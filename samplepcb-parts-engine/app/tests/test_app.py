"""app 계층 엔드투엔드 — 업로드→파싱→결과 표시 경로를 실제로 구동한다.

공급사 검색은 실 API 키/네트워크가 필요해 여기서 라이브로 돌리지 않는다
(엔드포인트 계약/게이팅만 확인). 추출 경로는 인라인 CSV로 완전 검증.
"""

from __future__ import annotations

from copy import deepcopy
import time

from fastapi.testclient import TestClient

from parts_engine_app.config import Config
from parts_engine_app.jobs import Job, JobService, SupplierSearchOptions
from parts_engine_app.main import create_app
from supplier_search_engine.contract import build_batch_from_result
from supplier_search_engine.matcher import CandidateMatcher, finalize_candidate_decisions
from supplier_search_engine.models import (
    BatchSearchResult,
    ComponentSearchResult,
    MatchStatus,
    PlannedQuery,
    ProcurementPolicyInput,
    SearchMode,
    Supplier,
    SupplierOffer,
    SupplierProduct,
    SupplierSearchResult,
)
from supplier_search_engine.service import SearchService

_CSV = (
    "No,Part Number,Manufacturer,Qty,Reference\n"
    "1,RC0402FR-0710KL,Yageo,100,R1 R2\n"
    "2,GRM155R71C104KA88D,Murata,50,C1\n"
    "3,LQG15HS10NJ02D,Murata,20,L1\n"
)


def _client(tmp_path) -> TestClient:
    config = Config(
        data_dir=tmp_path,
        m2v_path="off",  # 오프라인·임베딩 폴백 비활성 → 사전만으로 헤더 탐지
        component_limit=5000,
        max_upload_bytes=30 * 1024 * 1024,
        supplier_max_calls=700,
    )
    config.uploads_dir.mkdir(parents=True, exist_ok=True)
    return TestClient(create_app(config))


def _await_completed(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/jobs/{job_id}").json()
        if body["status"] in ("completed", "failed"):
            return body
        time.sleep(0.05)
    raise AssertionError("job did not finish in time")


def test_health(tmp_path):
    assert _client(tmp_path).get("/health").json() == {"status": "ok"}


def test_capabilities_exposes_limits_without_supplier_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("DIGIKEY_CLIENT_ID", "digikey-client-secret-value")
    monkeypatch.setenv("DIGIKEY_CLIENT_SECRET", "digikey-secret-value")
    monkeypatch.setenv("MOUSER_API_KEY", "mouser-secret-value")
    monkeypatch.delenv("UNIKEYIC_API_KEY", raising=False)

    body = _client(tmp_path).get("/capabilities").json()

    assert body["supplier_search"]["max_calls_per_job"] == 700
    assert body["supplier_search"]["cache"]["mode"] == "normal"
    assert body["supplier_search"]["cache"]["entry_count"] == 0
    assert body["supplier_search"]["suppliers"] == [
        {"supplier": "digikey", "configured": True},
        {"supplier": "mouser", "configured": True},
        {"supplier": "unikeyic", "configured": False},
    ]
    serialized = str(body)
    assert "digikey-client-secret-value" not in serialized
    assert "digikey-secret-value" not in serialized
    assert "mouser-secret-value" not in serialized


def test_upload_parse_and_display(tmp_path):
    client = _client(tmp_path)
    resp = client.post(
        "/jobs",
        files={"file": ("bom.csv", _CSV, "text/csv")},
        data={"engine": "smartbom"},
    )
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]

    view = _await_completed(client, job_id)
    assert view["status"] == "completed", view
    assert view["result_available"] is True

    result = client.get(f"/jobs/{job_id}/result")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["engine"] == "smartbom"  # 계약 식별자 보존 확인
    assert body["summary"]["component_count"] >= 3
    pns = {c.get("part_number") for c in body["components"]}
    assert "RC0402FR-0710KL" in pns


def test_unsupported_extension_rejected(tmp_path):
    client = _client(tmp_path)
    resp = client.post("/jobs", files={"file": ("bom.txt", b"x", "text/plain")})
    assert resp.status_code == 400
    assert "unsupported_extension" in resp.json()["detail"]


