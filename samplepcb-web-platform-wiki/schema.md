# Wiki Schema — samplepcb-web-platform

컴파일러가 따르는 구조 정의. 사람이 편집하면 다음 컴파일이 이를 존중한다.

## Conventions
- 모드: codebase · 링크: markdown · 언어: 한국어
- 토픽 슬러그: lowercase-kebab-case
- 섹션: Purpose / Architecture / Talks To / API Surface / Data / Key Decisions / Gotchas / Sources (+coverage 태그)
- 개념 섹션: Pattern / Instances(최신순·날짜 접두) / What This Means / Sources
- 개념↔개념 참조도 같은 폴더 기준 마크다운 링크(표시명 + 슬러그 파일명) — 옛 `[[슬러그]]` 표기는 2026-09-19 에 전량 교체

## Topics
| Slug | Description |
|---|---|
| sp-node-api | Fastify 5 API(apps/api) — 거버 담기·라이브 가격, 고객 BOM 견적+`/api/svc`, SmartBOM·PCB 협력 트랙(RFQ→발주→물류→클레임)의 관리자·포털·매직링크 API, 부품 카탈로그+ES·sp-engine 게이트웨이, 재능마켓·AI 사전 검토서·개발의뢰, 발송 이력·배송방법·환불 기록, g5 접근 카탈로그 ①~㉑, 레거시 이관·운영 재이관·DB 스냅샷 |
| sp-vue-web | Vue 3 SPA(apps/web, `/app`) — 관리자 업무 모듈 5종(통합·PCB·BOM·개발·마켓)의 역할별 워크큐·Case 상세 + 회원 BOM 워크벤치(`/app/bom`) + 협력사 포털(`/app/partner`, BOM/PCB 모듈·3개 언어) + 매직링크 회신 페이지. 판정·보안은 sp-node |
| partner-tracks | 협력사(파트너) 트랙 — BOM·PCB 두 트랙의 RFQ→선정·확정가→발주(PO)→EQ/생산→선적·입고→고객 배송→클레임 업무 흐름, 조직 모델 `sp_partner` 3축·포털·매직링크, 가드 코드 체계, 돈(링크 통화·송금 원장·환차·환불), 문서(견적서·인보이스·패킹리스트·QR) |
| sp-market-web | 재능마켓 고객 Vue SPA(apps/market, `/market`:5176) — 분야 레지스트리 파생 3스텝 의뢰 위저드·AI 사전 검토서(동기)+정밀 구성도(비동기)·블라인드 입찰·계약·영카트 결제·의뢰 수정 이력. 렌더 컴포넌트는 `@sp/ui` 로 추출 |
| sp-develop-web | 개발의뢰 Vue SPA(apps/develop, `/develop`:5177) — 당사 직접 개발 용역: 5스텝 위저드·관리자 주도 AI 검토서 3층+버전 원장·항목별 견적/마일스톤 결제·프로젝트 문서 5종·업무표 + 관리자 「개발」 모듈 + `develop-*`·`admin-develop-*` 라우트 |
| parts-engine | samplepcb-parts-engine — Python(uv workspace) BOM 추출·공급사 검색 엔진, FastAPI 잡 API(:8400, 무인증·127.0.0.1, sp-node 만 소비). 2026-07-21부터 기술·조달 판단의 단일 원본; 08월부터 협력사 재고 프로필(inventory)·로컬 소스 주입(local_products)·대체 검색 3단·로컬 회귀 코퍼스까지 품되 판단 경로는 하나 |
| api-contract | `@sp/api-contract` Zod 계약 — 41개 도메인 스키마(BOM·PCB 협력 트랙·주문 진행·마켓·개발의뢰·AI·메일·미리보기)의 요청/응답·코드 사전·한글 라벨·`apiRoutes` 67종에 더해, 반려 판정·납기 경과·주문 진행 병합·마진 역산 같은 **업무 판정을 순수 함수로 소유** |
| shared-packages | `@sp/config`·`shared`·`utils`·`ui` 모노레포 공용 패키지 — 설정 프리셋, FE/BE 가 같은 함수를 쓰는 도메인 순수 로직(골든 테스트), 인증 fetch 코어, 세 Vue 앱(web·market·develop) 공용 렌더 컴포넌트 |
| spcb-bridge | `samplepcb-web/spcb` — 코어 비수정 브리지 영역: 인증(me.php)·주문 알림(sp-node→PHP)·고객 쓰기 브리지 4종(EQ 결정·첨부·좌표파일·A/S 접수, PHP→sp-node)·사용자 노출 페이지(계정 셸·후기·피그마 정적 3종)·프로빙 실험실(previews) |
| theme-sp-lite | sp-lite 테마 — 코어 비수정 오버라이드 지점(cart 스킨·계정 셸 4종·헤더/푸터·CSS 토큰·공용 팝업) 겸 **피그마 → sp-php 페이지 구현 착지점**(홈 하이브리드 히어로·회사소개/연혁/위치·마이페이지·주문내역·로그인·포인트) |
| gnuboard-integration | 그누보드5/영카트 코어를 subtree(pull only)로 두고 extend·spcb·테마·모노레포에만 커스텀하는 통합 전략 — 코어 최소 수정 7파일과 가드 스크립트, PHP→sp-node 브리지 훅, 공유 DB 이관·스냅샷·재이관 절차 |
| infrastructure | 로컬 nginx 통합 호스트(`/`·`/app`·`/market`·`/develop`·`/api`)와 운영 3사이트(centrafab-main·dev.centrafab·new.samplepcb 직결 TLS) 라우팅, `deploy.sh` 10케이스·systemd, 배포 전 DB 스냅샷·원복·운영 재이관·프로토타입 정리 절차, 코어 패치 가드·헤드리스 검증 도구, 파일서버·Mailpit·DB 튜닝·복구 기록 |
| testing | 전 계층 검증 체계 — 모노레포 E2E 하네스(vitest+playwright-core, `/spcb/api/me` 스텁 로그인, 여정 편 재점검 루프)·옵트인 통합·루트 API 하네스(market·develop)·엔진 pytest·코어 비수정 가드·헤드리스 스크린샷 헬퍼 |
| docs-knowledge | `docs/` 설계·운영 기록 문서군(루트 47 + `prompts/` 14 + 회수 자료)의 안내 지도 — 문서별 요지·정본을 쓰는 토픽·최종 커밋, "어떤 질문에 어떤 문서" 진입 규칙, 정본 우선순위(§정정 우선)와 문서 자체의 함정 |

