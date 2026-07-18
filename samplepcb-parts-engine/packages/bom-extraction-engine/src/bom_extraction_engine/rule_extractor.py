# -*- coding: utf-8 -*-
"""규칙 기반 1차 추출기 — 열 매핑 + 값 문법 + 사전.

LABELING_GUIDE.md가 스펙이다: 원문 표기 그대로, 명시된 것만, 필드당 1개.
LLM 검증 파이프라인(verify.py)의 1차 추출기로 쓰이며, 필드별로
출처(source)를 남겨 confidence 정책의 입력이 된다:
  col   — 명시적으로 매핑된 열에서 그대로 취함 (고신뢰)
  text  — Description/Value 프리텍스트 문법 매칭 (중신뢰)
  infer — part_type 키워드 추론 (저신뢰)
"""
import re
from typing import Dict, List, Optional, Tuple

from .schema import RowAttrs

# ---- 열 매핑 -----------------------------------------------------------------
# (role, 판정함수) 순서가 우선순위다 — "Manufacturer Part No."가
# manufacturer보다 먼저 part_number에 잡혀야 한다.


def _norm_label(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


_IGNORE_PAT = re.compile(
    r"url|http|datasheet|price|단가|재고|stock|구매|보유|필요|도급|수삽|비고"
    r"|note|msl|process|fitted|octopart|최종|판매|unit|item|ext\b")
_PN_PAT = re.compile(r"part[\s\-_]*(number|no|name)|mpn|\bp/?no?\b|품번"
                     r"|(?:mfr|mrf|fab)[\s._-]*part|n° de fab")
_DIST_PAT = re.compile(  # 유통사 열 — PN 열보다 먼저 걸러낸다 (Digikey_PN 등)
    r"digi[\s\-_]?key|mouser|farnell|lcsc|element14|distributor|supplier"
    r"|구매처|유통")
_DESIG_PAT = re.compile(r"designator|reference|location|ref\s*des|^ref\b")
_QTY_PAT = re.compile(r"q['`]?n?ty|quantity|수량|소요량|\bcount\b|개수")
_QTY_NEG = re.compile(  # 구매/재고성 수량 열 — 보드당 수량이 아님 (gpt 증류)
    r"purchase|order|required|total|stock|spare"
    r"|구매|필요|재고|예비|셋트|세트|견적|합계|총")
_MFR_PAT = re.compile(r"manufactur|maker|제조|vendor|fabricant")
_PKG_PAT = re.compile(r"package|footprint|패키지|\bpkg\b|\bsize\b|dimension|치수"
                      r"|^pattern$")  # Altium/Protel의 풋프린트 열명
_TYPE_EXACT = {"class", "type", "part type", "parttype", "구분"}
_TYPE_KO = re.compile(r"품명|품목")           # "Item (품명)", "품목명" 포함형
_DESC_PAT = re.compile(r"description|사양|내용|^item\s*name$|^remarks?$")
# "Item Name"·"Remark"(영문)는 설명 열 — _IGNORE_PAT의 item보다 먼저 판정.
# 한국어 '비고'는 노이즈("사급"/"입고") 위주라 ignore 유지.
# 규격/spec/name 계열은 값·PN·타입어가 섞이는 이중 열 — value 역할로 보낸다
_VALUE_PAT = re.compile(r"^value$|^comment$|comp[\s_]*value|^규격$"
                        r"|specification|^spec\b|^part$|^name$|^device$"
                        r"|^designation$")  # KiCad export의 값 열
_UNIT_EXACT = {"a": "current", "w": "power", "v": "voltage",
               "정밀도": "tolerance", "tolerance": "tolerance",
               "current": "current", "voltage": "voltage", "power": "power",
               "resistance": "resistance", "capacitance": "capacitance",
               "inductance": "inductance", "frequency": "frequency"}


def classify_columns(labels: List[str]) -> Dict[str, List[int]]:
    """헤더 라벨 → 역할별 열 인덱스 목록 (열 순서 유지)."""
    roles: Dict[str, List[int]] = {}
    for i, raw in enumerate(labels):
        lab = _norm_label(raw)
        if not lab:
            continue
        if _DIST_PAT.search(lab):
            role = "ignore"      # "Digikey_PN"·"Supplier Part"는 유통 코드 열
        elif _PN_PAT.search(lab):
            role = "part_number"
        elif _DESIG_PAT.search(lab):
            role = "designator"
        elif _QTY_PAT.search(lab):
            # 네거티브(구매/재고성)는 일단 보류 — 다른 양성 수량 열이 없으면
            # 뒤에서 승격한다 ("Quantity Required"만 있는 파일)
            role = "_qty_neg" if _QTY_NEG.search(lab) else "quantity"
        elif _MFR_PAT.search(lab):
            role = "manufacturer"
        elif _PKG_PAT.search(lab):
            role = "package"
        elif lab in _TYPE_EXACT or _TYPE_KO.search(lab):
            role = "part_type"
        elif _DESC_PAT.search(lab):
            role = "description"
        elif _VALUE_PAT.search(lab):
            role = "value"
        elif lab in _UNIT_EXACT:
            role = _UNIT_EXACT[lab]
        elif _IGNORE_PAT.search(lab) or lab in ("no", "no.", "번호"):
            role = "ignore"
        else:
            role = "ignore"
        roles.setdefault(role, []).append(i)
    # '품번'(사내 발주코드)과 '규격'(형명)이 공존하면 형명이 PN — 가이드
    # 관례("사내 발주코드는 part_number 아님"). 품번 열은 최후 폴백으로 강등.
    labs = [_norm_label(x) for x in labels]
    if any("규격" in x for x in labs) and roles.get("part_number"):
        internal = [i for i in roles["part_number"] if "품번" in labs[i]]
        if internal:
            keep = [i for i in roles["part_number"] if i not in internal]
            if keep:
                roles["part_number"] = keep
            else:
                del roles["part_number"]
            roles["_pn_internal"] = internal
    # 네거티브 수량 열 처리: 양성 수량 열이 있으면 버리고, 없으면 첫 열 승격
    neg = roles.pop("_qty_neg", [])
    if neg and "quantity" not in roles:
        roles["quantity"] = [neg[0]]
        neg = neg[1:]
    if neg:
        roles.setdefault("ignore", []).extend(neg)
    return roles


# ---- 값 문법 (원문 부분 문자열 그대로 캡처) ------------------------------------

_RE_CAP = re.compile(r"\d+(?:\.\d+)?\s*[uµμnp]F\b", re.I)
_RE_IND = re.compile(r"\d+(?:\.\d+)?\s*[uµμnm]H(?!z)\b", re.I)
_RE_RES_OHM = re.compile(  # ohm 표기 명시된 것만 (프리텍스트 안전)
    r"\d+(?:\.\d+)?\s*[KMR]?\s*(?:OHMS?|Ω|Ω|옴)", re.I)
_RE_RES_CODE = re.compile(  # 4K7 / 0R01 / 150R / 10KJ / 2.04KF — value열 전용
    r"^(?!\d+(?:\.\d+)?mm$)"
    r"(?P<resistance>\d+(?:\.\d+)?(?:[KM]\d*|m?R\d*|kR))"
    r"(?P<tolerance>[BCDFGJKM])?$",
    re.I,
)
_RE_RES_BARE = re.compile(  # resistor 문맥 한정 bare 값 ("0.02", "49.9", "0")
    r"^\d+(?:\.\d+)?$")
_RE_TANTAL_CAP = re.compile(r"^T(\d+(?:\.\d+)?\s*[uµμnp]F)$", re.I)
_RE_TANTAL_PACKAGE = re.compile(r"^(?:2012|3216|3528|6032|7343)[A-Z]?$", re.I)
_RE_POW = re.compile(r"(?:1/\d+\s*W|\d+(?:\.\d+)?\s*[mk]?W)(?![a-z])", re.I)
_RE_POW_FRACTION = re.compile(r"\d\s*/\s*\d+\s*[mk]?W(?![A-Za-z])", re.I)
_RE_COLOR_WORD = re.compile(
    r"(?:white|red|green|blue|yellow|amber|orange|rgb)", re.I)
_RE_FOR_CLAUSE = re.compile(r"\bfor\b[^|]{0,60}(?:$|\|)", re.I)


def _resistance_code_parts(value: str) -> Tuple[str, Optional[str]]:
    """Split a compact resistor value from its optional EIA tolerance suffix."""

    match = _RE_RES_CODE.fullmatch(value.strip())
    if not match:
        return value, None
    tolerance = match.group("tolerance")
    return match.group("resistance"), tolerance.upper() if tolerance else None
_RE_TOL = re.compile(
    r"(?:[±]|\+/-)\s*\d+(?:\.\d+)?\s*(?:[%％]|ppm|[npｎｐ][FHｆｈ])"
    r"|\b\d+(?:\.\d+)?\s*(?:[%％]|ppm)", re.I)
_RE_VOLT = re.compile(  # 범위("5v~12V", "4.7~5.1V")는 통째로 — 앞 단위 생략 허용
    r"[-+]?\d+(?:\.\d+)?\s*(?:k?V(?:DC|AC)?)?\s*~\s*[-+]?\d+(?:\.\d+)?"
    r"\s*k?V(?:DC|AC)?\b"
    r"|[-+]?\d+(?:\.\d+)?\s*k?V(?:DC|AC)?\b", re.I)
_RE_CUR = re.compile(  # 좌경계 — PN 꼬리("5569-20A", "…105A")의 오탐 차단.
    r"(?<![A-Za-z0-9._-])\d+(?:\.\d+)?\s*(?:[mu]?A|Amps?)\+?(?![A-Za-z0-9])",
    re.I)  # "700mA+"의 '+'(최소 사양 표기)는 원문 보존
_RE_BARE_UNIT = re.compile(  # 단위 문자 생략 표기 "4.7u", "100n" — 게이팅 전용
    r"(?<![A-Za-z0-9.])\d+(?:\.\d+)?[unm]\b(?![FHAVW])", re.I)
_RE_FREQ = re.compile(  # 대역 범위("2.4GHz ~ 2.4835GHz")는 통째로
    r"\d+(?:\.\d+)?\s*[KMG]?Hz(?:\s*~\s*\d+(?:\.\d+)?\s*[KMG]?Hz)?", re.I)
_RE_TEMP = re.compile(  # "-40~+85C", "-55℃ ~ 155℃", "-65 to 150 degC"
    r"-?\d+(?:\.\d+)?\s*(?:℃|°\s*C|deg\s*C|C\b)?\s*(?:~|to|〜)\s*"
    r"[+-]?\d+(?:\.\d+)?\s*(?:℃|°\s*C|deg\s*C|C\b)"
    r"|\b\d+(?:\.\d+)?\s*(?:℃|°\s*C)", re.I)

# 패키지 — 우선순위: C메트릭 코드 > 슬래시 병기 > 임페리얼 4자리 > 명명 패키지
_RE_PKG_C = re.compile(r"\bC\d{4}\b")                       # C1005, C0603
_RE_PKG_SLASH = re.compile(r"\b\d{4}/\d{4}\b")              # 0402/1005
_RE_PKG_IMP = re.compile(r"\b(0201|0402|0603|0606|0805|1005|1206|1210|1218"
                         r"|1220|1608|1610|1612|1812|2010|2012|2016|2512"
                         r"|2520|3215|3216|3225|3528|4532|5032|7050|7343)\b")
_RE_PKG_NAMED = re.compile(  # 꼬리 -?\d*는 절단 매치("DIP-")를 만들므로 금지
    r"\b(?:T?SOT-?\d+[A-Z0-9-]*|SOD-?\d+[A-Z-]*|DO-?\d+[A-Z]*|TO-?\d+[A-Z-]*"
    r"|[A-Z]*QFN ?\d*(?:[A-Z0-9._-]*[A-Z0-9])?|[LTV]?QFP(?:-?\d+)?"
    r"|[TLQMSHV]*SS?OP(?:-[IVX]{1,3})?(?:-?\d+)?"
    r"|SOIC(?:-?\d+)?|DFN(?:-?\d+)?|[WXU]?SON(?:-?\d+)?|PLCC\d*|BGA\d*"
    r"|DPAK|D2PAK|DIP(?:-?\d+)?|SC-?\d+|DIN ?\d{4}|\d{1,3}-?(?:[LV]?QFP"
    r"|[VW]?QFN|SS?OP|SOIC|Power[A-Z]?DFN|TDFN|DFN)"
    r"|SMA|SMB|SMC|SMD|\d+SMD)\b")
_RE_PKG_DIM = re.compile(  # 치수형 "3x3", "10x6mm", "7.2mm X 30.5mm X 50mm"
    r"\d+(?:\.\d+)?(?:\s*mm)?\s*[xX×]\s*\d+(?:\.\d+)?(?:\s*mm)?"
    r"(?:\s*[xX×]\s*\d+(?:\.\d+)?(?:\s*mm)?)?")

_GRAMMAR = [  # (필드, 정규식) — 프리텍스트 공용
    ("capacitance", _RE_CAP),
    ("inductance", _RE_IND),
    ("resistance", _RE_RES_OHM),
    ("power", _RE_POW),
    ("tolerance", _RE_TOL),
    ("voltage", _RE_VOLT),
    ("current", _RE_CUR),
    ("frequency", _RE_FREQ),
    ("temperature", _RE_TEMP),
]

# ---- part_type ---------------------------------------------------------------

_TYPE_RULES = [  # (enum, 키워드 정규식) — 구체적인 것 먼저
    # 기계류·비전자 — 전자부품 규칙보다 먼저 ("Hex socket cap"의 cap,
    # "M5 screw"류가 capacitor/connector로 오폭하지 않게). screw terminal은
    # 커넥터라 제외.
    ("other", re.compile(
        r"screw(?!\s*terminal)|\bbolt\b|\bnut\b|washer|standoff|spacer"
        r"|extrusion|bracket|acrylic|3d[- ]?print|enclosure|\bcase\b"
        r"|hex socket|raspberry pi|나사|볼트|너트|와셔|아크릴|케이스", re.I)),
    # 신호 스위치/멀티플렉서 IC — "USB Switch"의 USB가 커넥터로 오폭 방지
    ("ic", re.compile(
        r"\b(?:usb|hdmi|can|ethernet|analog|signal)\s+(?:switch|mux(?:er)?"
        r"|transceiver|redriver)\b", re.I)),
    ("crystal", re.compile(r"crystal|x-?tal|oscillator|resonator|\bosc\b"
                           r"|크리스탈|발진", re.I)),
    ("ic", re.compile(  # "IC LED DRVR", "LED Driver"는 led가 아니라 ic
        r"\bic\b|i\.c\b|mcu|driver|drvr|regulator|amplifier|opamp|controller"
        r"|eeprom|flash|transceiver|sensor ic|레귤레이터"
        r"|\bldo\b|dcdc|dc-dc|buck|boost|converter|step[ -]?down|step[ -]?up"
        r"|\bmodule\b|모듈", re.I)),
    ("led", re.compile(r"\bled\b|엘이디", re.I)),
    ("transistor", re.compile(r"transist[eo]r|mosfet|\bfet\b|\bbjt\b"
                              r"|트랜지스터", re.I)),
    ("diode", re.compile(r"diode|schottky|zener|rectifier|\btvs\b|\besd\b"
                         r"|다이오드|제너|쇼트키", re.I)),
    ("connector", re.compile(
        r"conn\b|connector|socket|plug|header|rece|jack|\bbtb\b|\busb\b"
        r"|\d\s*pin\b|\bjst\b|커넥터|콘넥터|컨넥터|컨낵터|하네스", re.I)),
    ("inductor", re.compile(r"inductor|\bind\b|bead|ferrite|choke"
                            r"|인덕터|비드|초크", re.I)),
    ("capacitor", re.compile(r"capacitor|\bcap\b|mlcc"
                             r"|콘덴서|커패시터|캐패시터|탄탈", re.I)),
    ("resistor", re.compile(r"resistor|\bres\b|저항", re.I)),
    ("other", re.compile(r"filter|antenna|switch|button|fuse|\bpcb\b|motor"
                         r"|buzzer|speaker|shield|holder|jumper|battery"
                         r"|hole|\bmount\b|test\s*point|\btp\b|varistor"
                         r"|thermistor|\bntc\b|온도센서|\bpad\b|keypad"
                         r"|스위치|퓨즈|안테나|배터리|모터|부저|배리스터", re.I)),
]

# CAD 명명("PinHeader_1x08", "MCU_LAN_PHY")은 '_'/'-'가 단어 경계를 깨므로
# 타입 추론용 텍스트는 구분자를 공백으로 정규화해 본다
_TYPE_SEP = re.compile(r"[_\-./]+")


def infer_part_type(*texts: str) -> Optional[str]:
    for t in texts:
        if not t:
            continue
        norm = _TYPE_SEP.sub(" ", t)
        for enum, pat in _TYPE_RULES:
            if pat.search(t) or pat.search(norm):
                return enum
    return None


# 제조사 사전 — 열 매핑이 실패한 행에서 desc/행 전체 텍스트를 스캔한다.
# 긴 이름 우선(Texas Instruments가 TI보다 먼저). 2글자 약어는 오탐 위험으로 제외.
_MFR_NAMES = [
    "Texas Instruments", "Analog Devices", "Silicon Labs", "Taiyo Yuden",
    "STMicroelectronics", "ON Semiconductor", "Diodes Incorporated",
    "Murata", "Samsung", "Yageo", "KEMET", "Nexperia", "Vishay", "Panasonic",
    "Infineon", "Microchip", "Bourns", "Wurth", "Würth", "Molex", "Hirose",
    "Amphenol", "Samtec", "Walsin", "UniOhm", "Everlight", "Lite-On",
    "Susumu", "Abracon", "Nichicon", "Rubycon", "Littelfuse", "Coilcraft",
    "Sunlord", "Fenghua", "Cabcon", "Johanson", "Skyworks", "Qorvo",
    "Nordic", "Espressif", "Quectel", "SIMCom", "u-blox", "Toshiba",
    "Renesas", "Winbond", "Macronix", "GigaDevice", "Holtek", "Richtek",
    "Torex", "Kingbright", "Broadcom", "Avago", "Osram", "Onsemi", "Rohm",
    "Diodes", "Maxim", "Epson",
    # 공유 GT(2026-07-15) 정답값에서 파생 — gpt ManufacturerLexicon의 무학습 등가
    "3L COILS", "Allegro", "Bel Fuse", "Bright LED", "Central Semiconductor",
    "Ciellight", "ECS Inc", "ECS", "Hosonic", "Kento", "Korean Hroparts",
    "Hroparts", "Linear Technology", "Micro Commercial", "Micro Chip",
    "Mornsun", "Seiko", "Taoglas", "WCON", "WIZnet", "YhenHo", "housheng",
    "신우광", "한양반도체", "연호",
    # 공개 하드웨어 BOM에 흔한 팹/벤더 (v27 외부 스위트 실측)
    "JLCPCB", "PCBWay", "OSH Park", "PJRC", "METZ CONNECT", "Cetus",
    "Ethertronics",
    "TDK", "NXP", "AVX", "KOA", "NDK", "JST", "KEC", "GCT", "MPS", "Cree",
]
_RE_MFR_LEX = re.compile(
    r"\b(" + "|".join(re.escape(n) for n in _MFR_NAMES) + r")\b", re.I)


def find_manufacturer(*texts: str) -> Optional[str]:
    for t in texts:
        if not t:
            continue
        m = _RE_MFR_LEX.search(_TYPE_SEP.sub(" ", t))
        if m:
            return m.group(1)
    return None


def find_manufacturers_all(text: str) -> List[str]:
    """한 셀 안의 사전 히트 전부 (distinct, 등장 순서) — 다중 벤더 병기
    셀("Cetus/WIZNet", "OSH Park, JLCPCB, PCBWay") 판별용."""
    seen = []
    for m in _RE_MFR_LEX.finditer(_TYPE_SEP.sub(" ", text)):
        g = m.group(1)
        if g.lower() not in (s.lower() for s in seen):
            seen.append(g)
    return seen


# 지시자 접두어 → part_type (최후 폴백 — 가이드상 part_type만 판단 허용)
_DESIG_TYPE = {"R": "resistor", "C": "capacitor", "L": "inductor",
               "D": "diode", "Q": "transistor", "U": "ic", "IC": "ic",
               "FB": "inductor", "JP": "connector", "JA": "connector",
               "JB": "connector", "EC": "capacitor", "VR": "resistor",
               "TR": "transistor", "ZD": "diode",
               "Y": "crystal", "X": "crystal", "XTAL": "crystal",
               "J": "connector", "CN": "connector", "CON": "connector",
               "USB": "connector", "LED": "led", "SW": "other",
               "TP": "other", "MT": "other", "ANT": "other", "BT": "other"}
_RE_DESIG_PREFIX = re.compile(r"^\s*([A-Za-z]+)\d")
_RE_MOUNT_ONLY = re.compile(  # 실장 방식 서술 — part_type 근거가 아니다
    r"(?:THRU|THROUGH)[\s\-]?HOLE|SURFACE[\s\-]?MOUNT(?:ED)?|SMD|SMT|THT")


def desig_part_type(designator_cell: str) -> Optional[str]:
    m = _RE_DESIG_PREFIX.match(designator_cell or "")
    return _DESIG_TYPE.get(m.group(1).upper()) if m else None


_RE_REF_TOKEN = re.compile(  # "R1", "U$3", "C1-C4", "U10~U12"
    r"[A-Za-z]{1,4}\$?\d+(?:\s*[-~]\s*[A-Za-z]{0,4}\$?\d+)?")
_RE_REF_CELL = re.compile(  # 셀 전체가 지시자 목록형 (공백/세미콜론 구분 포함)
    r"^[A-Za-z]{1,4}\$?\d+(?:\s*[,;/~\- ]\s*[A-Za-z]{0,4}\$?\d+)*$")


def extract_reference(cell: str) -> Optional[str]:
    """REFDES 추출 — 셀 전체가 지시자 목록이면 원문 그대로(트림만),
    아니면("R1 (DNP)") 지시자 토큰만 ", " 조인 (순서 보존 dedup).
    채점 등가는 normalize_values.reference_equal(토큰 집합)이 흡수."""
    c = (cell or "").strip()
    if not c:
        return None
    if _RE_REF_CELL.match(c):
        return c
    raw_toks = [t for t in re.split(r"[,;\s]+", c) if t]

    def _custom_tok(t: str) -> bool:
        # 커스텀 지시자 명명("C-74HC", "CN-BL", "74HC4067") — CAD명 제외.
        # 숫자나 하이픈이 있어야 한다 — 일반 단어("PCB", "Standoff") 배제
        return (len(t) <= 12 and t.count("_") < 2
                and not _RE_PIN_ARRAY.match(t)
                and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_$-]+", t))
                and bool(_RE_HAS_ALPHA.search(t))
                and (bool(_RE_HAS_DIGIT.search(t)) or "-" in t))

    if len(raw_toks) >= 2:
        # 비표준 이름("DS_5V", "D3V") 섞인 목록 — 대다수가 지시자형이면 원문
        desig_ish = sum(1 for t in raw_toks if re.fullmatch(
            r"[A-Za-z]{1,4}[\w$]*\d[\w$~-]*", t) or _custom_tok(t))
        if desig_ish / len(raw_toks) >= 0.7:
            return c
    elif raw_toks and re.fullmatch(
            r"[A-Za-z]{1,4}\$?\d+(?:[-~][A-Za-z]{0,4}\$?\d+)?", raw_toks[0]):
        return c  # 후행 콤마 단일 지시자("R5,") — 원문 그대로
    elif raw_toks and _custom_tok(raw_toks[0]):
        # 커스텀 지시자("C-74HC", "CN-SIGNAL", "74HC4067"류 명명) — 지시자
        # 전용 열의 셀이므로 원문 수용. CAD명(다중 '_'/핀배열)은 계속 기권
        return c
    else:
        return None  # 단일 토큰인데 목록형 아님("PHB_1MM27_…" CAD명) — 기권
    # 토큰 폴백("R1 (DNP)")은 완전한 지시자 토큰이 있을 때만 —
    # 서술형 셀("U1-Hdr 4")에서 파편(U1)을 줍지 않는다
    if not any(re.fullmatch(r"[A-Za-z]{1,4}\$?\d+", t) for t in raw_toks):
        return None
    toks = []
    for m in _RE_REF_TOKEN.finditer(c):
        t = re.sub(r"\s+", "", m.group())
        if t.upper() not in (x.upper() for x in toks):
            toks.append(t)
    return ", ".join(toks) if toks else None


