import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SNAPSHOT_PATH = path.join(ROOT, "artifacts/sikka/src/data/bundledSnapshot.json");
const PREPARED_PATH = path.join(ROOT, "scripts/generated/prepared-device-route-seed.json");
const PREPARED_MANIFEST_PATH = path.join(ROOT, "scripts/generated/prepared-device-route-seed-manifest.json");
const API_SEED_PATHS = [
  path.join(ROOT, "artifacts/api-server/src/data/egyptTransitSeed.json"),
  path.join(ROOT, "artifacts/api-server/data/egyptTransitSeed.json"),
];
const STUDY_OUTPUT_PATH = path.join(ROOT, "scripts/generated/greater-cairo-road-transport-study.json");
const BRT_OUTPUT_PATH = path.join(ROOT, "scripts/generated/cairo-brt-phase1-google-route.json");
const MICROBUS_REPAIR_OUTPUT_PATH = path.join(ROOT, "scripts/generated/greater-cairo-microbus-brt-ban-repairs.json");
const GOOGLE_DIRECTIONS_URL = "https://maps.googleapis.com/maps/api/directions/json";

const BRT_SOURCE_URLS = {
  presidency: "https://www.presidency.eg/en/%D8%A7%D9%84%D9%85%D8%B4%D8%A7%D8%B1%D9%8A%D8%B9-%D8%A7%D9%84%D9%82%D9%88%D9%85%D9%8A%D8%A9/projects162025/",
  ahramBan: "https://english.ahram.org.eg/News/546452.aspx",
  ahramFactbox: "https://english.ahram.org.eg/News/546581.aspx",
  cairoGovernorate: "https://cairo.gov.eg/ar/Interactive%20Services/Transportation/Pages/Frequent_bus_detials.aspx?NID=3",
  transportForCairoWorldBank: "https://transportforcairo.com/wp-content/uploads/2020/04/WB_GCR_Multi-modal-Transport-Stragey_2019_en_v2.pdf",
  pressPostStationDetails: "https://thepresspost.com/names-shuttle-bus-stations-egypt-ring-road-how-to-arrival/",
  dailyNewsStationDetails: "https://www.dailynewsegypt.com/2025/06/01/egypt-launches-trial-operation-of-cairo-ring-road-brt-first-phase/",
};

const BRT_ORIGIN = [31.2155439, 30.1641142];
const BRT_DESTINATION = [31.4199, 30.0458];

const BRT_STATIONS = [
  {
    nameEn: "Alexandria Agricultural Road",
    nameAr: "طريق الإسكندرية الزراعي",
    fraction: 0,
    access: "Pedestrian tunnel",
    serves: ["Cairo-Alexandria Agricultural Road", "Banha", "Toukh", "Qalyub", "Shubra El Kheima", "Ring Road access"],
  },
  {
    nameEn: "Colonel Ahmed Abdel Rahim",
    nameAr: "العقيد أحمد عبد الرحيم",
    fraction: 0.075,
    access: "Pedestrian tunnel",
    serves: ["El-Sharqaweya", "Mit Halfa", "Mit Nama"],
  },
  {
    nameEn: "Shubra Banha",
    nameAr: "شبرا بنها",
    fraction: 0.145,
    access: "Pedestrian tunnel",
    serves: ["Shubra-Banha Freeway", "Al-Assar Axis"],
  },
  {
    nameEn: "Bahtim",
    nameAr: "بهتيم",
    fraction: 0.205,
    access: "Pedestrian bridge",
    serves: ["Bahtim", "West Shubra El Kheima", "Eskoo Club Street"],
  },
  {
    nameEn: "Mostorod",
    nameAr: "مسطرد",
    fraction: 0.275,
    access: "Pedestrian tunnel",
    serves: ["Mostorod", "Ismailia Canal", "Ismailia Agricultural Road", "Belbeis Road", "Amiriya", "Matareya"],
  },
  {
    nameEn: "El Khosous",
    nameAr: "الخصوص",
    fraction: 0.35,
    access: "Pedestrian tunnel",
    serves: ["El Khosous"],
  },
  {
    nameEn: "El Marg",
    nameAr: "المرج",
    fraction: 0.43,
    access: "Pedestrian tunnel",
    serves: ["New El Marg", "Marg-Khanka axis"],
    interchange: ["Cairo Metro Line 1 at El Marg"],
  },
  {
    nameEn: "El Qalag",
    nameAr: "القلج",
    fraction: 0.505,
    access: "Pedestrian tunnel",
    serves: ["El Qalag", "Mohamed Naguib Road"],
  },
  {
    nameEn: "Zakat Foundation",
    nameAr: "مؤسسة الزكاة",
    fraction: 0.585,
    access: "Pedestrian tunnel",
    serves: ["Zakat Foundation", "Ain Shams"],
  },
  {
    nameEn: "General Ibrahim El Oraby",
    nameAr: "الفريق إبراهيم العرابي",
    fraction: 0.665,
    access: "Pedestrian tunnel",
    serves: ["100 Street", "El Herafeyeen"],
  },
  {
    nameEn: "El Salam",
    nameAr: "السلام",
    fraction: 0.735,
    access: "Pedestrian tunnel",
    serves: ["El Salam", "El Salam Station", "El Nahda City", "El Salam Stadium"],
  },
  {
    nameEn: "Adly Mansour",
    nameAr: "عدلي منصور",
    fraction: 0.815,
    access: "Non-standard interchange station",
    serves: ["Gesr El Suez", "Hikestep", "El Obour", "Ismailia Road"],
    interchange: ["Cairo Metro Line 3", "Cairo LRT", "Cairo-Suez railway", "SuperJet"],
  },
  {
    nameEn: "Suez Road",
    nameAr: "طريق السويس",
    fraction: 0.9,
    access: "Pedestrian tunnel",
    serves: ["Cairo-Suez Road", "Nasr City", "Almaza", "First Settlement", "New Administrative Capital corridor"],
  },
  {
    nameEn: "Police Academy",
    nameAr: "أكاديمية الشرطة",
    fraction: 1,
    access: "Pedestrian bridge",
    serves: ["Police Academy", "Zahraa Nasr City", "First Settlement", "Cairo Festival City"],
  },
];

