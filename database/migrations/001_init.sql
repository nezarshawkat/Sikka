CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS transport_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  avg_speed NUMERIC(6,2) NOT NULL,
  avg_cost_per_km NUMERIC(10,2) NOT NULL,
  comfort_score NUMERIC(3,2) NOT NULL,
  safety_score NUMERIC(3,2) NOT NULL,
  availability_hours VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS stops (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  geom GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  type VARCHAR(80) NOT NULL,
  city VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS routes (
  id BIGSERIAL PRIMARY KEY,
  transport_type_id INT REFERENCES transport_types(id),
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS route_stops (
  route_id BIGINT REFERENCES routes(id) ON DELETE CASCADE,
  stop_id BIGINT REFERENCES stops(id) ON DELETE CASCADE,
  stop_order INT NOT NULL,
  PRIMARY KEY(route_id, stop_id)
);

CREATE TABLE IF NOT EXISTS edges (
  id BIGSERIAL PRIMARY KEY,
  start_stop BIGINT REFERENCES stops(id),
  end_stop BIGINT REFERENCES stops(id),
  distance NUMERIC(10,2) NOT NULL,
  time NUMERIC(10,2) NOT NULL,
  cost NUMERIC(10,2) NOT NULL,
  transport_type INT REFERENCES transport_types(id)
);

CREATE TABLE IF NOT EXISTS live_vehicles (
  vehicle_id VARCHAR(64) PRIMARY KEY,
  route_id BIGINT REFERENCES routes(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_reports (
  id BIGSERIAL PRIMARY KEY,
  report_type VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_stops_geom ON stops USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_route_stops_route_order ON route_stops(route_id, stop_order);
CREATE INDEX IF NOT EXISTS idx_edges_lookup ON edges(start_stop, end_stop, transport_type);
CREATE INDEX IF NOT EXISTS idx_transport_types_name ON transport_types(name);
