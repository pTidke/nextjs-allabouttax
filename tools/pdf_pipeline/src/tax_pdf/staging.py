"""Pure staging boundary. Trusted registry is supplied by the operator, never the client.

Validation has no filesystem, network, database, reviewer authority or index effects.
A consistent candidate can enter extraction review; nothing here grants acceptance.
"""

import hashlib
import json
from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from urllib.parse import urlsplit

from PIL import Image
from pydantic import Field

from .models import Artifact, Model, assess
from .review_store import checksum
from .table_repair import RepairDraft, validate_layout
from .table_review import SHA

ID = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$"


class ObjectRef(Model):
    object_id: str = Field(pattern=ID)
    sha256: str = Field(pattern=SHA)


class RenderRef(Model):
    page: int = Field(ge=1, le=1000)
    object: ObjectRef


class TextProposal(Model):
    block_id: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=20000)
    note: str = Field(default="", max_length=4000)


class ScopeRevision(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    state: Literal["STAGING_EXTRACTION_DRAFT"] = "STAGING_EXTRACTION_DRAFT"
    publication_eligible: Literal[False] = False
    acceptance: None = None
    run_id: str = Field(min_length=1, max_length=100)
    source_sha256: str = Field(pattern=SHA)
    artifact_sha256: str = Field(pattern=SHA)
    kind: Literal["native_full_pages", "image_table_band"]
    pages: list[int] = Field(min_length=1, max_length=1000)
    scope_note: str = Field(min_length=1, max_length=4000)
    text: list[TextProposal] = Field(default_factory=list, max_length=10000)
    reconstruction: RepairDraft | None = None
    # Raw registered evidence remains attached, with no automatic context inference.
    context_objects: list[ObjectRef] = Field(default_factory=list, max_length=20)
    prior_feedback: list[ObjectRef] = Field(default_factory=list, max_length=20)
    required_context_regions: list[str] = Field(default_factory=list, max_length=1000)


class ImportEnvelope(Model):
    schema_version: Literal["0.1.0"] = "0.1.0"
    state: Literal["STAGING_IMPORT_REQUEST"] = "STAGING_IMPORT_REQUEST"
    publication_eligible: Literal[False] = False
    acceptance: None = None
    source_id: str = Field(pattern=ID)
    run_id: str = Field(min_length=1, max_length=100)
    original: ObjectRef
    artifact: ObjectRef
    renders: list[RenderRef] = Field(max_length=1000)
    raw_outputs: list[ObjectRef] = Field(max_length=20)
    revision: ObjectRef
    expected_parent_sha256: str | None = Field(default=None, pattern=SHA)


class RegisteredSource(Model):
    source_id: str = Field(pattern=ID)
    original: ObjectRef
    page_count: int = Field(ge=1, le=1000)
    byte_length: int = Field(ge=1, le=100 * 1024**2)
    official_url: str = Field(max_length=2000)
    registered_at: str = Field(min_length=1, max_length=100)


class RegisteredRun(Model):
    source_id: str = Field(pattern=ID)
    run_id: str = Field(min_length=1, max_length=100)
    artifact: ObjectRef
    renders: list[RenderRef] = Field(max_length=1000)
    raw_outputs: list[ObjectRef] = Field(max_length=20)
    revision: ObjectRef
    context_objects: list[ObjectRef] = Field(default_factory=list, max_length=20)
    prior_feedback: list[ObjectRef] = Field(default_factory=list, max_length=20)
    # Optimistic precondition only. A future persistence transaction must check again.
    review_head_sha256: str | None = Field(default=None, pattern=SHA)
    holds: list[str] = Field(default_factory=list, max_length=100)
    repair_binding: dict | None = None


@dataclass(frozen=True)
class Registry:
    sources: dict[str, RegisteredSource]
    runs: dict[str, RegisteredRun]
    objects: dict[str, bytes]


def object_bytes(ref: ObjectRef, registry: Registry, budget=40 * 1024**2):
    raw = registry.objects.get(ref.object_id)
    if not isinstance(raw, bytes) or len(raw) > budget:
        raise ValueError("Registered object missing or exceeds budget")
    if hashlib.sha256(raw).hexdigest() != ref.sha256:
        raise ValueError("Registered object checksum mismatch")
    return raw


def _same_inventory(actual, expected, *, renders=False):
    if renders:
        a = [(x.page, x.object.object_id, x.object.sha256) for x in actual]
        b = [(x.page, x.object.object_id, x.object.sha256) for x in expected]
        unique = len({x.page for x in actual}) == len(actual)
    else:
        a = [(x.object_id, x.sha256) for x in actual]
        b = [(x.object_id, x.sha256) for x in expected]
        unique = len({x.object_id for x in actual}) == len(actual)
    if not unique or sorted(a) != sorted(b):
        raise ValueError("Registered evidence inventory mismatch")


def validate_import(value, registry: Registry):
    """Returns a non-authoritative receipt; caller must not treat it as acceptance."""
    envelope = ImportEnvelope.model_validate(value)
    source = registry.sources.get(envelope.source_id)
    run = registry.runs.get(envelope.run_id)
    if not source or not run or source.source_id != envelope.source_id:
        raise ValueError("Unknown registered source/run")
    if run.source_id != source.source_id or run.run_id != envelope.run_id:
        raise ValueError("Run belongs to a different source")
    if (
        envelope.original != source.original
        or envelope.artifact != run.artifact
        or envelope.revision != run.revision
        or envelope.expected_parent_sha256 != run.review_head_sha256
    ):
        raise ValueError("Stale source, artifact, revision or review parent")
    _same_inventory(envelope.renders, run.renders, renders=True)
    _same_inventory(envelope.raw_outputs, run.raw_outputs)
    url = urlsplit(source.official_url)
    if (
        url.scheme != "https"
        or url.hostname
        not in {
            "incometaxindia.gov.in",
            "www.incometaxindia.gov.in",
            "incometax.gov.in",
            "www.incometax.gov.in",
        }
        or url.username
        or url.password
        or url.port not in {None, 443}
    ):
        raise ValueError("Source metadata needs a registered official HTTPS URL")
    references = (
        [envelope.original, envelope.artifact, envelope.revision]
        + [r.object for r in envelope.renders]
        + run.raw_outputs
        + run.context_objects
        + run.prior_feedback
    )
    if sum(len(registry.objects.get(ref.object_id, b"")) for ref in references) > 300 * 1024**2:
        raise ValueError("Referenced evidence exceeds total byte budget")
    original = object_bytes(envelope.original, registry, 100 * 1024**2)
    if len(original) != source.byte_length or not original.startswith(b"%PDF-"):
        raise ValueError("Registered original metadata mismatch")
    artifact = Artifact.model_validate_json(object_bytes(envelope.artifact, registry, 20 * 1024**2))
    if (
        artifact.run_id != run.run_id
        or artifact.source_sha256 != source.original.sha256
        or artifact.source_bytes != len(original)
        or artifact.expected_pages != source.page_count
    ):
        raise ValueError("Artifact belongs to a different source/run/page inventory")
    if sorted(p.number for p in artifact.pages) != list(range(1, source.page_count + 1)):
        raise ValueError("Every original page must have exactly one manifest entry")
    pages = {p.number: p for p in artifact.pages}
    rendered = [p for p in artifact.pages if p.render]
    if {p.number for p in rendered} != {r.page for r in run.renders}:
        raise ValueError("Render inventory does not account for artifact pages")
    for render in run.renders:
        if render.object.sha256 != pages[render.page].render_sha256:
            raise ValueError("Render belongs to a different page revision")
        with Image.open(BytesIO(object_bytes(render.object, registry))) as image:
            if image.format != "PNG" or not 0 < image.width * image.height <= 16_000_000:
                raise ValueError("Invalid or oversized registered page render")
            image.verify()
    for ref in run.raw_outputs + run.context_objects + run.prior_feedback:
        object_bytes(ref, registry)
    revision = ScopeRevision.model_validate_json(
        object_bytes(envelope.revision, registry, 5 * 1024**2)
    )
    if (
        revision.run_id != run.run_id
        or revision.source_sha256 != source.original.sha256
        or revision.artifact_sha256 != run.artifact.sha256
    ):
        raise ValueError("Scope revision belongs to different evidence")
    if len(set(revision.pages)) != len(revision.pages) or any(
        type(n) is not int or n not in pages for n in revision.pages
    ):
        raise ValueError("Unknown or repeated scope page")
    _same_inventory(revision.context_objects, run.context_objects)
    _same_inventory(revision.prior_feedback, run.prior_feedback)
    assessed = assess(artifact.model_copy(deep=True))
    if any(i.code == "UNIQUE_REGION_IDS_REQUIRED" for i in assessed.issues):
        raise ValueError("Ambiguous source region identities")
    blockers = set(run.holds)
    review_holds = {
        "AUTHENTICATED_EXTRACTION_REVIEW_REQUIRED",
        "TAX_REVIEW_REQUIRED",
        "RELEASE_REQUIRED",
    }
    if revision.context_objects:
        blockers.add("CONTEXT_DEPENDENCIES_UNREVIEWED")
    for p in artifact.pages:
        if p.number in revision.pages:
            if p.status != "native_candidate" or not p.render:
                blockers.add("SCOPE_PAGE_PROCESSING_INCOMPLETE")
            blockers.update(i.code for i in p.issues if i.severity == "blocking")
            review_holds.update(i.code for i in p.issues if i.severity == "review")
    blockers.update(
        i.code
        for i in artifact.issues
        if i.severity == "blocking" and i.code not in {"PAGE_PROCESSING_INCOMPLETE"}
    )
    review_holds.update(i.code for i in artifact.issues if i.severity == "review")
    block_map = {b.id: (p, b) for p in artifact.pages for b in p.blocks}
    if len(set(revision.required_context_regions)) != len(revision.required_context_regions):
        raise ValueError("Duplicate context region")
    if any(key not in block_map for key in revision.required_context_regions):
        raise ValueError("Foreign required context region")
    accounting = None
    if revision.kind == "native_full_pages":
        if revision.reconstruction is not None or run.repair_binding is not None:
            raise ValueError("Native text scope cannot substitute a reconstruction")
        expected = {b.id for p in artifact.pages if p.number in revision.pages for b in p.blocks}
        actual = [t.block_id for t in revision.text]
        if set(actual) != expected or len(actual) != len(expected) or not expected:
            raise ValueError("Full-page text inventory is incomplete, duplicated or foreign")
        if any(p.tables for p in artifact.pages if p.number in revision.pages):
            blockers.add("NATIVE_TABLE_IMPORT_NOT_SUPPORTED")
        for proposal in revision.text:
            if block_map[proposal.block_id][1].raw_text.strip() and not proposal.text.strip():
                raise ValueError("Removing printed text requires an explicit exclusion contract")
            if (
                proposal.text != block_map[proposal.block_id][1].raw_text
                and not proposal.note.strip()
            ):
                raise ValueError("Changed transcription requires a source note")
        if not set(revision.required_context_regions) <= set(actual):
            blockers.add("REQUIRED_CONTEXT_OUTSIDE_SCOPE")
    else:
        if revision.text or revision.reconstruction is None or run.repair_binding is None:
            raise ValueError("Image table scope needs its registered reconstruction")
        repair = revision.reconstruction
        bound = repair.binding
        if (
            bound.model_dump() != run.repair_binding
            or bound.run_id != run.run_id
            or bound.source_sha256 != source.original.sha256
            or bound.artifact_sha256 != run.artifact.sha256
            or revision.pages != [bound.page]
            or pages[bound.page].render_sha256 != bound.render_sha256
        ):
            raise ValueError("Reconstruction source revision mismatch")
        matching = [ref for ref in run.raw_outputs if ref.sha256 == bound.raw_sha256]
        if len(matching) != 1:
            raise ValueError("Reconstruction raw output is not uniquely registered")
        raw = json.loads(object_bytes(matching[0], registry))
        tables = raw.get("tables", [])
        if (
            bound.table_index >= len(tables)
            or checksum(tables[bound.table_index]) != bound.table_sha256
        ):
            raise ValueError("Raw table revision mismatch")
        raw_cells = tables[bound.table_index].get("data", {}).get("table_cells", [])
        if not 1 <= len(raw_cells) <= 10000 or any(
            not isinstance(c.get("text"), str) for c in raw_cells
        ):
            raise ValueError("Invalid registered raw cell inventory")
        page = pages[bound.page]
        accounting = validate_layout(repair, page.width, page.height, raw_cells)
        if accounting["unplaced_characters"]:
            blockers.add("TABLE_RAW_TEXT_UNPLACED")
        if accounting["unresolved_cells"] or any(c.state == "unreadable" for c in repair.cells):
            blockers.add("TABLE_CELLS_UNRESOLVED")
        # There is no accepted hierarchy/context contract for these partial bands yet.
        blockers.add("TABLE_CONTEXT_AND_STRUCTURE_UNREVIEWED")
        if revision.required_context_regions:
            blockers.add("TABLE_CONTEXT_REGIONS_UNREVIEWED")
    canonical = envelope.model_dump()
    canonical["renders"] = sorted(canonical["renders"], key=lambda r: r["page"])
    canonical["raw_outputs"] = sorted(canonical["raw_outputs"], key=lambda r: r["object_id"])
    return {
        "schema_version": "0.1.0",
        "state": "BLOCKED" if blockers else "AWAITING_EXTRACTION_REVIEW",
        "import_key": checksum(canonical),
        "source_id": source.source_id,
        "run_id": run.run_id,
        "revision_sha256": run.revision.sha256,
        "expected_parent_sha256": run.review_head_sha256,
        "scope_pages": revision.pages,
        "scope_note": revision.scope_note,
        "original_pages": source.page_count,
        "all_original_pages_inventoried": True,
        "whole_document_processed": assessed.processed_pages_complete,
        "upstream_issues": [i.model_dump() for i in artifact.issues]
        + [i.model_dump() for p in artifact.pages for i in p.issues],
        "blocking_holds": sorted(blockers),
        "review_holds": sorted(review_holds),
        "table_accounting": accounting,
        "publication_eligible": False,
        "extraction_accepted": False,
        "tax_approved": False,
        "retrieval_items_created": 0,
        "acceptance": None,
    }
