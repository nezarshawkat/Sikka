-- Sikka route geometry repair schema
-- Safe to run more than once. Apply this before deploying the API that reads
-- geometry_locked / active_geometry_version_id / route_quality.

ALTER TABLE transit_lines
  ADD COLUMN IF NOT EXISTS geometry_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_geometry_version_id uuid,
  ADD COLUMN IF NOT EXISTS route_quality jsonb;

CREATE TABLE IF NOT EXISTS route_repair_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transit_line_id uuid NOT NULL,
  sequence integer NOT NULL,
  direction text NOT NULL DEFAULT 'forward',
  name text NOT NULL DEFAULT '',
  name_ar text,
  lat real NOT NULL,
  lng real NOT NULL,
  source text NOT NULL DEFAULT 'manual_admin',
  required boolean NOT NULL DEFAULT true,
  confidence_score real NOT NULL DEFAULT 0.8,
  anchor_type text NOT NULL DEFAULT 'corridor',
  created_by text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS route_repair_anchors_line_sequence_idx
  ON route_repair_anchors (transit_line_id, direction, sequence);

CREATE TABLE IF NOT EXISTS route_geometry_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transit_line_id uuid NOT NULL,
  version integer NOT NULL,
  geometry jsonb NOT NULL,
  source text NOT NULL DEFAULT 'candidate',
  status text NOT NULL DEFAULT 'candidate',
  quality_score real NOT NULL DEFAULT 0,
  confidence_score real NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  accepted_at timestamp,
  rejected_at timestamp,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS route_geometry_versions_line_version_idx
  ON route_geometry_versions (transit_line_id, version);

CREATE INDEX IF NOT EXISTS route_geometry_versions_line_status_idx
  ON route_geometry_versions (transit_line_id, status);

CREATE TABLE IF NOT EXISTS route_repair_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geometry_version_id uuid NOT NULL,
  transit_line_id uuid NOT NULL,
  from_anchor_id uuid,
  to_anchor_id uuid,
  from_anchor_sequence integer,
  to_anchor_sequence integer,
  shape_start_index integer,
  shape_end_index integer,
  routing_mode text NOT NULL DEFAULT 'osm_snapped',
  status text NOT NULL DEFAULT 'candidate',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings text[] NOT NULL DEFAULT '{}',
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS route_repair_segments_version_idx
  ON route_repair_segments (geometry_version_id);

CREATE INDEX IF NOT EXISTS route_repair_segments_line_idx
  ON route_repair_segments (transit_line_id);
