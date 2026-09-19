---
concept: 코어 비수정 우회 기법
last_compiled: 2026-09-19
topics_connected: [gnuboard-integration, theme-sp-lite, spcb-bridge, sp-node-api, infrastructure, api-contract, sp-develop-web]
status: active
---

# 코어 비수정 우회 기법 (Core Non-Modification)

## Pattern
이 플랫폼의 모든 설계 결정을 지배하는 단일 제약: **그누보드5/영카트 코어는 (거의) 한 줄도 수정하지 않는다** (subtree pull 로 보안 패치를 계속 받아야 하므로). 코어와 요구사항이 충돌할 때마다 "코어를 고치는" 대신 코어의 기존 확장점(테마 오버라이드·`extend/`·스냅샷 모델·커스텀 메일 템플릿 재사용·실행 순서)을 역이용하거나, 코어 밖(`spcb/`·sp-node·nginx)에서 푼다. 기법 카탈로그는 `docs/GERBER_ORDER_FLOW.md` 4장에 **11건**, g5 DB 접근은 5장 **접근 카탈로그 ①~㉑** 으로 규율된다.

2026-08 이후 원칙 자체가 두 방향으로 자랐다. ① **해석이 넓어졌다** — "코어 파일을 안 고친다"는 그대로지만, 컬럼을 새로 추가하거나 코어 필드를 공유하는 것은 허용으로 정리됐다(코어가 스스로 런타임 ALTER 하는 전례가 근거). ② **예외를 운영한다** — 피할 수 없는 코어 한 줄 수정은 주석 + 가드 스크립트 등록이 규칙이 됐다([exception-ledger](exception-ledger.md)). 그리고 `extend/` 가 단순 훅에서 **PHP→sp-node 브리지 계층**으로 자라면서, 코어 무수정으로 얹을 수 있는 기능의 상한이 크게 올라갔다.

