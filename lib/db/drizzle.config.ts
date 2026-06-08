import { defineConfig } from "drizzle-kit";
import path from "path";

const override = process.env.DATABASE_URL_OVERRIDE?.trim();
const databaseUrl = override || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "No database connection string found. Set DATABASE_URL_OVERRIDE (preferred) or DATABASE_URL.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
