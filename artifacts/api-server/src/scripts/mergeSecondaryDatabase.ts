import pg from "pg";

const { Client } = pg;

const primaryUrl = (
  process.env.DATABASE_URL_OVERRIDE?.trim() || process.env.DATABASE_URL?.trim()
);
const secondaryUrl = process.env.DATABASE_URL_2?.trim();

if (!primaryUrl || !secondaryUrl) {
  throw new Error(
    "Set DATABASE_URL (or DATABASE_URL_OVERRIDE) and DATABASE_URL_2 before running the append-only merge.",
  );
}

type TableInfo = {
  schema: string;
  name: string;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableKey(table: TableInfo): string {
  return `${table.schema}.${table.name}`;
}

async function getTables(client: pg.Client): Promise<TableInfo[]> {
  const result = await client.query<TableInfo>(`
    select table_schema as "schema", table_name as "name"
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema not in ('pg_catalog', 'information_schema')
    order by table_schema, table_name
  `);
  return result.rows;
}

async function orderTables(client: pg.Client, tables: TableInfo[]): Promise<TableInfo[]> {
  const tableKeys = new Set(tables.map(tableKey));
  const dependencies = new Map<string, Set<string>>(
    tables.map((table) => [tableKey(table), new Set<string>()]),
  );
  const foreignKeys = await client.query<{
    schema: string;
    table: string;
    foreignSchema: string;
    foreignTable: string;
  }>(`
    select
      tc.table_schema as schema,
      tc.table_name as table,
      ccu.table_schema as "foreignSchema",
      ccu.table_name as "foreignTable"
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
  `);

  for (const foreignKey of foreignKeys.rows) {
    const child = `${foreignKey.schema}.${foreignKey.table}`;
    const parent = `${foreignKey.foreignSchema}.${foreignKey.foreignTable}`;
    if (tableKeys.has(child) && tableKeys.has(parent) && child !== parent) {
      dependencies.get(child)?.add(parent);
    }
  }

  const ordered: TableInfo[] = [];
  const remaining = new Map(dependencies);
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, required]) => [...required].every((dependency) => !remaining.has(dependency)))
      .map(([key]) => key);

    if (ready.length === 0) {
      throw new Error("Cannot determine a safe foreign-key order; refusing to merge.");
    }

    for (const key of ready.sort()) {
      ordered.push(tables.find((table) => tableKey(table) === key)!);
      remaining.delete(key);
    }
  }

  return ordered;
}

async function copyTable(
  source: pg.Client,
  destination: pg.PoolClient,
  table: TableInfo,
): Promise<number> {
  const qualifiedName = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
  const sourceRows = await source.query(`select * from ${qualifiedName}`);
  if (sourceRows.rows.length === 0) return 0;

  const columns = sourceRows.fields.map((field) => quoteIdentifier(field.name));
  const placeholders = sourceRows.fields.map((_, index) => `$${index + 1}`).join(", ");
  const insert = `insert into ${qualifiedName} (${columns.join(", ")}) values (${placeholders})`;

  for (const row of sourceRows.rows) {
    await destination.query({
      text: insert,
      values: sourceRows.fields.map((field) => row[field.name]),
    });
  }

  return sourceRows.rows.length;
}

async function ensureAdmin(destination: pg.PoolClient): Promise<void> {
  await destination.query(
    `insert into "profiles" ("user_id", "language", "nationality", "display_name")
     values ('sikka-admin', 'en', 'egyptian', 'Admin')
     on conflict ("user_id") do nothing`,
  );
  await destination.query(
    `insert into "user_roles" ("user_id", "role")
     select 'sikka-admin', 'admin'
     where not exists (
       select 1 from "user_roles" where "user_id" = 'sikka-admin' and "role" = 'admin'
     )`,
  );
}

async function main(): Promise<void> {
  const source = new Client({ connectionString: secondaryUrl });
  const destination = new Client({ connectionString: primaryUrl });

  await source.connect();
  await destination.connect();

  try {
    const sourceTables = await getTables(source);
    const destinationTables = new Set((await getTables(destination)).map(tableKey));
    const missingTables = sourceTables.filter((table) => !destinationTables.has(tableKey(table)));
    if (missingTables.length > 0) {
      throw new Error(`Main database is missing tables: ${missingTables.map(tableKey).join(", ")}`);
    }

    const tables = await orderTables(source, sourceTables);
    const destinationTransaction = await destination.query("begin");
    void destinationTransaction;

    try {
      let copied = 0;
      for (const table of tables) {
        const count = await copyTable(source, destination, table);
        copied += count;
        if (count > 0) console.log(`[merge] ${tableKey(table)}: ${count} rows`);
      }
      await ensureAdmin(destination);
      await destination.query("commit");
      console.log(`[merge] committed ${copied} rows and ensured the Nezar admin account.`);
    } catch (error) {
      await destination.query("rollback");
      throw error;
    }
  } finally {
    await source.end();
    await destination.end();
  }
}

main().catch((error) => {
  console.error("[merge] aborted; no destination rows were changed.", error);
  process.exitCode = 1;
});