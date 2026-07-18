"""app 계층 엔드투엔드 — 업로드→파싱→결과 표시 경로를 실제로 구동한다.

공급사 검색은 실 API 키/네트워크가 필요해 여기서 라이브로 돌리지 않는다
(엔드포인트 계약/게이팅만 확인). 추출 경로는 인라인 CSV로 완전 검증.
"""
from __future__ import annotations

import time

from fastapi.testclient import TestClient

from parts_engine_app.config import Config
from parts_engine_app.main import create_app

_CSV = (
    "No,Part Number,Manufacturer,Qty,Reference\n"
    "1,RC0402FR-0710KL,Yageo,100,R1 R2\n"
    "2,GRM155R71C104KA88D,Murata,50,C1\n"
    "3,LQG15HS10NJ02D,Murata,20,L1\n"
)


def _client(tmp_path) -> TestClient:
    config = Config(
        data_dir=tmp_path,
        m2v_path="off",          # 오프라인·임베딩 폴백 비활성 → 사전만으로 헤더 탐지
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
    assert body["engine"] == "smartbom"           # 계약 식별자 보존 확인
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
