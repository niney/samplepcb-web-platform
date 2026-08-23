"""협력사 보유 부품 주입(docs/PARTNER_PARTS.md) — 로컬 소스의 계약.

설계 결정(2026-08-23): 협력사 부품은 **별도 폴백 티어가 아니라 기존 공급사와 같은
자리에서 경쟁하되 뒤순위**다. 그래서 지켜야 할 것이 셋이다.
  ① 외부 후보와 **같은 매처·조달 정책**을 탄다(별도 판정 경로를 만들지 않는다).
  ② 기술 판정이 동률이면 **실공급사가 앞선다** — 공급사 문자열 알파벳순에 기대면
     'partner' 가 'unikeyic' 을 앞질러 버리므로 명시 소스 순위가 필요하다.
  ③ 외부 호출·캐시·trace 를 **오염시키지 않는다**(api_calls 는 그대로 0 이어야 한다).
"""
from __future__ import annotations

import pytest

from supplier_search_engine.models import (
    CatalogProductMetadata,
    CatalogSupplier,
    MatchRelation,
    PlannedQuery,
    SearchMode,
    Supplier,
    SupplierOffer,
    SupplierProduct,
)
from supplier_search_engine.service import (
    SearchService,
    _local_products_for,
    _source_rank,
    normalize_local_product_key,
)
from supplier_search_engine.settings import Settings


def _query(part_number: str | None = "STM32F030F4P6") -> PlannedQuery:
    return PlannedQuery(
        component_id="c1",
        mode=SearchMode.IDENTITY if part_number else SearchMode.PARAMETRIC,
        part_number=part_number,
        manufacturer="ST",
        part_type=None,
        requirements={},
    )


def _partner_product(
    mpn: str = "STM32F030F4P6",
    manufacturer: str | None = "ST",
    *,
    partner_id: int = 7,
    stock: int | None = 1200,
) -> SupplierProduct:
    return SupplierProduct(
        supplier=CatalogSupplier.PARTNER,
        manufacturer_part_number=mpn,
        manufacturer=manufacturer,
        normalized_specs={},
        catalog_metadata=CatalogProductMetadata(
            catalogOnly=True,
            autoQuoteEligible=manufacturer is not None,
            apiVerificationRequired=False,
            partnerId=partner_id,
            partnerStockQty=stock,
        ),
        offers=[],
    )


def _supplier_product(supplier: Supplier, mpn: str = "STM32F030F4P6") -> SupplierProduct:
    return SupplierProduct(
        supplier=supplier,
        manufacturer_part_number=mpn,
        manufacturer="ST",
        normalized_specs={},
        offers=[SupplierOffer(supplier=supplier, supplier_sku="SKU-1")],
    )


def test_source_rank_puts_partner_behind_every_real_supplier():
    for supplier in Supplier:
        assert _source_rank(supplier) < _source_rank(CatalogSupplier.PARTNER)
    # 로컬 카탈로그(samplepcb 등)보다도 뒤 — 값이 확인된 순서대로.
    assert _source_rank(CatalogSupplier.SAMPLEPCB) < _source_rank(CatalogSupplier.PARTNER)
    # 알파벳순에 기대면 'partner' < 'unikeyic' 이라 앞서 버린다(이 키가 존재하는 이유).
    assert CatalogSupplier.PARTNER.value < Supplier.UNIKEYIC.value


def test_injection_key_matches_sp_node_normalize_mpn():
    # sp-node normalizeMpn: NFKC → 대문자 → [0-9A-Z] 만.
    assert normalize_local_product_key("pca9575pw2, 118") == "PCA9575PW2118"
    assert normalize_local_product_key("DS1307Z+T&R") == "DS1307ZTR"
    assert normalize_local_product_key("  stm32f030f4p6 ") == "STM32F030F4P6"
    assert normalize_local_product_key(None) == ""


def test_lookup_only_binds_to_exact_part_number_queries():
    products = {"STM32F030F4P6": [_partner_product()]}

    assert _local_products_for(products, _query()) == tuple(products["STM32F030F4P6"])
    # 품번 없는 스펙 검색에는 붙지 않는다 — 협력사 주장에 스펙 호환 판정을 기대지 않는다.
    assert _local_products_for(products, _query(None)) == ()
    # 다른 품번이면 걸리지 않는다.
    assert _local_products_for(products, _query("LM358D")) == ()
    assert _local_products_for({}, _query()) == ()


