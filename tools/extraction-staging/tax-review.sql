-- Apply to the isolated extraction review database only, after schema.sql.
CREATE TABLE IF NOT EXISTS extraction_staging.tax_reviewers (
  email text PRIMARY KEY CHECK (email=lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE OR REPLACE FUNCTION extraction_staging.can_review(actor text, verified_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM extraction_staging.capabilities
    WHERE user_id=actor AND capability='EXTRACTION_REVIEW' AND revoked_at IS NULL AND expires_at>now()
  ) OR EXISTS (
    SELECT 1 FROM extraction_staging.tax_reviewers
    WHERE email=verified_email AND revoked_at IS NULL AND expires_at>now()
  );
$$;
CREATE TABLE IF NOT EXISTS extraction_staging.tax_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES extraction_staging.candidates(id),
  extraction_revision text NOT NULL REFERENCES extraction_staging.revisions(id),
  actor_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('DRAFT', 'ACCEPT', 'NEEDS_CHANGES')),
  fields jsonb NOT NULL CHECK (octet_length(fields::text) <= 32768),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staging_tax_reviews_current
  ON extraction_staging.tax_reviews(candidate_id, extraction_revision, id DESC);
DROP TRIGGER IF EXISTS immutable_tax_review ON extraction_staging.tax_reviews;
CREATE TRIGGER immutable_tax_review BEFORE UPDATE OR DELETE ON extraction_staging.tax_reviews
  FOR EACH ROW EXECUTE FUNCTION extraction_staging.immutable_record();
