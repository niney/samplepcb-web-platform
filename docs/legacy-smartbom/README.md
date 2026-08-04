# legacy-smartbom — 레거시 SmartBOM PCB 트랙 회수 자료

PCB 파트너 트랙 이식 조사(2026-08-04, `docs/PCB_PARTNER_TRACK.md`) 중 **유실 위험이 확인되어 회수한 레거시 정본**이다.
원본 소유는 레거시 리포( `D:\work\workspace_other\sp-smartbom-web` )이며, 여기 사본은 이식 근거 보존용 스냅샷 — 수정하지 않는다.

| 파일 | 출처 | 왜 회수했나 |
|---|---|---|
| `currency-link-model-redesign.md` | `sp-smartbom-web/tmp/` (**gitignore** — 그 로컬에만 존재) | 링크별 결제통화 모델의 유일한 서술형 설계서(31KB). §7 DDL 제안 컬럼명 일부는 미구현·코드와 다름 — 코드가 정본 |
| `smartbom-bom-pcb-uml.html` | `sp-smartbom-web/tmp/` (**gitignore**) | 2026-07-29 작성 "BOM·PCB UML Atlas" — 다이어그램 40여 개. 레거시 자료 중 가장 최신·완전(PCB 활동 흐름 D19, EQ 상태머신 D25, 선적그룹 D28, 국내 3단계 D30, A/S D32 등) |
| `legacy-pcb-ddl.sql` | 레거시 운영 덤프 DB(`samplepcb_legacy_full`)에서 `SHOW CREATE TABLE` 직접 추출 | `sp_pcb_partner_order` 등 기반 테이블의 CREATE DDL이 레거시 리포 마이그레이션에 없어(alter만 존재) 실 DB가 유일한 스키마 명세. 한글 코멘트는 cp949 인코딩 깨짐(구조는 정확) |
