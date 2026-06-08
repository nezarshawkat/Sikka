import { pgTable, text, boolean, real, integer, timestamp, uuid } from "drizzle-orm/pg-core";

export const interCitiesTable = pgTable("inter_cities", {
  id: uuid("id").primaryKey().defaultRandom(),
  globalId: integer("global_id").unique(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  normalizedName: text("normalized_name").notNull(),
  governorate: text("governorate").notNull().default(""),
  lat: real("lat"),
  lng: real("lng"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const interOperatorsTable = pgTable("inter_operators", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  website: text("website"),
  bookingType: text("booking_type").notNull().default("online"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const interOperatorCitiesTable = pgTable("inter_operator_cities", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => interOperatorsTable.id),
  globalCityId: uuid("global_city_id").notNull().references(() => interCitiesTable.id),
  operatorCityId: text("operator_city_id").notNull(),
  operatorCityName: text("operator_city_name").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const interStationsTable = pgTable("inter_stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull().references(() => interOperatorsTable.id),
  globalCityId: uuid("global_city_id").notNull().references(() => interCitiesTable.id),
  operatorStationId: text("operator_station_id"),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().default(""),
  address: text("address"),
  lat: real("lat"),
  lng: real("lng"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const interTripsCacheTable = pgTable("inter_trips_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  cacheKey: text("cache_key").notNull().unique(),
  data: text("data").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