@pytest.mark.asyncio
async def test_partner_candidate_is_evaluated_by_the_same_matcher_and_sorts_last(tmp_path):
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[])
    query = _query()
    candidates, _decision, _omitted = service._evaluate_supplier_candidates(
        query,
        [],
        procurement_policy=_policy(),
        extra_products=[
            _partner_product(),
            _supplier_product(Supplier.UNIKEYIC),
        ],
    )
    candidates.sort(key=lambda candidate: service._candidate_sort_key(candidate, query))

    # ① 같은 매처를 탔다 — 정확 품번이라 관계 판정이 exact 로 나온다.
    by_supplier = {candidate.product.supplier: candidate for candidate in candidates}
    assert by_supplier[CatalogSupplier.PARTNER].decision.match_relation == MatchRelation.EXACT
    # ② 동률이면 실공급사가 앞선다.
    assert candidates[0].product.supplier == Supplier.UNIKEYIC
    assert candidates[-1].product.supplier == CatalogSupplier.PARTNER


@pytest.mark.asyncio
async def test_partner_candidate_never_creates_a_purchasable_offer(tmp_path):
    """가격은 견적요청 회신이 정본 — 주입 후보는 구매 조건을 만들지 않는다."""
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[])
    query = _query()
    candidates, decision, _omitted = service._evaluate_supplier_candidates(
        query,
        [],
        procurement_policy=_policy(),
        extra_products=[_partner_product()],
    )

    assert len(candidates) == 1
    assert candidates[0].product.offers == []
    # 구매 조건이 없으므로 어떤 자동 선정도 금액을 만들지 못한다.
    assert decision.automatic_offer_key is None
    assert decision.review_offer_key is None


@pytest.mark.asyncio
async def test_replacement_fallback_keeps_the_partner_candidate(tmp_path):
    """대체 폴백이 협력사 후보를 지우면 안 된다 (2026-08-23 실검색에서 잡힌 결함).

    협력사 보유 부품은 **가격을 만들지 않는다**. 그래서 조달 판정이 늘 `no_offer` 가 되고,
    그 순간 "구매 가능한 조건이 없다"며 대체 폴백이 켜진다. 폴백 병합은 후보를
    `supplier_results` 로 다시 계산하는데 로컬 소스는 그 바깥에 살기 때문에, 넘겨주지 않으면
    **1차에서 분명히 잡혔던 협력사 후보가 통째로 사라진다** — 아무도 안 가진 희귀 품번,
    즉 협력사 원장이 유일한 근거인 자리에서 정확히 그렇게 됐다.
    """
    service = SearchService(Settings(cache_path=tmp_path / "cache.sqlite3"), clients=[])
    # 수량이 있어야 조달 판정이 '구매 조건 없음'까지 간다 — 실제 BOM 행은 늘 수량이 있다.
    query = _query().model_copy(update={"quantity": 10})
    primary_only_partner, decision, _omitted = service._evaluate_supplier_candidates(
        query,
        [],
        procurement_policy=_policy(),
        extra_products=[_partner_product()],
    )
    # 전제 — 1차에서는 잡힌다. 그리고 가격이 없어 폴백 조건(no_offer)이 성립한다.
    assert len(primary_only_partner) == 1
    assert decision.status == "no_recommendation"

    merged = service._merge_procurement_replacement_fallback(
        query,
        _empty_result(query),
        query,
        _empty_result(query),
        _policy(),
        local_products=[_partner_product()],
    )
    assert [c.product.supplier for c in merged.candidates] == [CatalogSupplier.PARTNER]


def _empty_result(query: PlannedQuery):
    from supplier_search_engine.models import ComponentSearchResult, MatchStatus

    return ComponentSearchResult(
        component_id=query.component_id,
        mode=query.mode,
        status=MatchStatus.NOT_FOUND,
        query=query,
        candidates=[],
        supplier_results=[],
    )


def _policy():
    from supplier_search_engine.models import ProcurementPolicyInput

    return ProcurementPolicyInput()
