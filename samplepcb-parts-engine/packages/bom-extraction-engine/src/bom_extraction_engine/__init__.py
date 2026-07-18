# -*- coding: utf-8 -*-
"""SMARTBOM 추출 엔진 — bom_probing_claude 규칙 파이프라인의 웹 이식.

헤더 탐지(fusion) → 규칙 추출(rule_extractor) → G-shape 어댑터(adapter).
공급사 검색·LLM 검증은 포함하지 않는다 (추출 전용).
"""
from .engine import (PARSER_VERSION, SCHEMA_VERSION, SmartbomConfig,
                     build_smartbom_result)

__all__ = ["PARSER_VERSION", "SCHEMA_VERSION", "SmartbomConfig",
           "build_smartbom_result"]
