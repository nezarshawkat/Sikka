/**
 * Authoritative Cairo rail station coordinates (Metro Lines 1–3 + Monorail).
 *
 * The route_path geometry already in the DB places many rail stations wrongly
 * (failed geocodes were snapped to a downtown fallback), so rail station
 * locations are curated here from verified public sources (official network
 * maps / OpenStreetMap) rather than derived. Keys use the same station-name
 * spellings as the seeded transit_lines so they reconcile via normalizeName.
 *
 * Coordinates are [latitude, longitude] at ~4-decimal (~10 m) precision.
 * Only stations whose location is verifiable are listed; uncertain/placeholder
 * names from the seed (e.g. NAC monorail stubs) are intentionally omitted rather
 * than guessed.
 */
export const RAIL_STATIONS: Record<string, [number, number]> = {
  // ── Metro Line 1 (Helwan ↔ New El Marg) ──────────────────────────────────
  Helwan: [29.8489, 31.3343],
  "Ain Helwan": [29.8606, 31.3236],
  "Wadi Hof": [29.877, 31.3133],
  "Hadayek Helwan": [29.8894, 31.3036],
  "El Maasara": [29.9065, 31.2984],
  "Tora El Asmant": [29.9176, 31.2932],
  Kozzika: [29.9271, 31.2899],
  "Tora El Balad": [29.9368, 31.2856],
  "Sakanat El Maadi": [29.9481, 31.2771],
  Maadi: [29.9601, 31.2576],
  "Hadayek El Maadi": [29.9687, 31.2613],
  "Dar El Salam": [29.9825, 31.2529],
  "El Zahraa": [29.9931, 31.2479],
  "Mar Girgis": [30.0061, 31.2299],
  "El Malek El Saleh": [30.0165, 31.2312],
  "Sayyida Zeinab": [30.0291, 31.2354],
  "Saad Zaghloul": [30.0357, 31.2389],
  Sadat: [30.0444, 31.2357],
  Nasser: [30.0537, 31.2387],
  Orabi: [30.0578, 31.2437],
  "Al Shohadaa": [30.0617, 31.2465],
  Ghamra: [30.0686, 31.2607],
  "El Demerdash": [30.0772, 31.2785],
  "Kobry El Qobba": [30.0862, 31.2884],
  "Hammamat El Qobba": [30.0917, 31.2944],
  "Saray El Qobba": [30.0972, 31.2988],
  "Hadayek El Zeitoun": [30.1059, 31.307],
  "Helmeyet El Zeitoun": [30.114, 31.3118],
  "El Matareyya": [30.1216, 31.311],
  "Ain Shams": [30.13, 31.3191],
  "Ezbet El Nakhl": [30.138, 31.3242],
  "El Marg": [30.1519, 31.3366],
  "New El Marg": [30.1626, 31.3372],

  // ── Metro Line 2 (Shobra El Kheima ↔ El Mounib) ──────────────────────────
  "Shobra El Kheima": [30.1227, 31.2446],
  "Kolleyet El Zeraa": [30.1131, 31.247],
  Mezallat: [30.1041, 31.2487],
  Khalafawy: [30.0959, 31.2467],
  "St. Teresa": [30.0879, 31.2462],
  "Rod El Farag": [30.0793, 31.2455],
  Massara: [30.0726, 31.2456],
  Attaba: [30.0522, 31.2475],
  "Mohamed Naguib": [30.047, 31.244],
  Opera: [30.0418, 31.2256],
  Dokki: [30.0383, 31.2122],
  "El Bohoos": [30.0364, 31.2008],
  "Cairo University": [30.0264, 31.201],
  Faisal: [30.0179, 31.1969],
  Giza: [30.0107, 31.2073],
  "Omm El Masryeen": [30.0033, 31.2083],
  "Sakiat Mekky": [29.9947, 31.2095],
  "El Mounib": [29.9814, 31.212],

  // ── Metro Line 3 (Adly Mansour ↔ Kit Kat / Rod El Farag) ─────────────────
  "Adly Mansour": [30.1463, 31.4214],
  "El Haykestep": [30.1419, 31.4036],
  "Omar Ibn El Khattab": [30.1352, 31.3933],
  Qobaa: [30.129, 31.3832],
  "Hesham Barakat": [30.123, 31.3735],
  "El Nozha": [30.1163, 31.3639],
  "Nadi El Shams": [30.1097, 31.3478],
  Haroun: [30.0987, 31.3403],
  "Al Ahram": [30.0922, 31.3289],
  "Heliopolis (Masr El Gedida)": [30.0876, 31.3246],
  Abbasiya: [30.0716, 31.2823],
  "Abdou Pasha": [30.0656, 31.279],
  "El Geish": [30.0606, 31.2693],
  "Bab El Shaaria": [30.0541, 31.2596],
  Naguib: [30.0498, 31.243],
  "Boulaq Abu El Ela": [30.0573, 31.2316],
  "Kit Kat": [30.0668, 31.2218],

  // ── Monorail (verifiable termini / major stations only) ───────────────────
  "Remaya Square": [29.993, 31.132],
  "Giza Square": [30.0125, 31.211],
  "6th October City": [29.945, 30.918],
  "6th October Center": [29.968, 30.942],
  "Sheikh Zayed City": [30.018, 30.97],
};