# ---- 보조 --------------------------------------------------------------------

# 핫패스 공용 (콜타임 컴파일 회피 — 프로파일: _compile 32k회)
_RE_HAS_DIGIT = re.compile(r"\d")
_RE_HAS_ALPHA = re.compile(r"[A-Za-z]")
_RE_PAREN_VAL = re.compile(r"\(([^()]{1,15})\)")
_RE_PAREN_PKG = re.compile(r"\(([^()]{2,20})\)")

_RE_PN_LIKE = re.compile(  # 공백 없는 본체 + 선택적 대문자 접미("MS621FE FL11E")
    r"^[A-Za-z0-9][A-Za-z0-9().+\-_/$#=]{3,}"
    r"(?: [A-Z0-9]{1,6})?(?: \([A-Za-z0-9.]+\))?$")  # "(32.768kHZ)" 부기 허용
_RE_PN_NUMERIC = re.compile(  # TE/Kyocera류 숫자 PN "2452796-1", "046843…+"
    r"^(?:\d{5,}-\d+|\d{7,}\+?)$"
)
_RE_PN_PAREN_ALT = re.compile(  # "M7(1N4007SMD)" — 괄호가 대문자 PN형일 때만
    r"^([A-Za-z0-9.+#\-_/]{2,})\([A-Z0-9][A-Z0-9\-/]{3,}\)$")


def _strip_pn_alt(pn: str) -> str:
    """괄호 대체표기 분리 — "DL_TP(2.54mm)" 같은 치수 괄호는 유지."""
    m = _RE_PN_PAREN_ALT.match(pn.strip())
    return m.group(1) if m else pn


# PN 오인 차단 — CAD 심볼명/부류명("MCU_LAN_PHY", "LED-0603_Y", "F.BEAD 2012")
_PN_REJECT_KW = re.compile(
    r"\bled\b|\bbead\b|f\.bead|\bheader\b|\bmcu\b|x-?tal\b|\bic\b|\bcap\b"
    r"|\bres\b|\bind\b|socket|holder|jumper|\bcon\b|conn\b|\bdiode\b|\bfuse\b"
    r"|test\s*point|testpoint|\bpwr\b|\bext\b|\bpin\b|antenna|shield"
    r"|\bwhite\b|\bred\b|\bgreen\b|\bblue\b|\byellow\b|\bblack\b", re.I)