## Instances
- **2026-09-19 (스캔)** in [gnuboard-integration](../topics/gnuboard-integration.md): 성적표 = sp 심 마커가 있는 코어 파일 **7개**(`lib/common.lib.php`·`shop/orderform.php`·`shop/orderform.sub.php`·`mobile/shop/orderform.sub.php`·`shop/orderformupdate.php`·`mobile/shop/orderformupdate.php`·`shop/ordermail1.inc.php`), 그 밖은 순정. ⚠ 가드는 **5 assert** 뿐이라 `mobile/shop/orderform.sub.php`·`shop/ordermail1.inc.php`(커밋 4b4ec853d)가 미등록이고, 게다가 **subtree pull 실행 이력이 0회**(초기 커밋 `d4323b882` 이후)라 가드가 실 pull 로 검증된 적이 없다
- **2026-09-05** in [sp-develop-web](../topics/sp-develop-web.md): 개발의뢰 결제 앵커 `sp-develop-svc` 가 `extend/sp_quote_cart.extend.php` 의 it_id 사전 union 에 **네 번째**로 합류(quote·market·bom·develop) — 주문서·주문 메일이 코어 수정 0으로 새 트랙을 받아들인다. 앵커 상품 패턴(기법 #1)의 네 번째 재사용
- **2026-08~09** in [theme-sp-lite](../topics/theme-sp-lite.md): 테마가 코어의 **실행 순서**를 우회 수단으로 쓴다 — 코어 `get_paging` 이 sub include 뒤에 돌아가는 성질을 이용해 `$total_count`/`$total_page`/`$qstr` 를 덮어 주문내역 유형 탭·페이지네이션을 구현 · `head.sub.php` 의 `SP_INLINE_ACCOUNT` 가 코어가 팝업으로 여는 포인트·쿠폰·쪽지·스크랩을 계정 레이아웃으로 **승격** · `js/orderform-defaults.js` 가 코어 핸들러를 프로그램적 click 으로 태워 기본값을 채운다
- **2026-08~09** in [theme-sp-lite](../topics/theme-sp-lite.md) / [spcb-bridge](../topics/spcb-bridge.md): 코어 `alert()` 은 `bbs/alert.php` 로 **페이지를 통째로 갈아치우므로** 새 화면은 쓰지 않는다 — 브리지는 원래 화면으로 `?sp_msg=&sp_tone=` 를 실어 보내고 테마 `js/sp-dialog.js` 가 모달로 띄운 뒤 `replaceState` 로 지운다([no-native-dialogs](no-native-dialogs.md)). 대가는 복제 — `sp_pcb_check_token()` 은 코어 `check_token()` 의 사본이다(코어가 실패 시 자체 alert 로 끝나 감쌀 수 없다)
- **2026-08-17** in [gnuboard-integration](../topics/gnuboard-integration.md) / [api-contract](../topics/api-contract.md): **배송방법 = 신설 컬럼 + 한글 라벨 병용(B안)** — 코어에 없는 개념을 `g5_shop_order.od_delivery_method`(varchar) 로 넣되 `od_delivery_company` 에 한글 라벨을 함께 기록해 /adm 주문상세·배송 메일 `{택배회사}` 치환·고객 조회가 **PHP 0줄**. 근거는 코어 스스로 `g5_shop_order` 를 런타임 ALTER 하는 전례(`od_other_pay_type`). 과입금 환불도 새 컬럼 없이 코어 필드 `od_refund_price` 를 공유(이미 미수 산식 안에 있어 적는 순간 과입금이 닫힌다) — "비수정"이 **"코어 파일 무수정, 컬럼 추가·필드 공유는 허용"** 으로 해석된 실례
- **2026-08-07~25** in [spcb-bridge](../topics/spcb-bridge.md) / [gnuboard-integration](../topics/gnuboard-integration.md): **extend sp 훅 6종**(`sp_quote_cart`·`sp_order_status`·`sp_partner`·`sp_pcb_eq`·`sp_pcb_claim`·`sp_bom_claim`)이 `common.php` 부트스트랩으로 **모든 코어 페이지보다 먼저** 로드돼, `SPCB_NODE_BASE=127.0.0.1:3333` 직결 curl(2분 회원 JWT, 5초)로 EQ 확인·A/S 접수·파트너 판정·주문 진행 표시를 코어 무수정으로 얹는다. 규약은 "판정·저장은 sp-node, PHP 는 화면만"이고 실패는 `null`→**섹션만 숨김**(주문내역이 죽으면 안 된다)
- **2026-08-05** in [infrastructure](../topics/infrastructure.md) / [gnuboard-integration](../topics/gnuboard-integration.md): `ops/scripts/check-core-patches.sh` 신설(커밋 5eb5d3f67) → 2026-08-17 +4(ea2916b98, 배송방법 **독립 검토가 미등록 코어 수정 4건을 발견**). subtree pull 은 그누보드가 그 줄 근처를 안 건드리면 **충돌 없이 조용히 원본으로 덮어쓴다** — 그래서 "코어를 고칠 수밖에 없으면 `// [samplepcb]` 주석 + 가드 한 줄 등록"이 규칙(UPSTREAM_SYNC §3)이 됐다. 원칙의 운영 형태 = [exception-ledger](exception-ledger.md)
- **2026-08-25** in [gnuboard-integration](../topics/gnuboard-integration.md) / [spcb-bridge](../topics/spcb-bridge.md): **URL 도 코어 밖에서 만든다** — 루트 `samplepcb-web/.htaccess`(코어 비수정 신규 파일)가 실존 파일 우선 → 1단계 슬러그 `/{slug}`→`spcb/pages/{slug}.php` → `/shop/quotes`·`/shop/quotes/archive` + 08-25 추가 `/shop/eq`·`/shop/as` 를 리라이트하고, `spcb/.htaccess` 가 무확장 라우팅과 `HTTP_AUTHORIZATION` 패스스루를 맡는다(이게 없으면 `order-notify.php` 가 서비스 JWT 를 못 읽는다). 코어 라우팅 파일은 한 줄도 건드리지 않는다
- **2026-07-05** in [spcb-bridge](../topics/spcb-bridge.md) / [sp-node-api](../topics/sp-node-api.md): 주문 알림(메일/SMS)을 Node 로 **재구현하지 않고** 레거시 커스텀 템플릿(`ordermail.inc.php`)을 `order-notify.php` 브리지로 재사용 — 코어의 검증된 발송 자산을 그대로 빌린다
- **2026-07-04** in [gnuboard-integration](../topics/gnuboard-integration.md): **기법 #11 = 무수정 원칙의 첫 기록된 예외** — 주문서 `ct_select` 필터·옵션 나열 교체는 피할 수 없어 최소 수정하되 스톡 불변(no-op) + subtree 충돌 시 재적용 규약으로 봉인. 같은 날 g5 접근을 "금지+한정 예외"에서 **접근 카탈로그**로 재정의
- **2026-07-02~05 (이전 컴파일분 유지)** in [sp-node-api](../topics/sp-node-api.md) / [theme-sp-lite](../topics/theme-sp-lite.md) / [infrastructure](../topics/infrastructure.md): PCB 8단계를 신규 컬럼 없이 `od_status`/`ct_status` 재사용 · 코어 가격 재검증을 옵션 행 실등록(`io_id=quoteId`)으로 정당 통과(#3) · 세션 키를 `me.php` JWT `cartId` 클레임으로(#4) · [선택사항수정] 선형 곱 오류를 테마 cart 스킨 분기 숨김으로 차단(#8) · 장바구니 삭제를 훅 없이 lazy reconcile 로 감지(#10) · 통합을 코드가 아닌 **nginx 라우팅**으로, `G5_DOMAIN=''`+`proxy_fix.php` 로 도메인·https 독립

## What This Means
"코어를 못 고친다"는 제약이 오히려 아키텍처를 깨끗하게 유지시킨다 — 모든 커스텀이 명시적 경계(`extend/`·`spcb/`·테마·모노레포·접근 카탈로그) 안에 있어 업스트림 동기화·소유권·책임이 명확하다. 새 요구사항이 코어와 충돌하면: ① 기법·접근 카탈로그에서 유사 사례를 먼저 찾고 ② **컬럼 추가·코어 필드 공유·실행 순서 역이용·extend 브리지**가 코어 파일 수정보다 항상 먼저 검토되며 ③ 그래도 만져야 하면 최소·no-op·주석 + **가드 등록**으로 봉인한다. 가드는 등록해야만 지켜지고, 지금 2건이 빠져 있다 — `assert_contains` 두 줄 추가가 이 개념의 가장 값싼 부채 상환이다. 한편 첫 subtree pull 은 아직 오지 않았다: 가드·충돌 처리·재적용 규약 전체가 **한 번도 실행되지 않은 절차**라는 사실을 계획에 넣어야 한다.

## Sources
- [gnuboard-integration](../topics/gnuboard-integration.md)
- [theme-sp-lite](../topics/theme-sp-lite.md)
- [spcb-bridge](../topics/spcb-bridge.md)
- [sp-node-api](../topics/sp-node-api.md)
- [infrastructure](../topics/infrastructure.md)
- [api-contract](../topics/api-contract.md)
- [sp-develop-web](../topics/sp-develop-web.md)
