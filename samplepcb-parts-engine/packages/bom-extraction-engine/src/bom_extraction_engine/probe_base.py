# -*- coding: utf-8 -*-
"""헤더 탐지 결과 타입.

원본 header_probing_claude/probe_base.py에서 프로덕션에 필요한
ProbeResult만 남겼다 — 벤치마크용 프로버 골격(LexiconProber)과 스캔
유틸은 fusion.py가 자체 구현을 쓰므로 제거했다.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class ProbeResult:
    found: bool
    header_row: Optional[int]          # 0-based, 못 찾으면 None
    confidence: float
    candidates: List[Tuple[int, float]] = field(default_factory=list)
    column_map: Dict[int, dict] = field(default_factory=dict)
    reason: str = ""