_RE_PIN_ARRAY = re.compile(r"^[A-Z]{0,3}\dx\d{1,2}$", re.I)  # "HN1x3", "2x03"
_RE_LCSC_CODE = re.compile(r"C\d{5,7}")   # LCSC 유통 재고 코드
_RE_DIGIKEY_TAIL = re.compile(r".+-ND$")  # Digikey 유통 코드 접미
_RE_CAD_DIMTOK = re.compile(r"\d{3,4}X\d+[A-Z]{0,2}$", re.I)  # "3216X18L"
_RE_DIM_TOKEN = re.compile(  # 치수 토큰("6.2X6.2", "35x47x7")은 PN이 아니다
    r"^\d+(?:\.\d+)?(?:mm)?\s*[xX×*]\s*\d+(?:\.\d+)?(?:mm)?"
    r"(?:\s*[xX×*]\s*\d+(?:\.\d+)?(?:mm)?)?$", re.I)
_RE_COLOR_NUM = re.compile(  # "white1608" — 색상+사이즈 결합은 PN이 아니다
    r"^(?:white|red|green|blue|yellow|black|amber|orange)\d", re.I)
# TP/MT/PAD는 정품 PN의 포장 접미("BZT52C10-TP")로도 쓰인다 — 선행일 때만 거부
_PN_REJECT_LEAD = re.compile(r"^(?:tp|mt|pad)\b", re.I)
_RE_DESIG_RANGE = re.compile(r"^[A-Z]{1,3}\d+(?:-[A-Z]{1,3}\d+)+$")
_RE_MM_DIM = re.compile(r"^\d+(?:\.\d+)?\s*mm$", re.I)


def _pn_reject(c: str) -> bool:
    # CAD 명명은 '_'/'-'가 단어 경계를 깨므로("DIODE_SCHOTTKY") 정규화 사본도 검사
    norm = _TYPE_SEP.sub(" ", c)
    if _PN_REJECT_KW.search(c) or _PN_REJECT_KW.search(norm) \
            or _PN_REJECT_LEAD.match(norm) \
            or _RE_DESIG_RANGE.match(c) or _RE_MM_DIM.match(c) \
            or _RE_PIN_ARRAY.match(c) or _RE_DIM_TOKEN.match(c) \
            or _RE_COLOR_NUM.match(c):
        return True
    if re.fullmatch(
            r"[CR]\s*=\s*(?:01005|0201|0402|0603|0805|1005|1206|1210|"
            r"1608|1808|1812|2010|2012|2220|2312|2512|3216|3225|4520|"
            r"4532|5025|5750|6032|6332|7343)", c, re.I):
        return True  # "C=1005"/"R=1608"는 품번이 아니라 패키지 메모
    if c.count("_") >= 3 and re.search(r"\d+x\d+|\dmm", c, re.I):
        return True  # "PHB_1MM27_2X03_SNT_S" — 치수 내장 CAD 심볼명만
        # (치수 없는 "CABLE_USB_HOST_T36"류 식별자는 PN으로 인정)
    if re.fullmatch(r"C\d{5,6}", c):
        return True  # LCSC 유통 재고 코드("C385460") — 제조사 PN 아님 (GT 선례)
    if _RE_DIGIKEY_TAIL.fullmatch(c):
        return True  # Digikey 유통 코드("490-4779-1-ND")
    if _RE_CAD_DIMTOK.fullmatch(c):
        return True  # 치수 토큰("3216X18L")
    if c.count("/") >= 2:      # "47uF/50V/EC/SMD/6.3mm" — 값 병기 셀
        vals = sum(1 for s in c.split("/")
                   if any(p.fullmatch(s.strip()) for _, p in _GRAMMAR))
        if vals >= 2:
            return True
    # 첫 공백-세그먼트가 패키지명이면 PN이 아니다 ("TQFP-44 10X10")
    head = c.split()[0] if c.split() else c
    if _RE_PKG_NAMED.fullmatch(head):
        return True
    if len(c) < 12:
        # 짧은 후보에 값 표기("16MHz_20pF")나 패키지명("TO-247")이 섞인 경우.
        # 단 토큰 시작 위치의 매치만 — "HR911105A"의 꼬리 "…105A"는 PN이다.
        for _, p in _GRAMMAR:
            for m in p.finditer(c):
                if m.start() == 0 or not c[m.start() - 1].isalnum():
                    return True
        if _RE_PKG_NAMED.search(c) \
                and not re.match(r"[A-Za-z]{2,4}-\d", c):
            return True  # 문자접두-숫자 형명("TS-1105SMD")은 PN으로 인정
    return False


_PN_SEG_DROP = re.compile(  # 세그먼트 단위 잡음: NC/색상/실장어
    r"^(?:NC|N\.C\.?|GREEN|RED|BLUE|YELLOW|WHITE|BLACK|SMD|DIP|TH)$", re.I)


def _pn_finalize(tok: str) -> Optional[str]:
    """'/'-결합 셀에서 PN 세그먼트만 — "Molex/1054500101" → "1054500101",
    "0ZCJ0110FF2E/1.1A" → "0ZCJ0110FF2E", "LTST-…/GREEN" → 앞부분.
    괄호 부기가 패키지/값/NC면 벗긴다 ("LT3980IMSE#PBF(MSOP-16)")."""
    segs = [s.strip() for s in tok.split("/") if s.strip()]
    cands = []
    packing_only_drops = True  # 버린 세그가 전부 포장/등급 접미(NOPB, TR, W)인가
    for s in segs:
        if _PN_SEG_DROP.match(s) or _RE_MM_DIM.match(s):
            packing_only_drops = False
            continue
        if any(p.fullmatch(s) for _, p in _GRAMMAR) or _RE_RES_CODE.match(s):
            packing_only_drops = False
            continue
        if _RE_PKG_C.fullmatch(s) or _RE_PKG_NAMED.fullmatch(s) \
                or _RE_PKG_IMP.fullmatch(s):
            packing_only_drops = False
            continue
        if re.fullmatch(r"\d{7,}", s):        # Molex류 순숫자 PN
            cands.append(s)
            continue
        if re.search(r"\d", s) and _RE_HAS_ALPHA.search(s) \
                and not _pn_reject(s):
            cands.append(s)
            continue
        # 여기 도달한 드롭 세그 — 짧은 대문자 토큰이고 제조사/색상이 아니면
        # 포장 접미로 본다 ("LM2664M6/NOPB", "WR148UY/W"는 통짜가 정답)
        if not (re.fullmatch(r"[A-Z]{1,5}", s)
                and not find_manufacturer(s) and not _PN_REJECT_KW.search(s)):
            packing_only_drops = False
    if not cands:
        return None
    # 아무 세그도 안 버렸거나 버린 게 포장 접미뿐이면 통짜 유지
    best = (tok if len(segs) > 1
            and (len(cands) == len(segs) or packing_only_drops)
            else max(cands, key=len))
    # 괄호 부기 제거 — 내용이 패키지/값/NC일 때만 ("DL_TP(2.54mm)"는 유지)
    m = re.fullmatch(r"([A-Za-z0-9.+#\-_]{4,})\((.{1,20})\)", best)
    if m:
        inner = m.group(2)
        if (_RE_PKG_NAMED.fullmatch(inner) or _PN_SEG_DROP.match(inner)
                or any(p.fullmatch(inner) for _, p in _GRAMMAR)
                or _find_dim(inner, strict=False) == inner.strip()):
            best = m.group(1)  # 치수 괄호("(3x2.5)")도 부기라 벗긴다
    return _strip_pn_alt(best)
_RE_INT = re.compile(r"[+-]?\d+")
_MFR_PLACEHOLDER = {"n.a.", "n/a", "na", "-", "--", "any", "tbd", "none", "x"}


def _looks_like_pn(cell: str) -> bool:
    """영숫자 혼합(또는 언더스코어형·숫자-하이픈형)·값 표기 아님 → PN 후보."""
    c = cell.strip()
    if _RE_PN_NUMERIC.match(c):
        return True
    if not c or not _RE_PN_LIKE.match(c):
        return False
    if not ((_RE_HAS_DIGIT.search(c) or "_" in c)
            and _RE_HAS_ALPHA.search(c)):
        return False
    # 순수 값 표기(680pF, 10K, C0603 등)는 PN이 아니다 — 문장 부착
    # 구두점("16V.", "20mA)")은 벗긴 사본으로도 본다
    core = c.strip(".,;)")
    for pat in (_RE_CAP, _RE_IND, _RE_POW, _RE_VOLT, _RE_CUR, _RE_FREQ):
        if pat.fullmatch(c) or pat.fullmatch(core):
            return False
    if re.fullmatch(r"\d+(?:\.\d+)?\s*(?:mils?|mm|cm)", core, re.I):
        return False   # 단독 치수("50mil")는 PN이 아니다
    if _RE_RES_CODE.match(c) or _RE_PKG_C.fullmatch(c):
        return False
    return True


_RE_PKG_VERBATIM = re.compile(r"^\S+$")


_RE_PKG_PREFIXED = re.compile(r"^[A-Za-z]+/(\S+)$")  # "XTAL/2016", "CON/RECE"
_PKG_TYPE_PREFIX = re.compile(  # "LED-0603_Y" 류 부류 접두어 + 구분자
    r"^(?:LED|CAP|RES(?:ISTE?R)?|IND|FER|CONN?|XTAL|TRANS|BAT|DIODE|SW"
    r"|FUSE)[-_/]", re.I)
_PKG_VERBATIM_MAX = 10  # 이보다 길면 CAD 풋프린트명으로 간주(코드 탐색으로)


_RE_PKG_TWO_TOKEN = re.compile(  # "DO214 SMAJ" — 코드형 두 토큰 병기
    r"^[A-Z0-9][A-Z0-9-]{1,11} [A-Z0-9][A-Z0-9-]{1,11}$")


def _pkg_verbatim(cell: str) -> Optional[str]:
    """가이드 "셀 전체가 코드면 그대로" — 공백 없는 짧은 영숫자 혼합 셀
    (R0603, XSON8, ESD0603_B). "XTAL/2016"·"LED-0603_Y" 같은 부류 접두어나
    "LGA50P1210X…" 같은 긴 CAD 풋프린트명은 코드 부분 탐색으로 넘긴다.
    괄호가 있으면("SMD(2012)") 코드 추출 경로로 넘긴다.
    반환값에 '_'가 있으면 호출부가 Description 후보를 우선한다."""
    c = cell.strip()
    if re.fullmatch(r"[CR]\s*=\s*\d{4,5}", c, re.I):
        return None
    if _RE_PKG_PREFIXED.match(c) or _PKG_TYPE_PREFIX.match(c) or "(" in c:
        return None
    if _RE_PIN_ARRAY.match(c):
        return None  # 핀 배열("HN1x3", "2x03")은 패키지 코드가 아니다
    if _RE_PKG_TWO_TOKEN.match(c) and re.search(r"\d", c.split()[0]):
        return c  # "DO214 SMAJ" — 첫 토큰이 코드형이면 병기 그대로
    if len(c) > _PKG_VERBATIM_MAX:
        return None
    if re.search(r"\d[a-z]\d", c):
        return None  # 숫자 사이 소문자("NX40i32") — 모듈 형명이지 코드가 아님
    if (_RE_PKG_VERBATIM.match(c) and re.search(r"\d", c)
            and _RE_HAS_ALPHA.search(c)):
        return c
    return None


def _pkg_col_fallback(cell: str, blob: str = "") -> Optional[str]:
    """패키지 역할 열의 복합 원문 보존 — verbatim·코드 추출이 모두 실패한
    소켓·치수 병기 문자열("SOCKET_1x13_SMD", "IND-SMD_L7.1-W6.6",
    "MT-2.2 /NPH")은 잘라내지 말고 그대로 낸다. 값 표기 세그(220uH, 4A)나
    PN성 순숫자가 들어있으면 패키지가 아니라 사양 문자열이므로 거부."""
    c = cell.strip()
    if not (4 <= len(c) <= 40) or "," in c or c.lower().startswith("http"):
        return None
    toks = c.split()
    if len(toks) == 2 and toks[0].isalpha() and 2 <= len(toks[0]) <= 8:
        # 브랜드/부류어 접두 병기("IPEX 3x3_23011", "CAP 0402_1005") —
        # 접두를 벗긴 몸통으로 재판정
        return _pkg_col_fallback(toks[1], blob)
    if not (_RE_HAS_DIGIT.search(c) and _RE_HAS_ALPHA.search(c)):
        return None
    if _RE_PIN_ARRAY.match(c):
        return None   # 핀 배열("HN1x3")은 패키지 코드가 아니다
    if re.search(r"/\s|^/", c):
        return None   # slash 병기 리스트("CON/ USB/ GCT_…")는 단일 표기가 아님
    if _RE_PKG_CADISH.search(c) and blob:
        # CAD 풋프린트명은 설명 텍스트가 전무한 시트(TMS류 — 그 열이
        # 유일한 표기)에서만 채택하는 GT 관례 — 그 외엔 배척한다
        return None
    m = _PKG_TYPE_PREFIX.match(c)
    if m and re.fullmatch(r"[A-Za-z0-9]{8,}", c[m.end():]):
        # 부류접두 + 단일 PN형 토큰("TRANS_BSC010NE2LSI")은 다른 부품의
        # PN을 되풀이한 CAD명 — 복합 치수("IND-SMD_L7.1-W6.6")와 다르다
        return None
    if ("$" in c or c.startswith("FP-")
            or re.search(r"mm|mil", c, re.I) or re.search(r"[a-z]{3}", c)
            or _RE_COLOR_WORD.search(c)):
        # 서술형(mm/mil 치수·소문자 단어·색상)·인코딩 잔재는 package가 아니다
        return None
    for seg in re.split(r"[/_\s-]+", c):
        if seg and (re.fullmatch(r"\d{7,}", seg)
                    or any(p.fullmatch(seg) for _, p in _GRAMMAR)):
            return None
    if sum(1 for s in c.split("-") if s and s.isalpha()) >= 4:
        return None   # 알파 세그 나열("BCS-105-L-D-PE-BE")은 커넥터 PN형
    head0 = c.split("-")[0]
    if ("_" not in c and len(head0) >= 7
            and not _RE_PKG_CADISH.search(c)
            and _RE_HAS_DIGIT.search(head0) and _RE_HAS_ALPHA.search(head0)):
        # PN성 두문("WJ15EDGRC-3.81-2P")은 커넥터 PN형 — 거부.
        # CAD명("SOIC127P600X175-8N")은 위 blob 조건이 판정을 가진다.
        return None
    head = c.split("_")[0]
    if "_" in c and _RE_PKG_NAMED.fullmatch(head):
        return head   # 표준 코드+치수 결합("TSSOP-16_L5.0-…")은 코드만
    return c


