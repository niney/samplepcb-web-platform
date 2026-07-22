# -*- coding: utf-8 -*-
"""SMARTBOM 규칙 추출 회귀 테스트 — bom_probing_claude/test_rules.py 포팅.

원본 CASES를 이식본 extract_case에 그대로 돌려 포팅 무결성을 고정한다.
전 코퍼스 교차 평가(R7)에서 실측된 회귀·요구사항:
- 분수 power가 세그 분리로 절단되지 않는다 (1/16W → 16W 회귀)
- 치수 토큰(50mil)은 PN으로 승격되지 않는다
- 콤마 병기 PN은 첫 표기, 공백 병기 PN은 통짜 유지
- 색상 꼬리(/GREEN)는 PN에서 벗긴다
- 패키지 열 복합 원문 보존 / 값 표기 내장 문자열(L_220uH-4A) 거부
"""
import pytest

from bom_extraction_engine.rule_extractor import extract_case


def _row(labels, cells, extra_rows=()):
    rows = [{"row_id": 1, "cells": cells}]
    rows += [{"row_id": i + 2, "cells": list(c)}
             for i, c in enumerate(extra_rows)]
    case = {"header_labels": labels, "rows": rows}
    attrs, _ = extract_case(case)
    return attrs.get(1)


CASES = []

for frac in ("1/16W", "1/8W", "1/4W", "1/2W"):
    CASES.append((
        f"분수 power {frac} 보존",
        (["Part", "Description"],
         ["RC0402FR-07240RL", f"240 Ohm, 5%, 1005 Size, {frac}"]),
        lambda a, f=frac: a.power == f))
