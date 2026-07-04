import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/scripts/importStops.ts"),
      path.resolve(artifactDir, "src/scripts/enrichBusPaths.ts"),
      path.resolve(artifactDir, "src/scripts/runGtfsImport.ts"),
      path.resolve(artifactDir, "src/scripts/generateOfflineRoadCandidates.ts"),
      path.resolve(artifactDir, "src/scripts/auditOfflineRoadCandidates.ts"),
      path.resolve(artifactDir, "src/scripts/importOfflineRoadCandidates.ts"),
      path.resolve(artifactDir, "src/scripts/upgradeMediumWithOsmNames.ts"),
      path.resolve(artifactDir, "src/scripts/regenerateRoutesWithGoogle.ts"),
      path.resolve(artifactDir, "src/scripts/auditStoredRouteGeometry.ts"),
      path.resolve(artifactDir, "src/scripts/exportBundledSnapshotFromDb.ts"),
      path.resolve(artifactDir, "src/scripts/rollbackUncertainGoogleRoutes.ts"),
      path.resolve(artifactDir, "src/scripts/quarantineUnreasonableGoogleRoutes.ts"),
      path.resolve(artifactDir, "src/scripts/quarantineFailedAuditRoutes.ts"),
      path.resolve(artifactDir, "src/scripts/regenerateFixedGuidewayRoutes.ts"),
      path.resolve(artifactDir, "src/scripts/backfillActiveGoogleAnchorTrails.ts"),
      path.resolve(artifactDir, "src/scripts/acceptCurrentMetroRoutes.ts"),
      path.resolve(artifactDir, "src/scripts/prepareDeviceRouteSeed.ts"),
      path.resolve(artifactDir, "src/scripts/seedPreparedDeviceRoutes.ts"),
      path.resolve(artifactDir, "src/scripts/applyPreparedDeviceRouteSeedToBackend.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  // The bundled server still reads seed JSON files at runtime with paths like
  // ../data/egyptTransitSeed.json from dist/index.mjs. In production, that
  // resolves to artifacts/api-server/data, so copy vendored data there during
  // every build. Without this, Render starts successfully but crashes on boot
  // with ENOENT: artifacts/api-server/data/egyptTransitSeed.json.
  const srcDataDir = path.resolve(artifactDir, "src/data");
  const runtimeDataDir = path.resolve(artifactDir, "data");
  await rm(runtimeDataDir, { recursive: true, force: true });
  await cp(srcDataDir, runtimeDataDir, { recursive: true });

}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