def _find_dim(text: str, strict: bool) -> Optional[str]:
    """치수형 패키지("3x3", "12.5 x 12.5", "10x6mm") — CAD명 내장
    ("…P1210X1110X130…")과 핀수 표기("1x4")는 제외. strict면 프리텍스트용으로
    소수점 또는 mm가 있어야 받는다."""
    for m in _RE_PKG_DIM.finditer(text):
        s, e = m.start(), m.end()
        if s > 0 and text[s - 1].isalnum():
            continue
        if e < len(text) and text[e].isalnum():
            continue
        g = m.group().strip()
        if g[0] == "1" and not g[1].isdigit() and "." not in g \
                and "mm" not in g.lower():
            continue  # "1x4" 핀수
        if strict and "." not in g and "mm" not in g.lower():
            continue
        return g
    return None


_RE_PKG_PAREN_WRAP = re.compile(r"^[A-Za-z]{2,6}\s*\((.+)\)$")  # "SMD(2012)"
_RE_PKG_MOUNT_NUM = re.compile(r"^(?:SMD|DIP)[ -]?(\d{3,4})$", re.I)
_RE_PKG_CLASS_TOKEN = re.compile(  # "IND SRN5040TA" — 부류어 + 코드 토큰
    r"^(?:LED|CAP|RES|IND|FER|CON|XTAL|TRANS|BAT|DIODE|SW|FUSE)\s+(\S+)$",
    re.I)
_RE_PKG_CAD_SUFFIX = re.compile(r"_(?:Pad|HandSolder)[^ ]*", re.I)
_RE_PKG_CLASS_US = re.compile(  # CAD명 선두 부류어 + '_' ("LED_0603_…", "D_…")
    r"^(?:LED|CAP|CAPACITOR|CP|RES|RESISTER|RESISTOR|IND|INDUCTOR|FER|CON"
    r"|XTAL|TRANS|BAT|DIODE|SW|FUSE|[DCRLQUJY])_", re.I)
_RE_PKG_MM_TAIL = re.compile(r"_(\d+(?:\.\d+)?mm)$", re.I)
_RE_PKG_PIN_SUFFIX = re.compile(  # '_' 인접("…_5032-2Pin_…")도 잡도록 lookaround
    r"(?<![A-Za-z0-9])\d{3,4}-\d{1,2}Pin(?![A-Za-z0-9])", re.I)
_RE_PKG_PAIR_US = re.compile(  # 임페리얼_메트릭 병기 "0402_1005", "0603_1608Metric"
    r"(?<![A-Za-z0-9])\d{4}_\d{4}(?:Metric)?(?![A-Za-z0-9])")
_RE_PKG_EIA = re.compile(r"EIA-?\d{3,4}-\d+")
_RE_PKG_CADISH = re.compile(  # IPC CAD 치수명 — GT 관례상 package 아님
    r"\d+X\d+X\d+|P\d+X\d+|[A-Z]\d{4}X\d+")


_PKG_GENERIC = ("SMD", "SMA", "SMB", "SMC", "DIP")


def _named_best(text: str) -> Optional[str]:
    """명명 패키지 매치 중 최선 — '_'를 공백으로 푼 사본에서도 찾고
    (CAD명 "DIP-8_W7.62mm"의 경계 깨짐 대응), 범용어(SMD/DIP)와 CAD
    치수명("QFN50P300X…")을 뒤로 미룬 뒤 원문 등장 순서로 고른다
    ("TSSOP14 … SOT402-1"에서 앞의 표준명 우선)."""
    ms = list(_RE_PKG_NAMED.finditer(text))
    ms += list(_RE_PKG_NAMED.finditer(text.replace("_", " ")))
    if not ms:
        return None
    best = min(ms, key=lambda m: (m.group() in _PKG_GENERIC,
                                  bool(_RE_PKG_CADISH.search(m.group())),
                                  m.start(), -len(m.group())))
    return best.group()


def _pkg_from_cell(cell: str) -> Optional[str]:
    """패키지 열 셀에서 코드 부분만 — "FER 0402/1005" → "0402/1005".
    "LED-0603_Y"처럼 '_'가 단어 경계를 깨는 CAD명은 구분자 정규화 사본에서
    찾는다 (숫자 코드 계열만 — 매치 토큰은 원문 부분 문자열 그대로다).
    코드가 없으면 치수형("3x3") → 구조화 풋프린트명 verbatim 순으로 받는다."""
    c = cell.strip()
    if not c:
        return None
    passive_hint = re.fullmatch(
        r"[CR]\s*=\s*(01005|0201|0402|0603|0805|1005|1206|1210|1608|"
        r"1808|1812|2010|2012|2220|2312|2512|3216|3225|4520|4532|"
        r"5025|5750|6032|6332|7343)", c, re.I)
    if passive_hint:
        return passive_hint.group(1)
    m = _RE_PKG_PAREN_WRAP.match(c)          # "SMD(2012)" → 괄호 안에서 탐색
    if m:
        inner = _pkg_from_cell(m.group(1))
        if inner:
            return inner
    if _RE_PKG_CAD_SUFFIX.search(c):         # "LED_0603_1608Metric_Pad…"
        core = _RE_PKG_CAD_SUFFIX.sub("", c)
        core = _RE_PKG_CLASS_US.sub("", core).strip("_- ")
        if core:
            return _pkg_from_cell(core) or (
                core if _RE_HAS_DIGIT.search(core)
                and not _RE_PKG_CADISH.search(core) else None)
    if _RE_PKG_CLASS_US.match(c):            # "D_SOD-123F" → "SOD-123F"
        core = _RE_PKG_CLASS_US.sub("", c).strip("_- ")
        got = _pkg_from_cell(core) if core else None
        if got:
            return got
    m = _RE_PKG_PIN_SUFFIX.search(c)         # "5032-2Pin" — 핀수 접미 보존
    if m:
        return m.group()
    m = _RE_PKG_PAIR_US.search(c)            # "0402_1005" / "0603_1608Metric"
    if m:
        g = m.group()
        # KiCad형 "…Metric" 병기는 임페리얼 부분만 (GT 관례: R_0603_1608Metric
        # → "0603"). 무접미 병기("0402_1005")는 통째로.
        return g[:4] if g.endswith("Metric") else g
    m = _RE_PKG_EIA.search(c)                # "EIA-7132-28" (_AVX-C 꼬리 제거)
    if m:
        return m.group()
    norm = c.replace("_", " ")
    for pat in (_RE_PKG_C, _RE_PKG_SLASH):
        m = pat.search(c) or pat.search(norm)
        if m:
            return m.group()
    m = _RE_PKG_MOUNT_NUM.match(c)           # "SMD1005" → 숫자부
    if m:
        return m.group(1)
    if _RE_PKG_PREFIX_CODE.fullmatch(c):     # "CD2012" 접두 코드는 그대로
        return c
    seg0 = c.split("_")[0]                   # "SM0603_Capa_libcms" → SM0603
    if "_" in c and _RE_PKG_PREFIX_CODE.fullmatch(seg0):
        return seg0
    named = _named_best(c)
    if named:
        generic = named in ("SMD", "SMA", "SMB", "SMC")
        if not generic or (not re.search(r"\d", c)
                           and not _PKG_TYPE_PREFIX.match(c)):
            # 범용어(SMD 등)는 숫자 코드도 부류 접두("XTAL_SMD")도 없을 때만
            return named
    # "LED0603_RED"처럼 글자에 붙은 4자리 코드는 경계를 만들어 재탐색
    norm2 = re.sub(r"(?<=[A-Za-z])(?=\d{4})", " ", re.sub(r"[-_]", " ", c))
    m = (_RE_PKG_IMP.search(c) or _RE_PKG_IMP.search(norm)
         or _RE_PKG_IMP.search(norm2))
    if m:
        return m.group()
    if named and named not in _PKG_GENERIC:
        return named  # 최종 폴백도 범용어(SMD/DIP)는 제외 — 실장방식 오인 방지
    m = _RE_PKG_CLASS_TOKEN.match(c)         # "IND SRN5040TA" → 코드 토큰
    if m and re.search(r"\d", m.group(1)):
        return m.group(1)  # PN 조각 여부는 호출부(step 6)가 PN과 대조해 거른다
    if c.count("_") < 2 and not re.search(r"pin|header|\bpos\b|way", c, re.I):
        # 언더스코어 다수 = CAD명, pin/header 문맥 = 핀 배열("2x3 Pin Header")
        dim = _find_dim(c, strict=False)
        if dim:
            return dim
    m = _RE_PKG_MM_TAIL.search(c)            # "Coil_Toroidal_21mm" → "21mm"
    if m:
        return m.group(1)
    if (_RE_PKG_PREFIXED.match(c) and len(c) <= 10
            and _RE_HAS_DIGIT.search(c)):
        return c  # "TP/1.0" — 접두형인데 코드 추출이 전부 실패한 짧은 표기
    if re.fullmatch(r"\d{3,4}", c):
        return c  # 패키지 역할 열의 bare 사이즈("402", "0630") — 화이트리스트 밖
    m = re.fullmatch(r"(\d{3,4})\s+size", c, re.I)
    if m:
        return m.group(1)                    # "3535  Size" → "3535"
    return None
    # 주의: 무숫자 코드("USC")는 여기서 받지 않는다 — 이 함수는 '/'-세그
    # 분류에도 쓰여서 "PN/OT"의 포장 접미를 패키지로 오인하게 만든다.
    # 무숫자 코드 수용은 호출부(step 6, 패키지 역할 열 한정)에서 처리.


_RE_PKG_TANTAL_SIZE = re.compile(r"\b([A-J])\s*[- ]?size\b", re.I)
_RE_PKG_PI = re.compile(r"(?<![A-Za-z0-9.])\d{1,2}\s?Pi\b")  # 지름 "5Pi" (파이)


def _pkg_paren_code(text: str) -> Optional[str]:
    """괄호 안 병기 패키지 — 전체가 코드/치수일 때만 (fullmatch 규율:
    "(MSOP-16)"·"(5X5)"는 받고 "(4MB)"·"(51)"·"(MSOP16/0.5)"는 거른다)."""
    t = text.strip()
    for pat in (_RE_PKG_C, _RE_PKG_SLASH, _RE_PKG_IMP):
        if pat.fullmatch(t):
            return t
    m = _RE_PKG_NAMED.fullmatch(t)
    if m and m.group() not in ("SMD", "SMA", "SMB", "SMC"):
        return m.group()
    if _find_dim(t, strict=False) == t:
        return t
    return None


def _pkg_candidates(text: str) -> Dict[str, str]:
    """프리텍스트에서 우선순위 계층별 패키지 후보. 'SMD' 단독은 실장 방식
    서술이지 패키지 근거로 약해 제외한다 (패키지 열의 'SMD'는 별도 경로)."""
    out = {}
    norm = text.replace("_", " ")
    for tier, pat in (("c", _RE_PKG_C), ("slash", _RE_PKG_SLASH),
                      ("imp", _RE_PKG_IMP), ("named", _RE_PKG_NAMED)):
        m = pat.search(text) or (pat.search(norm)
                                 if tier in ("c", "slash", "imp") else None)
        if not m:
            continue
        if tier == "named":
            g = m.group()
            # 실장 방식 단독·동축 커넥터명 — 텍스트 근거로는 약함
            if g in ("SMD", "DIP", "SMA", "SMB", "SMC"):
                continue
            if (g.endswith("SMD") and g[0].isdigit() and m.start() > 0
                    and (text[m.start() - 1].isalpha()
                         or text[m.start() - 1] == "-")):
                continue  # "TS-1105SMD" — PN 꼬리의 \d+SMD 오탐
        out[tier] = m.group().strip()
    m = _RE_PKG_TANTAL_SIZE.search(text)   # "Chip Tantal A size" → "A"
    if m:
        out["size"] = m.group(1)
    m = _RE_PKG_PI.search(text)            # LED 지름 표기 "5Pi", "10Pi"
    if m:
        out["pi"] = m.group()
    dim = _find_dim(text, strict=True)
    if dim:
        out["dim"] = dim
    return out


