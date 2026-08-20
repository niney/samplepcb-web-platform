# -*- coding: utf-8 -*-
"""Local BOM extraction corpus runner contract tests."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace


def _load_runner_module():
    engine_root = Path(__file__).resolve().parents[3]
    script = engine_root / "scripts" / "verify-bom-extraction-corpus.py"
    spec = importlib.util.spec_from_file_location(
        "verify_bom_extraction_corpus", script,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_non_bom_processing_error_fails_the_gate(tmp_path: Path, monkeypatch):
    runner = _load_runner_module()
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    source = corpus / "broken.xlsx"
    source.write_bytes(b"not-a-real-workbook")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = corpus / "manifest.local.json"
    manifest.write_text(
        json.dumps({
            "schema_version": 2,
            "corpus_kind": "bom-extraction",
            "files": [{
                "stored_path": source.name,
                "sha256": digest,
                "original_paths": ["source/broken.xlsx"],
                "sheets": [{
                    "name": "Sheet1",
                    "classification": "non_bom",
                    "header": {
                        "primary_anchor_row_1based": None,
                        "allowed_anchor_rows_1based": [],
                        "blocks_1based": [],
                    },
                    "extraction": {
                        "forbidden_component_rows_1based": [],
                    },
                }],
            }],
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "get_sheet_names", lambda _: ["Sheet1"])
    monkeypatch.setattr(
        runner,
        "build_smartbom_result",
        lambda **_: {
            "sheets": [{
                "sheet_name": "Sheet1",
                "status": "error",
                "unparsed_reason": "synthetic parse failure",
            }],
            "components": [],
            "headers": [],
        },
    )

    report, exit_code = runner.verify(corpus, manifest)

    assert exit_code == 1
    assert report["passed"] is False
    assert report["issues"] == [{
        "file": source.name,
        "sheet": "Sheet1",
        "kind": "non_bom_processing_error",
        "actual": "error",
        "reason": "synthetic parse failure",
    }]


def test_repeated_header_allows_any_declared_anchor_and_optional_first_row(
        tmp_path: Path, monkeypatch):
    runner = _load_runner_module()
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    source = corpus / "repeated.xlsx"
    source.write_bytes(b"synthetic-workbook")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest = corpus / "manifest.local.json"
    manifest.write_text(
        json.dumps({
            "schema_version": 2,
            "corpus_kind": "bom-extraction",
            "files": [{
                "stored_path": source.name,
                "sha256": digest,
                "original_paths": ["source/repeated.xlsx"],
                "sheets": [{
                    "name": "BOM",
                    "classification": "bom",
                    "header": {
                        "primary_anchor_row_1based": 1,
                        "allowed_anchor_rows_1based": [1, 10],
                        "blocks_1based": [[1], [10]],
                    },
                    "extraction": {
                        "forbidden_component_rows_1based": [1, 10],
                    },
                }],
            }],
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(runner, "get_sheet_names", lambda _: ["BOM"])
    monkeypatch.setattr(runner, "load_sheet", lambda *_: object())
    monkeypatch.setattr(
        runner,
        "detect_header",
        lambda _: SimpleNamespace(found=True, header_row=9, reason="repeat"),
    )
    monkeypatch.setattr(
        runner,
        "build_smartbom_result",
        lambda **_: {
            "sheets": [{
                "sheet_name": "BOM",
                "status": "parsed",
                "header_rows_1based": [1, 10],
                "unparsed_reason": None,
            }],
            "components": [],
            "headers": [],
        },
    )

    report, exit_code = runner.verify(corpus, manifest)

    assert exit_code == 0
    assert report["passed"] is True
    assert report["issues"] == []