## Concepts
| Slug | Description |
|---|---|
| core-nonmodification | 코어를 고치는 대신 확장점·실행 순서·컬럼 추가·코어 밖 계층으로 우회하고, 피할 수 없는 예외는 주석+가드 스크립트에 등록해 운영한다 |
| server-single-truth | 값·권한·노출은 물론 **라벨 문자열까지** 서버가 계산해 내려주고, 클라이언트는 식별자만 보낸다 |
| judgment-single-owner | 한 판단은 한 곳이 소유한다 — 엔진(기술)·계약 순수 함수(업무)·버전 계약 필드 셋 중 하나로만 공유하고 재구현은 없다 |
| snapshot-freeze | 시간을 불신한다 — 결정 시점의 사실은 굳히고(값·문서·버전 원장) 확정은 서버 재계산으로만 |
| lazy-derived-state | cron 없이 조회 시점에 판정·승격하고, 원장에서 셀 수 있는 상태에는 컬럼을 만들지 않는다 |
| in-memory-async-jobs | `run→jobId→폴링` 골격은 유지하되 저장소가 인메모리에서 DB 원장으로 이동했다 — 소실되면 돈이 드는 산출물은 처음부터 원장에 |
| manual-sync-drift | 경계마다 생기는 수동 동기화 지점의 카탈로그 — 없애는 수단과, 못 없앨 때의 정본 명시·자동 검증·등록 규율 |
| admin-vue-consume-php | 관리 UI 는 sp-vue, 노출은 sp-php — 읽기는 공유 DB 직접 SELECT, 쓰기·판정은 PHP 가 sp-node 를 호출하고 실패해도 섹션만 숨긴다 |
| share-render-mirror-domain | 같은 픽셀·계산은 추출해 공유하고 같은 업무 어휘는 값이 같아도 미러로 격리한다 — `@sp/ui` 추출과 PCB/BOM 사전 분리가 한 경계의 양면 |
| workqueue-case-spine | 네 모듈이 반복하는 화면 문법 — 역할별 워크큐·내 차례 배지·단일 Case 상세·URL 이 상태 정본, 모두 저장이 아닌 파생 |
| journey-recheck-loop | 시나리오 완주 → 화면 관찰 → 엄선 → 수정 → 어서션 반전으로 회귀선을 남기는 편(호) 단위 재점검 루프 — 4트랙 반복, 검증이 조용히 비는 3패턴이 핵심 교훈 |
| golden-as-spec | 골든 표(JSON 벡터·실파일 코퍼스·레거시 실캡처)가 요구사항 명세 자체이고 코드가 표를 따라간다 — 표를 고치는 것이 곧 명세 변경 |
| exception-ledger | 정본에서의 편차를 네 종류 원장(코어 수정·디자인·명세 정정·이관 정리)에 등록하고 가드로 검사하는 규율 — 원장이 비면 편차는 조용한 회귀가 된다 |
| new-app-onboarding | 모노레포에 앱을 붙이는 11단계 반복 절차(AGENTS 등록→포트·Vite→nginx→부트스트랩 순서→계약→마이그레이션→deploy→앵커 상품→관리자 화면→하네스→스크립트 밖 체크리스트) |
| destructive-op-guardrails | 삭제 경로가 공통으로 밟는 다섯 계단(미리보기 기본·명시 플래그·검증된 백업·미분류 중단·복원 전 재백업)과 앱 가드의 잠김→정리→열림 |
| get-opens-post-decides | 메일·매직링크 URL 은 GET 으로 화면만 열고 결정은 화면 안 POST 로 — 보안 게이트웨이 자동 프리페치 방어가 근거 |
| no-native-dialogs | `alert/confirm/prompt` 전면 금지와 공용 대화상자 대체 — "추가 대화상자 표시 안 함" 체크가 조작을 통째로 막던 실결함이 근거 |