def _mask(text: str, *needles: Optional[str]) -> str:
    """PN 등 이미 확정된 토큰을 지워 값 문법의 오탐(0.4V(51))을 막는다."""
    for n in needles:
        if n and len(n) >= 4:
            text = text.replace(n, " ")
    return text


# ---- 행 추출 -----------------------------------------------------------------

def extract_row(labels: List[str], roles: Dict[str, List[int]],
                cells: List[str], row_id: int
                ) -> Tuple[RowAttrs, Dict[str, str]]:
    _cstr = [str(x).strip() if x is not None else "" for x in cells]

    def cell(i: int) -> str:
        return _cstr[i] if i < len(_cstr) else ""

    val: Dict[str, object] = {}
    src: Dict[str, str] = {}

    def put(field: str, v, source: str):
        if v not in (None, "") and field not in val:
            val[field] = v
            src[field] = source

    def put_resistance_code(raw: str):
        resistance, tolerance = _resistance_code_parts(raw)
        put("resistance", resistance, "col")
        if tolerance:
            put("tolerance", tolerance, "col")

    pre_texts = []  # 이중성 열의 미해석 텍스트 — 프리텍스트(blob)로 편입

    # 1) 명시 열 — 그대로 취함. 명시적 PN 열은 느슨하게 신뢰 —
    #    "ESP32-WROOM-32D (4MB)", "8.85012E+11"(엑셀 부동소수 오염)도 그대로.
    #    단 플레이스홀더("N.A.")와 문장형("Missing Hole")은 거른다.
    #    PN 열이 여럿이면(유통사별 병렬 — 1-click-bom) 유통 코드 접두
    #    ("81-GRM…")가 없는 열을 우선한다 (2패스).
    pn_cols = roles.get("part_number", [])
    pn_vendorish = [i for i in pn_cols
                    if re.match(r"\d{2,3}-", cell(i))
                    or _RE_DIGIKEY_TAIL.fullmatch(cell(i))]
    if len(pn_cols) > len(pn_vendorish) and pn_vendorish:
        pn_cols = ([i for i in pn_cols if i not in pn_vendorish]
                   + pn_vendorish)
    for i in pn_cols:
        c = cell(i)
        if not c or c.lower().startswith("http"):
            continue
        if re.match(r"pn-", c, re.I):
            continue  # 내부 플레이스홀더("pn-R1210") — 실PN은 다른 열에 있다
        # 괄호 값 병기("ABS07 (32.768kHZ)")는 PN에서 벗기고 값으로
        mv = re.fullmatch(r"(.{3,}?)\s*\(([^()]+)\)", c)
        if mv:
            inner = mv.group(2).strip()
            fld = next((f for f, p in _GRAMMAR if p.fullmatch(inner)), None)
            if fld:
                put(fld, inner, "col")
                c = mv.group(1).strip()
        if any(p.fullmatch(c) for _, p in _GRAMMAR) or _RE_RES_CODE.match(c):
            pre_texts.append(c)  # PN열에 값 표기("120pF", "100K")가 온 경우
            continue
        if (len(c) >= 4 and c.lower() not in _MFR_PLACEHOLDER
                and _RE_PN_LIKE.match(c) and not _pn_reject(c)):
            put("part_number", _strip_pn_alt(c), "col")
            break
        # "MOLEX 430451400" — 제조사 + 숫자 PN 병기 셀
        toks = c.split()
        if (len(toks) == 2 and find_manufacturer(toks[0])
                and re.fullmatch(r"[A-Z0-9-]{5,}", toks[1], re.I)
                and _RE_HAS_DIGIT.search(toks[1])):
            put("part_number", toks[1], "col")
            put("manufacturer", toks[0], "col")
            break
        # 결합/병기 셀만 — "LTST-…/GREEN"(색상 접미), "FFC2B35-40-G /GCT"(벤더),
        # "KRA101S,FJV4101R"(대체 병기는 대표 1개).
        # 콤마 꼬리가 전부 짧은 숫자면 포장 접미("74HC4067PW,118") — 통짜 유지
        if "," in c and all(re.fullmatch(r"\d{1,4}", t.strip())
                            for t in c.split(",")[1:] if t.strip()):
            if _RE_PN_LIKE.match(c.replace(",", "")) and not _pn_reject(c):
                put("part_number", c, "col")
                break
        if "/" in c or "," in c:
            head = c.split(",")[0].strip()
            fin = _pn_finalize(c) or (
                head if head != c and len(head) >= 4
                and _RE_PN_LIKE.match(head) and not _pn_reject(head) else None)
            if fin and len(fin) >= 4 and _RE_PN_LIKE.match(fin) \
                    and not _pn_reject(fin):
                put("part_number", fin, "col")
                break
        pre_texts.append(c)  # PN열의 비PN 텍스트("Chip Resistor" 등)
    for i in roles.get("quantity", []):         # 가이드: 첫 번째 열이 보드당
        m = _RE_INT.search(cell(i))             # — 단 빈 셀이면 다음 수량 열
        if m:                                   # (병렬 하위 테이블 파일 대응)
            put("quantity", int(m.group()), "col")
            break
    for i in roles.get("manufacturer", []):
        c = cell(i)
        if (c and not c.lower().startswith("http")
                and c.lower() not in _MFR_PLACEHOLDER):
            put("manufacturer", c, "col")
            break
    for i in roles.get("part_type", []):
        c = cell(i)
        if not c:
            continue
        pre_texts.append(c)   # "저항 (1/4W)" — 타입 외 정보도 문법으로
        cu = c.strip().upper()
        if _RE_MOUNT_ONLY.fullmatch(cu):
            continue  # "Thru-hole"/"Surface mount"는 실장 방식이지 타입이 아님
        t = ("transistor" if cu == "TR"                  # Class 열의 축약 표기
             else infer_part_type(c)
             or (_DESIG_TYPE.get(cu) if len(cu) <= 2 else None))
        # KiCad 'Cmp name' 열의 단일 문자("C"/"R"/"J")도 지시자 사전으로
        if t:
            put("part_type", t, "col")
            break
    for f in ("current", "power", "voltage", "tolerance"):
        for i in roles.get(f, []):
            c = cell(i)
            if not c:
                continue
            if f == "tolerance" and re.fullmatch(r"0?\.\d+", c):
                # 엑셀 백분율 서식의 원시값(0.1 → 10%) 복원
                c = f"{float(c) * 100:g}%"
            put(f, c, "col")
            break

    # 2) 프리텍스트 수집 — Description + 라벨 없는 열의 긴 텍스트 +
    #    이중성 열 잔여 텍스트 + 스펙성 패키지 열("47NH 0603")
    texts = [cell(i) for i in roles.get("description", [])
             if not cell(i).lower().startswith("http")]
    for i in roles.get("_unlabeled_text", []):
        if not cell(i).lower().startswith("http"):  # URL 열이 blob에 들어오면
            texts.append(cell(i))                   # 제조사·값 환각의 원천
    pkg_texts = []            # 패키지 열 유래 — 값 문법에는 참여하되
    for i in roles.get("package", []):   # 타입 추론에서는 제외한다
        c = cell(i)                      # ("CAP 0402/1005 RF"가 NC 행을
        if c and " " in c.strip():       #  capacitor로 만드는 오폭 방지)
            pkg_texts.append(c)
    texts += pre_texts + pkg_texts
    raw_blob = " | ".join(t for t in texts if t)
    desc_raw = " | ".join(t for t in texts if t and t not in pkg_texts)

    # 3) Value/Comment/규격/Name 열 — 값 표기·PN·자유 텍스트 이중성
    pkg_value_col = None
    extra_texts = []          # 미해석 텍스트는 프리텍스트(blob)로 편입
    pending_bare_res = None   # bare 숫자("0.02","470") — resistor 확정 후 적용
    nc_row = False            # NC 단독/접두 셀("NC, [NoValue]") — 미실장 행
    for i in roles.get("value", []):
        c = cell(i)
        if not c:
            continue
        if c.startswith("(") and c.endswith(")"):
            c = c[1:-1].strip()   # "(220nF/20/50V)" 괄호 포장 제거
        if not c:
            continue
        stripped_nc = False
        if c.upper() == "NC" or c.upper().startswith("NC,"):
            nc_row = True   # 미실장 행 — 근거 약한 type 추론을 막는다
            continue
        if c.upper().startswith("NC/"):
            stripped_nc = True    # 선행 NC(미실장) — PN 후보에서 제외
            c = c[3:].strip()
            if not c:
                continue

        # "C&K=PTS636-…"/"MOLEX=53261-…"처럼 제조사와 MPN을 한 셀에
        # 병기한 경우 RHS가 패키지가 아니면 실제 식별자로 분리한다.
        prefixed_mpn = re.fullmatch(r"([^=]{2,24})=(.+)", c)
        if prefixed_mpn:
            candidate = re.sub(
                r"\((?:NP|RVS|ALT|대체)\)$", "", prefixed_mpn.group(2).strip(),
                flags=re.I)
            if (_pkg_from_cell(candidate) is None and _looks_like_pn(candidate)
                    and not _pn_reject(candidate)):
                put("part_number", candidate, "col")
                maker = find_manufacturer(prefixed_mpn.group(1))
                if maker:
                    put("manufacturer", maker, "col")
                continue

        # 괄호 병기 값 — "DSX321(8MHz)", "100nF(0201 6.3V)", "DSS34(3A 500mV)"
        for inner in _RE_PAREN_VAL.findall(c):
            inner = inner.strip()
            matched_full = False
            for field, pat in _GRAMMAR:
                if pat.fullmatch(inner):
                    put(field, inner, "col")
                    matched_full = True
                    break
            if matched_full:
                continue
            if re.fullmatch(r"\d{7,}", inner):
                # 괄호 병기 순숫자 PN — "10uH(0420)(78438357100)"
                put("part_number", inner, "col")
                continue
            if " " not in inner:
                continue
            for field, pat in _GRAMMAR:  # 다중 값 괄호는 필드별 탐색
                m2 = pat.search(inner)
                if not m2:
                    continue
                g2 = m2.group().strip()
                if field == "voltage":
                    from .normalize_values import norm_voltage
                    nv = norm_voltage(g2)
                    if nv is not None and nv < 1.0:
                        continue  # 1V 미만은 Vf(순방향 전압) 관례 — 제외
                put(field, g2, "col")

        # 괄호를 벗긴 몸통이 값 표기면 값으로 — "10.0kR(0201)"의 저항값이
        # PN으로 오인되지 않게 한다
        core = _RE_PAREN_VAL.sub("", c).strip()
        if core != c.strip():
            put_field = None
            for field, pat in _GRAMMAR:
                if pat.fullmatch(core):
                    put_field = field
                    break
            if put_field:
                put(put_field, core, "col")
                continue
            if _RE_RES_CODE.match(core):
                put_resistance_code(core)
                continue

        # 슬래시 포함 단일 값 표기("1/16W")는 통째로 값 — 세그 분리가
        # "16W"로 쪼개기 전에 셀 전체 매치를 먼저 확정한다
        whole_val = next((f for f, p in _GRAMMAR if p.fullmatch(c)), None)
        if whole_val:
            put(whole_val, c, "col")
            continue

        # 세그 분류 — "330uF/16V", "3216/2.2R", "10pF/0603", "10mR/1005"
        # 분수 power("…, 1/16W")의 '/'는 분리 지점이 아니다 — 보호 후 분리
        protected = _RE_POW_FRACTION.sub(
            lambda m: m.group().replace("/", "\x00"), c)
        segs = [s.strip().replace("\x00", "/")
                for s in protected.split("/") if s.strip()]
        # 혼합 셀("0ZCJ0110FF2E/1.1A")의 값 세그는 PN 처리와 무관하게 회수
        if len(segs) > 1:
            for s in segs:
                tantal_cap = _RE_TANTAL_CAP.fullmatch(s)
                if tantal_cap:
                    put("capacitance", tantal_cap.group(1), "col")
                    continue
                if _RE_TANTAL_PACKAGE.fullmatch(s):
                    continue
                for field, pat in _GRAMMAR:
                    if pat.fullmatch(s):
                        put(field, s, "col")
                        break
        cls = []
        for s in segs:
            if _RE_TANTAL_CAP.fullmatch(s):
                cls.append("val")
            elif _RE_TANTAL_PACKAGE.fullmatch(s):
                cls.append("pkg")
            elif any(p.fullmatch(s) for _, p in _GRAMMAR):
                cls.append("val")
            elif _RE_RES_CODE.match(s):
                cls.append("res")
            elif _RE_RES_BARE.match(s):
                cls.append("bare")
            elif s.upper() in ("NC", "N.C", "N.C."):
                cls.append("nc")
            elif _pkg_from_cell(s) == s:
                cls.append("pkg")
            elif re.fullmatch(r"\d+(?:\.\d+)?mm", s, re.I):
                cls.append("pkg")   # 전해캡 직경("6.3mm") — 치수형 패키지
            else:
                cls.append("?")
        # 스펙/실PN 병기("1.5uH/VLS3012HBX-1R5M")는 스펙을 검증값으로
        # 보존하면서 유일한 PN 세그먼트를 식별자로 사용한다.
        pn_segments = [
            s for s, kind in zip(segs, cls)
            if kind == "?" and len(s) >= 5
            and _looks_like_pn(s) and not _pn_reject(s)
        ]
        if any(kind in {"val", "res"} for kind in cls) and len(pn_segments) == 1:
            for s, kind in zip(segs, cls):
                if kind == "res":
                    put_resistance_code(s)
                elif kind == "pkg" and pkg_value_col is None:
                    pkg_value_col = s
            put("part_number", _strip_pn_alt(pn_segments[0]), "col")
            continue
        # 긴 사양 병기("47uF/50V/EC/SMD/6.3mm")는 모르는 세그(EC) 하나쯤은
        # 무시하고 해석한다 — 세그 4개+일 때만 (짧은 셀은 오분해 위험)
        allowed_unknown = 1 if len(segs) >= 4 else 0
        if cls.count("?") <= allowed_unknown \
                and (any(k in cls for k in ("val", "res", "bare"))
                     or (len(cls) >= 2
                         and cls.count("pkg") == len(cls))):
            # 패키지 병기 셀("6.2X6.2/SMD")도 구체 표기를 회수한다
            for s, k in zip(segs, cls):
                if k == "val":
                    for field, pat in _GRAMMAR:
                        if pat.fullmatch(s):
                            put(field, s, "col")
                            break
                elif k == "res":
                    put_resistance_code(s)
                elif k == "bare" and pending_bare_res is None:
                    pending_bare_res = s
                elif k == "pkg":
                    if pkg_value_col is None or (
                            pkg_value_col in ("SMD", "DIP")
                            and s not in ("SMD", "DIP")):
                        pkg_value_col = s   # 실장 방식보다 구체 표기 우선
            continue

        pn_cand = None
        body, sep, tail = c.partition("/")
        body_s, tail_s = body.strip(), tail.strip()
        tail_pkg = _pkg_from_cell(tail_s) if sep else None
        if stripped_nc:
            # "NC/BLM18KG…" — 잔여가 PN형이면 대체 PN, 아니면 버림
            if ((len(c) >= 5
                 or (_norm_label(labels[i]) == "value" and len(c) >= 4
                     and sum(ch.isalpha() for ch in c) >= 2
                     and sum(ch.isdigit() for ch in c) >= 2))
                    and _looks_like_pn(c) and not _pn_reject(c)):
                put("part_number",
                    _pn_finalize(c) or _strip_pn_alt(c), "col")
            continue
        # 콤마 병기 다중 PN("KRA101S,FJV4101R SRA2201S")은 첫 표기가 대표.
        # 콤마 없는 공백 병기("MS621FE FL11E")는 한 PN의 두 부분일 수 있다.
        _toks = re.split(r"[,\s]+", c) if "," in c else []
        if (len(_toks) >= 2 and all(len(t) >= 5 and _looks_like_pn(t)
                                    and not _pn_reject(t) for t in _toks)):
            put("part_number", _toks[0], "col")
            continue
        if (sep and _RE_COLOR_WORD.fullmatch(tail_s)
                and _looks_like_pn(body_s) and not _pn_reject(body_s)):
            pn_cand = body_s           # "LTST-S270KGKT/GREEN" — 꼬리는 색상
        elif (sep and re.fullmatch(r"[A-Z]{2,5}", tail_s)
                and body.endswith(" ")   # " /" — 붙은 "/OT"는 포장 접미(PN 일부)
                and len(body_s) >= 8
                and _looks_like_pn(body_s) and not _pn_reject(body_s)):
            pn_cand = body_s           # "FFC2B35-40-G /GCT" — 꼬리는 벤더 약칭
        elif tail_pkg and _looks_like_pn(body_s) and not _pn_reject(body_s):
            pn_cand = body_s           # "MP2143DJ/TSOT23-8" — PN/패키지
            pkg_value_col = pkg_value_col or tail_pkg
        elif ((len(c) >= 5
               or (_norm_label(labels[i]) == "value" and len(c) >= 4
                   and sum(ch.isalpha() for ch in c) >= 2
                   and sum(ch.isdigit() for ch in c) >= 2))
              and _looks_like_pn(c) and not _pn_reject(c)):
            # "PN/시리즈·풋프린트명" 결합 셀 — 꼬리가 '_'를 갖거나
            # Description에 그대로 등장하면(시리즈명) 앞부분만 PN
            pn_cand = (body_s if (sep and _looks_like_pn(body_s)
                                  and ("_" in tail
                                       or (tail and tail in raw_blob)))
                       else c)
        elif (sep and _looks_like_pn(tail_s) and not _pn_reject(tail_s)
                and (infer_part_type(body_s)
                     or (len(tail_s) >= 8
                         and re.search(r"\dmm|\d\s*[xX]\s*\d", body_s)))):
            pn_cand = tail_s   # "BEAD/MPZ2012S300AT000" — 부류어/PN,
            #                    "10x6mm 5T (도전 Tape) / UKB6-5-10-4"
            dim = _find_dim(body_s, strict=True)
            if dim and pkg_value_col is None:
                pkg_value_col = dim   # 몸통의 치수 표기는 패키지 후보
        if pn_cand:
            put("part_number",
                _pn_finalize(pn_cand) or _strip_pn_alt(pn_cand), "col")
        elif re.fullmatch(r"(?=.*\d)[A-Z][A-Z0-9.]{2,}(?: [A-Z0-9.]{1,6}){1,4}",
                          c) and not _pn_reject(c) \
                and not re.search(r"\d(?:\.\d+)?\s*[Xx]\s*\d", c):
            # 치수 나열("FPCB 0.5 X 40P")은 형명이 아니다
            # 규격 열의 공백 포함 형명("MCR03 EZP5 J 103") — PN으로
            put("part_number", c, "col")
        else:
            extra_texts.append(c)  # "Chip Resistor", "SOP-8 3.9mm" 류

    if extra_texts:
        raw_blob = " | ".join([raw_blob] + extra_texts) if raw_blob \
            else " | ".join(extra_texts)
        desc_raw = " | ".join([desc_raw] + extra_texts) if desc_raw \
            else " | ".join(extra_texts)
    blob = _mask(raw_blob, val.get("part_number"))  # type: ignore[arg-type]
    desc_blob = _mask(desc_raw, val.get("part_number"))  # type: ignore[arg-type]

    # 4) part_type — 문법보다 먼저 (인덕터 DCR 가드에 필요).
    #    Class 열의 범용 'IC'는 Description의 구체 타입이 이긴다.
    #    값·수량·PN이 전무한 행(가공 지시 등 비부품 행)은 추론하지 않는다.
    #    구제 열(_rescued_text)은 타입 추론에만 참여 — 값 문법·PN에서 격리.
    rescue_text = " | ".join(
        t for t in (cell(i) for i in roles.get("_rescued_text", []))
        if t and not t.lower().startswith("http"))
    # "for green LED"류 용도 절은 부품 자신이 아니라 쓰임의 서술 —
    # 타입 추론에서만 걷어낸다 (LED용 직렬 저항이 led가 되는 오폭 방지)
    _de_for = _RE_FOR_CLAUSE.sub(" ", desc_blob) if desc_blob else desc_blob
    desc_type = infer_part_type(_de_for) if _de_for else None
    if not desc_type and blob and not nc_row:
        # 패키지 열 서술("resonator_ATS-…")은 2차로 — NC 행에서는 풋프린트
        # 어휘("CAP 0402…")가 type을 만들지 않도록 1차(desc_blob)만 쓴다
        desc_type = infer_part_type(_RE_FOR_CLAUSE.sub(" ", blob))
    if not desc_type and rescue_text:
        rt = infer_part_type(rescue_text)
        if rt:
            # 구제 열은 용도 서술("For MCU Status")일 수 있다 — 명시적
            # 지시자(LED1 → led)가 있으면 그쪽이 근거가 강하다
            dt = next((desig_part_type(cell(i))
                       for i in roles.get("designator", []) if cell(i)),
                      None)
            desc_type = dt or rt
    row_has_substance = bool(val)
    if "part_type" not in val:
        if desc_type and row_has_substance:
            # NC 행이라도 명시 서술("Capacitor, NP0")이 있으면 type은 인정
            # — 패키지 열 어휘 유래 오폭은 desc_blob 분리가 이미 막는다
            put("part_type", desc_type, "infer")
    elif val.get("part_type") == "ic" and desc_type and desc_type != "ic":
        val["part_type"] = desc_type
        src["part_type"] = "text"

    # 5) 값 문법 — current/voltage/power는 PN형 토큰을 지운 사본에서 스캔
    #    ("HR911105A"의 5A, "RJ-45 w/"의 45 w 같은 오탐 차단, gpt 증류)
    cv_blob = None
    if blob:
        for field, pat in _GRAMMAR:
            if field in val:
                continue
            scan = blob
            if field in ("current", "voltage", "power"):
                if cv_blob is None:
                    # PN형 토큰은 지우되, 내장 값 세그("L_220uH-4A"의
                    # 4A)는 살린다 — 세그 전체 매치만이라 "HR911105A"의
                    # 꼬리 "5A" 같은 우연 매치는 되살아나지 않는다
                    kept = []
                    for t in blob.split():
                        core = t.strip(".,;()")
                        if _looks_like_pn(core) and "/" not in core:
                            kept += [s for s in re.split(r"[-_]", core)
                                     if s and any(p.fullmatch(s)
                                                  for _, p in _GRAMMAR)]
                        else:
                            kept.append(t)
                    cv_blob = " ".join(kept)
                scan = cv_blob
            for m in pat.finditer(scan):
                g = m.group().strip()
                # 비저항 부품의 mΩ·소수 Ohm 표기는 기생 저항(DCR·
                # RDS(on)·ESR)이지 저항값이 아니다 (가이드: note 대상)
                if (field == "resistance"
                        and val.get("part_type") not in (None, "resistor")
                        and (re.search(r"m\s*(?:ohms?|Ω|Ω)", g, re.I)
                             or re.match(r"0?\.\d+\s*(?:ohms?|Ω|Ω)", g,
                                         re.I))):
                    continue
                put(field, g, "text")
                break

    # 5.3) part_number 최후 폴백 — 프리텍스트 토큰에서 PN형 추출
    if "part_number" not in val and blob:
        tok = extract_pn_token(blob)
        fin = _pn_finalize(tok) if tok else None
        if fin:
            put("part_number", fin, "text")
    # 5.35) 사내 품번 열 — 형명이 어디에도 없을 때만
    if "part_number" not in val:
        for i in roles.get("_pn_internal", []):
            c = cell(i)
            if (c and len(c) >= 4 and _RE_PN_LIKE.match(c)
                    and not _pn_reject(c)):
                put("part_number", _strip_pn_alt(c), "col")
                break

    # 5.5) part_type 폴백 사다리 — 값 함의 → 패키지 열 부류어("XTAL/1612")
    #      → 지시자 접두어(R1→resistor). part_type만 판단이 허용된 필드.
    if "part_type" not in val:
        for f, t in (("resistance", "resistor"), ("capacitance", "capacitor"),
                     ("inductance", "inductor")):
            if f in val:
                put("part_type", t, "infer")
                break
    if "part_type" not in val and val:
        # PN 문자열 자체의 타입 힌트 ("LED_R", "pn-res") — 짧은 것만
        pn_s = str(val.get("part_number", ""))
        if pn_s and len(pn_s) <= 10:
            t = infer_part_type(pn_s)
            if t:
                put("part_type", t, "infer")
    if "part_type" not in val and val and not nc_row:
        # 패키지 열의 부류어는 앵커된 접두("XTAL/1612", "LED_PLCC4")만 신뢰 —
        # CAD명 중간의 단어("…_W7.62mm_Socket")로 판단하면 오폭한다.
        # NC(미실장) 행은 풋프린트 접두("CAP 0402…")로 추론하지 않는다.
        for i in roles.get("package", []):
            c = cell(i)
            m = re.match(r"^([A-Za-z]{2,9})[-_/ ]", c)
            t = infer_part_type(m.group(1)) if m else None
            if t:
                put("part_type", t, "infer")
                break
    if "part_type" not in val and val and val.get("quantity") != 0 \
            and not nc_row:
        # 수량 0(미실장) 행은 지시자만으로 판단하지 않는다 (GT 관례)
        for i in roles.get("designator", []):
            t = desig_part_type(cell(i))
            if t:
                # D 지시자 + 색상 값(WHITE/RGB)은 LED 관례
                if t == "diode" and re.search(
                        r"\b(?:white|red|green|blue|yellow|amber|orange"
                        r"|rgb)\b", blob or "", re.I):
                    t = "led"
                put("part_type", t, "infer")
                break
    # 5.8) 최후 폴백 — 패키지 열 전체 텍스트 스캔 ("JST_XH_B3B…",
    #      "3x2.5PushButton"). 지시자 폴백 뒤에만 — CAD명 중간 단어
    #      ("…_Socket")가 지시자 근거(U→ic)를 이기지 못하게 한다.
    if "part_type" not in val and val and not nc_row:
        for i in roles.get("package", []):
            t = infer_part_type(_TYPE_SEP.sub(" ", cell(i)))
            if t:
                put("part_type", t, "infer")
                break

    # 5.51) crystal의 PN 내장 주파수 — "ABLS-6.144MHZ-B4-T" (부류 확정 후만)
    if (val.get("part_type") == "crystal" and "frequency" not in val
            and "part_number" in val):
        m = re.search(r"\d+(?:\.\d+)?\s*[KM]HZ", str(val["part_number"]), re.I)
        if m:
            put("frequency", m.group(), "text")
    # 인덕터의 PN 내장 값 — "EMC6540-4.7uH" (같은 원리)
    if (val.get("part_type") == "inductor" and "inductance" not in val
            and "part_number" in val):
        m = re.search(r"\d+(?:\.\d+)?\s*[unm]H\b", str(val["part_number"]),
                      re.I)
        if m:
            put("inductance", m.group(), "text")

    # 5.52) 타입 게이팅 bare 단위 — 부류 확정 후 "4.7u"/"100n"(단위 문자
    #      생략 표기)을 해당 값 필드로 (gpt _IND_NO_H 증류)
    _bare_fld = {"capacitor": "capacitance",
                 "inductor": "inductance"}.get(val.get("part_type"))
    if _bare_fld and _bare_fld not in val and blob:
        m = _RE_BARE_UNIT.search(blob)
        if m:
            put(_bare_fld, m.group().strip(), "text")

    # 5.53) tolerance 문자 코드 — 명시 라벨("Tolerence J")과 저항/커패시터
    #      괄호 세그("(100K/16/J)")의 좁은 문맥만 (EIA 등급 문자 오탐 방지)
    if "tolerance" not in val and blob:
        m = re.search(r"toler[ae]nce\s*[:=]?\s*([FGJKM])\b", blob, re.I)
        if not m and val.get("part_type") in ("resistor", "capacitor"):
            m = re.search(r"/\s*([FGJKM])\s*\)", blob)
        if m:
            put("tolerance", m.group(1), "text")
    if "tolerance" not in val and rescue_text:
        # 구제 열의 명시적 ± 표기("X7R/ ±10%/ 50V")만 — 기호가 있어
        # 오탐이 없는 좁은 형식이라 격리 원칙의 예외로 허용
        m = re.search(r"(?:[±]|\+/-)\s*\d+(?:\.\d+)?\s*[%％]", rescue_text)
        if m:
            put("tolerance", re.sub(r"\s+", "", m.group()), "text")

    # 5.55) manufacturer 사전 폴백 — desc, 그다음 행 전체 텍스트
    if "manufacturer" not in val:
        # 셀 단위 스캔만 — blob(연결 문자열) 선탐색은 다중 벤더 병기 셀
        # ("OSH Park, JLCPCB, PCBWay")의 첫 이름만 잘라 가는 회귀를 만든다
        found = None
        pkg_idx = set(roles.get("package", []))      # CAD명 속 벤더 태그
        for i in range(len(cells)):                  # ("…_AVX-C_Pad…") 배제
            c = cell(i)
            if not c or c.lower().startswith("http"):
                continue
            if i in pkg_idx:
                # 단 셀이 "브랜드_PN" 결합("SAMTEC_QSS-050…" == SAMTEC +
                # 추출 PN)이면 벤더 태그가 아니라 제조사 표기다
                m0 = find_manufacturers_all(c)
                pn0 = str(val.get("part_number", ""))
                if not (m0 and pn0
                        and c.upper() == f"{m0[0]}_{pn0}".upper()):
                    continue
            hits = find_manufacturers_all(c)
            if len(hits) >= 2:
                found = c        # 다중 벤더 병기 셀은 원문 그대로
                break
            if hits:
                # 브랜드 뒤에 바로 숫자가 오는 서술("JST 2 PIN")은 수식어
                tail = c[c.upper().find(hits[0].upper()) + len(hits[0]):]
                if re.match(r"\s+\d", tail):
                    continue
                found = hits[0]
                break
        if found:
            put("manufacturer", found, "text")

    # 5.6) resistor 문맥 저항값 폴백 — bare 숫자("0.02", "470")와
    #      K/M/R 코드("24K", "5R0")는 부류가 확정된 뒤에만 신뢰한다.
    #      페라이트 비드(inductor + "bead")의 R 표기("120R Bead")도 저항값.
    _res_ctx = (val.get("part_type") == "resistor"
                or (val.get("part_type") == "inductor" and blob
                    and re.search(r"\bbead\b", blob, re.I)))
    if _res_ctx and "resistance" not in val:
        if pending_bare_res is not None:
            put("resistance", pending_bare_res, "col")
        elif blob:
            m = (re.search(r"\b\d+(?:\.\d+)?(?:[KM]\d*|m?R\d+|R)\b", blob)
                 or re.search(r"\b\d+\.\d+\b", blob))
            if m and not _RE_PKG_IMP.fullmatch(m.group()):
                put("resistance", m.group(), "text")
    # capacitor 문맥의 EIA 3자리 코드("104") — Specification 열 단독 표기
    if (val.get("part_type") == "capacitor" and "capacitance" not in val
            and pending_bare_res is not None
            and re.fullmatch(r"[1-9]\d{2}", pending_bare_res)):
        put("capacitance", pending_bare_res, "col")
    # 저항값이 이미 있는 행의 bare 4자리는 사이즈 코드("360R/1608/1%")
    if (pending_bare_res is not None and "resistance" in val
            and pkg_value_col is None
            and re.fullmatch(r"(?:0402|0603|0805|1005|1206|1210|1608"
                             r"|2012|2512|3216|3225|4532|5025|6432)",
                             pending_bare_res)):
        pkg_value_col = pending_bare_res

    # 5.7) reference(REFDES) — 지시자 역할 열의 첫 유효 셀 (확장 필드,
    #      VALUE_FIELDS 본선 채점 밖. LLM 검증 대상도 아님 — 열 복사 성격)
    for i in roles.get("designator", []):
        ref = extract_reference(cell(i))
        if ref:
            put("reference", ref, "col")
            break

    # 6) 패키지 — verbatim 열 > C코드 > 열 코드 > 원문 폴백 > 괄호 병기
    #    > value열 > 프리텍스트
    pkg_cell = next((cell(i) for i in roles.get("package", []) if cell(i)), "")
    pkg_cell = pkg_cell.replace("$2F$", "/")   # CAD 익스포트의 '/' 인코딩
    verbatim = _pkg_verbatim(pkg_cell)
    if not verbatim and "/" in pkg_cell:
        # "TQFP-44 10X10 / QFP80P1200X…" — 꼬리가 CAD 풋프린트명뿐이면
        # 첫 세그 병기를 원문으로. 짧은 접미("MT-2.2 /NPH")는 전체 보존.
        segs = [s.strip() for s in pkg_cell.split("/") if s.strip()]
        if len(segs) >= 2 and all(len(s) > 14 or _RE_PKG_CADISH.search(s)
                                  for s in segs[1:]):
            verbatim = _pkg_verbatim(segs[0])
    if verbatim and "_" in verbatim \
            and not _pkg_col_fallback(verbatim):
        verbatim = None   # 값 표기 세그 내장("L_220uH-4A") — 사양 문자열
    col_code = _pkg_from_cell(pkg_cell)
    if col_code:
        col_code = col_code.rstrip("-")   # 절단 잔재("SOD123-") 정리
    if col_code in ("SMD", "DIP") and pkg_cell != col_code:
        col_code = None   # 부류어 잔여가 실장 방식뿐("XTAL_SMD") — 기권.
        #                   열 값 자체가 SMD/DIP인 파일 관례는 그대로 둔다
    if (col_code and col_code == pkg_cell
            and _RE_PKG_CADISH.search(col_code) and blob):
        col_code = None   # CAD 풋프린트명 통짜("SOT95P280X145-6N")는
        #                   설명 열이 있는 시트에서 배척 (폴백과 같은 관례)
    if not col_code and re.fullmatch(r"[A-Z]{2,5}", pkg_cell) \
            and pkg_cell not in ("ANY", "TBD", "NONE", "SMD", "DIP"):
        col_code = pkg_cell  # 패키지 역할 열의 무숫자 코드("USC")
    if (col_code and " " not in pkg_cell and "_" not in pkg_cell
            and "/" not in pkg_cell and "(" not in pkg_cell
            and "=" not in pkg_cell
            and pkg_cell.count("-") <= 1
            and not _PKG_TYPE_PREFIX.match(pkg_cell)
            and col_code != pkg_cell and col_code in pkg_cell
            and len(pkg_cell) <= 14
            and not _RE_PKG_CADISH.search(pkg_cell)
            and _RE_HAS_DIGIT.search(pkg_cell)
            and _RE_HAS_ALPHA.search(pkg_cell)):
        # "2X5-SHROUDED" — 짧은 단일 토큰은 원문 우선. 단 부류 접두
        # ("XTAL/2016", "FUSE-1206")와 CAD형("FP-AC0402-MFG")은 코드 유지
        col_code = pkg_cell
    text_cands = _pkg_candidates(blob) if blob else {}
    text_best = next((text_cands[t] for t in ("c", "slash", "imp", "named",
                                              "size", "pi", "dim")
                      if t in text_cands), None)
    # PN·value 셀의 괄호 병기 — "LT3980IMSE#PBF(MSOP-16)", "MVK50VC4.7M(5X5)"
    paren_best = None
    for i in (*roles.get("part_number", []), *roles.get("value", [])):
        for inner in _RE_PAREN_PKG.findall(cell(i)):
            paren_best = _pkg_paren_code(inner)
            if paren_best:
                break
        if paren_best:
            break
    pkg = None
    if verbatim and "_" not in verbatim:
        pkg = (verbatim, "col")
    elif text_cands.get("c"):
        pkg = (text_cands["c"], "text")
    elif verbatim:                       # '_' 포함 — 풋프린트명일 수 있음
        # 단문자 클래스 접두("D_SOD-123")만 코드 추출 우선 —
        # "ESD0603_B" 같은 일반 '_' 코드는 verbatim 원칙 유지
        if col_code and re.match(r"[DCRLQUJY]_", verbatim, re.I):
            pkg = (col_code, "col")
        else:
            pkg = (text_best, "text") if text_best else (verbatim, "col")
    elif col_code:
        # 열이 긴 CAD명인데 프리텍스트에 짧은 명명 코드가 있으면 후자 우선
        # ("SOT95P237X112-3N" 열 vs 설명의 "SOT23-3")
        named_txt = text_cands.get("named")
        raw_full = (_pkg_col_fallback(pkg_cell, blob)
                    if (col_code != pkg_cell and "_" in pkg_cell
                        and not _RE_PKG_NAMED.fullmatch(col_code)
                        and not _PKG_TYPE_PREFIX.match(pkg_cell)
                        and not re.match(r"[DCRLQUJY]_", pkg_cell, re.I))
                    else None)   # 표준 명명 코드("SOD123")는 원문보다 우선
        if len(col_code) > 12 and named_txt and len(named_txt) <= 10:
            pkg = (named_txt, "text")
        elif raw_full:
            pkg = (raw_full, "col")   # "3x3_23011" — 코드 조각보다 원문
        else:
            pkg = (col_code, "col")
    elif _pkg_col_fallback(pkg_cell, blob):
        pkg = (_pkg_col_fallback(pkg_cell, blob), "col")
    elif paren_best:
        pkg = (paren_best, "col")
    elif pkg_value_col:
        pkg = (pkg_value_col, "col")
    elif text_best:
        pkg = (text_best, "text")
    if (pkg and pkg[1] == "col" and pkg[0] in ("DIP", "SMD") and text_best
            and text_best not in ("DIP", "SMD")):
        # 열 값이 실장 방식 단독(DIP/SMD)인데 사양 텍스트에 구체 표기
        # ("5Pi", 치수, 코드)가 있으면 후자 우선 — 가이드 "구체적·대표 표기"
        pkg = (text_best, "text")
    if pkg and pkg[0]:
        # PN 조각/중복 가드 — 풋프린트 열이 PN을 되풀이하는 파일에서
        # ("12505WR-02" 열 == PN, "IND SRP7050TA"의 토큰 == PN 접두)
        pn_norm = re.sub(r"[^A-Za-z0-9]", "", str(val.get("part_number", ""))).upper()
        cand_norm = re.sub(r"[^A-Za-z0-9]", "", str(pkg[0])).upper()
        pn_head = re.sub(r"[^A-Za-z0-9]", "",
                         str(val.get("part_number", "")).split()[0]).upper() \
            if val.get("part_number") else ""
        # 부류 접두를 벗긴 사본도 비교 — "TRANS_BSC010NE2LSI"·
        # "WIFI_WIZFI360-PA"처럼 부류어+PN 조합 CAD명은 PN 되풀이다
        cand_core = re.sub(r"[^A-Za-z0-9]", "",
                           re.sub(r"^[A-Za-z]{2,6}[-_/]", "",
                                  str(pkg[0]))).upper()
        cand_segs = [re.sub(r"[^A-Za-z0-9]", "", s).upper()
                     for s in re.split(r"[-_/]", str(pkg[0])) if s]
        seg_dup = (len(cand_segs) >= 2   # 다세그 CAD명만 — "NR6028"(단일
                   and any(len(s) >= 6 and pn_norm.startswith(s)  # 시리즈명
                           for s in cand_segs))  # 겸 패키지)은 살린다
        if (pn_norm and (cand_norm == pn_norm or cand_norm == pn_head
                         or (len(pn_norm) >= 8 and cand_core == pn_norm)
                         or (len(pn_norm) >= 8 and seg_dup)
                         or (len(cand_norm) >= 6
                             and pn_norm.endswith(cand_norm))
                         or (len(cand_norm) >= 8
                             and (pn_norm.startswith(cand_norm)
                                  or cand_norm.startswith(pn_norm))))):
            # 동일(중복 열)이거나 8자+ 접두 조각만 거부 — "NR6028"(6자,
            # 시리즈명 겸 패키지)은 살리고 "SRP7050TA"(9자 PN 접두)는 거른다.
            # 거부 시 value 열의 패키지 병기("6.2X6.2")가 있으면 그쪽으로.
            pkg = (pkg_value_col, "col") if pkg_value_col else None
    if pkg:
        put("package", pkg[0], pkg[1])
    if ("package" not in val and blob
            and val.get("part_type") == "diode"):
        # diode 서술의 DO-214 계열 별칭("Schottky, 100 V, 1 A, SMA") —
        # 커넥터 SMA와 겹치므로 부류가 diode로 확정된 행만
        m = re.search(r"\b(SMA|SMB|SMC)\b", blob)
        if m:
            put("package", m.group(1), "text")

    # 6.1) 재작업 파일 관례 — Package 열이 실제 PN("SRR1260-331K")인 경우.
    #      PN성 두문 + 값 코드 꼬리의 단독 토큰만, PN이 아직 없을 때 승격
    #      (소수점·'_'·CAD명은 치수/풋프린트 표기이므로 제외)
    if "part_number" not in val and pkg_cell and "." not in pkg_cell \
            and "_" not in pkg_cell and " " not in pkg_cell:
        h = pkg_cell.split("-")[0]
        if (len(h) >= 7 and _RE_HAS_DIGIT.search(h)
                and _RE_HAS_ALPHA.search(h)
                and not _RE_PKG_CADISH.search(pkg_cell)
                and _looks_like_pn(pkg_cell) and not _pn_reject(pkg_cell)
                and (not pkg or pkg[0] != pkg_cell)):
            put("part_number", pkg_cell, "col")

    if set(val) == {"quantity"}:
        # 수량 하나뿐인 행(비BOM 통계 시트의 "On count" 등) — 역할 열에
        # 부품성 텍스트가 하나도 없으면 수량도 의미가 없다. 텍스트가
        # 있는 행("Standoff screw"/M2.5 + Qty)은 미해석 부품이므로 유지.
        has_texty = any(
            cell(i) and not re.fullmatch(r"[\d.,\s-]+", cell(i))
            for role, idxs in roles.items()
            if role not in ("quantity", "ignore", "_qty_neg")
            for i in idxs)
        if not has_texty:
            val.pop("quantity")
            src.pop("quantity", None)

    return RowAttrs(row_id=row_id, **val), src