const SOURCE_DETAILS = [
  {
    id: "brt-phase1-official",
    url: BRT_SOURCE_URLS.presidency,
    evidence: [
      "Phase 1 is 35 km from Ring Road/Alexandria Agricultural Road to Police Academy.",
      "The official station list contains 14 stations.",
      "Adly Mansour is an interchange; Bahtim and Police Academy use pedestrian bridges; the other surface stations use tunnels.",
    ],
  },
  {
    id: "brt-microbus-ban",
    url: BRT_SOURCE_URLS.ahramBan,
    evidence: [
      "Microbuses are banned from the 35 km Ring Road stretch between Cairo-Alexandria Agricultural Road and Police Academy.",
    ],
  },
  {
    id: "brt-network-factbox",
    url: BRT_SOURCE_URLS.ahramFactbox,
    evidence: [
      "The BRT is a dedicated-lane Ring Road system and will replace microbuses on the Ring Road.",
      "Phase 1 has 14 stations and Phase 2/3 continue the Ring Road network.",
    ],
  },
  {
    id: "cairo-governorate-brt-network",
    url: BRT_SOURCE_URLS.cairoGovernorate,
    evidence: [
      "Cairo Governorate publishes the wider Ring Road BRT station list and notes access by tunnel or pedestrian stair/bridge.",
    ],
  },
  {
    id: "world-bank-tfc-route-survey",
    url: BRT_SOURCE_URLS.transportForCairoWorldBank,
    evidence: [
      "The 2019 Greater Cairo study collected 603 bus routes: 181 CTA, 62 minibus, and 360 informal routes covering Cairo, Giza, and Qalyubia.",
      "The study data was available as GIS and GTFS and represents comprehensive geographic coverage.",
    ],
  },
  {
    id: "brt-station-service-areas",
    url: BRT_SOURCE_URLS.dailyNewsStationDetails,
    evidence: [
      "Published station-by-station service areas align with the official phase-1 station order.",
    ],
  },
];

