"""Package source-informed reconstruction examples without modifying their trial."""

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .benchmark import digest
from .table_repair import source_evidence, validate_repair


def prepare_workspace(trial: Path, plan_path: Path, output: Path):
    if output.exists():
        raise ValueError("Use a fresh reconstruction workspace")
    if plan_path.stat().st_size > 1024**2:
        raise ValueError("Repair plan exceeds budget")
    plan = json.loads(plan_path.read_text())
    if (
        plan.get("state") != "AGENT_RECONSTRUCTION_EXAMPLES_NOT_ACCEPTED"
        or plan.get("publication_eligible") is not False
        or plan.get("owner_verified") is not False
        or len(plan.get("examples", [])) != 2
    ):
        raise ValueError("Only the two unaccepted engineering examples are supported")
    report = json.loads((trial / "scan-tables.json").read_text())
    contexts, packages = [], {}
    for row in plan["examples"]:
        case = next(c for c in report["cases"] if c["id"] == row["case_id"])
        doc = next(d for d in report["documents"] if d["source_sha256"] == case["source_sha256"])
        package = trial / doc["package"]
        bound, page, cells, image = source_evidence(package, case["id"])
        if bound.raw_sha256 != row["raw_sha256"]:
            raise ValueError("Engineering example belongs to a different provider revision")
        packages[case["id"]] = package
        contexts.append(
            {
                "case_id": case["id"],
                "binding": bound.model_dump(),
                "width": page.width,
                "height": page.height,
                "raw_cells": cells,
                "image": Path(os.path.relpath(image, output.resolve())).as_posix(),
                "original": Path(
                    os.path.relpath(package / "original.pdf", output.resolve())
                ).as_posix(),
                "raw_output": Path(
                    os.path.relpath(
                        trial
                        / next(
                            a["raw"]
                            for a in case["attempts"]
                            if a["provider"] == "docling-image-en"
                        ),
                        output.resolve(),
                    )
                ).as_posix(),
            }
        )
    assets = Path(__file__).parent / "table_assets"
    env = {k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "TMPDIR", "SYSTEMROOT"}}
    result = subprocess.run(
        ["node", str(assets / "repair_examples.mjs")],
        input=json.dumps({"plan": plan, "contexts": contexts}),
        text=True,
        capture_output=True,
        timeout=20,
        env=env,
        check=False,
    )
    if result.returncode or len(result.stdout.encode()) > 5 * 1024**2:
        raise ValueError("Engineering reconstruction builder failed: " + result.stderr[-1500:])
    data = json.loads(result.stdout)
    summaries = []
    for sample in data["samples"]:
        for key in ["draft", "prepared"]:
            checked, accounting = validate_repair(packages[sample["case_id"]], sample[key])
            sample[key] = checked.model_dump()
            summaries.append(
                {
                    "case": sample["case_id"],
                    "version": key,
                    "rows": len(checked.y) - 1,
                    "columns": len(checked.x) - 1,
                    **accounting,
                }
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".reconstruction-", dir=output.parent))
    (staging / "repairs.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    for name in ["repair.html", "repair.css", "repair.js", "repair_ops.mjs"]:
        shutil.copy2(assets / name, staging / ("index.html" if name == "repair.html" else name))
    metadata = {
        "state": "TABLE_RECONSTRUCTION_DRAFT",
        "publication_eligible": False,
        "owner_verified": False,
        "plan_sha256": digest(plan_path),
        "trial_sha256": digest(trial / "scan-tables.json"),
        "summaries": summaries,
        "code_sha256": {
            name: digest(assets / name)
            for name in [
                "repair_examples.mjs",
                "repair_ops.mjs",
                "repair.js",
                "repair.html",
                "repair.css",
            ]
        },
        "limitations": [
            "Agent-prepared source geometry and transcriptions; no automatic repair or accepted reference.",
            "Only the scoped bands are reconstructed; all remaining raw cells/text stay unplaced and unreviewed.",
            "Saving/validation establishes lineage and geometry consistency, not extraction or legal acceptance.",
        ],
    }
    (staging / "reconstruction.json").write_text(json.dumps(metadata, indent=2) + "\n")
    (staging / "files.json").write_text(
        json.dumps({p.name: digest(p) for p in sorted(staging.iterdir())}, indent=2) + "\n"
    )
    staging.rename(output)
    return metadata
