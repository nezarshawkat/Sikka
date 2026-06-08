/**
 * Direct seed script — bypasses HTTP auth, runs seed logic straight against DB.
 * Run: pnpm --filter @workspace/api-server tsx src/scripts/seedDirect.ts
 */
import { db } from "@workspace/db";
import { transportTypesTable, transitLinesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Transport type definitions ─────────────────────────────────────────────
const TYPES = [
  { nameEn: "Metro",         nameAr: "مترو",                      icon: "metro",    color: "#8B5CF6", base: 10,  pkm: 0,   spd: 40 },
  { nameEn: "Monorail",      nameAr: "مونوريل",                   icon: "monorail", color: "#EC4899", base: 20,  pkm: 0,   spd: 50 },
  { nameEn: "Train",         nameAr: "قطار",                       icon: "train",    color: "#F59E0B", base: 30,  pkm: 1,   spd: 60 },
  { nameEn: "CTA Bus",       nameAr: "أتوبيس الهيئة",             icon: "bus",      color: "#DC2626", base: 13,  pkm: 0,   spd: 20 },
  { nameEn: "NTA Bus",       nameAr: "أتوبيس النقل الجماعي",      icon: "bus",      color: "#2563EB", base: 19,  pkm: 0,   spd: 22 },
  { nameEn: "Serfis",        nameAr: "سرفيس",                      icon: "bus",      color: "#16A34A", base: 5,   pkm: 0.5, spd: 28 },
  { nameEn: "Microbus",      nameAr: "ميكروباص",                   icon: "bus",      color: "#10B981", base: 3,   pkm: 0.5, spd: 25 },
  { nameEn: "Tuktuk",        nameAr: "توك توك",                    icon: "bike",     color: "#F97316", base: 5,   pkm: 2,   spd: 20 },
  { nameEn: "White Taxi",    nameAr: "تاكسي أبيض",                icon: "car",      color: "#64748B", base: 10,  pkm: 3,   spd: 30 },
  { nameEn: "Uber / Careem", nameAr: "أوبر / كريم",               icon: "car",      color: "#06B6D4", base: 15,  pkm: 4,   spd: 35 },
];

// ─── Metro lines ─────────────────────────────────────────────────────────────
const METRO_LINES = [
  { n: "M1", nameEn: "Metro Line 1", nameAr: "مترو الخط الأول",
    stops: ["المرج الجديدة","المرج","عين شمس","العزيزية","إسهال","مسرة","الخليفة المأمون","الملاك","رمسيس","جمال عبد الناصر","عبد المنعم رياض","السادات","صاري","البحوث","الدقي","الجيزة","حدائق المعادي","دار السلام","المعادي","طهران","المنيل","قاضي الحصون","الحلمية"] },
  { n: "M2", nameEn: "Metro Line 2", nameAr: "مترو الخط الثاني",
    stops: ["السلام","العباسية","الشهداء","ميدان الإسماعيلية","عين شمس","روكسي","الحجاز","المرج الجديدة","مدينة نصر","عبد الخالق ثروت","جمال عبد الناصر","أبو بكر الصديق","السادات","عبد المنعم رياض","أوبرا","دكي","العتبة","محمد نجيب","الجامعة العربية","حدائق الأهرام","الكريمات"] },
  { n: "M3", nameEn: "Metro Line 3", nameAr: "مترو الخط الثالث",
    stops: ["شبرا الخيمة","الكلية الحربية","قلوبية","كوبري القبة","هليوبوليس","بين السرايات","آدلي منصور","النزهة","عبد المنعم رياض","عبد الخالق ثروت","السادات","محمد نجيب","مصر الجديدة","هشام بركات","العاشر من رمضان"] },
];

// ─── Monorail ─────────────────────────────────────────────────────────────────
const MONORAIL_LINES = [
  { n: "EMR", nameEn: "East Cairo Monorail", nameAr: "مونوريل شرق القاهرة",
    stops: ["عدلي منصور","المقطم","التجمع الأول","التجمع الخامس","العاصمة الإدارية"] },
  { n: "WMR", nameEn: "West Cairo Monorail", nameAr: "مونوريل غرب القاهرة",
    stops: ["الكيت كات","الحوامدية","الصف","العياط"] },
];

// ─── Train lines ──────────────────────────────────────────────────────────────
const TRAIN_LINES = [
  { n: "T1", nameEn: "Cairo–Alexandria", nameAr: "القاهرة–الإسكندرية",
    stops: ["رمسيس","بنها","طنطا","المحلة","المنصورة","دمياط","الإسكندرية"] },
  { n: "T2", nameEn: "Cairo–Suez", nameAr: "القاهرة–السويس",
    stops: ["رمسيس","عين شمس","الزقازيق","الإسماعيلية","السويس"] },
  { n: "T3", nameEn: "Cairo–Assiut", nameAr: "القاهرة–أسيوط",
    stops: ["رمسيس","حلوان","بني سويف","المنيا","أسيوط"] },
  { n: "T4", nameEn: "Cairo–Fayoum", nameAr: "القاهرة–الفيوم",
    stops: ["رمسيس","حلوان","الجيزة","الفيوم"] },
];

// ─── NTA Bus routes ───────────────────────────────────────────────────────────
// Source: Cairo NTA (شركات النقل الجماعي) March 2026 PDF ~110 routes
interface LineSpec { n: string; r: string; gov?: string }
const NTA_ROUTES: LineSpec[] = [
  { n: "1",   r: "المطرية|الزاوية الحمراء|الشرابية|العباسية|القاهرة" },
  { n: "2",   r: "المطرية|السكاكيني|الأزهر|القاهرة" },
  { n: "3",   r: "عين شمس|مدينة نصر|مصر الجديدة|رمسيس" },
  { n: "4",   r: "السلام|مدينة نصر|مصر الجديدة|العباسية|رمسيس" },
  { n: "5",   r: "حلمية الزيتون|المطرية|الشرابية|رمسيس" },
  { n: "6",   r: "مصر الجديدة|الزمالك|القاهرة" },
  { n: "7",   r: "أرض الجولف|مدينة نصر|العباسية|القاهرة" },
  { n: "8",   r: "النزهة|مصر الجديدة|مدينة نصر|العباسية" },
  { n: "9",   r: "شبرا الخيمة|شبرا|العباسية|العتبة" },
  { n: "10",  r: "شبرا|رمسيس|وسط البلد" },
  { n: "11",  r: "مدينة نصر|العباسية|السيدة زينب|الجيزة" },
  { n: "12",  r: "منشأة ناصر|الشرابية|العباسية|الأزهر" },
  { n: "13",  r: "شبرا الخيمة|شبرا|الزاوية الحمراء|بولاق" },
  { n: "14",  r: "المرج|عين شمس|مدينة نصر|مصر الجديدة" },
  { n: "15",  r: "السلام|عين شمس|الزيتون|المطرية|شبرا" },
  { n: "16",  r: "مدينة بدر|التجمع الخامس|مدينة نصر|مصر الجديدة" },
  { n: "17",  r: "العبور|شرق القاهرة|مدينة نصر|العباسية" },
  { n: "18",  r: "الشروق|التجمع الخامس|مدينة نصر|رمسيس" },
  { n: "19",  r: "العاشر من رمضان|مدينة نصر|العباسية|رمسيس" },
  { n: "20",  r: "حلوان|المعادي|وسط البلد|القاهرة" },
  { n: "21",  r: "حلوان|التبين|بشتيل|الجيزة" },
  { n: "22",  r: "المعادي|دار السلام|السيدة زينب|الأزهر" },
  { n: "23",  r: "طرة|المعادي|الفسطاط|العتبة" },
  { n: "24",  r: "حلوان|المعادي|الجيزة|الهرم" },
  { n: "25",  r: "المعادي|دار السلام|إمبابة|شبرا" },
  { n: "26",  r: "الهرم|جيزة|الجيزة|رمسيس" },
  { n: "27",  r: "6 أكتوبر|إمبابة|شبرا|رمسيس" },
  { n: "28",  r: "6 أكتوبر|الهرم|الجيزة|وسط البلد" },
  { n: "29",  r: "الشيخ زايد|6 أكتوبر|الهرم|الجيزة" },
  { n: "30",  r: "بولاق الدكرور|الجيزة|المنيل|السيدة زينب" },
  { n: "31",  r: "الدقي|المهندسين|إمبابة|شبرا" },
  { n: "32",  r: "الزمالك|العجوزة|المهندسين|الدقي" },
  { n: "33",  r: "المنيل|رشوان|السيدة زينب|الأزهر" },
  { n: "34",  r: "فيصل|الهرم|الجيزة|العتبة" },
  { n: "35",  r: "فيصل|إمبابة|شبرا|العباسية" },
  { n: "36",  r: "بشتيل|إمبابة|الزيتون|العباسية" },
  { n: "37",  r: "6 أكتوبر|إمبابة|الزاوية الحمراء|شبرا" },
  { n: "38",  r: "الحوامدية|الجيزة|وسط البلد|العباسية" },
  { n: "39",  r: "الصف|حلوان|المعادي|العتبة" },
  { n: "40",  r: "أبو النمرس|الهرم|الجيزة|بولاق" },
  { n: "41",  r: "حدائق الأهرام|الجيزة|إمبابة|شبرا" },
  { n: "42",  r: "المقطم|السيدة زينب|الجيزة|إمبابة" },
  { n: "43",  r: "المقطم|الخليفة|السيدة زينب|الأزهر" },
  { n: "44",  r: "حي السلام|السيدة زينب|الأزهر|العباسية" },
  { n: "45",  r: "عين الصيرة|المعادي|وسط البلد" },
  { n: "46",  r: "قناطر الخيرية|شبرا|رمسيس|العتبة" },
  { n: "47",  r: "شبرا الخيمة|الزاوية الحمراء|العباسية|العتبة" },
  { n: "48",  r: "بنها|شبرا الخيمة|شبرا|رمسيس" },
  { n: "49",  r: "العبور|مدينة نصر|مصر الجديدة|رمسيس" },
  { n: "50",  r: "الشروق|مدينة بدر|التجمع الخامس|مدينة نصر" },
  { n: "51",  r: "المرج|الخليفة المأمون|مصر الجديدة|مدينة نصر" },
  { n: "52",  r: "مدينة العبور|السلام|مدينة نصر|العباسية" },
  { n: "53",  r: "أرض اللواء|الجيزة|إمبابة|المهندسين" },
  { n: "54",  r: "حدائق الحرية|مدينة نصر|العباسية|رمسيس" },
  { n: "55",  r: "الرحاب|التجمع الأول|مدينة نصر|رمسيس" },
  { n: "56",  r: "المقطم|الدويقة|الدرب الأحمر|الأزهر" },
  { n: "57",  r: "الخصوص|شبرا الخيمة|شبرا|العباسية" },
  { n: "58",  r: "الزاوية الحمراء|المطرية|هليوبوليس|مدينة نصر" },
  { n: "59",  r: "عين شمس|الزيتون|المطرية|رمسيس" },
  { n: "60",  r: "المرج|المطرية|الزيتون|العباسية|رمسيس" },
  { n: "61",  r: "أوسيم|إمبابة|المهندسين|وسط البلد" },
  { n: "62",  r: "شبرا|باب الشعرية|العتبة|السيدة زينب" },
  { n: "63",  r: "روض الفرج|شبرا|رمسيس|العتبة" },
  { n: "64",  r: "الشرابية|باب الشعرية|الأزهر|السيدة زينب" },
  { n: "65",  r: "الإمام الشافعي|السيدة زينب|العتبة|باب الشعرية" },
  { n: "66",  r: "البساتين|المعادي|السيدة زينب|الأزهر" },
  { n: "67",  r: "البدرشين|الهرم|الجيزة|وسط البلد" },
  { n: "68",  r: "المنيب|الجيزة|البحوث|إمبابة" },
  { n: "69",  r: "الحوامدية|الجيزة|إمبابة|بولاق" },
  { n: "70",  r: "كرداسة|الهرم|الجيزة|بولاق" },
  { n: "71",  r: "الزيتون|المطرية|شبرا|رمسيس" },
  { n: "72",  r: "هليوبوليس|مصر الجديدة|مدينة نصر|النزهة" },
  { n: "73",  r: "القطامية|التجمع|مدينة نصر|مصر الجديدة" },
  { n: "74",  r: "مصر الجديدة|العباسية|القاهرة|الأزهر" },
  { n: "75",  r: "هليوبوليس|عين شمس|مدينة نصر|رمسيس" },
  { n: "76",  r: "بولاق الدكرور|العجوزة|المهندسين|الدقي" },
  { n: "77",  r: "الوراق|الشيرة|بولاق الدكرور|الجيزة" },
  { n: "78",  r: "الخصوص|الزاوية الحمراء|العباسية|القاهرة" },
  { n: "79",  r: "منشأة القناطر|شبرا الخيمة|شبرا|العباسية" },
  { n: "80",  r: "الشروق|العبور|السلام|رمسيس" },
  { n: "81",  r: "التجمع الثالث|التجمع الخامس|مدينة نصر|رمسيس" },
  { n: "82",  r: "القاهرة الجديدة|التجمع|مدينة نصر|العباسية" },
  { n: "83",  r: "مساكن الشيراتون|مصر الجديدة|مدينة نصر|رمسيس" },
  { n: "84",  r: "عزبة النخل|السلام|مدينة نصر|رمسيس" },
  { n: "85",  r: "شبرا|الشرابية|المطرية|عين شمس" },
  { n: "86",  r: "بولاق|وسط البلد|السيدة زينب|المقطم" },
  { n: "87",  r: "الدقي|المهندسين|الزمالك|القاهرة" },
  { n: "88",  r: "إمبابة|شبرا|الزاوية الحمراء|المطرية" },
  { n: "89",  r: "المعصرة|حلوان|المعادي|السيدة زينب" },
  { n: "90",  r: "التبين|حلوان|المعادي|الجيزة" },
  { n: "91",  r: "الحرفيين|6 أكتوبر|الهرم|الجيزة" },
  { n: "92",  r: "العمرانية|فيصل|الهرم|الجيزة" },
  { n: "93",  r: "الواحة الجديدة|6 أكتوبر|الجيزة|وسط البلد" },
  { n: "94",  r: "أبو رواش|كرداسة|إمبابة|شبرا" },
  { n: "95",  r: "الحوامدية|فيصل|الهرم|العتبة" },
  { n: "96",  r: "المنيل|علوي|السيدة زينب|العتبة" },
  { n: "97",  r: "الخليفة|القلعة|الأزهر|باب الشعرية" },
  { n: "98",  r: "دار السلام|المعادي|السيدة زينب|باب الشعرية" },
  { n: "99",  r: "طرة الاسمنت|طرة|المعادي|العتبة" },
  { n: "100", r: "ميت عقبة|إمبابة|الدقي|العجوزة" },
  { n: "101", r: "العجوزة|المهندسين|الدقي|الجيزة" },
  { n: "102", r: "الشيخ زايد|6 أكتوبر|بشتيل|إمبابة" },
  { n: "103", r: "المعتمدية|الحوامدية|فيصل|الهرم" },
  { n: "104", r: "البدرشين|أبو النمرس|فيصل|الجيزة" },
  { n: "105", r: "الوراق|الشيرة|المهندسين|العجوزة" },
  { n: "106", r: "إمبابة|الزيتون|عين شمس|الشرابية" },
  { n: "107", r: "الشهداء|القاهرة|العتبة|باب الشعرية" },
  { n: "108", r: "عزبة خير الله|حلوان|المعادي|وسط البلد" },
  { n: "109", r: "منشأة ناصر|باب الشعرية|العباسية|مدينة نصر" },
  { n: "110", r: "السلام|عين شمس|الزيتون|الزاوية الحمراء|شبرا" },
];

// ─── Serfis routes ────────────────────────────────────────────────────────────
const SERFIS_ROUTES: LineSpec[] = [
  { n: "S1",  r: "المعادي|وسط البلد|باب الشعرية|شبرا" },
  { n: "S2",  r: "حلوان|المعادي|الجيزة|إمبابة" },
  { n: "S3",  r: "الهرم|الجيزة|وسط البلد|مصر الجديدة" },
  { n: "S4",  r: "6 أكتوبر|إمبابة|المهندسين|العجوزة" },
  { n: "S5",  r: "فيصل|الهرم|الجيزة|السيدة زينب" },
  { n: "S6",  r: "مدينة نصر|مصر الجديدة|هليوبوليس|عين شمس" },
  { n: "S7",  r: "شبرا|المطرية|الزيتون|النزهة" },
  { n: "S8",  r: "الدقي|المهندسين|إمبابة|شبرا الخيمة" },
  { n: "S9",  r: "المقطم|السيدة زينب|الأزهر|العتبة" },
  { n: "S10", r: "منشأة ناصر|الزيتون|مدينة نصر|التجمع" },
  { n: "S11", r: "بولاق الدكرور|المهندسين|الزمالك|القاهرة" },
  { n: "S12", r: "الشرابية|باب الشعرية|الأزهر|المنيل" },
  { n: "S13", r: "عين شمس|السلام|مدينة نصر|الرحاب" },
  { n: "S14", r: "حدائق الأهرام|الجيزة|الدقي|المهندسين" },
  { n: "S15", r: "بشتيل|إمبابة|شبرا|الزاوية الحمراء" },
  { n: "S16", r: "كرداسة|الهرم|الجيزة|فيصل" },
  { n: "S17", r: "التبين|حلوان|البساتين|المعادي" },
  { n: "S18", r: "الوراق|إمبابة|المهندسين|الدقي" },
  { n: "S19", r: "مصر الجديدة|العباسية|رمسيس|الزمالك" },
  { n: "S20", r: "المرج|المطرية|الشرابية|العباسية" },
];

// ─── Alexandria APTA routes ───────────────────────────────────────────────────
const ALEX_BUS_ROUTES: LineSpec[] = [
  { n: "1",  r: "سموحة|سيدي جابر|محطة مصر|اللبان|السيالة|أبو قير", gov: "Alexandria" },
  { n: "2",  r: "فيكتوريا|السيوف|الإبراهيمية|محطة الرمل|المنشية|محرم بك|الجمرك|المكس", gov: "Alexandria" },
  { n: "3",  r: "محطة مصر|سيدي جابر|العجمي|الهانوفيل|العامرية|برج العرب", gov: "Alexandria" },
  { n: "4",  r: "محطة مصر|كرموز|الدخيلة|المكس|بحري", gov: "Alexandria" },
  { n: "5",  r: "سيدي بشر|سموحة|المطار|نزلة البحر|أبو قير", gov: "Alexandria" },
  { n: "6",  r: "محطة الرمل|اللبان|كوم الدكة|المنشية|الجمرك|مينا البصل|الدخيلة", gov: "Alexandria" },
  { n: "7",  r: "محطة مصر|الإسكندرية الجديدة|بورتو مارينا|برج العرب الجديدة", gov: "Alexandria" },
  { n: "8",  r: "ستانلي|سيدي جابر|محطة مصر|كرموز|العامرية|برج العرب", gov: "Alexandria" },
  { n: "9",  r: "الإسكندرية الجديدة|سيدي بشر|سموحة|سيدي جابر|محطة مصر|المنشية|الجمرك", gov: "Alexandria" },
  { n: "10", r: "محطة مصر|الرمل|الأنفوشي|ستانلي|المنتزه|أبو قير", gov: "Alexandria" },
  { n: "11", r: "سيدي جابر|الكيلو 21|برج العرب|سيدي كرير", gov: "Alexandria" },
  { n: "12", r: "المحطة المركزية|الإبراهيمية|بكوس|كامب شيزار|المنتزه", gov: "Alexandria" },
  { n: "13", r: "المندرة|سيدي بشر|محطة مصر|كرموز|الصواري|عزبة سيدي كرير", gov: "Alexandria" },
  { n: "14", r: "محطة مصر|اللبان|بكوس|سيدي بشر|الدخيلة|العامرية", gov: "Alexandria" },
  { n: "15", r: "المنشية|محرم بك|السيوف|الموسكي|محطة مصر|العجمي", gov: "Alexandria" },
  { n: "16", r: "كليوباترا|محطة مصر|ورديان|الدخيلة|المكس|بحري", gov: "Alexandria" },
  { n: "17", r: "كامب شيزار|الموسكي|اللبان|السيالة|المطار|أبو قير", gov: "Alexandria" },
  { n: "18", r: "سيدي بشر|الإسكندرية الجديدة|سموحة|سيدي جابر|المنشية", gov: "Alexandria" },
  { n: "19", r: "أبو قير|المنتزه|سيدي بشر|الرمل|المنشية|محرم بك|العامرية", gov: "Alexandria" },
  { n: "20", r: "العجمي|الدخيلة|العامرية|محطة مصر|الرمل|المنتزه|أبو قير", gov: "Alexandria" },
  { n: "21", r: "برج العرب|العامرية|كرموز|محطة مصر|سيدي جابر|المنتزه", gov: "Alexandria" },
  { n: "22", r: "المكس|الدخيلة|ورديان|محطة مصر|اللبان|المنتزه|أبو قير", gov: "Alexandria" },
  { n: "23", r: "سموحة|سيدي بشر|ستانلي|المنتزه|قايتباي|الأنفوشي|المنشية", gov: "Alexandria" },
  { n: "24", r: "محطة مصر|كرموز|المعمورة|أبو قير|برج العرب", gov: "Alexandria" },
  { n: "25", r: "سيدي جابر|الرمل|اللبان|الدخيلة|العامرية|برج العرب", gov: "Alexandria" },
  { n: "26", r: "محطة الرمل|الإبراهيمية|ستانلي|المعمورة|الدخيلة", gov: "Alexandria" },
  { n: "27", r: "كليوباترا|سيدي بشر|سموحة|المطار|أبو قير", gov: "Alexandria" },
  { n: "28", r: "المنشية|بكوس|سيدي بشر|الإسكندرية الجديدة|المعمورة", gov: "Alexandria" },
  { n: "29", r: "محطة مصر|اللبان|ستانلي|سيدي بشر|المنتزه|قايتباي", gov: "Alexandria" },
  { n: "30", r: "سموحة|اللبان|سيدي بشر|المنتزه|أبو قير|برج العرب", gov: "Alexandria" },
  { n: "31", r: "المنشية|كوم الدكة|الموسكي|الإبراهيمية|السيوف|سيدي بشر", gov: "Alexandria" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildLines(
  specs: Array<{ n: string; r: string; gov?: string }>,
  typeId: string,
  namePrefix: string,
  basePrice: number,
  speed: number,
): Array<{ lineNumber: string; nameEn: string; nameAr: string; transportTypeId: string;
            stopsAreaAr: string; costEgp: number; speedKmh: number; governorate: string;
            hasFixedStops: boolean }> {
  return specs.map(({ n, r, gov }) => {
    const stops = r.split("|");
    const first = stops[0];
    const last = stops[stops.length - 1];
    return {
      lineNumber: n,
      nameEn: `${namePrefix} ${n}: ${first} → ${last}`,
      nameAr: `${namePrefix} ${n}: ${first} → ${last}`,
      transportTypeId: typeId,
      stopsAreaAr: r,
      costEgp: basePrice,
      speedKmh: speed,
      governorate: gov || "Cairo",
      hasFixedStops: false,
    };
  });
}

async function upsertType(nameEn: string) {
  const [existing] = await db.select().from(transportTypesTable)
    .where(eq(transportTypesTable.nameEn, nameEn)).limit(1);
  if (existing) return existing;
  const t = TYPES.find(x => x.nameEn === nameEn)!;
  const [created] = await db.insert(transportTypesTable).values({
    nameEn: t.nameEn, nameAr: t.nameAr, icon: t.icon, color: t.color,
    basePriceEgp: t.base, pricePerKmEgp: t.pkm, speedKmh: t.spd,
    serviceLevel: "standard",
  }).returning();
  return created;
}

async function upsertLine(line: ReturnType<typeof buildLines>[number]) {
  const [existing] = await db.select().from(transitLinesTable)
    .where(eq(transitLinesTable.lineNumber, line.lineNumber)).limit(1);
  // Check if it's the same type too (line numbers repeat across types)
  const [existingFull] = await db.select().from(transitLinesTable)
    .where(eq(transitLinesTable.nameEn, line.nameEn)).limit(1);
  if (existingFull) return { action: "skipped", name: line.nameEn };
  await db.insert(transitLinesTable).values({
    lineNumber: line.lineNumber,
    nameEn: line.nameEn,
    nameAr: line.nameAr,
    transportTypeId: line.transportTypeId,
    stopsAreaAr: line.stopsAreaAr,
    costEgp: line.costEgp,
    speedKmh: line.speedKmh,
    governorate: line.governorate,
    hasFixedStops: line.hasFixedStops,
    isActive: true,
  });
  return { action: "seeded", name: line.nameEn };
}

async function main() {
  console.log("Starting direct seed...\n");
  let seeded = 0; let skipped = 0;

  // ── Upsert all transport types ──
  for (const t of TYPES) {
    const [existing] = await db.select().from(transportTypesTable)
      .where(eq(transportTypesTable.nameEn, t.nameEn)).limit(1);
    if (!existing) {
      await db.insert(transportTypesTable).values({
        nameEn: t.nameEn, nameAr: t.nameAr, icon: t.icon, color: t.color,
        basePriceEgp: t.base, pricePerKmEgp: t.pkm, speedKmh: t.spd,
        serviceLevel: "standard",
      });
      console.log(`  ✓ Type: ${t.nameEn}`);
    }
  }

  // ── Metro ──
  const metroType = await upsertType("Metro");
  for (const line of METRO_LINES) {
    const stops = line.stops;
    const spec = { n: line.n, r: stops.join("|") };
    const lines = buildLines([spec], metroType.id, line.nameEn.replace(/ .*/,""), 10, 40);
    lines[0].nameEn = line.nameEn;
    lines[0].nameAr = line.nameAr;
    lines[0].hasFixedStops = true;
    const r = await upsertLine(lines[0]);
    r.action === "seeded" ? seeded++ : skipped++;
    console.log(`  ${r.action === "seeded" ? "✓" : "—"} Metro ${line.n}`);
  }

  // ── Monorail ──
  const monorailType = await upsertType("Monorail");
  for (const line of MONORAIL_LINES) {
    const spec = { n: line.n, r: line.stops.join("|") };
    const lines = buildLines([spec], monorailType.id, "Monorail", 20, 50);
    lines[0].nameEn = line.nameEn;
    lines[0].nameAr = line.nameAr;
    lines[0].hasFixedStops = true;
    const r = await upsertLine(lines[0]);
    r.action === "seeded" ? seeded++ : skipped++;
    console.log(`  ${r.action === "seeded" ? "✓" : "—"} Monorail ${line.n}`);
  }

  // ── Trains ──
  const trainType = await upsertType("Train");
  for (const line of TRAIN_LINES) {
    const spec = { n: line.n, r: line.stops.join("|") };
    const lines = buildLines([spec], trainType.id, "Train", 30, 60);
    lines[0].nameEn = line.nameEn;
    lines[0].nameAr = line.nameAr;
    lines[0].hasFixedStops = true;
    const r = await upsertLine(lines[0]);
    r.action === "seeded" ? seeded++ : skipped++;
    console.log(`  ${r.action === "seeded" ? "✓" : "—"} Train ${line.n}`);
  }

  // ── NTA Bus ──
  const ntaType = await upsertType("NTA Bus");
  const ntaLines = buildLines(NTA_ROUTES, ntaType.id, "NTA Bus", 19, 22);
  for (const line of ntaLines) {
    const r = await upsertLine(line);
    r.action === "seeded" ? seeded++ : skipped++;
  }
  console.log(`  NTA Bus: ${ntaLines.length} routes processed`);

  // ── Serfis ──
  const serfisType = await upsertType("Serfis");
  const serfisLines = buildLines(SERFIS_ROUTES, serfisType.id, "Serfis", 5, 28);
  for (const line of serfisLines) {
    const r = await upsertLine(line);
    r.action === "seeded" ? seeded++ : skipped++;
  }
  console.log(`  Serfis: ${serfisLines.length} routes processed`);

  // ── Alexandria CTA Bus ──
  const ctaType = await upsertType("CTA Bus");
  const alexLines = buildLines(ALEX_BUS_ROUTES, ctaType.id, "Alex Bus", 13, 20);
  for (const line of alexLines) {
    const r = await upsertLine(line);
    r.action === "seeded" ? seeded++ : skipped++;
  }
  console.log(`  Alexandria APTA: ${alexLines.length} routes processed`);

  console.log(`\n✅ Done — seeded: ${seeded}, skipped: ${skipped}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
