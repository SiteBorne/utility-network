"""Local CLI entry point for the document-processing core. No Modal import.

Usage:
    .venv/bin/python -m modal_worker.local_runner <path-to-pdf-or-image> [--ocr-policy if_needed]
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

from .document import InMemoryArtifactAccessor, execute
from .document.hashing import content_hash
from .document.models import ArtifactReference, OcrPolicy, TablePolicy, WorkerRequest, WorkerResult


def _media_type_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".png":
        return "image/png"
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    raise SystemExit(f"unsupported file extension: {suffix}")


def run_file(
    path: Path, ocr_policy: OcrPolicy = OcrPolicy.IF_NEEDED, table_policy: TablePolicy = TablePolicy.EXTRACT
) -> WorkerResult:
    data = path.read_bytes()
    media_type = _media_type_for(path)
    artifact_id = f"local/{path.name}"

    accessor = InMemoryArtifactAccessor()
    accessor.register(artifact_id, data, media_type)

    request = WorkerRequest(
        job_id=str(uuid.uuid4()),
        request_id=str(uuid.uuid4()),
        service_id="document_evidence_json.v1",
        contract_release="1.0.0",
        input_schema_hash="sha256:" + "0" * 64,
        artifact_reference=ArtifactReference(
            artifact_id=artifact_id,
            media_type=media_type,  # type: ignore[arg-type]
            size_bytes=len(data),
            content_hash=content_hash(data),
        ),
        declared_media_type=media_type,  # type: ignore[arg-type]
        declared_byte_length=len(data),
        declared_sha256=content_hash(data),
        ocr_policy=ocr_policy,
        table_policy=table_policy,
    )

    return execute(request, accessor)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the document worker locally against a file.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--ocr-policy", choices=[p.value for p in OcrPolicy], default=OcrPolicy.IF_NEEDED.value)
    parser.add_argument("--table-policy", choices=[p.value for p in TablePolicy], default=TablePolicy.EXTRACT.value)
    args = parser.parse_args(argv)

    result = run_file(args.path, OcrPolicy(args.ocr_policy), TablePolicy(args.table_policy))
    print(json.dumps(json.loads(result.model_dump_json()), indent=2))
    return 0 if result.status.value != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
