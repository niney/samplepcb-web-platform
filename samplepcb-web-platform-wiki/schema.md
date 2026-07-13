# Wiki Schema — samplepcb-web-platform

컴파일러가 따르는 구조 정의. 사람이 편집하면 다음 컴파일이 이를 존중한다.

## Conventions
- 모드: codebase · 링크: markdown · 언어: 한국어
- 토픽 슬러그: lowercase-kebab-case
- 섹션: Purpose / Architecture / Talks To / API Surface / Data / Key Decisions / Gotchas / Sources (+coverage 태그)

## Topics
| Slug | Description |
|---|---|
| sp-node-api | Fastify API (apps/api) — 담기 API·가격 엔진·관리 API·g5 접근 카탈로그 ⑤–⑲·재능마켓 백엔드·AI 유스케이스·레거시 마이그레이션·Prisma sp_* |
| sp-vue-web | Vue SPA (apps/web) — /app 관리자 화면(견적·회원·주문·마켓·SEO·슬라이드·설정 관리) |
| sp-market-web | 재능마켓 Vue SPA (apps/market) — /market 의뢰 위저드·전문가·입찰·계약 |
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
| admin-vue-consume-php | 관리=sp-vue(쓰기) / 소비=sp-php read-only 직접 SELECT — 공유 DB 브릿지 (슬라이드·후기·SEO) |
| lazy-derived-state | cron 없는 lazy 파생 상태 — 조회 시점 판정·승격 (paid 승격·자동확정·입찰 마감·reconcile) |

## Evolution Log
- 2026-07-03: Initial schema generated from 9 topics, 3 concepts
- 2026-07-06: 증분 재컴파일 — 토픽/개념 슬러그 무변경. 6개 토픽(sp-node-api·sp-vue-web·spcb-bridge·gnuboard-integration·infrastructure·docs-knowledge) 갱신. 관리 기능 이관(g5 접근 카탈로그 ⑤–⑱·관리자 주문/회원/설정·제작 8단계)·PHP 알림 브리지·신규 docs 4종 반영. sp-node-api·sp-vue-web 설명 갱신
- 2026-07-13: 토픽 sp-market-web 신설(재능마켓 Vue 앱 /market 신규 서비스). 개념 2종 추가 — admin-vue-consume-php(슬라이드·후기·SEO 3회 반복으로 확립), lazy-derived-state(paid 승격·자동확정·입찰 마감·reconcile). 9개 토픽 갱신(재능마켓·AI 유스케이스·거버 가격모드·레거시 DB 마이그레이션·SEO·위시숨김·후기·운영 배포 반영). shared-packages는 유의미 변경 없어 유지
