# -*- coding: utf-8 -*-
"""엑셀 로더 — 레거시(load_excel_pandas) 방식 차용 + 견고성 보강.

xlsx/xlsm: openpyxl read_only + data_only(수식 대신 계산값)
      실패 시 calamine 폴백 (openpyxl은 read_only여도 스타일시트를 파싱해서
      비표준 extLst 속성이 있는 파일에서 죽는다 — 레거시도 못 읽던 파일)
xls : pandas + xlrd, 실패 시 calamine 폴백
csv/tsv : stdlib csv (인코딩 폴백 + 구분자 추정 + 가변 열 허용)
헤더 추정 없이 header=None 원본 그리드 그대로 DataFrame으로 만든다.

원본(header_probing_claude) 대비 웹 이식 보정: 업로드 허용 확장자인
xlsm/tsv가 xlrd 분기로 낙하해 실패하던 라우팅을 명시 분기로 고쳤다.
"""
import csv as _csv
import io
import warnings
import zipfile
from pathlib import Path
from typing import List

import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning)

# openpyxl은 read_only여도 스타일시트를 통째로 파싱한다 — 서식 오염으로
# styles.xml이 수 MB로 부푼 파일(실측: BOM_MINI SERVO, 압축 해제 10.1MB)은
# 시트당 ~3초가 걸린다. 이런 파일만 스타일을 읽지 않는 calamine으로 우회.
_STYLES_BLOAT_BYTES = 2 * 1024 * 1024


def _styles_bloated(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as z:
            return z.getinfo("xl/styles.xml").file_size > _STYLES_BLOAT_BYTES
    except (KeyError, zipfile.BadZipFile, OSError):
        return False


def _load_csv(path: str) -> pd.DataFrame:
    """행마다 열 수가 다른(ragged) CSV도 크래시 없이 읽는다.

    pandas read_csv(sep=None, engine='python')는 일관된 열 수를 요구해
    가변 열 CSV에서 ParserError로 죽는다 — 실제 오픈소스/고객 BOM에 흔한
    형태라 stdlib csv.reader로 읽고 최대 폭으로 패딩한다.
    빈 문자열 셀은 pandas NaN 동작과 맞추기 위해 None으로 치환한다.
    """
    raw = Path(path).read_bytes()
    text = None
    for enc in ("utf-8-sig", "cp949", "utf-16", "latin1"):
        try:
            text = raw.decode(enc)
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    if text is None:
        raise ValueError(f"CSV 인코딩을 결정할 수 없습니다: {path}")
    delimiter = "\t" if path.lower().endswith(".tsv") else ","
    try:
        delimiter = _csv.Sniffer().sniff(text[:8192], delimiters=",\t;").delimiter
    except _csv.Error:
        pass
    rows = list(_csv.reader(io.StringIO(text), delimiter=delimiter))
    if not rows:
        return pd.DataFrame()
    source_row_widths = [len(row) for row in rows]
    width = max(len(r) for r in rows)
    data = [[(c if c != "" else None) for c in r] + [None] * (width - len(r))
            for r in rows]
    frame = pd.DataFrame(data, dtype=object)
    # Padding deliberately makes ragged rows rectangular. Keep their original
    # widths so the workbook layer can distinguish a truly empty trailing
    # column from an unquoted delimiter inside a data cell after header roles
    # are known.
    frame.attrs["source_row_widths"] = source_row_widths
    frame.attrs["source_delimiter"] = delimiter
    return frame


def get_sheet_names(path: str) -> List[str]:
    ext = path.lower().rsplit(".", 1)[-1]
    if ext in ("csv", "tsv"):
        return [ext]
    if ext in ("xlsx", "xlsm"):
        if _styles_bloated(path):
            return pd.ExcelFile(path, engine="calamine").sheet_names
        try:
            from openpyxl import load_workbook
            wb = load_workbook(filename=path, read_only=True)
            names = wb.sheetnames
            wb.close()
            return names
        except Exception:
            return pd.ExcelFile(path, engine="calamine").sheet_names
    if ext == "xls":
        try:
            return pd.ExcelFile(path, engine="xlrd").sheet_names
        except Exception:
            return pd.ExcelFile(path, engine="calamine").sheet_names
    raise ValueError(f"지원하지 않는 파일 형식: {ext}")


def load_sheet(path: str, sheet_idx: int = 0) -> pd.DataFrame:
    """시트 하나를 원본 그리드 그대로 로드한다."""
    ext = path.lower().rsplit(".", 1)[-1]
    if ext in ("csv", "tsv"):
        if sheet_idx != 0:
            raise ValueError("CSV/TSV는 시트가 하나입니다")
        return _load_csv(path)
    if ext in ("xlsx", "xlsm"):
        if _styles_bloated(path):
            return pd.read_excel(path, sheet_name=sheet_idx, header=None,
                                 engine="calamine")
        try:
            from openpyxl import load_workbook
            wb = load_workbook(filename=path, read_only=True, data_only=True)
            names = wb.sheetnames
            if sheet_idx >= len(names):
                raise ValueError(f"시트 인덱스 {sheet_idx} 초과 (총 {len(names)}개)")
            sheet = wb[names[sheet_idx]]
            data = [list(row) for row in sheet.iter_rows(values_only=True)]
            wb.close()
            return pd.DataFrame(data)
        except ValueError:
            raise
        except Exception:
            return pd.read_excel(path, sheet_name=sheet_idx, header=None,
                                 engine="calamine")
    if ext == "xls":
        try:
            return pd.read_excel(path, sheet_name=sheet_idx, header=None,
                                 engine="xlrd")
        except Exception:
            return pd.read_excel(path, sheet_name=sheet_idx, header=None,
                                 engine="calamine")
    raise ValueError(f"지원하지 않는 파일 형식: {ext}")
