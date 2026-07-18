# -*- coding: utf-8 -*-
"""추출 행 스키마 — bom_probing_claude/schema.py에서 추출 부분만 발췌.

원칙: "셀 원문 표기 그대로" 문자열 추출. 단위 등가성(0.125W == 1/8W)은
어댑터(values.py)가 표시용 수치를 만들 때만 흡수한다.
LLM 배치 스키마(batch_json_schema/parse_rows/BatchResult)는 SMARTBOM이
LLM을 쓰지 않아 제외했다.
"""
import re
from typing import Optional

from pydantic import BaseModel, field_validator

PART_TYPES = ["resistor", "capacitor", "inductor", "ic", "led", "diode",
              "transistor", "connector", "crystal", "other"]

# 문자열 값 필드 — 추출기·어댑터가 공유하는 단일 정의
STRING_FIELDS = ["part_number", "part_type", "resistance", "capacitance",
                 "inductance", "power", "tolerance", "voltage", "current",
                 "frequency", "temperature", "package", "manufacturer"]
VALUE_FIELDS = STRING_FIELDS + ["quantity"]
# 확장 필드 — REFDES
EXTRA_FIELDS = ["reference"]

_INT_PREFIX = re.compile(r"[+-]?\d+")


class RowAttrs(BaseModel):
    row_id: int
    part_number: Optional[str] = None
    # 검증은 관대하게 — enum 밖 값도 행을 버리지 않는다
    part_type: Optional[str] = None
    resistance: Optional[str] = None
    capacitance: Optional[str] = None
    inductance: Optional[str] = None
    power: Optional[str] = None
    tolerance: Optional[str] = None
    voltage: Optional[str] = None
    current: Optional[str] = None
    frequency: Optional[str] = None
    temperature: Optional[str] = None
    package: Optional[str] = None
    manufacturer: Optional[str] = None
    quantity: Optional[int] = None
    reference: Optional[str] = None

    @field_validator(*STRING_FIELDS, "reference", mode="before")
    @classmethod
    def _to_str(cls, v):
        """숫자로 들어온 값("10000")도 문자열로 수용. 빈 문자열은 null."""
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("quantity", mode="before")
    @classmethod
    def _to_int(cls, v):
        """"2EA" 같은 표기로 행 전체가 버려지지 않게 앞자리 정수만 취한다."""
        if v is None or isinstance(v, int):
            return v
        if isinstance(v, float):
            return int(v) if v.is_integer() else None
        m = _INT_PREFIX.search(str(v))
        return int(m.group()) if m else None
