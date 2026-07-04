import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createBrotliCompress, constants as zlibConstants } from 'node:zlib';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createRoadGraphBuilder } from './lib/overtureRoadGraph.mjs';

const DEFAULT_RELEASE = '2026-06-17.0';
const DEFAULT_BOUNDS = [29.55, 29.55, 32.05, 31.5];

function flag(name, fallback) {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function intersects(a, b) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function parquetAssets(release, bounds) {
  const base = `https://stac.overturemaps.org/${release}/transportation/segment/`;
  const collection = await fetchJson(`${base}collection.json`);
  const itemUrls = collection.links
    .filter((link) => link.rel === 'item')
    .map((link) => new URL(link.href, base).href);
  const matches = [];
  let cursor = 0;
  async function worker() {
    while (cursor < itemUrls.length) {
      const url = itemUrls[cursor++];
      const item = await fetchJson(url);
      if (Array.isArray(item.bbox) && intersects(item.bbox, bounds)) matches.push(item.assets?.aws?.href ?? item.assets?.azure?.href);
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  return matches.filter(Boolean);
}

async function runDuckDb(executable, sql) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.end(sql);
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`DuckDB exited with ${code}`)));
  });
}

async function buildGraphs(filePath, modes) {
  const builders = Object.fromEntries(modes.map((mode) => [mode, createRoadGraphBuilder({ mode })]));
  let featureCount = 0;
  const input = readline.createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    let geometry;
    try { geometry = typeof row.geometry_json === 'string' ? JSON.parse(row.geometry_json) : row.geometry_json; } catch { continue; }
    const feature = {
      id: row.id,
      subtype: row.subtype,
      class: row.class,
      name: row.name,
      connectors: row.connectors,
      access_restrictions: row.access_restrictions,
      prohibited_transitions: row.prohibited_transitions,
      geometry,
    };
    for (const builder of Object.values(builders)) builder.addFeature(feature);
    featureCount++;
    if (featureCount % 50_000 === 0) console.log(`Indexed ${featureCount} Overture road segments...`);
  }
  return { featureCount, graphs: Object.fromEntries(Object.entries(builders).map(([mode, builder]) => [mode, builder.finish()])) };
}

async function writeBrotliJson(filePath, value) {
  const temporary = `${filePath}.json`;
  await writeFile(temporary, JSON.stringify(value));
  await pipeline(
    createReadStream(temporary),
    createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } }),
    (await import('node:fs')).createWriteStream(filePath),
  );
  await rm(temporary, { force: true });
}

async function main() {
  const root = process.cwd();
  const release = flag('release', DEFAULT_RELEASE);
  const bounds = flag('bbox', DEFAULT_BOUNDS.join(',')).split(',').map(Number);
  if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) throw new Error('Invalid --bbox');
  const duckdb = flag('duckdb', process.env.DUCKDB_BIN || 'duckdb');
  const output = path.resolve(flag('output', path.join(root, 'scripts/generated/overture-egypt-road-graph.json.br')));
  const raw = path.resolve(flag('raw', path.join(root, 'scripts/generated/overture-egypt-road-segments.ndjson')));
  const requestedMode = flag('mode', 'road');
  const modes = requestedMode === 'both' ? ['road', 'pedestrian'] : [requestedMode];
  if (modes.some((mode) => mode !== 'road' && mode !== 'pedestrian')) throw new Error('Invalid --mode; use road, pedestrian, or both');
  await mkdir(path.dirname(output), { recursive: true });

  if (!process.argv.includes('--reuse-raw')) {
    const assets = await parquetAssets(release, bounds);
    if (!assets.length) throw new Error('No Overture segment partitions intersect the requested bounds');
    const quotedAssets = assets.map((asset) => `'${asset.replaceAll("'", "''")}'`).join(',\n');
    const [west, south, east, north] = bounds;
    const rawSqlPath = raw.replaceAll('\\', '/').replaceAll("'", "''");
    const sql = `
INSTALL spatial;
LOAD spatial;
COPY (
  SELECT id, subtype, class, names.primary AS name, connectors, access_restrictions,
         prohibited_transitions, ST_AsGeoJSON(geometry) AS geometry_json
  FROM read_parquet([${quotedAssets}])
  WHERE subtype = 'road'
    AND bbox.xmin < ${east} AND bbox.xmax > ${west}
    AND bbox.ymin < ${north} AND bbox.ymax > ${south}
) TO '${rawSqlPath}' (FORMAT JSON, ARRAY false);
`;
    console.log(`Extracting Overture ${release} roads from ${assets.length} spatial partitions...`);
    await runDuckDb(duckdb, sql);
  } else {
    console.log(`Reusing cached raw Overture extract: ${raw}`);
  }
  console.log(`Streaming Overture segments into ${modes.join(' + ')} graph...`);
  const { featureCount, graphs } = await buildGraphs(raw, modes);
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    overtureRelease: release,
    bounds,
    ...graphs,
  };
  await writeBrotliJson(output, payload);
  if (!process.argv.includes('--keep-raw')) await rm(raw, { force: true });
  console.log(JSON.stringify({
    output,
    sourceSegments: featureCount,
    graphs: Object.fromEntries(Object.entries(graphs).map(([mode, graph]) => [mode, { nodes: graph.nodes.length, edges: graph.edges.length }])),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
