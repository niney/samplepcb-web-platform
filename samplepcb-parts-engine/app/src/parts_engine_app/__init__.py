"""FastAPI 오케스트레이션 계층 — BOM 추출 + 공급사 검색 잡 API.

엔진(bom_extraction_engine·supplier_search_engine)은 순수 계산/IO 라이브러리로 두고,
이 계층이 잡 생애주기(업로드→파싱→검색)와 HTTP 표면을 담당한다.
잡 상태는 인메모리(저장은 다음 스텝에서 sp-node가 담당) — 공급사 엔진의 SQLite
캐시/쿼터만 디스크에 유지한다.
"""
