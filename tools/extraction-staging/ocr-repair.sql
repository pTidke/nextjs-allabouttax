-- Apply to the isolated extraction review database only.
CREATE TABLE IF NOT EXISTS extraction_staging.ocr_repair_jobs (
  request_id text PRIMARY KEY REFERENCES extraction_staging.revisions(id),
  candidate_id text NOT NULL REFERENCES extraction_staging.candidates(id),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (
    status IN ('QUEUED','PROCESSING','READY','NEEDS_OPERATOR','FAILED','SUPERSEDED')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id uuid,
  lease_until timestamptz,
  result_id text REFERENCES extraction_staging.candidates(id),
  model text,
  failure_code text,
  CHECK ((status = 'PROCESSING') = (lease_id IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((status = 'READY') = (result_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS extraction_ocr_repair_ready
  ON extraction_staging.ocr_repair_jobs(available_at,request_id)
  WHERE status IN ('QUEUED','PROCESSING');
