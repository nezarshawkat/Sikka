import fs from "fs";
import pg from "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CSV = {
  nta: "NTA_Busses_data_Cairo_1780318927061.csv",
  cta: "Cairo_Bus_Lines_All_1780318927059.csv",
  microbus: "Cairo_Microbus_Full_Data_1780318927060.csv",
  serfis: "serfis_with_stations_1780318927062.csv",
};
const DIR = "/home/runner/workspace/attached_assets/";

const parsePriceEGP = (str) => {
  if (!str || str.trim() === "-") return 0;
  const m = str.trim().split(/\s*-\s*/)[0].match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
};
const parseArabicStops = (raw) =>
  !raw || raw.trim() === "-" ? [] : raw.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
const parseCSVLine = (line) => {
  const result = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  result.push(cur.trim());
  return result;
};
const read = (f) => fs.readFileSync(DIR + f, "utf-8");

async function insertLine(o) {
  try {
    await pool.query(
      `INSERT INTO transit_lines
        (transport_type_id, line_number, name_en, name_ar, from_area, to_area, via_stops, price_egp, has_fixed_stops, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,true)`,
      [o.transportTypeId, o.lineNumber, o.nameEn, o.nameAr, o.fromArea, o.toArea, o.viaStops, o.priceEgp]
    );
    return "seeded";
  } catch (e) {
    if (e.code === "23505") return "skipped";
    throw e;
  }
}

const main = async () => {
  const types = await pool.query(
    "SELECT id, name_en FROM transport_types WHERE name_en IN ('NTA Bus','CTA Bus','Microbus','Serfis')"
  );
  const idOf = {};
  for (const r of types.rows) idOf[r.name_en] = r.id;
  const ntaId = idOf["NTA Bus"],
    ctaId = idOf["CTA Bus"],
    microbusId = idOf["Microbus"],
    serfisId = idOf["Serfis"];
  console.log("Type IDs:", idOf);
  if (!ntaId || !ctaId || !microbusId || !serfisId) throw new Error("Missing transport type");

  const del = await pool.query(
    "DELETE FROM transit_lines WHERE transport_type_id = ANY($1::uuid[]) RETURNING id",
    [[ntaId, ctaId, microbusId, serfisId]]
  );
  console.log("Cleared lines:", del.rowCount);

  const counts = { ntaBus: 0, ctaBus: 0, microbus: 0, serfis: 0, skipped: 0 };
  const errors = [];

  // NTA: رقم الخط, المسار, المواقف, التعريفة
  try {
    const lines = read(CSV.nta).replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 3) continue;
      const lineNum = cols[0]?.trim() || null;
      const routeAr = cols[1]?.trim() || "";
      const stops = parseArabicStops(cols[2]?.trim() || "");
      const price = parsePriceEGP(cols[3] || "20");
      const fromArea = stops[0] || routeAr.split(/[–-]/)[0].trim();
      const toArea = stops[stops.length - 1] || routeAr.split(/[–-]/).pop()?.trim() || "";
      const r = await insertLine({
        transportTypeId: ntaId,
        lineNumber: lineNum,
        nameAr: lineNum ? `خط ${lineNum}: ${fromArea} → ${toArea}` : `${fromArea} → ${toArea}`,
        nameEn: lineNum ? `NTA Line ${lineNum}` : `NTA Route`,
        fromArea,
        toArea,
        viaStops: stops.slice(1, -1),
        priceEgp: price,
      });
      r === "seeded" ? counts.ntaBus++ : counts.skipped++;
    }
  } catch (e) {
    errors.push(`NTA: ${e.message}`);
  }

  // CTA (Cairo Bus Lines): رقم الخط, المواقف, السعر
  try {
    const lines = read(CSV.cta).replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 2) continue;
      const lineNum = cols[0]?.trim() || null;
      const stops = parseArabicStops(cols[1]?.trim() || "");
      const price = parsePriceEGP(cols[2] || "20");
      const fromArea = stops[0] || "";
      const toArea = stops[stops.length - 1] || "";
      const r = await insertLine({
        transportTypeId: ctaId,
        lineNumber: lineNum,
        nameAr: lineNum ? `خط ${lineNum}: ${fromArea} → ${toArea}` : `${fromArea} → ${toArea}`,
        nameEn: lineNum ? `CTA Line ${lineNum}` : `CTA Route`,
        fromArea,
        toArea,
        viaStops: stops.slice(1, -1),
        priceEgp: price,
      });
      r === "seeded" ? counts.ctaBus++ : counts.skipped++;
    }
  } catch (e) {
    errors.push(`CTA: ${e.message}`);
  }

  // Microbus: رقم الخط, خط السير, المواقف, السعر
  try {
    const lines = read(CSV.microbus).replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 3) continue;
      const routeAr = cols[1]?.trim() || "";
      const stops = parseArabicStops(cols[2]?.trim() || "");
      const price = parsePriceEGP(cols[3] || "8");
      const routeParts = routeAr.split(/\s*-\s*/);
      const fromArea = routeParts[0]?.trim() || stops[0] || "";
      const toArea = routeParts[routeParts.length - 1]?.trim() || stops[stops.length - 1] || "";
      const r = await insertLine({
        transportTypeId: microbusId,
        lineNumber: null,
        nameAr: routeAr || `${fromArea} → ${toArea}`,
        nameEn: `Microbus: ${fromArea} → ${toArea}`,
        fromArea,
        toArea,
        viaStops: stops.slice(1, -1),
        priceEgp: price,
      });
      r === "seeded" ? counts.microbus++ : counts.skipped++;
    }
  } catch (e) {
    errors.push(`Microbus: ${e.message}`);
  }

  // Serfis: م, خطوط السير, المواقف, (جنية),(قرش), بعد الزيادة (جنية),(قرش)
  try {
    const lines = read(CSV.serfis).replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 4) continue;
      const lineNum = cols[0]?.trim() || null;
      const routeAr = cols[1]?.trim() || "";
      const stops = parseArabicStops(cols[2]?.trim() || "");
      const pricePounds = parseFloat(cols[5] || cols[3] || "8") || 0;
      const pricePiastres = parseFloat(cols[6] || cols[4] || "0") || 0;
      const price = pricePounds + pricePiastres / 100;
      const routeParts = routeAr.split(/\s*-\s*/);
      const fromArea = routeParts[0]?.trim() || stops[0] || "";
      const toArea = routeParts[routeParts.length - 1]?.trim() || stops[stops.length - 1] || "";
      const r = await insertLine({
        transportTypeId: serfisId,
        lineNumber: lineNum,
        nameAr: routeAr || `${fromArea} → ${toArea}`,
        nameEn: lineNum ? `Serfis Line ${lineNum}` : `Serfis Route`,
        fromArea,
        toArea,
        viaStops: stops.slice(1, -1),
        priceEgp: price,
      });
      r === "seeded" ? counts.serfis++ : counts.skipped++;
    }
  } catch (e) {
    errors.push(`Serfis: ${e.message}`);
  }

  console.log("Cleared:", del.rowCount);
  console.log("Seeded:", counts);
  console.log("Errors:", errors);
  await pool.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