## Evolution Log
- 2026-07-03: Initial schema generated from 9 topics, 3 concepts
- 2026-07-06: 증분 재컴파일 — 토픽/개념 슬러그 무변경. 6개 토픽 갱신(관리 기능 이관·PHP 알림 브리지·신규 docs 4종)
- 2026-07-13: 토픽 sp-market-web 신설. 개념 2종 추가 — admin-vue-consume-php, lazy-derived-state. 9개 토픽 갱신
- 2026-07-20: 토픽 parts-engine 신설. 개념 2종 추가 — snapshot-freeze, in-memory-async-jobs. 6개 토픽 갱신
- 2026-07-27: 개념 judgment-single-owner 신설. in-memory-async-jobs 방향 전환 기록(인메모리 → BOM 트랙 DB 원장 승격). 6개 토픽 갱신
- 2026-09-19: **대규모 재컴파일**(직전 컴파일 이후 커밋 479건). 토픽 3종 신설 — **partner-tracks**(BOM·PCB 협력사 트랙이 리포 최대 축으로 성장, 정본 문서 2편 4,983줄), **sp-develop-web**(개발의뢰 앱·API·관리자 모듈 신설 08-28~09-11), **testing**(E2E 스펙 117·하네스 3종·가드·스크린샷 헬퍼가 독립 계층이 됨). 기존 11토픽 전부 갱신. 개념 9종 신설 — share-render-mirror-domain·workqueue-case-spine·journey-recheck-loop·golden-as-spec·exception-ledger·new-app-onboarding·destructive-op-guardrails·get-opens-post-decides·no-native-dialogs(이 중 new-app-onboarding 은 2026-07-20 로그가 "3회째에 승격 검토"로 예고한 항목 — market→rnd→develop 로 성립). 기존 8개념 전부 갱신: **in-memory-async-jobs** 는 2026-08-28 AI 잡의 `sp_ai_job` DB 이전으로 "인메모리 전제"를 대체 표기, **admin-vue-consume-php** 는 "PHP→Node HTTP 호출 없음" 단언을 08월 브리지 계층 신설로 대체하고 읽기/쓰기 두 축으로 분리, **judgment-single-owner** 는 계약(@sp/api-contract)이 업무 판정을 순수 함수로 소유하는 세 번째 형태를 추가. 개념↔개념 링크를 마크다운으로 통일
