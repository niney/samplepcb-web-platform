# Wiki Schema — samplepcb-web-platform

컴파일러가 따르는 구조 정의. 사람이 편집하면 다음 컴파일이 이를 존중한다.

## Conventions
- 모드: codebase · 링크: markdown · 언어: 한국어
- 토픽 슬러그: lowercase-kebab-case
- 섹션: Purpose / Architecture / Talks To / API Surface / Data / Key Decisions / Gotchas / Sources (+coverage 태그)

## Topics
| Slug | Description |
|---|---|
| sp-node-api | Fastify API (apps/api) — 담기 API·가격 엔진·관리 API·g5 접근 카탈로그 ⑤–⑱·알림 브리지·Prisma sp_* |
| sp-vue-web | Vue SPA (apps/web) — /app 관리자 화면(견적·회원·주문·설정 관리) |
| api-contract | @sp/api-contract Zod 계약 — 요청/응답 스키마 공유 |
| shared-packages | @sp/config·shared·utils 모노레포 공용 패키지 |
| spcb-bridge | samplepcb-web/spcb — 인증 브리지(me.php)·사용자 노출 커스텀 페이지(quotes 등) |
| theme-sp-lite | sp-lite 테마 — 코어 비수정 오버라이드 지점(cart 스킨·헤더·CSS) |
| gnuboard-integration | 그누보드 subtree 운영·코어 비수정 전략·g5 한정 예외 |
| infrastructure | ops/nginx 라우팅(/→PHP·/app→Vue·/api→Node)·파일서버 연동 |
| docs-knowledge | docs/ 설계 기록 문서군 안내 지도 |

## Concepts
| Slug | Description |
|---|---|
| core-nonmodification | 코어 비수정 우회 기법 카탈로그 패턴 |
| server-single-truth | 가격·인증·상태의 서버 단일 계산 (클라이언트 불신) |
| manual-sync-drift | 경계 간 수동 동기화 지점과 드리프트 실사고 패턴 |

## Evolution Log
- 2026-07-03: Initial schema generated from 9 topics, 3 concepts
- 2026-07-06: 증분 재컴파일 — 토픽/개념 슬러그 무변경. 6개 토픽(sp-node-api·sp-vue-web·spcb-bridge·gnuboard-integration·infrastructure·docs-knowledge) 갱신. 관리 기능 이관(g5 접근 카탈로그 ⑤–⑱·관리자 주문/회원/설정·제작 8단계)·PHP 알림 브리지·신규 docs 4종 반영. sp-node-api·sp-vue-web 설명 갱신
