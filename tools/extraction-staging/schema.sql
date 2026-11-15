-- Operator-applied only to the independent staging database. Not a Prisma migration.
CREATE SCHEMA IF NOT EXISTS extraction_staging;
CREATE TABLE IF NOT EXISTS extraction_staging.environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS extraction_staging.capabilities (
  user_id text PRIMARY KEY,
  capability text NOT NULL CHECK (capability = 'EXTRACTION_REVIEW'),
  reason text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS extraction_staging.capability_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('GRANT', 'REVOKE')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS extraction_staging.candidates (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 2000000),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS extraction_staging.revisions (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  candidate_id text NOT NULL REFERENCES extraction_staging.candidates(id),
  parent_id text REFERENCES extraction_staging.revisions(id),
  actor_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('SAVE_DRAFT','ACCEPT_EXTRACTION','REQUEST_CHANGES')),
  server_stamp text NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 131072),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, request_id)
);
CREATE TABLE IF NOT EXISTS extraction_staging.heads (
  candidate_id text PRIMARY KEY REFERENCES extraction_staging.candidates(id),
  revision_id text NOT NULL REFERENCES extraction_staging.revisions(id)
);
CREATE INDEX IF NOT EXISTS extraction_revision_chain ON extraction_staging.revisions(candidate_id,created_at);
CREATE OR REPLACE FUNCTION extraction_staging.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Extraction staging history is immutable'; END;
$$;
DROP TRIGGER IF EXISTS immutable_candidate ON extraction_staging.candidates;
CREATE TRIGGER immutable_candidate BEFORE UPDATE OR DELETE ON extraction_staging.candidates FOR EACH ROW EXECUTE FUNCTION extraction_staging.immutable_record();
DROP TRIGGER IF EXISTS immutable_revision ON extraction_staging.revisions;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON extraction_staging.revisions FOR EACH ROW EXECUTE FUNCTION extraction_staging.immutable_record();
DROP TRIGGER IF EXISTS immutable_capability_event ON extraction_staging.capability_events;
CREATE TRIGGER immutable_capability_event BEFORE UPDATE OR DELETE ON extraction_staging.capability_events FOR EACH ROW EXECUTE FUNCTION extraction_staging.immutable_record();