CASES += [
    ("정수 power 16W 유지",
     (["Part", "Description"], ["ABC1234X", "Power Resistor 16W"]),
     lambda a: a.power == "16W"),
    ("치수 50mil PN 승격 금지",
     (["Device", "Value"],
      ["Pin Header", "Box-Type, 1.27mm/0.5/50mil Pitch, 2x03 Circuits"]),
     lambda a: a.part_number != "50mil"),
    ("콤마 병기 PN은 첫 표기",
     (["Description", "Specification"],
      ["TR(SOT-23)", "KRA101S,FJV4101R SRA2201S"]),
     lambda a: a.part_number == "KRA101S"),
    ("공백 병기 PN은 통짜 유지",
     (["Part Number", "Description"],
      ["MS621FE FL11E", "Battery Backup"]),
     lambda a: a.part_number == "MS621FE FL11E"),
    ("색상 꼬리는 PN에서 제거",
     (["Comment", "Designator"], ["LTST-S270KGKT/GREEN", "LED2"]),
     lambda a: a.part_number == "LTST-S270KGKT"),
    ("패키지 열 복합 원문 보존",
     (["Value", "Package"], ["Socket 2x13", "SOCKET_1x13_SMD"]),
     lambda a: a.package == "SOCKET_1x13_SMD"),
    ("값 표기 내장 문자열은 패키지 거부",
     (["COMPANY PART NO.", "GEOMETRY", "DESCRIPTION"],
      ["pn-L_220uH_4A", "L_220uH-4A", "L_220uH-4A, 220uH"]),
     lambda a: a.package is None),
    ("capacitor 문맥 EIA 코드",
     (["Description", "Specification", "수량", "Location No."],
      ["CER.CAP(0805)", "104", "3", "C4-C6"]),
     lambda a: a.capacitance == "104"),
    ("CAD 커패시터 크기와 값을 길이에 무관하게 분리",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["C2012_0.47uF", "C2012", "C106", "1"]),
     lambda a: a.part_number is None and a.part_type == "capacitor"
     and a.capacitance == "0.47uF" and a.package == "C2012"),
    ("CAD 저항 크기와 값을 품번으로 오인하지 않음",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["R2012_1.5k", "R2012", "R100", "1"]),
     lambda a: a.part_number is None and a.part_type == "resistor"
     and a.resistance == "1.5k" and a.package == "R2012"),
    ("핀 수 선행 IC 패키지를 품번에서 분리",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["DRV8825PWPR/28TSSOP", "28TSSOP-W6.6/E0.65", "U100", "1"]),
     lambda a: a.part_number == "DRV8825PWPR"
     and a.package == "TSSOP-28"),
    ("괄호 저항값은 품번 밖의 스펙",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["GF063P-103 (10k)", "GF063P", "VR100", "1"]),
     lambda a: a.part_number == "GF063P-103" and a.resistance == "10k"),
    ("괄호 실장 표기는 품번에서 분리",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["TLP281(SMD)", "TLP281", "U101", "1"]),
     lambda a: a.part_number == "TLP281" and a.part_type == "ic"),
    ("E/C 접두 전해 커패시터 사양 분리",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["E/C_100uF/25V", "E/C-SMD/8X6.3/H63", "C105", "1"]),
     lambda a: a.part_number is None and a.part_type == "capacitor"
     and a.capacitance == "100uF" and a.voltage == "25V"
     and a.package == "E/C-SMD/8X6.3/H63"),
    ("HDR 라이브러리 표기는 커넥터이지 품번이 아님",
     (["Part", "PCB DECAL", "Reference", "Q'ty"],
      ["HDR_2X2_2.54 (JUMPER)", "HDR_2X2_2.54", "J106", "1"]),
     lambda a: a.part_number is None and a.part_type == "connector"),
    ("값/사이즈/공차 병기 — 사이즈는 package",
     (["품목명", "규격", "Quantity"], ["RESISTOR,CHIP", "360R/1608/1%", "15"]),
     lambda a: a.package == "1608" and a.resistance == "360R"),
    ("Comment 패키지 메모보다 Value 실제 PN 우선",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["MPS=TSOT23-5", "MP3302DJ-LF-Z", "MPS=TSOT23-5", "U1", "1"]),
     lambda a: a.part_number == "MP3302DJ-LF-Z"),
    ("NC 접두 뒤의 짧은 실제 PN 회수",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["VISHAY=SOD-123", "NC/SS34", "VISHAY=SOD-123", "D1", "1"]),
     lambda a: a.part_number == "SS34"),
    ("제조사=MPN 병기에서 실제 식별자 분리",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["C&K=PTS636-SK25-SMTR-LFS(NP)", "NC/PTS636 SK25 SMTR LFS",
       "C&K=PTS636-SK25-SMTR-LFS(NP)", "SW1", "1"]),
     lambda a: a.part_number == "PTS636-SK25-SMTR-LFS"),
    ("Comment 패키지 메모는 수동소자 품번이 아님",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["C=1005", "100nF/50V/1005", "C=1005", "C1", "1"]),
     lambda a: a.part_number is None and a.capacitance == "100nF"
     and a.voltage == "50V" and a.package == "1005"),
    ("저항값의 EIA 공차 접미 분리",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["R=1005", "10KJ/1005", "R=1005", "R1", "1"]),
     lambda a: a.part_number is None and a.resistance == "10K"
     and a.tolerance == "J" and a.package == "1005"),
    ("스펙/실PN 병기에서 양쪽 모두 회수",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["TDK=3030", "1.5uH/VLS3012HBX-1R5M", "TDK=3030", "L1", "1"]),
     lambda a: a.part_number == "VLS3012HBX-1R5M"
     and a.inductance == "1.5uH"),
    ("전해캡 직경 병기 — 모르는 세그 하나 무시",
     (["품목명", "규격", "Quantity"],
      ["CAPACITOR,SMD", "47uF/50V/EC/SMD/6.3mm", "2"]),
     lambda a: a.package == "6.3mm" and a.capacitance == "47uF"),
    ("탄탈 용량 접두와 케이스 패키지 분리",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["C=6032", "T100uF/10V/6032", "C=6032", "C1", "1"]),
     lambda a: a.capacitance == "100uF" and a.voltage == "10V"
     and a.current is None and a.package == "6032"),
    ("탄탈 패키지의 A 접미는 전류가 아님",
     (["Comment", "Value", "Footprint", "Designator", "Quantity"],
      ["10uF/16V/3216A", "10uF/16V/3216A", "FP-T520A107", "TC1", "1"]),
     lambda a: a.capacitance == "10uF" and a.current is None
     and a.package == "3216A"),
    ("문자접두-숫자 형명 PN + 치수 병기 package",
     (["PartType", "Value", "Quantity", "Package"],
      ["TS-1105SMD", "6.2X6.2/SMD", "4", "TACT/ /TS-1105SMD"]),
     lambda a: a.part_number == "TS-1105SMD" and a.package == "6.2X6.2"),
    ("벤더 약칭 꼬리(공백+슬래시)는 PN에서 제거",
     (["PartType", "Quantity"], ["FFC2B35-40-G /GCT", "1"]),
     lambda a: a.part_number == "FFC2B35-40-G"),
    ("붙은 슬래시 접미는 PN 일부로 보존",
     (["Part Number", "Quantity"], ["MCP1801T-5002I/OT", "1"]),
     lambda a: a.part_number == "MCP1801T-5002I/OT"),
    ("NC 행은 풋프린트 접두로 type을 만들지 않음",
     (["PartType", "Value", "Footprint", "Quantity"],
      ["NC", "NC, [NoValue]", "CAP 0402/1005 RF", "3"]),
     lambda a: a.part_type is None),
    ("diode 확정 행의 SMA 별칭 package",
     (["Comment", "Description", "Designator", "Quantity"],
      ["B1100-13-F", "Diode, Schottky, 100 V, 1 A, SMA", "D2", "1"]),
     lambda a: a.package == "SMA"),
    ("유통 코드 열보다 제조사 PN 열",
     (["N° Mouser", "N° de fab.", "Fabricant", "Description", "Qté."],
      ["511-STD96N3LLH6", "STD96N3LLH6", "STMicroelectronics",
       "MOSFET N-Ch 30V 0.0037 Ohm 80A", "1"],
      (["621-74AHCT1G126SE-7", "74AHCT1G126SE-7", "Diodes Inc",
        "Tampons et circuits", "1"],
       ["538-22-05-7035", "22-05-7035", "Molex",
        "Connecteur", "1"])),
     lambda a: a.part_number == "STD96N3LLH6" and a.resistance is None),
    ("용도 절(for LED)은 타입이 아님",
     (["Comment", "Designator", "Footprint", "Manuf. Part No"],
      ["133R for green LED RX", "R15", "0402", "CRCW0402133RFKED"]),
     lambda a: a.part_type == "resistor" and a.resistance == "133R"),
    ("KiCad 라이브러리 경로형 DIN 패키지",
     (["Reference", "Quantity", "Value", "Footprint"],
      ["R1 R2 R3 R4", "4", "1K", "Resistors_THT:R_Axial_DIN0207_L6.3"]),
     lambda a: a.package == "DIN0207"),
    ("PN형 토큰 내장 값 세그(4A) 회수",
     (["COMPANY PART NO.", "GEOMETRY", "COUNT", "DESCRIPTION"],
      ["pn-L_220uH_4A", "L_220uH-4A", "2", "L_220uH-4A, 220uH"]),
     lambda a: a.current == "4A"),
    ("병렬 MPN 열 — 유통 코드보다 제조사 PN",
     (["References", "Qty", "Description", "MPN", "MPN"],
      ["C1, C2", "5", "1u", "81-GRM219R7YA105KA2J", "GRM219R7YA105KA12D"]),
     lambda a: a.part_number == "GRM219R7YA105KA12D"),
    ("괄호 값 병기는 PN에서 벗겨 값으로",
     (["Part Number", "Qty"], ["ABS07 (32.768kHZ)", "1"]),
     lambda a: a.part_number == "ABS07" and a.frequency == "32.768kHZ"),
    ("Mrf Part 라벨은 제조사 PN 열",
     (["Comment", "Designator", "Quantity", "Mrf . Part"],
      ["Box Header", "P1", "1", "JS20T-S06PHW-00"]),
     lambda a: a.part_number == "JS20T-S06PHW-00"),
    ("역할 열이 전부 숫자인 행의 quantity 기권",
     (["App", "On count", "Off count"], ["Fibonacci", "19", "18"]),
     lambda a: a is None or a.quantity is None),
    ("전해 커패시터의 F 생략 용량은 품번이 아님",
     (["References", "Description", "Value", "Quantity", "Footprint"],
      ["C52", "", "100u/35V/H10", "1", "CAP_ECAP_H10"]),
     lambda a: a.part_number is None and a.capacitance == "100u"
     and a.voltage == "35V"),
    ("IC 패키지 핀 수만으로 connector가 되지 않음",
     (["References", "Description", "Value", "Quantity", "Footprint"],
      ["U4", "SOIC 8PIN / MAX485ESA", "MAX485", "1", "D008_N"]),
     lambda a: a.part_type == "ic" and a.part_number == "MAX485"),
]


@pytest.mark.parametrize("name,spec,check", CASES, ids=[c[0] for c in CASES])
def test_rule_extraction_regression(name, spec, check):
    attrs = _row(*spec)
    assert attrs is not None, name
    assert check(attrs), f"{name} → {attrs.__dict__}"
