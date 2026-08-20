#!/usr/bin/env python3
"""Verify the private BOM extraction corpus against the production engine.

The workbook corpus and ``manifest.local.json`` are intentionally ignored by
Git.  The manifest must be authored from source-only review before this runner
is used; this script never derives expected results from engine output.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Iterable

from openpyxl.utils import get_column_letter

from bom_extraction_engine.bom_loader import get_sheet_names, load_sheet
from bom_extraction_engine.engine import SmartbomConfig, build_smartbom_result
from bom_extraction_engine.workbook import detect_header


ENGINE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ENGINE_ROOT / "local-corpus" / "bom-extraction"
DEFAULT_MANIFEST = DEFAULT_CORPUS / "manifest.local.json"
SUPPORTED_SUFFIXES = {".xlsx", ".xlsm", ".xls", ".csv", ".tsv", ".bom"}


class ManifestError(ValueError):
    """The local ground-truth manifest is incomplete or inconsistent."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalized_relative_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise ManifestError(f"corpus 밖 경로는 허용하지 않음: {value}")
    return path.as_posix()


def _blocks(rows: Iterable[int]) -> list[list[int]]:
    blocks: list[list[int]] = []
    for row in sorted(set(rows)):
        if row < 1:
            raise ManifestError(f"행 번호는 1 이상이어야 함: {row}")
        if not blocks or row != blocks[-1][-1] + 1:
            blocks.append([row])
        else:
            blocks[-1].append(row)
    return blocks


def _expected_blocks(raw: Any, *, context: str) -> list[list[int]]:
    if not isinstance(raw, list):
        raise ManifestError(f"{context}: header.blocks_1based는 배열이어야 함")
    rows: list[int] = []
    for block in raw:
        if not isinstance(block, list) or not block:
            raise ManifestError(f"{context}: 빈 헤더 블록은 허용하지 않음")
        if any(not isinstance(row, int) for row in block):
            raise ManifestError(f"{context}: 헤더 행은 정수여야 함")
        normalized = _blocks(block)
        if len(normalized) != 1 or normalized[0] != block:
            raise ManifestError(
                f"{context}: 각 헤더 블록은 오름차순 연속 행이어야 함: {block}"
            )
        rows.extend(block)
    if len(rows) != len(set(rows)):
        raise ManifestError(f"{context}: 헤더 행이 중복됨")
    return _blocks(rows)