const CORRIDORS = [
  {
    id: "brt_phase1_ring_road",
    name: "Ring Road, phase 1 BRT segment",
    modeRule: "Cairo BRT only; microbuses banned on the 35 km Alexandria Agricultural Road to Police Academy section.",
    patterns: ["الدائري", "ring road", "brt", "اكاديمية الشرطة", "أكاديمية الشرطة", "اسكندرية الزراعي", "الإسكندرية الزراعي"],
    sourceIds: ["brt-phase1-official", "brt-microbus-ban", "brt-network-factbox"],
  },
  {
    id: "alexandria_agricultural_qalyub",
    name: "Cairo-Alexandria Agricultural Road / Qalyub / Shubra El Kheima",
    modeRule: "Bus and microbus feeder corridor; BRT station access at the Ring Road interchange.",
    patterns: ["اسكندرية الزراعي", "الإسكندرية الزراعي", "agricultural", "قليوب", "qalyub", "شبرا الخيمة", "shubra el kheima"],
    sourceIds: ["brt-station-service-areas", "world-bank-tfc-route-survey"],
  },
  {
    id: "shubra_banha_assar",
    name: "Shubra-Banha Freeway / Al-Assar Axis",
    modeRule: "Road public transport feeder corridor to the northern Ring Road.",
    patterns: ["شبرا بنها", "shubra banha", "العصار", "assar"],
    sourceIds: ["brt-station-service-areas"],
  },
  {
    id: "ismailia_belbeis_mostorod",
    name: "Ismailia Agricultural Road / Belbeis / Mostorod",
    modeRule: "Bus and microbus corridor feeding Mostorod and eastern Cairo.",
    patterns: ["مسطرد", "mostorod", "ترعة الاسماعيلية", "ترعة الإسماعيلية", "ismailia canal", "الاسماعيلية الزراعي", "الإسماعيلية الزراعي", "بلبيس", "belbeis"],
    sourceIds: ["brt-station-service-areas"],
  },
  {
    id: "gesr_el_suez_adly_mansour",
    name: "Gesr El Suez / Adly Mansour / Hikestep",
    modeRule: "Major bus/microbus and metro/LRT interchange corridor.",
    patterns: ["جسر السويس", "gesr el suez", "adly mansour", "عدلي منصور", "الهايكستب", "hikestep", "هايكستب"],
    sourceIds: ["brt-phase1-official", "brt-station-service-areas"],
  },
  {
    id: "cairo_suez_road",
    name: "Cairo-Suez Road",
    modeRule: "Bus and regional-road corridor; BRT station access at Ring Road/Suez Road.",
    patterns: ["طريق السويس", "suez road", "القاهرة السويس", "cairo suez", "الماظة", "almaza"],
    sourceIds: ["brt-station-service-areas"],
  },
  {
    id: "nasr_road_salah_salem_abbasia",
    name: "Nasr Road / Salah Salem / Abbasia",
    modeRule: "Core CTA/NTA bus corridor through Nasr City, Abbasia, and central Cairo.",
    patterns: ["طريق النصر", "nasr road", "صلاح سالم", "salah salem", "العباسية", "abbasia", "يوسف عباس", "youssef abbas"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "ramses_attaba_downtown",
    name: "Ramses / Attaba / Abd Al Moneim Riad / Downtown",
    modeRule: "Central Cairo bus terminal and interchange corridor.",
    patterns: ["رمسيس", "ramses", "عتبة", "attaba", "عبد المنعم رياض", "abdel monem", "abd al moneim", "التحرير", "tahrir"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "shubra_helmy_mozallat",
    name: "Shubra Street / Ahmed Helmy / El Mozallat",
    modeRule: "North-central bus corridor connecting Shubra, Ahmed Helmy, and Ramses.",
    patterns: ["شارع شبرا", "shubra street", "احمد حلمي", "أحمد حلمي", "ahmed helmy", "المظلات", "mozallat"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "autostrad_maadi_helwan",
    name: "Autostrad / Maadi / Helwan / Sayeda Aisha",
    modeRule: "South Cairo bus and microbus corridor.",
    patterns: ["الأوتوستراد", "الاوتوستراد", "autostrad", "المعادي", "maadi", "حلوان", "helwan", "السيدة عائشة", "sayeda aisha", "صقر قريش"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "corniche_nile_giza",
    name: "Nile Corniche / Giza Square / University Bridge",
    modeRule: "Cairo-Giza bus and microbus crossing corridor.",
    patterns: ["الكورنيش", "corniche", "المنيب", "moneeb", "ميدان الجيزة", "giza square", "كوبري الجامعة", "university bridge"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "haram_faisal_mariouteya",
    name: "Al Haram / Faisal / Mariouteya / Tersa",
    modeRule: "Western Giza bus/microbus corridor and BRT phase-2 feeder area.",
    patterns: ["الهرم", "haram", "فيصل", "faisal", "المريوطية", "mariouteya", "ترسا", "tersa", "الطالبية", "talbia"],
    sourceIds: ["brt-network-factbox", "world-bank-tfc-route-survey"],
  },
  {
    id: "october_26_july_wahat",
    name: "26 July Corridor / 15 May Bridge / Wahat / 6th of October",
    modeRule: "Western NUC formal and informal road-transit corridor.",
    patterns: ["26 يوليو", "26 july", "المحور", "mehwar", "15 مايو", "15 may", "الواحات", "wahat", "اكتوبر", "أكتوبر", "october"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "new_cairo_road_90",
    name: "New Cairo / Road 90 / Fifth Settlement / AUC",
    modeRule: "New Cairo bus, minibus, and microbus corridor.",
    patterns: ["التجمع", "settlement", "الحي الخامس", "fifth", "شارع التسعين", "road 90", "التسعين", "auc", "الجامعة الامريكية", "الجامعة الأمريكية"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "obour_shorouk_ismailia_desert",
    name: "Obour / Shorouk / Ismailia Desert Road / 10th of Ramadan",
    modeRule: "Eastern NUC formal and informal road-transit corridor.",
    patterns: ["العبور", "obour", "الشروق", "shorouk", "طريق الاسماعيلية الصحراوي", "طريق الإسماعيلية الصحراوي", "ismailia desert", "العاشر من رمضان", "10th of ramadan"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "port_said_ghamra_azhar",
    name: "Port Said Street / Ghamra / Al Azhar",
    modeRule: "Historic central/north Cairo bus corridor.",
    patterns: ["بورسعيد", "port said", "غمرة", "ghamra", "الأزهر", "الازهر", "azhar", "الدراسة", "darassa"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
  {
    id: "qalyub_shebin_qanater",
    name: "Qalyub / Shebin El Qanater / Qanater",
    modeRule: "Qalyubia bus and microbus corridor.",
    patterns: ["قليوب", "qalyub", "شبين القناطر", "shebin", "القناطر", "qanater", "طنان", "tanan"],
    sourceIds: ["world-bank-tfc-route-survey"],
  },
];

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

function argValue(name, fallback = undefined) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function decodePolyline5(encoded) {
  const output = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const decodeValue = () => {
      let result = 0;
      let shift = 0;
      let byte = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      return (result & 1) ? ~(result >> 1) : result >> 1;
    };
    latitude += decodeValue();
    longitude += decodeValue();
    output.push([longitude / 1e5, latitude / 1e5]);
  }
  return output;
}

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function pathLengthKm(points) {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += haversineKm(points[index - 1], points[index]);
  return total;
}

function validLngLat(point) {
  return Array.isArray(point)
    && Number.isFinite(point[0])
    && Number.isFinite(point[1])
    && point[0] >= 24.5
    && point[0] <= 36.9
    && point[1] >= 21.5
    && point[1] <= 31.8;
}

function pointAtKm(points, targetKm) {
  let traveled = 0;
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1];
    const after = points[index];
    const segmentKm = haversineKm(before, after);
    if (traveled + segmentKm >= targetKm) {
      const ratio = segmentKm > 0 ? (targetKm - traveled) / segmentKm : 0;
      return [
        Number((before[0] + (after[0] - before[0]) * ratio).toFixed(6)),
        Number((before[1] + (after[1] - before[1]) * ratio).toFixed(6)),
      ];
    }
    traveled += segmentKm;
  }
  const last = points.at(-1);
  return [Number(last[0].toFixed(6)), Number(last[1].toFixed(6))];
}

function distancePointToSegmentKm(point, start, end) {
  const latRad = point[1] * Math.PI / 180;
  const x = (lng, lat) => [lng * Math.cos(latRad) * 111.32, lat * 110.57];
  const p = x(point[0], point[1]);
  const a = x(start[0], start[1]);
  const b = x(end[0], end[1]);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq)) : 0;
  const q = [a[0] + dx * t, a[1] + dy * t];
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

function nearestPathDistanceKm(point, pathPoints) {
  let best = Infinity;
  for (let index = 1; index < pathPoints.length; index++) {
    best = Math.min(best, distancePointToSegmentKm(point, pathPoints[index - 1], pathPoints[index]));
  }
  return best;
}

function routeShareNearPath(routePath, referencePath, thresholdKm = 0.25) {
  if (!Array.isArray(routePath) || routePath.length < 2) return 0;
  const samples = [];
  const stride = Math.max(1, Math.floor(routePath.length / 80));
  for (let index = 0; index < routePath.length; index += stride) samples.push(routePath[index]);
  if (samples.at(-1) !== routePath.at(-1)) samples.push(routePath.at(-1));
  const near = samples.filter((point) => nearestPathDistanceKm(point, referencePath) <= thresholdKm).length;
  return samples.length ? near / samples.length : 0;
}

async function googleDirectionsRoute(apiKey) {
  const params = new URLSearchParams({
    origin: `${BRT_ORIGIN[1]},${BRT_ORIGIN[0]}`,
    destination: `${BRT_DESTINATION[1]},${BRT_DESTINATION[0]}`,
    mode: "driving",
    alternatives: "false",
    units: "metric",
    region: "eg",
    key: apiKey,
  });
  const response = await fetch(`${GOOGLE_DIRECTIONS_URL}?${params}`, { signal: AbortSignal.timeout(25_000) });
  const body = await response.json();
  if (!response.ok || body.status !== "OK") {
    throw new Error(`Google Directions failed for BRT phase 1: ${body.status || response.status} ${body.error_message || ""}`.trim());
  }
  const route = body.routes?.[0];
  const encoded = route?.overview_polyline?.points;
  if (!encoded) throw new Error("Google Directions returned no overview polyline for BRT phase 1");
  const points = decodePolyline5(encoded);
  return {
    points,
    summary: route.summary ?? "",
    googleDistanceMeters: route.legs?.[0]?.distance?.value ?? null,
    googleDistanceText: route.legs?.[0]?.distance?.text ?? null,
    startAddress: route.legs?.[0]?.start_address ?? null,
    endAddress: route.legs?.[0]?.end_address ?? null,
  };
}

async function googleDirectionsForAnchors(apiKey, anchors, options = {}) {
  if (anchors.length < 2) throw new Error("At least two anchors are required");
  const params = new URLSearchParams({
    origin: `${anchors[0][1]},${anchors[0][0]}`,
    destination: `${anchors.at(-1)[1]},${anchors.at(-1)[0]}`,
    mode: "driving",
    alternatives: "false",
    units: "metric",
    region: "eg",
    key: apiKey,
  });
  if (options.avoidHighways) params.set("avoid", "highways");
  if (anchors.length > 2) {
    params.set("waypoints", anchors.slice(1, -1).map(([lng, lat]) => `via:${lat},${lng}`).join("|"));
  }
  const response = await fetch(`${GOOGLE_DIRECTIONS_URL}?${params}`, { signal: AbortSignal.timeout(25_000) });
  const body = await response.json();
  if (!response.ok || body.status !== "OK") {
    throw new Error(`${body.status || response.status} ${body.error_message || ""}`.trim());
  }
  const encoded = body.routes?.[0]?.overview_polyline?.points;
  if (!encoded) throw new Error("Google Directions returned no overview polyline");
  return {
    points: decodePolyline5(encoded).map(([lng, lat]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]),
    summary: body.routes?.[0]?.summary ?? "",
    distanceMeters: body.routes?.[0]?.legs?.[0]?.distance?.value ?? null,
    distanceText: body.routes?.[0]?.legs?.[0]?.distance?.text ?? null,
  };
}

function buildBrtRoute(routeInfo, generatedAt, licenseReference) {
  const pathKm = pathLengthKm(routeInfo.points);
  const stations = BRT_STATIONS.map((station) => {
    const [lng, lat] = pointAtKm(routeInfo.points, pathKm * station.fraction);
    return {
      ...station,
      lat,
      lng,
      source: "official_station_order_google_directions_ring_road_projection",
      sourceUrls: [BRT_SOURCE_URLS.presidency, BRT_SOURCE_URLS.dailyNewsStationDetails],
    };
  });
  return {
    schemaVersion: 1,
    generatedAt,
    provider: "Google Directions API",
    storagePermissionReference: licenseReference,
    sourceUrls: BRT_SOURCE_URLS,
    officialFacts: {
      phase: 1,
      corridor: "Cairo Ring Road",
      officialLengthKm: 35,
      stationCount: 14,
      start: "Ring Road and Alexandria Agricultural Road",
      end: "Police Academy",
      microbusRule: "Microbuses are banned on this phase-1 Ring Road stretch once BRT service is running.",
    },
    googleRoute: {
      summary: routeInfo.summary,
      distanceMeters: routeInfo.googleDistanceMeters,
      distanceText: routeInfo.googleDistanceText,
      computedPathKm: Number(pathKm.toFixed(3)),
      startAddress: routeInfo.startAddress,
      endAddress: routeInfo.endAddress,
    },
    stations,
    routePath: {
      type: "LineString",
      coordinates: routeInfo.points.map(([lng, lat]) => [Number(lng.toFixed(5)), Number(lat.toFixed(5))]),
    },
  };
}

function updateEgyptTransitSeed(seed, brtRoute) {
  const stationsEn = brtRoute.stations.map((station) => station.nameEn);
  const stationsAr = brtRoute.stations.map((station) => station.nameAr);
  seed.brt.lines = [
    {
      lineNumber: "BRT-1",
      nameEn: "Cairo BRT - Ring Road Phase 1 (Alexandria Agricultural Road to Police Academy)",
      nameAr: "الأتوبيس الترددي - الطريق الدائري المرحلة الأولى (طريق الإسكندرية الزراعي إلى أكاديمية الشرطة)",
      stationsEn,
      stationsAr,
      stations: brtRoute.stations.map(({ fraction, sourceUrls, ...station }) => station),
      routePath: brtRoute.routePath,
      routeQualityDetails: routeQualityDetails(brtRoute),
    },
  ];
  return seed;
}

function routeQualityDetails(brtRoute) {
  return {
    source: "official_station_list_google_directions",
    generatedAt: brtRoute.generatedAt,
    provider: brtRoute.provider,
    storagePermissionReference: brtRoute.storagePermissionReference,
    confidenceLevel: "high",
    confidenceScore: 0.96,
    qualityScore: 0.96,
    corridor: brtRoute.officialFacts.corridor,
    officialLengthKm: brtRoute.officialFacts.officialLengthKm,
    computedPathKm: brtRoute.googleRoute.computedPathKm,
    googleDistanceText: brtRoute.googleRoute.distanceText,
    stationCount: brtRoute.stations.length,
    sourceUrls: Object.values(BRT_SOURCE_URLS),
    notes: [
      "Station names/order and access categories are from official and transport press sources.",
      "Station coordinates are projected onto the Google Directions Ring Road geometry in official order because Directions geocoding of free-text BRT station names is ambiguous.",
      "BRT is restricted to the Ring Road phase-1 segment; non-BRT road transit is not substituted onto this geometry.",
    ],
  };
}

function updatePreparedOrSnapshotLine(line, brtRoute) {
  const stations = brtRoute.stations.map((station) => ({
    lat: station.lat,
    lng: station.lng,
    name: station.nameEn,
    nameAr: station.nameAr,
    access: station.access,
    serves: station.serves,
    interchange: station.interchange ?? [],
    source: station.source,
  }));
  line.lineNumber = "BRT-1";
  line.nameEn = "Cairo BRT - Ring Road Phase 1 (Alexandria Agricultural Road to Police Academy)";
  line.nameAr = "الأتوبيس الترددي - الطريق الدائري المرحلة الأولى (طريق الإسكندرية الزراعي إلى أكاديمية الشرطة)";
  line.fromArea = brtRoute.stations[0].nameEn;
  line.toArea = brtRoute.stations.at(-1).nameEn;
  line.governorate = "Cairo";
  line.viaStops = brtRoute.stations.slice(1, -1).map((station) => station.nameEn);
  line.stops = stations;
  line.path = brtRoute.routePath.coordinates;
  line.pathPointCount = brtRoute.routePath.coordinates.length;
  line.pathSuspect = false;
  line.routeQuality = "gtfs";
  line.routeQualityDetails = routeQualityDetails(brtRoute);
  line.geometryLocked = true;
  line.dataSource = "official_station_list_google_directions";
  line.sourcePriority = 40;
  line.confidenceScore = 0.96;
  line.routeStatus = "active";
  line.verifiedAt = brtRoute.generatedAt;
  line.lastConfirmedAt = brtRoute.generatedAt;
  line.needsReviewReason = null;
  line.reviewReportCount = 0;
  line.frequencyMinutes = 3;
  line.hasFixedStops = true;
  line.updatedAt = brtRoute.generatedAt;
}

function updateRoadLineWithRepair(line, repair, generatedAt) {
  line.path = repair.points;
  line.pathPointCount = repair.points.length;
  line.pathSuspect = false;
  line.routeQuality = "standard";
  line.routeQualityDetails = {
    source: "google_directions_avoid_highways_brt_phase1_microbus_repair",
    generatedAt,
    provider: "Google Directions API",
    confidenceLevel: "medium",
    confidenceScore: 0.82,
    qualityScore: 0.82,
    reason: "Microbus route overlapped the phase-1 BRT Ring Road ban area; candidate was generated with avoid=highways and accepted only after reducing BRT path overlap.",
    originalBrtPhase1PathShare: repair.originalShare,
    repairedBrtPhase1PathShare: repair.repairedShare,
    anchorCount: repair.anchorCount,
    googleDistanceText: repair.distanceText,
    warnings: [
      "This is a geometry correction to keep the line away from the BRT-only Ring Road segment.",
      "Stop/service legality should still be confirmed with operator/local field data before marking as high confidence.",
    ],
  };
  line.dataSource = "google_directions_avoid_highways_brt_ban_study";
  line.sourcePriority = Math.max(Number(line.sourcePriority ?? 0), 35);
  line.confidenceScore = Math.min(Math.max(Number(line.confidenceScore ?? 0.7), 0.82), 0.88);
  line.routeStatus = "active";
  line.needsReviewReason = null;
  line.updatedAt = generatedAt;
}

function getTransportTypes(snapshotLike) {
  return Object.fromEntries((snapshotLike.types ?? []).map((type) => [type.id, type.nameEn]));
}

function isGreaterCairoRoadTransit(typeName) {
  return ["NTA Bus", "CTA Bus", "Microbus", "Cairo BRT"].includes(typeName);
}

function routeText(line) {
  return normalizeText([
    line.nameEn,
    line.nameAr,
    line.lineNumber,
    line.fromArea,
    line.toArea,
    ...(line.viaStops ?? []),
    ...(Array.isArray(line.stops) ? line.stops.map((stop) => `${stop.name ?? ""} ${stop.nameAr ?? ""}`) : []),
  ].filter(Boolean).join(" "));
}

function stopName(stop) {
  return normalizeText(`${stop?.name ?? ""} ${stop?.nameAr ?? ""}`);
}

function anchorCandidatesForLine(line, brtPath) {
  const structured = Array.isArray(line.stops)
    ? line.stops
      .map((stop) => ({ name: stopName(stop), point: [Number(stop.lng), Number(stop.lat)] }))
      .filter(({ point }) => validLngLat(point))
    : [];

  const raw = structured.length >= 2
    ? structured
    : (Array.isArray(line.path) ? line.path.map((point) => ({ name: "", point })) : []).filter(({ point }) => validLngLat(point));
  if (raw.length < 2) return [];

  const filtered = raw.filter((entry, index) => {
    if (index === 0 || index === raw.length - 1) return true;
    const nearBrt = nearestPathDistanceKm(entry.point, brtPath) <= 0.25;
    const explicitlyRingRoad = /ring road|الدائري|دايري|dairi/.test(entry.name);
    return !(nearBrt && explicitlyRingRoad);
  });
  const anchors = filtered.length >= 2 ? filtered.map((entry) => entry.point) : raw.map((entry) => entry.point);
  const deduped = [];
  for (const point of anchors) {
    const previous = deduped.at(-1);
    if (!previous || haversineKm(previous, point) >= 0.05) deduped.push(point);
  }
  if (deduped.length <= 27) return deduped;
  const interior = deduped.slice(1, -1);
  const sampled = [];
  for (let index = 0; index < 25; index++) sampled.push(interior[Math.round(index * (interior.length - 1) / 24)]);
  return [deduped[0], ...sampled, deduped.at(-1)];
}

function matchedCorridors(text) {
  return CORRIDORS
    .filter((corridor) => corridor.patterns.some((pattern) => text.includes(normalizeText(pattern))))
    .map((corridor) => corridor.id);
}

function auditRoutes(snapshot, brtRoute) {
  const typeById = getTransportTypes(snapshot);
  const routes = [];
  const corridorCounts = Object.fromEntries(CORRIDORS.map((corridor) => [corridor.id, 0]));
  const totals = {
    allRoadTransit: 0,
    byType: {},
    currentSuspect: 0,
    acceptedByTextualCorridorEvidence: 0,
    brtReplaced: 0,
    microbusPhase1RingRoadFlags: 0,
    needsGoogleRegeneration: 0,
    needsManualTransportEvidence: 0,
  };

  for (const line of snapshot.lines ?? []) {
    const transportType = typeById[line.transportTypeId] ?? "";
    if (!isGreaterCairoRoadTransit(transportType)) continue;
    totals.allRoadTransit++;
    totals.byType[transportType] = (totals.byType[transportType] ?? 0) + 1;

    const text = routeText(line);
    const corridors = matchedCorridors(text);
    for (const corridorId of corridors) corridorCounts[corridorId]++;

    const qualitySuspect = line.pathSuspect === true
      || line.routeQuality === "suspect"
      || typeof line.needsReviewReason === "string";
    if (qualitySuspect) totals.currentSuspect++;

    const nearBrtShare = transportType === "Microbus"
      ? routeShareNearPath(line.path, brtRoute.routePath.coordinates)
      : 0;
    const flags = [];
    const actions = [];
    let status = "accepted";

    if (transportType === "Cairo BRT") {
      status = "replaced_with_official_ring_road_phase1";
      actions.push("Use canonical BRT-1 station order, fixed stops, and Google Ring Road geometry.");
      totals.brtReplaced++;
    } else {
      if (nearBrtShare >= 0.18) {
        flags.push("microbus_overlaps_brt_phase1_ring_road_ban_area");
        actions.push("Regenerate away from the phase-1 Ring Road BRT segment or convert to a feeder to a BRT station.");
        totals.microbusPhase1RingRoadFlags++;
        status = "hard_rule_violation";
      }
      if (qualitySuspect) {
        actions.push("Run Google constrained regeneration using route endpoints plus valid via-stops/anchors before publishing as high confidence.");
        totals.needsGoogleRegeneration++;
        if (status === "accepted") status = "needs_google_regeneration";
      }
      if (!corridors.length) {
        actions.push("Needs manual corridor evidence because route text does not match the known Greater Cairo bus/microbus corridor list.");
        totals.needsManualTransportEvidence++;
        if (status === "accepted") status = "needs_manual_transport_evidence";
      } else {
        totals.acceptedByTextualCorridorEvidence++;
      }
    }

    routes.push({
      lineId: line.id,
      lineNumber: line.lineNumber,
      nameEn: line.nameEn,
      transportType,
      fromArea: line.fromArea,
      toArea: line.toArea,
      status,
      matchedCorridors: corridors,
      flags,
      recommendedActions: actions,
      currentQuality: {
        routeQuality: line.routeQuality,
        pathSuspect: Boolean(line.pathSuspect),
        pathPointCount: Array.isArray(line.path) ? line.path.length : 0,
        needsReviewReason: line.needsReviewReason ?? null,
      },
      brtPhase1PathShare: transportType === "Microbus" ? Number(nearBrtShare.toFixed(3)) : undefined,
    });
  }

  return {
    schemaVersion: 1,
    generatedAt: brtRoute.generatedAt,
    methodology: [
      "First, build the BRT hard rule from official sources: BRT-1 is only the Ring Road phase-1 segment between Alexandria Agricultural Road and Police Academy.",
      "Second, compile the Greater Cairo bus/microbus corridor dictionary from official BRT feeder descriptions, the World Bank/Transport for Cairo route survey, and the current route text.",
      "Third, check every bundled Greater Cairo road-transit line for corridor text evidence, existing geometry quality, and forbidden microbus overlap with the BRT phase-1 Ring Road path.",
      "Fourth, apply only hard, well-sourced replacements automatically. BRT-1 is replaced now; bus/microbus suspect lines are queued for constrained Google regeneration instead of being blindly snapped to shortest-driving paths.",
    ],
    sourceDetails: SOURCE_DETAILS,
    corridors: CORRIDORS.map((corridor) => ({
      id: corridor.id,
      name: corridor.name,
      modeRule: corridor.modeRule,
      sourceIds: corridor.sourceIds,
      matchedRouteCount: corridorCounts[corridor.id] ?? 0,
    })),
    totals,
    routes,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function maybeUpdateApiSeeds(brtRoute) {
  for (const seedPath of API_SEED_PATHS) {
    const seed = await readJson(seedPath);
    updateEgyptTransitSeed(seed, brtRoute);
    await writeJson(seedPath, seed);
  }
}

async function maybeUpdateSnapshot(snapshot, brtRoute) {
  for (const line of snapshot.lines ?? []) {
    if (line.lineNumber === "BRT-1" || /Cairo BRT/i.test(line.nameEn ?? "")) {
      updatePreparedOrSnapshotLine(line, brtRoute);
    }
  }
  snapshot.generatedAt = brtRoute.generatedAt;
  snapshot.revision = `greater-cairo-road-study-${brtRoute.generatedAt.slice(0, 10)}`;
  await writeJson(SNAPSHOT_PATH, snapshot);
}

async function maybeUpdatePreparedSeed(brtRoute) {
  const prepared = await readJson(PREPARED_PATH);
  for (const line of prepared.lines ?? []) {
    if (line.lineNumber === "BRT-1" || /Cairo BRT/i.test(line.nameEn ?? "")) {
      updatePreparedOrSnapshotLine(line, brtRoute);
    }
  }
  await writeJson(PREPARED_PATH, prepared);
  const bytes = await readFile(PREPARED_PATH);
  const manifest = await readJson(PREPARED_MANIFEST_PATH);
  manifest.generatedAt = brtRoute.generatedAt;
  manifest.sha256 = createHash("sha256").update(bytes).digest("hex");
  manifest.ready = true;
  manifest.routeCount = prepared.lines.length;
  manifest.typeCount = prepared.types.length;
  manifest.notes = [...new Set([
    ...(Array.isArray(manifest.notes) ? manifest.notes : []),
    "BRT-1 replaced with official phase-1 Ring Road station order and Google Directions geometry.",
    "Existing backend apply script now replaces stored route_path on confirmed seed apply.",
  ])];
  await writeJson(PREPARED_MANIFEST_PATH, manifest);
}

async function repairMicrobusBrtBanRoutes(apiKey, snapshot, prepared, brtRoute) {
  const typeById = getTransportTypes(snapshot);
  const generatedAt = brtRoute.generatedAt;
  const report = {
    schemaVersion: 1,
    generatedAt,
    provider: "Google Directions API",
    strategy: "avoid=highways with existing structured stop anchors; accept only if phase-1 BRT path overlap drops below the hard-rule threshold.",
    routes: [],
    totals: { selected: 0, repaired: 0, keptForReview: 0 },
  };
  const preparedById = new Map((prepared.lines ?? []).map((line) => [line.id, line]));
  const candidates = (snapshot.lines ?? []).filter((line) => {
    const transportType = typeById[line.transportTypeId] ?? "";
    return transportType === "Microbus"
      && routeShareNearPath(line.path, brtRoute.routePath.coordinates) >= 0.18;
  });
  report.totals.selected = candidates.length;

  for (const line of candidates) {
    const originalShare = Number(routeShareNearPath(line.path, brtRoute.routePath.coordinates).toFixed(3));
    const anchors = anchorCandidatesForLine(line, brtRoute.routePath.coordinates);
    const record = {
      lineId: line.id,
      lineNumber: line.lineNumber,
      nameEn: line.nameEn,
      originalBrtPhase1PathShare: originalShare,
      anchorCount: anchors.length,
      status: "kept_for_review",
      reason: "",
    };
    try {
      if (anchors.length < 2) throw new Error("Fewer than two valid coordinate anchors");
      const repaired = await googleDirectionsForAnchors(apiKey, anchors, { avoidHighways: true });
      const repairedShare = Number(routeShareNearPath(repaired.points, brtRoute.routePath.coordinates).toFixed(3));
      record.repairedBrtPhase1PathShare = repairedShare;
      record.googleDistanceText = repaired.distanceText;
      record.pointCount = repaired.points.length;
      if (repairedShare >= 0.18) {
        throw new Error(`Candidate still overlaps BRT phase-1 path too much (${repairedShare})`);
      }
      const repair = {
        ...repaired,
        originalShare,
        repairedShare,
        anchorCount: anchors.length,
      };
      updateRoadLineWithRepair(line, repair, generatedAt);
      const preparedLine = preparedById.get(line.id);
      if (preparedLine) updateRoadLineWithRepair(preparedLine, repair, generatedAt);
      record.status = "repaired";
      record.reason = "Accepted avoid-highways geometry with reduced BRT phase-1 overlap.";
      report.totals.repaired++;
    } catch (error) {
      line.needsReviewReason = `BRT phase-1 hard rule: microbus overlaps banned Ring Road segment; ${error instanceof Error ? error.message : String(error)}`;
      line.routeStatus = "needs_review";
      const preparedLine = preparedById.get(line.id);
      if (preparedLine) {
        preparedLine.needsReviewReason = line.needsReviewReason;
        preparedLine.routeStatus = "needs_review";
      }
      record.reason = line.needsReviewReason;
      report.totals.keptForReview++;
    }
    report.routes.push(record);
  }

  return report;
}

function buildMicrobusRepairFinalReport(snapshot, study) {
  const typeById = getTransportTypes(snapshot);
  const repaired = (snapshot.lines ?? [])
    .filter((line) =>
      typeById[line.transportTypeId] === "Microbus"
      && line.dataSource === "google_directions_avoid_highways_brt_ban_study",
    )
    .map((line) => ({
      lineId: line.id,
      lineNumber: line.lineNumber,
      nameEn: line.nameEn,
      status: "repaired",
      fromArea: line.fromArea,
      toArea: line.toArea,
      originalBrtPhase1PathShare: line.routeQualityDetails?.originalBrtPhase1PathShare,
      repairedBrtPhase1PathShare: line.routeQualityDetails?.repairedBrtPhase1PathShare,
      pointCount: Array.isArray(line.path) ? line.path.length : 0,
      googleDistanceText: line.routeQualityDetails?.googleDistanceText,
      confidenceScore: line.confidenceScore,
    }));
  const keptForReview = (study.routes ?? [])
    .filter((route) => route.status === "hard_rule_violation")
    .map((route) => ({
      lineId: route.lineId,
      lineNumber: route.lineNumber,
      nameEn: route.nameEn,
      status: "kept_for_review",
      fromArea: route.fromArea,
      toArea: route.toArea,
      brtPhase1PathShare: route.brtPhase1PathShare,
      reason: route.currentQuality?.needsReviewReason ?? null,
    }));
  return {
    schemaVersion: 2,
    generatedAt: study.generatedAt,
    provider: "Google Directions API",
    strategy: "Cumulative final status after avoid=highways repair attempts for microbus lines overlapping the BRT phase-1 Ring Road ban area.",
    totals: {
      repaired: repaired.length,
      keptForReview: keptForReview.length,
      totalHandled: repaired.length + keptForReview.length,
    },
    repaired,
    keptForReview,
  };
}

async function main() {
  const apply = hasArg("apply");
  const apiKey = process.env.GOOGLE_DIRECTIONS_API_KEY?.trim();
  const licenseReference = argValue("acknowledge-google-storage-license", process.env.GOOGLE_STORAGE_PERMISSION_REFERENCE)?.trim();
  if (!apiKey) throw new Error("Set GOOGLE_DIRECTIONS_API_KEY before running this study.");
  if (!licenseReference) {
    throw new Error("Pass --acknowledge-google-storage-license=<permission-reference> before permanently storing Google-generated geometry.");
  }

  const generatedAt = new Date().toISOString();
  const snapshot = await readJson(SNAPSHOT_PATH);
  const routeInfo = await googleDirectionsRoute(apiKey);
  const brtRoute = buildBrtRoute(routeInfo, generatedAt, licenseReference);
  let study = auditRoutes(snapshot, brtRoute);
  let microbusRepairReport = null;

  await writeJson(BRT_OUTPUT_PATH, brtRoute);

  if (apply) {
    await maybeUpdateApiSeeds(brtRoute);
    await maybeUpdateSnapshot(snapshot, brtRoute);
    const prepared = await readJson(PREPARED_PATH);
    const regenerateHardMicrobus = hasArg("regenerate-hard-microbus");
    if (regenerateHardMicrobus) {
      microbusRepairReport = await repairMicrobusBrtBanRoutes(apiKey, snapshot, prepared, brtRoute);
      await writeJson(SNAPSHOT_PATH, snapshot);
      await writeJson(PREPARED_PATH, prepared);
    }
    await maybeUpdatePreparedSeed(brtRoute);
    study = auditRoutes(snapshot, brtRoute);
    if (regenerateHardMicrobus) {
      microbusRepairReport = buildMicrobusRepairFinalReport(snapshot, study);
      await writeJson(MICROBUS_REPAIR_OUTPUT_PATH, microbusRepairReport);
    }
  }

  await writeJson(STUDY_OUTPUT_PATH, study);

  console.log(JSON.stringify({
    applied: apply,
    brtOutput: path.relative(ROOT, BRT_OUTPUT_PATH),
    studyOutput: path.relative(ROOT, STUDY_OUTPUT_PATH),
    brtStations: brtRoute.stations.length,
    brtPathPoints: brtRoute.routePath.coordinates.length,
    googleDistanceText: brtRoute.googleRoute.distanceText,
    microbusRepair: microbusRepairReport?.totals ?? null,
    totals: study.totals,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