_RE_DESIG_CELL = re.compile(  # "R1", "C1, C5", "U$3", "R5-R11"
    r"^[A-Za-z]{1,4}\$?\d+(?:\s*[,/~\-]\s*[A-Za-z]{0,4}\$?\d+)*$")
_RE_PURE_NUM = re.compile(r"^[\d,.]+$")


def extract_pn_token(text: str) -> Optional[str]:
    """프리텍스트에서 PN 토큰 최후 추출 — "DIODE 1N4004",
    "503 / 온도센서 (RB503H4060F07)". 괄호·구두점을 벗긴 토큰 중
    영숫자 혼합(숫자≥2·글자≥2)·len≥6이고 값/패키지/지시자가 아닌 것."""
    best = None
    for raw in re.split(r"[\s|,]+", text):
        tok = raw.strip("()[]{}:;,")
        if len(tok) < 6 or not _pn_token_like(tok):
            continue
        if all(re.fullmatch(r"\d+(?:\.\d+)?(?:mm|mils?|cm)?", s, re.I)
               for s in tok.split("/") if s):
            continue   # 치수 나열("1.27mm/0.5/50mil")은 PN이 아니다
        digits = sum(ch.isdigit() for ch in tok)
        letters = sum(ch.isalpha() for ch in tok)
        if (digits < 2 or letters < 2) and not re.fullmatch(
                r"\d[NAP]\d{3,4}[A-Z]{0,3}", tok, re.I):  # JEDEC "1N4004"
            continue
        if best is None or len(tok) > len(best):
            best = tok
    return best


