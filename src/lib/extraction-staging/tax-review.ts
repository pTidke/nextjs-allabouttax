import { HttpError } from "../http";
import { digest, SHA, validateCandidate, type Candidate } from "./contract";
import {
  reviewerEmail,
  type Reviewer,
  type ExtractionStore,
  type Sql,
} from "./store";

export type TaxFields = {
  classification: string;
  appliesTo: string;
  period: string;
  notes: string;
  evidenceIds: string[];
};
export type TaxDecision = "DRAFT" | "ACCEPT" | "NEEDS_CHANGES";
export type TaxReview = {
  id: string;
  decision: TaxDecision;
  fields: TaxFields;
};

const accepted =
  "r.action='ACCEPT_EXTRACTION' AND c.payload->>'kind'='native_full_pages' " +
  "AND NOT EXISTS (SELECT 1 FROM extraction_staging.candidates next " +
  "WHERE next.payload->'repair'->>'replacesCandidateId'=c.id)";
const fromAccepted =
  "FROM extraction_staging.candidates c " +
  "JOIN extraction_staging.heads h ON h.candidate_id=c.id " +
  "JOIN extraction_staging.revisions r ON r.id=h.revision_id AND r.candidate_id=c.id " +
  "WHERE " +
  accepted;

async function authorize(sql: Sql, store: ExtractionStore, viewer: Reviewer) {
  if (!viewer.id || viewer.id.length > 200)
    throw new HttpError(401, "Sign in first.");
  const {
    rows: [row],
  } = await sql.query(
    "SELECT environment_id, extraction_staging.can_review($1,$2) AS can_view, " +
      "EXISTS(SELECT 1 FROM extraction_staging.tax_reviewers WHERE email=$2 AND expires_at>now() AND revoked_at IS NULL) AS can_write " +
      "FROM extraction_staging.environment WHERE singleton=true",
    [viewer.id, reviewerEmail(viewer)],
  );
  if (row?.environment_id !== store.environmentId)
    throw new Error("Wrong staging environment.");
  if (row.can_view !== true)
    throw new HttpError(403, "Staging reviewer access is required.");
  return row.can_write === true;
}

async function latest(
  sql: Sql,
  candidateId: string,
  revision: string,
): Promise<TaxReview | null> {
  const {
    rows: [row],
  } = await sql.query(
    "SELECT id::text, decision, fields FROM extraction_staging.tax_reviews WHERE candidate_id=$1 AND extraction_revision=$2 ORDER BY id DESC LIMIT 1",
    [candidateId, revision],
  );
  return row ? (row as TaxReview) : null;
}

async function detail(sql: Sql, id: string) {
  const {
    rows: [row],
  } = await sql.query(
    "SELECT c.payload, c.payload_hash, h.revision_id " +
      fromAccepted +
      " AND c.id=$1",
    [id],
  );
  if (!row)
    throw new HttpError(
      404,
      "This extraction is no longer ready for tax review.",
    );
  const candidate = validateCandidate(row.payload as Candidate);
  if (candidate.id !== id || digest(candidate) !== row.payload_hash)
    throw new Error("Candidate integrity failed.");
  return { candidate, extractionRevision: String(row.revision_id) };
}

export async function loadTaxReview(
  store: ExtractionStore,
  viewer: Reviewer,
  selected?: string,
) {
  return store.db.transaction(async (sql) => {
    const canWrite = await authorize(sql, store, viewer);
    const { rows } = await sql.query(
      "SELECT c.id, c.payload->>'title' AS title " +
        fromAccepted +
        " ORDER BY c.created_at DESC, c.id LIMIT 50",
    );
    const documents = rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
    }));
    const id = selected
      ? documents.find((doc) => doc.id === selected)?.id
      : documents[0]?.id;
    return {
      documents,
      canWrite,
      review: id
        ? await detail(sql, id).then(async (value) => ({
            ...value,
            latest: await latest(sql, id, value.extractionRevision),
          }))
        : null,
    };
  });
}

function field(input: unknown, max: number) {
  if (typeof input !== "string" || input.length > max)
    throw new HttpError(400, "Review fields are invalid or too long.");
  return input.trim();
}

export async function saveTaxReview(
  store: ExtractionStore,
  viewer: Reviewer,
  input: Record<string, unknown>,
) {
  const { candidateId, extractionRevision, previousId, decision, evidenceIds } =
    input;
  if (
    typeof candidateId !== "string" ||
    !SHA.test(candidateId) ||
    typeof extractionRevision !== "string" ||
    !SHA.test(extractionRevision) ||
    !(
      previousId === null ||
      (typeof previousId === "string" && /^[0-9]{1,19}$/.test(previousId))
    ) ||
    (decision !== "DRAFT" &&
      decision !== "ACCEPT" &&
      decision !== "NEEDS_CHANGES") ||
    !Array.isArray(evidenceIds) ||
    evidenceIds.length > 12 ||
    evidenceIds.some((id) => typeof id !== "string" || id.length > 100) ||
    new Set(evidenceIds).size !== evidenceIds.length
  )
    throw new HttpError(400, "Invalid tax review.");
  const fields: TaxFields = {
    classification: field(input.classification, 400),
    appliesTo: field(input.appliesTo, 1200),
    period: field(input.period, 1200),
    notes: field(input.notes, 2200),
    evidenceIds,
  };
  if (
    decision === "ACCEPT" &&
    (!fields.classification ||
      !fields.appliesTo ||
      !fields.period ||
      !fields.notes ||
      !fields.evidenceIds.length)
  )
    throw new HttpError(
      400,
      "Fill in the applicability fields, add a note, and mark at least one source line.",
    );
  if (decision === "NEEDS_CHANGES" && !fields.notes)
    throw new HttpError(400, "Describe what needs to change.");
  return store.db.transaction(async (sql) => {
    // Use the same lock as extraction writes so a review cannot apply to a
    // superseded source, or silently overwrite another tax decision.
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "extraction-candidate:" + candidateId,
    ]);
    if (!(await authorize(sql, store, viewer)))
      throw new HttpError(403, "Only a tax reviewer can save this review.");
    const current = await detail(sql, candidateId);
    const previous = await latest(sql, candidateId, current.extractionRevision);
    if (
      current.extractionRevision !== extractionRevision ||
      (previous?.id ?? null) !== previousId
    )
      throw new HttpError(
        409,
        "A newer version exists. Reopen the review before saving.",
      );
    const sourceIds = new Set(
      current.candidate.regions
        .filter((region) => region.proposed?.trim())
        .map((region) => region.id),
    );
    if (evidenceIds.some((id) => !sourceIds.has(id)))
      throw new HttpError(400, "Select source lines from this extraction.");
    const {
      rows: [row],
    } = await sql.query(
      "INSERT INTO extraction_staging.tax_reviews(candidate_id, extraction_revision, actor_id, decision, fields) " +
        "VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id::text",
      [
        candidateId,
        extractionRevision,
        viewer.id,
        decision,
        JSON.stringify(fields),
      ],
    );
    return { id: String(row.id), decision, fields };
  });
}