def test_result_before_ready_conflicts(tmp_path):
    client = _client(tmp_path)
    assert client.get("/jobs/does-not-exist").status_code == 404
    assert client.get("/jobs/does-not-exist/result").status_code == 404


def test_supplier_preflight_requires_completed_analysis_and_does_not_call_api(tmp_path):
    client = _client(tmp_path)
    upload = client.post(
        "/jobs",
        files={"file": ("bom.csv", _CSV, "text/csv")},
        data={"engine": "smartbom"},
    )
    assert upload.status_code == 202, upload.text
    job_id = upload.json()["job_id"]
    assert _await_completed(client, job_id)["status"] == "completed"

    response = client.post(
        f"/jobs/{job_id}/supplier-search/preflight",
        json={"max_calls": 5, "cache_only": True, "reset_cache": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["analysis_job_id"] == job_id
    assert body["plan"]["component_count"] >= 3
    assert body["plan"]["cache_only"] is True
    assert body["plan"]["estimated_api_calls"] == 0


def test_supplier_job_accepts_persisted_analysis_without_parse_job_dependency(tmp_path):
    client = _client(tmp_path)
    upload = client.post(
        "/jobs",
        files={"file": ("bom.csv", _CSV, "text/csv")},
        data={"engine": "smartbom"},
    )
    parse_job_id = upload.json()["job_id"]
    assert _await_completed(client, parse_job_id)["status"] == "completed"
    analysis = client.get(f"/jobs/{parse_job_id}/result").json()
    analysis["future_engine_field"] = {"preserved": True}

    created = client.post("/supplier-jobs", json={"analysis": analysis})
    assert created.status_code == 201, created.text
    supplier_job_id = created.json()["job_id"]
    assert supplier_job_id != parse_job_id
    assert created.json()["status"] == "completed"

    stored = client.get(f"/jobs/{supplier_job_id}/result")
    assert stored.status_code == 200, stored.text
    assert stored.json()["future_engine_field"] == {"preserved": True}

    preflight = client.post(
        f"/jobs/{supplier_job_id}/supplier-search/preflight",
        json={"max_calls": 5, "cache_only": True, "reset_cache": False},
    )
    assert preflight.status_code == 200, preflight.text
    assert preflight.json()["analysis_job_id"] == supplier_job_id
    assert preflight.json()["plan"]["component_count"] >= 3


def test_persisted_quantities_and_procurement_policy_reach_same_search_batch(tmp_path):
    client = _client(tmp_path)
    upload = client.post(
        "/jobs",
        files={"file": ("bom.csv", _CSV, "text/csv")},
        data={"engine": "smartbom"},
    )
    parse_job_id = upload.json()["job_id"]
    assert _await_completed(client, parse_job_id)["status"] == "completed"
    analysis = client.get(f"/jobs/{parse_job_id}/result").json()
    analysis["components"][0]["quantity_resolution"] = "verified"
    analysis["components"][0]["procurement_disposition"] = "eligible"
    analysis["components"][0]["disposition_reason_codes"] = []
    component_id = build_batch_from_result(analysis).components[0].component_id
    created = client.post(
        "/supplier-jobs",
        json={"analysis": analysis, "required_quantities": {component_id: 321}},
    )
    supplier_job = client.app.state.jobs.get(created.json()["job_id"])
    policy = ProcurementPolicyInput(
        currency_rate_snapshot_id="test-snapshot",
        currency_rate_source="pytest",
    )
    options = SupplierSearchOptions(max_calls=5, procurement_policy=policy)

    preflight_batch = client.app.state.jobs._supplier_batch(supplier_job, options)
    search_batch = client.app.state.jobs._supplier_batch(supplier_job, options)

    assert preflight_batch == search_batch
    assert preflight_batch.components[0].required_quantity == 321
    assert preflight_batch.procurement_policy.currency_rate_snapshot_id == (
        "test-snapshot"
    )


def test_persisted_quantity_does_not_override_engine_quantity_conflict(tmp_path):
    client = _client(tmp_path)
    upload = client.post(
        "/jobs",
        files={"file": ("bom.csv", _CSV, "text/csv")},
        data={"engine": "smartbom"},
    )
    parse_job_id = upload.json()["job_id"]
    assert _await_completed(client, parse_job_id)["status"] == "completed"
    analysis = client.get(f"/jobs/{parse_job_id}/result").json()
    component = analysis["components"][0]
    component["quantity_resolution"] = "conflict"
    component["procurement_disposition"] = "quantity_confirmation_required"
    component["disposition_reason_codes"] = ["quantity_reference_conflict"]
    component_id = build_batch_from_result(analysis).components[0].component_id

    created = client.post(
        "/supplier-jobs",
        json={"analysis": analysis, "required_quantities": {component_id: 321}},
    )
    supplier_job = client.app.state.jobs.get(created.json()["job_id"])
    batch = client.app.state.jobs._supplier_batch(
        supplier_job,
        SupplierSearchOptions(max_calls=5),
    )

    assert batch.components[0].required_quantity is None
    assert batch.components[0].quantity_resolution.value == "conflict"
    assert (
        batch.components[0].procurement_disposition.value
        == "quantity_confirmation_required"
    )


def _procurement_request() -> dict:
    query = PlannedQuery(
        component_id="api-component",
        mode=SearchMode.IDENTITY,
        part_number="ABC123",
        manufacturer="Acme",
        part_type="resistor",
        quantity=10,
    )
    product = SupplierProduct(
        supplier=Supplier.DIGIKEY,
        supplier_product_id="digikey-product-1",
        manufacturer_part_number="ABC123",
        manufacturer="Acme",
        offers=[
            SupplierOffer(
                supplier=Supplier.DIGIKEY,
                supplier_sku="ABC123-DK",
                stock=1_000,
                moq=1,
                order_multiple=1,
                price_breaks=[
                    {"quantity": 1, "unit_price": 10, "currency": "KRW"},
                    {"quantity": 100, "unit_price": 8, "currency": "KRW"},
                ],
            )
        ],
    )
    matcher = CandidateMatcher()
    candidates = finalize_candidate_decisions(
        query,
        [matcher.evaluate(query, product)],
    )
    candidates = SearchService._add_corroboration(candidates)
    candidates = SearchService._assign_technical_review_ranks(query, candidates)
    candidates = SearchService._assign_selection_recommendations(candidates, query)
    return {
        "contract_version": "supplier-procurement-reevaluation-v1",
        "component_id": query.component_id,
        "candidates": [candidate.model_dump(mode="json") for candidate in candidates],
        "required_quantity": 150,
        "procurement_policy": {
            "procurement_policy_version": "supplier-procurement-decision-v1",
            "target_currency": "KRW",
            "currency_rates": [],
            "currency_rate_snapshot_id": "fixture-2026-07-21",
            "currency_rate_as_of": "2026-07-21T00:00:00+09:00",
            "currency_rate_source": "pytest",
            "allowed_suppliers": ["digikey"],
        },
    }


def test_procurement_reevaluation_api_is_deterministic_and_fails_closed(tmp_path):
    client = _client(tmp_path)
    payload = _procurement_request()

    first = client.post("/supplier-search/procurement/reevaluate", json=payload)
    second = client.post("/supplier-search/procurement/reevaluate", json=payload)

    assert first.status_code == 200, first.text
    assert first.json() == second.json()
    result = first.json()
    offer = result["candidates"][0]["product"]["offers"][0]
    assert offer["procurement_decision"]["order_quantity"] == 150
    assert offer["procurement_decision"]["recommendation"] == "automatic"
    assert result["procurement_decision"]["status"] == "automatic_recommended"
    assert (
        result["procurement_decision"]["selection_application_state"]
        == "automatic_selected"
    )
    assert result["procurement_decision"]["confirmation_required"] is False
    assert (
        result["procurement_decision"]["application_candidate_identity_key"]
        == result["procurement_decision"]["technical_preselection_identity_key"]
    )
    assert result["procurement_decision"]["technical_fallback_used"] is False

    duplicate = deepcopy(payload)
    duplicate_offer = deepcopy(duplicate["candidates"][0]["product"]["offers"][0])
    duplicate["candidates"][0]["product"]["offers"].append(duplicate_offer)
    collapsed = client.post(
        "/supplier-search/procurement/reevaluate",
        json=duplicate,
    )
    assert collapsed.status_code == 200
    assert len(collapsed.json()["candidates"][0]["product"]["offers"]) == 1

    conflicting = deepcopy(duplicate)
    conflicting["candidates"][0]["product"]["offers"][1]["stock"] = 1
    rejected = client.post(
        "/supplier-search/procurement/reevaluate",
        json=conflicting,
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "duplicate_offer_key"
    assert rejected.json()["detail"]["context"]["duplicate_policy"] == (
        "fail_closed_conflict"
    )


def test_procurement_reevaluation_batch_api_isolates_component_failures(tmp_path):
    """sp-node 자동저장이 청크 단위로 던지는 벌크 재평가 — 한 컴포넌트 실패가 나머지를 막지 않는다."""
    client = _client(tmp_path)
    base = _procurement_request()

    broken_candidates = [base["candidates"][0], deepcopy(base["candidates"][0])]
    broken_candidates[1]["product"]["offers"][0]["stock"] = 1
    batch_payload = {
        "contract_version": "supplier-procurement-reevaluation-batch-v1",
        "procurement_policy": base["procurement_policy"],
        "components": [
            {
                "component_id": "batch-ok-1",
                "candidates": base["candidates"],
                "required_quantity": base["required_quantity"],
            },
            {
                "component_id": "batch-ok-2",
                "candidates": base["candidates"],
                "required_quantity": base["required_quantity"],
            },
            {
                "component_id": "batch-broken",
                "candidates": broken_candidates,
                "required_quantity": base["required_quantity"],
            },
        ],
    }

    response = client.post("/supplier-search/procurement/reevaluate-batch", json=batch_payload)
    assert response.status_code == 200, response.text
    by_id = {item["component_id"]: item for item in response.json()["components"]}

    assert by_id["batch-ok-1"]["status"] == "ok"
    assert by_id["batch-ok-1"]["procurement_decision"]["status"] == "automatic_recommended"
    assert by_id["batch-ok-2"]["status"] == "ok"
    assert by_id["batch-broken"]["status"] == "error"
    assert by_id["batch-broken"]["error_code"] == "duplicate_offer_key"
    assert by_id["batch-broken"]["candidates"] is None
    assert by_id["batch-broken"]["procurement_decision"] is None

    # 결정론 — 같은 입력을 다시 보내도 같은 결과(엔진은 상태를 갖지 않는다).
    replay = client.post("/supplier-search/procurement/reevaluate-batch", json=batch_payload)
    assert replay.json() == response.json()


def test_procurement_reevaluation_batch_api_rejects_oversized_batch(tmp_path):
    client = _client(tmp_path)
    base = _procurement_request()
    components = [
        {
            "component_id": f"batch-component-{index}",
            "candidates": base["candidates"],
            "required_quantity": base["required_quantity"],
        }
        for index in range(201)
    ]

    response = client.post(
        "/supplier-search/procurement/reevaluate-batch",
        json={
            "contract_version": "supplier-procurement-reevaluation-batch-v1",
            "procurement_policy": base["procurement_policy"],
            "components": components,
        },
    )
    assert response.status_code == 422


def test_procurement_reevaluation_batch_api_rejects_contract_version_mismatch(tmp_path):
    client = _client(tmp_path)
    base = _procurement_request()

    response = client.post(
        "/supplier-search/procurement/reevaluate-batch",
        json={
            "contract_version": "supplier-procurement-reevaluation-v1",  # 단건 계약 버전 — 배치가 아니다
            "procurement_policy": base["procurement_policy"],
            "components": [
                {
                    "component_id": base["component_id"],
                    "candidates": base["candidates"],
                    "required_quantity": base["required_quantity"],
                }
            ],
        },
    )
    assert response.status_code == 422


def test_supplier_search_rejects_conflicting_cache_modes(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/jobs/missing/supplier-search/preflight",
        json={"max_calls": 10, "cache_only": True, "reset_cache": True},
    )
    assert response.status_code == 422


def test_supplier_search_starts_when_preflight_estimate_exceeds_runtime_budget(
    tmp_path, monkeypatch
):
    service = JobService(
        Config(
            data_dir=tmp_path,
            m2v_path="off",
            component_limit=5000,
            max_upload_bytes=30 * 1024 * 1024,
            supplier_max_calls=700,
        )
    )
    job = Job(
        id="budgeted-job",
        engine="smartbom",
        filename="bom.xlsx",
        upload_path=tmp_path / "bom.xlsx",
        status="completed",
        result={"components": [], "sheets": []},
    )
    service._jobs[job.id] = job
    monkeypatch.setattr(
        service,
        "preflight_supplier",
        lambda _job_id, _options: {
            "plan": {
                "estimated_api_calls": 360,
                "job_call_limit": 300,
                "estimated_within_job_limit": False,
            }
        },
    )
    submitted = []
    monkeypatch.setattr(
        service._executor,
        "submit",
        lambda function, *args: submitted.append((function, args)),
    )

    try:
        started = service.submit_supplier(
            job.id,
            SupplierSearchOptions(max_calls=300),
        )
    finally:
        service.shutdown()

    assert started.supplier_status == "running"
    assert started.supplier_options == SupplierSearchOptions(max_calls=300)
    assert started.supplier_preflight["plan"]["estimated_api_calls"] == 360
    assert len(submitted) == 1


def test_supplier_envelope_counts_identity_and_spec_fallback_attempts(tmp_path):
    service = JobService(
        Config(
            data_dir=tmp_path,
            m2v_path="off",
            component_limit=5000,
            max_upload_bytes=30 * 1024 * 1024,
            supplier_max_calls=700,
        )
    )
    initial_query = PlannedQuery(
        component_id="component-1",
        mode=SearchMode.IDENTITY,
        part_number="0603X03L_C",
        keywords="0603X03L_C",
    )
    fallback_query = PlannedQuery(
        component_id="component-1",
        mode=SearchMode.PARAMETRIC,
        part_type="resistor",
        keywords="1k",
    )
    result = BatchSearchResult(
        source_file="bom.xlsx",
        components=[
            ComponentSearchResult(
                component_id="component-1",
                mode=SearchMode.PARAMETRIC,
                status=MatchStatus.SPEC_COMPATIBLE,
                query=fallback_query,
                initial_query=initial_query,
                initial_supplier_results=[
                    SupplierSearchResult(supplier=Supplier.DIGIKEY, api_calls=1)
                ],
                supplier_results=[
                    SupplierSearchResult(supplier=Supplier.DIGIKEY, api_calls=1)
                ],
                api_calls=2,
            )
        ],
        unique_query_count=1,
        api_calls=2,
        cache_hits=0,
        elapsed_ms=10.0,
    )
    job = Job(
        id="job-1",
        engine="smartbom",
        filename="bom.xlsx",
        upload_path=tmp_path / "bom.xlsx",
        status="completed",
        result={"summary": {"processing_ms": 1.0}},
        supplier_preflight={"preflight_elapsed_ms": 2.0, "plan": {}},
    )

    try:
        envelope = service._supplier_envelope(
            job,
            result,
            cache_entries_cleared=0,
            cache_reset_elapsed_ms=0.0,
            search_elapsed_ms=10.0,
        )
    finally:
        service.shutdown()

    digikey = envelope["timing"]["suppliers"]["digikey"]
    assert digikey["request_count"] == 2
    assert digikey["api_calls"] == 2
    component = envelope["search"]["components"][0]
    assert envelope["supplier_search_schema_version"] == "1.7"
    assert envelope["decision_contract_status"] == "current"
    assert envelope["procurement_decision_contract_status"] == "current"
    assert component["initial_query"]["part_number"] == "0603X03L_C"
    assert component["query"]["keywords"] == "1k"