def _load_manifest(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise ManifestError(f"정답 manifest 없음: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError(f"manifest 읽기 실패: {exc}") from exc
    if not isinstance(payload, dict) or payload.get("schema_version") != 2:
        raise ManifestError("manifest schema_version은 2여야 함")
    if payload.get("corpus_kind") != "bom-extraction":
        raise ManifestError("manifest corpus_kind는 bom-extraction이어야 함")
    files = payload.get("files")
    if not isinstance(files, list) or not files:
        raise ManifestError("manifest files는 비어 있지 않은 배열이어야 함")
    return payload


def _corpus_files(corpus: Path) -> set[str]:
    return {
        path.relative_to(corpus).as_posix()
        for path in corpus.rglob("*")
        if path.is_file() and path.suffix.casefold() in SUPPORTED_SUFFIXES
    }


def _actual_columns(headers: list[dict[str, Any]], sheet_name: str) -> dict[str, list[str]]:
    columns: dict[str, list[str]] = {}
    for header in headers:
        if header.get("sheet_name") != sheet_name:
            continue
        field = str(header.get("semantic_field") or "")
        column = header.get("column_1based")
        if not field or not isinstance(column, int):
            continue
        columns.setdefault(field, []).append(get_column_letter(column))
    return {field: sorted(set(values)) for field, values in columns.items()}


def _expected_columns(raw: Any, *, context: str) -> dict[str, list[str]]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ManifestError(f"{context}: expected_columns는 객체여야 함")
    normalized: dict[str, list[str]] = {}
    for field, value in raw.items():
        values = value if isinstance(value, list) else [value]
        if not values or any(not isinstance(item, str) or not item.strip() for item in values):
            raise ManifestError(f"{context}: 잘못된 expected_columns.{field}")
        normalized[str(field)] = sorted({item.strip().upper() for item in values})
    return normalized


def _sheet_components(result: dict[str, Any], sheet_name: str) -> list[dict[str, Any]]:
    return [
        component
        for component in result.get("components", [])
        if component.get("sheet_name") == sheet_name
    ]


def _component_rows(components: Iterable[dict[str, Any]]) -> set[int]:
    rows: set[int] = set()
    for component in components:
        for row in component.get("source_rows_1based") or []:
            if isinstance(row, int):
                rows.add(row)
    return rows


def verify(corpus: Path, manifest_path: Path, *,
           check: str = "all") -> tuple[dict[str, Any], int]:
    if check not in {"headers", "extraction", "all"}:
        raise ManifestError(f"지원하지 않는 check 모드: {check}")
    manifest = _load_manifest(manifest_path)
    declared_paths: set[str] = set()
    issues: list[dict[str, Any]] = []
    checked_sheets = 0

    for file_entry in manifest["files"]:
        if not isinstance(file_entry, dict):
            raise ManifestError("각 files 항목은 객체여야 함")
        relative = _normalized_relative_path(
            str(file_entry.get("stored_path") or "")
        )
        context = relative or "<빈 경로>"
        if not relative or relative in declared_paths:
            raise ManifestError(f"중복되거나 빈 corpus 경로: {context}")
        declared_paths.add(relative)
        original_paths = file_entry.get("original_paths")
        if (not isinstance(original_paths, list)
                or not original_paths
                or any(not isinstance(path, str) or not path.strip()
                       for path in original_paths)):
            raise ManifestError(
                f"{context}: original_paths는 비어 있지 않은 문자열 배열이어야 함"
            )
        source_path = corpus / Path(relative)
        if not source_path.is_file():
            issues.append({"file": relative, "kind": "missing_file"})
            continue

        expected_hash = str(file_entry.get("sha256") or "").casefold()
        actual_hash = _sha256(source_path)
        if expected_hash != actual_hash:
            issues.append({
                "file": relative,
                "kind": "sha256_mismatch",
                "expected": expected_hash,
                "actual": actual_hash,
            })
            continue

        sheet_entries = file_entry.get("sheets")
        if not isinstance(sheet_entries, list) or not sheet_entries:
            raise ManifestError(f"{context}: sheets는 비어 있지 않은 배열이어야 함")
        expected_sheet_names = [str(entry.get("name") or "") for entry in sheet_entries]
        if any(not name for name in expected_sheet_names):
            raise ManifestError(f"{context}: 빈 시트 이름")
        actual_sheet_names = get_sheet_names(str(source_path))
        if expected_sheet_names != actual_sheet_names:
            issues.append({
                "file": relative,
                "kind": "sheet_list_mismatch",
                "expected": expected_sheet_names,
                "actual": actual_sheet_names,
            })

        result = build_smartbom_result(
            input_path=source_path,
            original_filename=Path(original_paths[0]).name,
            progress=lambda *_: None,
            config=SmartbomConfig(m2v_path="off"),
        )
        result_sheets = {
            str(sheet.get("sheet_name")): sheet
            for sheet in result.get("sheets", [])
        }

        for sheet_index, expected in enumerate(sheet_entries):
            sheet_name = expected_sheet_names[sheet_index]
            sheet_context = f"{relative}::{sheet_name}"
            checked_sheets += 1
            classification = expected.get("classification")
            if classification not in {"bom", "non_bom"}:
                raise ManifestError(
                    f"{sheet_context}: classification은 bom 또는 non_bom이어야 함"
                )
            actual_sheet = result_sheets.get(sheet_name)
            if actual_sheet is None:
                issues.append({"file": relative, "sheet": sheet_name, "kind": "missing_sheet_result"})
                continue

            status = actual_sheet.get("status")
            header_expected = expected.get("header")
            extraction_expected = expected.get("extraction")
            if not isinstance(header_expected, dict):
                raise ManifestError(f"{sheet_context}: header 계약이 필요함")
            if not isinstance(extraction_expected, dict):
                raise ManifestError(f"{sheet_context}: extraction 계약이 필요함")
            if classification == "non_bom":
                if status != "not_bom":
                    issues.append({
                        "file": relative,
                        "sheet": sheet_name,
                        "kind": (
                            "non_bom_processing_error"
                            if status == "error"
                            else "non_bom_false_positive"
                        ),
                        "actual": status,
                        "reason": actual_sheet.get("unparsed_reason"),
                    })
                continue
            if status != "parsed":
                issues.append({
                    "file": relative,
                    "sheet": sheet_name,
                    "kind": "bom_not_parsed",
                    "actual": status,
                    "reason": actual_sheet.get("unparsed_reason"),
                })
                continue

            if check in {"headers", "all"}:
                expected_blocks = _expected_blocks(
                    header_expected.get("blocks_1based"), context=sheet_context
                )
                actual_rows = actual_sheet.get("header_rows_1based") or []
                actual_blocks = _blocks(int(row) for row in actual_rows)
                if expected_blocks != actual_blocks:
                    issues.append({
                        "file": relative,
                        "sheet": sheet_name,
                        "kind": "header_blocks_mismatch",
                        "expected": expected_blocks,
                        "actual": actual_blocks,
                    })

                frame = load_sheet(str(source_path), sheet_index)
                probe = detect_header(frame)
                expected_anchor = header_expected.get(
                    "primary_anchor_row_1based"
                )
                actual_anchor = (
                    probe.header_row + 1
                    if probe.found and probe.header_row is not None
                    else None
                )
                allowed_anchors = header_expected.get(
                    "allowed_anchor_rows_1based"
                )
                if allowed_anchors is not None:
                    if (not isinstance(allowed_anchors, list)
                            or not allowed_anchors
                            or any(not isinstance(row, int) or row < 1
                                   for row in allowed_anchors)):
                        raise ManifestError(
                            f"{sheet_context}: 잘못된 allowed anchor 행"
                        )
                    anchor_matches = actual_anchor in allowed_anchors
                    anchor_expectation: Any = allowed_anchors
                else:
                    anchor_matches = expected_anchor == actual_anchor
                    anchor_expectation = expected_anchor
                if not anchor_matches:
                    issues.append({
                        "file": relative,
                        "sheet": sheet_name,
                        "kind": "anchor_mismatch",
                        "expected": anchor_expectation,
                        "actual": actual_anchor,
                        "reason": probe.reason,
                    })

            components = _sheet_components(result, sheet_name)
            component_rows = _component_rows(components)
            if (check in {"extraction", "all"}
                    and "first_component_row_1based" in extraction_expected):
                expected_first = extraction_expected.get(
                    "first_component_row_1based"
                )
                actual_first = min(component_rows) if component_rows else None
                if expected_first != actual_first:
                    issues.append({
                        "file": relative,
                        "sheet": sheet_name,
                        "kind": "first_component_row_mismatch",
                        "expected": expected_first,
                        "actual": actual_first,
                    })

            if check in {"extraction", "all"}:
                forbidden_raw = extraction_expected.get(
                    "forbidden_component_rows_1based"
                ) or []
                if any(not isinstance(row, int) or row < 1
                       for row in forbidden_raw):
                    raise ManifestError(
                        f"{sheet_context}: 잘못된 forbidden component 행"
                    )
                leaked = sorted(set(forbidden_raw) & component_rows)
                if leaked:
                    issues.append({
                        "file": relative,
                        "sheet": sheet_name,
                        "kind": "forbidden_component_rows_emitted",
                        "rows": leaked,
                    })

                expected_columns = _expected_columns(
                    extraction_expected.get("expected_columns"),
                    context=sheet_context,
                )
                if expected_columns:
                    actual_columns = _actual_columns(
                        result.get("headers", []), sheet_name
                    )
                    for field, columns in expected_columns.items():
                        if actual_columns.get(field, []) != columns:
                            issues.append({
                                "file": relative,
                                "sheet": sheet_name,
                                "kind": "column_mapping_mismatch",
                                "field": field,
                                "expected": columns,
                                "actual": actual_columns.get(field, []),
                            })

    actual_paths = _corpus_files(corpus)
    for undeclared in sorted(actual_paths - declared_paths):
        issues.append({"file": undeclared, "kind": "undeclared_corpus_file"})
    for missing in sorted(declared_paths - actual_paths):
        if not any(issue.get("file") == missing and issue["kind"] == "missing_file" for issue in issues):
            issues.append({"file": missing, "kind": "missing_file"})

    report = {
        "schema_version": 2,
        "corpus_kind": "bom-extraction",
        "check": check,
        "corpus": str(corpus.resolve()),
        "manifest": str(manifest_path.resolve()),
        "checked_files": len(declared_paths),
        "checked_sheets": checked_sheets,
        "passed": not issues,
        "issues": issues,
    }
    return report, 0 if not issues else 1


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--check", choices=("headers", "extraction", "all"), default="all",
    )
    parser.add_argument("--json-output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    corpus = args.corpus.resolve()
    manifest = args.manifest.resolve()
    try:
        report, exit_code = verify(corpus, manifest, check=args.check)
    except ManifestError as exc:
        print(f"[manifest 오류] {exc}", file=sys.stderr)
        return 2

    if args.json_output is not None:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    state = "PASS" if report["passed"] else "FAIL"
    print(
        f"[BOM extraction corpus:{report['check']}] {state}: "
        f"{report['checked_files']} files, {report['checked_sheets']} sheets, "
        f"{len(report['issues'])} issues"
    )
    for issue in report["issues"]:
        print("  " + json.dumps(issue, ensure_ascii=False, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
