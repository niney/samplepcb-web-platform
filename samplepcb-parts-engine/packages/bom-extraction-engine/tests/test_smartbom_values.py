# -*- coding: utf-8 -*-
"""SMARTBOM 정규화 테스트 — normalize_values 포팅 무결성 + values 어댑터."""
import pytest

from bom_extraction_engine.normalize_values import values_equal
from bom_extraction_engine.values import (
    parse_size_code,
    temperature_range,
    to_farad,
    to_ohm,
    to_percent,
    to_volt,
    to_watt,
)

# bom_probing_claude/test_normalize.py의 대표 케이스 — 이식 무결성 고정
EQUAL_CASES = [
    ("resistance", "10K OHM", "10kΩ", True),
    ("resistance", "4R7", "4.7", True),
    ("resistance", "66.5R", "66.5 Ohm", True),
    ("resistance", "1M", "1000K", True),
    ("resistance", "10K", "1K", False),
    ("power", "1/16W", "0.0625W", True),
    ("power", "0.125W", "125mW", True),
    ("power", "1/4W", "0.5W", False),
    ("capacitance", "0.1uF", "100nF", True),
    ("capacitance", "4u7", "4.7uF", True),
    ("capacitance", "104", "104", True),
    ("capacitance", "0.1uF", "0.1nF", False),
    ("inductance", "10uH", "10000nH", True),
    ("tolerance", "1%", "±1%", True),
    ("voltage", "6.3V", "6300mV", True),
    ("current", "250mA", "0.25A", True),
    ("frequency", "16MHz", "16000kHz", True),
    ("temperature", "-40~+85℃", "-40 to +85 C", True),
    ("temperature", "-40~+85℃", "-40~+125℃", False),
    ("package", "SOT-23", "SOT23", True),
    ("package", "C1005", "0402", True),
    ("package", "0603", "1608", True),
    ("package", "C1005", "0603", False),
    ("package", "0603_1608Metric", "0603", True),
    ("part_number", "BAS21J,115", "BAS21J_115", True),
    ("part_number", "RC0402FR-0710KP", "RC0402FR-0710KL", False),
    ("reference", "FB2, FB4", "FB2 FB4", True),
    ("reference", "r5~r11", "R5-R11", True),
    ("reference", "R1", "R1, R2", False),
    ("manufacturer", "Murata", "Murata Manufacturing", True),
]


@pytest.mark.parametrize("field,gt,pred,want", EQUAL_CASES)
def test_values_equal_port(field, gt, pred, want):
    assert values_equal(field, gt, pred) is want


def test_to_ohm_conventions():
    assert to_ohm("10K OHM") == 10_000.0
    assert to_ohm("4R7") == 4.7
    assert to_ohm("2.2kR") == 2_200.0
    assert to_ohm("510kR") == 510_000.0
    assert to_ohm("1MR") == 1_000_000.0
    assert to_ohm("10mR") == 0.01
    assert to_ohm("의미없음") is None


def test_to_watt_fraction():
    assert to_watt("1/16W") == 0.0625


def test_to_percent_numeric_and_eia_letter():
    assert to_percent("±5%") == 5.0
    assert to_percent("1%") == 1.0
    # EIA 문자 코드 폴백
    assert to_percent("J") == 5.0
    assert to_percent("K") == 10.0
    assert to_percent("F") == 1.0
    assert to_percent("Z") is None


def test_decimal_and_bracketed_unit_normalization():
    assert to_farad(".47uF") == pytest.approx(0.47e-6)
    assert to_farad("10[uF]") == pytest.approx(10e-6)
    assert to_volt("6,3V") == 6.3


def test_parse_size_code_metric_to_imperial():
    assert parse_size_code("C1005") == "0402"
    assert parse_size_code("1608") == "0603"
    assert parse_size_code("0603_1608Metric") == "0603"
    assert parse_size_code("0402") == "0402"
    assert parse_size_code("SOT-23") is None
    assert parse_size_code(None) is None


def test_temperature_range():
    assert temperature_range("-40~+85℃") == (-40.0, 85.0)
    assert temperature_range("85°C") == (None, 85.0)
    assert temperature_range("+85 ~ -40") == (-40.0, 85.0)
    assert temperature_range(None) == (None, None)
    assert temperature_range("없음") == (None, None)