def _pn_token_like(c: str) -> bool:
    """내용 기반 열 추론용 — 이 셀이 part number 토큰으로 보이는가."""
    if len(c) < 5 or " " in c or c.lower().startswith("http"):
        return False
    if c.lower() in _MFR_PLACEHOLDER or _RE_PURE_NUM.match(c):
        return False
    if _RE_DESIG_CELL.match(c):
        return False
    if any(p.fullmatch(c) for _, p in _GRAMMAR) or _RE_RES_CODE.match(c):
        return False
    if _RE_PKG_C.fullmatch(c) or _RE_PKG_NAMED.fullmatch(c) \
            or _RE_PKG_IMP.fullmatch(c):
        return False
    return _looks_like_pn(c) and not _pn_reject(c)


def _value_token_like(c: str) -> bool:
    return bool(any(p.fullmatch(c) for _, p in _GRAMMAR)
                or _RE_RES_CODE.match(c))


_RE_PKG_PREFIX_CODE = re.compile(r"^[A-Z]{1,2}\d{4}$")   # CD2012, CR2012


def _pkg_cell_like(c: str) -> bool:
    """이 셀이 패키지 코드 표기로 보이는가 (내용 기반 열 추론용)."""
    return bool(_RE_PKG_C.fullmatch(c) or _RE_PKG_NAMED.fullmatch(c)
                or _RE_PKG_IMP.fullmatch(c) or _RE_PKG_SLASH.fullmatch(c)
                or _RE_PKG_PREFIX_CODE.fullmatch(c)
                or _find_dim(c, strict=False) == c)


