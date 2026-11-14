"""Operator-only local evidence adapter. Never exposed as a client registry endpoint."""

import hashlib
import json
from pathlib import Path

from .staging import RegisteredRun, RegisteredSource, Registry
from .table_review import SHA


def write_registry(registry: Registry, root: Path):
    root.mkdir(exist_ok=False, parents=True)
    objects = root / "objects"
    objects.mkdir()
    index = {}
    for key, raw in registry.objects.items():
        digest = hashlib.sha256(raw).hexdigest()
        index[key] = digest
        target = objects / (digest + ".blob")
        if not target.exists():
            target.write_bytes(raw)
    (root / "registry.json").write_text(
        json.dumps(
            {
                "schema_version": "0.1.0",
                "authority": "OPERATOR_LOCAL_REGISTRY_NOT_AUTHENTICATED_REVIEW",
                "objects": index,
                "sources": {k: v.model_dump() for k, v in registry.sources.items()},
                "runs": {k: v.model_dump() for k, v in registry.runs.items()},
            },
            indent=2,
        )
        + "\n"
    )


def load_registry(root: Path):
    """Root is selected by the operator, independently of an import request.

    This local adapter is not authenticated registration, a cloud object store,
    an atomic import transaction, or permission to trust a client-supplied root.
    """
    import re

    from .staging import ID

    root = root.resolve()
    descriptor = root / "registry.json"
    if descriptor.is_symlink() or descriptor.stat().st_size > 2 * 1024**2:
        raise ValueError("Registry descriptor exceeds budget or is unsafe")
    data = json.loads(descriptor.read_text())
    if (
        data.get("schema_version") != "0.1.0"
        or data.get("authority") != "OPERATOR_LOCAL_REGISTRY_NOT_AUTHENTICATED_REVIEW"
        or not 1 <= len(data.get("objects", {})) <= 1200
        or not 1 <= len(data.get("sources", {})) <= 20
        or not 1 <= len(data.get("runs", {})) <= 20
        or (root / "objects").is_symlink()
    ):
        raise ValueError("Invalid local registry inventory")
    blobs, total = {}, 0
    for key, digest in data["objects"].items():
        if not re.fullmatch(ID, key) or not re.fullmatch(SHA, digest):
            raise ValueError("Unsafe registered object identifier")
        file = root / "objects" / (digest + ".blob")
        if file.is_symlink() or not file.is_file():
            raise ValueError("Registered object is missing or unsafe")
        size = file.stat().st_size
        total += size
        if size > 100 * 1024**2 or total > 300 * 1024**2:
            raise ValueError("Local registry byte budget exceeded")
        raw = file.read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Local registered object changed")
        blobs[key] = raw
    return Registry(
        {k: RegisteredSource.model_validate(v) for k, v in data["sources"].items()},
        {k: RegisteredRun.model_validate(v) for k, v in data["runs"].items()},
        blobs,
    )
