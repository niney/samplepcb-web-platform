# -*- coding: utf-8 -*-
"""SMARTBOM 추출 엔진 — bom_probing_claude 규칙 파이프라인의 웹 이식.

헤더 탐지(fusion) → 규칙 추출(rule_extractor) → G-shape 어댑터(adapter).
공급사 검색·LLM 검증은 포함하지 않는다 (추출 전용).

협력사 재고표는 의미가 반대라(재고·단가가 정보, 보드당 수량이 아님) 같은
파이프라인을 쓰지 않고 `inventory` 프로필로 분리했다.
"""
from .engine import (PARSER_VERSION, SCHEMA_VERSION, SmartbomConfig,
                     build_smartbom_result)
from .inventory import (INVENTORY_PARSER_VERSION, INVENTORY_SCHEMA_VERSION,
                        InventoryConfig, build_inventory_result)

__all__ = ["PARSER_VERSION", "SCHEMA_VERSION", "SmartbomConfig",
           "build_smartbom_result", "INVENTORY_PARSER_VERSION",
           "INVENTORY_SCHEMA_VERSION", "InventoryConfig",
           "build_inventory_result"]