def infer_column_roles(roles: Dict[str, List[int]], labels: List[str],
                       rows: List[dict]) -> None:
    """라벨로 못 알아본 열을 셀 내용으로 판별한다 — PN형 토큰 다수면
    part_number, 값 표기(+PN 혼합) 다수면 value(이중성 처리 내장),
    지시자 다수면 designator. 라벨 시노님이 커버 못 하는 현장 표기
    ("자재코드", "P/No." 변형 등)의 일반 해법."""
    def col_vals(i):
        return [str(r["cells"][i]).strip() for r in rows
                if i < len(r["cells"]) and str(r["cells"][i] or "").strip()]

    mapped = {i for role, idxs in roles.items() if role != "ignore"
              for i in idxs}
    for i in range(len(labels)):
        if i in mapped:
            continue
        if _DIST_PAT.search(_norm_label(labels[i])):
            continue   # 유통 코드 열("N° Mouser")은 내용이 PN형이어도
            #            제조사 PN이 아니다 — 승격 금지
        vals = col_vals(i)
        if len(vals) < 3:
            continue
        n = len(vals)
        desig = sum(1 for v in vals if _RE_DESIG_CELL.match(v)
                    and not _RE_LCSC_CODE.fullmatch(v)) / n
        pkg = sum(1 for v in vals if _pkg_cell_like(v)) / n
        pn = sum(1 for v in vals if _pn_token_like(v)) / n
        value = sum(1 for v in vals if _value_token_like(v)) / n
        # 패키지 판정을 지시자보다 먼저 — 접두 코드("CD2012")가
        # 지시자 패턴([A-Z]{1,4}+숫자)에도 걸리므로 순서가 정확도를 가른다
        if pkg >= 0.6 and "package" not in roles:
            # 명시 패키지 열이 없는 파일에서 코드형("CD2012","TSSOP-20") 열
            roles.setdefault("package", []).append(i)
        elif desig >= 0.6:
            roles.setdefault("designator", []).append(i)
        elif pn >= 0.6 and value < 0.2:
            roles.setdefault("part_number", []).append(i)
        elif value + pn >= 0.6 and value > 0:
            roles.setdefault("value", []).append(i)
        elif "quantity" not in roles and (
                "part_number" in roles or "designator" in roles
                or "value" in roles):
            # 라벨 없는 소정수 열 → quantity (gpt 값-프로파일 역할 학습의
            # 규칙 근사). 단조 증가 수열(No./Index 열)은 제외하고, BOM
            # 신호(PN/지시자/값 열)가 있는 시트에서만 — 수치 시트(벤치마크
            # 데이터 등)에서의 수량 환각 방지.
            ints = [int(v) for v in vals if re.fullmatch(r"\d{1,3}", v)]
            if (len(ints) / n >= 0.8 and max(ints, default=0) <= 200
                    and ints != sorted(set(ints))):
                roles.setdefault("quantity", []).append(i)

    # 'device'/'Part' 라벨이 실제로는 지시자 열인 파일 (BD_BOM: "R5-R11",
    # "c4-c6, c8") — 내용이 지시자 일색이면 designator로 재배치
    for i in list(roles.get("value", [])):
        vals = col_vals(i)
        if len(vals) < 3:
            continue
        desig = sum(1 for v in vals if _RE_DESIG_CELL.match(v)
                    and not _pkg_cell_like(v)
                    and not _RE_LCSC_CODE.fullmatch(v)) / len(vals)
        if desig >= 0.7:
            roles["value"].remove(i)
            roles.setdefault("designator", []).append(i)

    # 'PartType'/'Type' 열의 이중성 — Altium류 export는 이 열에 부품명/PN
    # 또는 값("10K")을 담는다. 타입 키워드 히트가 낮고 PN/값형이 많으면
    # value(이중 처리)로 강등.
    for i in list(roles.get("part_type", [])):
        vals = col_vals(i)
        if len(vals) < 3:
            continue
        n = len(vals)
        pn = sum(1 for v in vals if _pn_token_like(v)) / n
        value = sum(1 for v in vals if _value_token_like(v)) / n
        typed = sum(1 for v in vals if infer_part_type(v)) / n
        if (pn >= 0.5 or value >= 0.5 or pn + value >= 0.6) and typed < 0.3:
            roles["part_type"].remove(i)
            roles.setdefault("value", []).append(i)

    # Manufacturer 열이 복수인데 한쪽이 PN형 다수면(다단 헤더 병합 부작용 —
    # "Manufacturer"/"Manufacturer Part Number") 그 열은 part_number로 재배치.
    mfr_cols = roles.get("manufacturer", [])
    if len(mfr_cols) > 1:
        for i in list(mfr_cols):
            vals = col_vals(i)
            if len(vals) >= 3 and sum(
                    1 for v in vals if _pn_token_like(v)) / len(vals) >= 0.5:
                mfr_cols.remove(i)
                roles.setdefault("part_number", []).insert(0, i)


def compute_roles(case: dict) -> Dict[str, List[int]]:
    """케이스의 최종 열 역할 계산 — extract_case의 프렐류드를 분리한 것.

    (SMARTBOM 웹 이식: 어댑터가 headers[]/value_raw/근거 탐색에 동일한
    역할 맵을 써야 해서 분리했다. 로직은 원본 extract_case와 바이트 동일.)
    """
    roles = classify_columns(case["header_labels"])
    # 라벨이 빈 열이라도 셀 다수가 공백 포함 긴 텍스트면 Description으로 편입
    # (실측: OTE 계열은 상세 서술이 무제목 열에 있다)
    labels = case["header_labels"]
    rows = case["rows"]

    def _texty_col(i) -> bool:
        vals = [str(r["cells"][i]).strip() for r in rows
                if i < len(r["cells"]) and str(r["cells"][i] or "").strip()]
        vals = [v for v in vals if not v.lower().startswith("http")]
        texty = [v for v in vals
                 if " " in v and len(v) > 6 and _RE_HAS_ALPHA.search(v)]
        return bool(vals) and len(texty) >= max(2, len(vals) // 2)

    for i, lab in enumerate(labels):
        if not _norm_label(lab) and _texty_col(i):
            roles.setdefault("_unlabeled_text", []).append(i)
    infer_column_roles(roles, labels, rows)
    # Altium류 BOM은 Comment와 Value를 모두 값 열로 쓰지만, Comment에는
    # "C=1005" 같은 풋프린트 메모가, Value에는 실제 MPN/전기값이 놓이는
    # 경우가 많다. 명시적인 Value를 먼저 해석하고 나머지는 보조 근거로 쓴다.
    if roles.get("value"):
        roles["value"].sort(
            key=lambda i: (0 if _norm_label(labels[i]) == "value" else 1, i)
        )
    # 역할 추론까지 끝난 뒤에도 ignore로 남은 서술형 열만 구제한다 ("Item"
    # 라벨 오폭의 "JST 2 PIN" 류). 지시자/PN 열을 선점하지 않도록 추론 이후,
    # 값 문법·PN 오염을 막도록 타입/설명 추론 전용(_rescued_text)으로 격리.
    mapped = {i for role, idxs in roles.items()
              if role != "ignore" for i in idxs}
    for i in roles.get("ignore", []):
        if i in mapped or _DIST_PAT.search(_norm_label(labels[i])):
            continue
        if _texty_col(i):
            roles.setdefault("_rescued_text", []).append(i)
    return roles


def extract_case(case: dict, roles: Optional[Dict[str, List[int]]] = None,
                 ) -> Tuple[Dict[int, RowAttrs], Dict[int, Dict[str, str]]]:
    if roles is None:
        roles = compute_roles(case)
    preds, sources = {}, {}
    for row in case["rows"]:
        attrs, src = extract_row(case["header_labels"], roles,
                                 row["cells"], row["row_id"])
        preds[row["row_id"]] = attrs
        sources[row["row_id"]] = src
    return preds, sources
