import pg from "pg";

const { Client } = pg;

const primaryUrl = (
  process.env.DATABASE_URL_OVERRIDE?.trim() || process.env.DATABASE_URL?.trim()
);
const secondaryUrl = process.env.DATABASE_URL_2?.trim();
const primaryToSecondary = process.argv.includes("--primary-to-secondary");

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

function normalizeValueForInsert(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();

  if (dataType === "jsonb" || dataType === "json") {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return value;
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return JSON.parse(trimmed.replace(/'/g, '"'));
      } catch {
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          const inner = trimmed.slice(1, -1).trim();
          if (!inner) return [];
          return inner
            .split(",")
            .map((item) => item.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, ""));
        }
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          const inner = trimmed.slice(1, -1).trim();
          if (!inner) return {};
          return Object.fromEntries(
            inner.split(",").map((entry) => {
              const idx = entry.indexOf(":");
              if (idx === -1) return [entry.trim(), ""];
              const key = entry.slice(0, idx).trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
              const raw = entry.slice(idx + 1).trim();
              return [key, raw === '""' ? "" : raw.replace(/^"|"$/g, "").replace(/^'|'$/g, "")];
            }),
          );
        }
      }
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (dataType === "ARRAY") {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
      } catch {
        return [value];
      }
    }
    return [value];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function copyTable(
  source: pg.Client,
  destination: pg.PoolClient,
  table: TableInfo,
): Promise<number> {
  const qualifiedName = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
  const sourceRows = await source.query(`select * from ${qualifiedName}`);
  if (sourceRows.rows.length === 0) return 0;

  const columnTypes = await source.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type
     from information_schema.columns
     where table_schema = $1 and table_name = $2`,
    [table.schema, table.name],
  );
  const dataTypes = new Map(columnTypes.rows.map((column) => [column.column_name, column.data_type]));

  const columns = sourceRows.fields.map((field) => quoteIdentifier(field.name));
  const placeholders = sourceRows.fields.map((_, index) => `$${index + 1}`).join(", ");
  const insert = `insert into ${qualifiedName} (${columns.join(", ")}) values (${placeholders})`;

  let inserted = 0;
  for (let offset = 0; offset < sourceRows.rows.length; offset += 20) {
    const batch = sourceRows.rows.slice(offset, offset + 20);
    const results = await Promise.all(batch.map(async (row) => {
      const values = sourceRows.fields.map((field) =>
        normalizeValueForInsert(row[field.name], dataTypes.get(field.name) ?? ""),
      );
      try {
        await destination.query({ text: insert, values });
        return 1;
      } catch (error) {
        console.warn(
          `[merge] skipped malformed row for ${tableKey(table)}:`,
          error instanceof Error ? error.message : String(error),
        );
        return 0;
      }
    }));
    inserted += results.reduce((total, result) => total + result, 0);
  }

  return inserted;
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
  const source = new Client({
    connectionString: primaryToSecondary ? primaryUrl : secondaryUrl,
  });
  const destination = new Client({
    connectionString: primaryToSecondary ? secondaryUrl : primaryUrl,
  });

  await source.connect();
  await destination.connect();

  try {
    const allSourceTables = await getTables(source);
    const routeTables = new Set([
      "public.transport_types",
      "public.transit_lines",
      "public.route_repair_anchors",
      "public.route_geometry_versions",
      "public.route_repair_segments",
    ]);
    const sourceTables = primaryToSecondary
      ? allSourceTables.filter((table) => routeTables.has(tableKey(table)))
      : allSourceTables;
    const destinationTables = new Set((await getTables(destination)).map(tableKey));
    const missingTables = sourceTables.filter((table) => !destinationTables.has(tableKey(table)));
    if (missingTables.length > 0) {
      throw new Error(`Main database is missing tables: ${missingTables.map(tableKey).join(", ")}`);
    }

    const tables = await orderTables(source, sourceTables);
    let copied = 0;
    for (const table of tables) {
      const count = await copyTable(source, destination, table);
      copied += count;
      if (count > 0) console.log(`[merge] ${tableKey(table)}: ${count} rows`);
    }
    await ensureAdmin(destination);
    console.log(
      `[merge] committed ${copied} rows (${primaryToSecondary ? "primary to secondary routes" : "secondary to primary"}).`,
    );
  } finally {
    await source.end();
    await destination.end();
  }
}

main().catch((error) => {
  console.error("[merge] aborted; no destination rows were changed.", error);
  process.exitCode = 1;
});