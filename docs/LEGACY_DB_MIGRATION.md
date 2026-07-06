# 레거시 DB 마이그레이션 — samplepcb_php → 신규 플랫폼 DB

> 레거시(그누보드5/영카트, `D:\work\workspace_other\samplepcb_php` · 운영 www.samplepcb.co.kr)의
> 실데이터를 신규 플랫폼 DB(`samplepcb`)로 변환 이관하는 sp-node 기능의 절차·설계·실증 기록.
> 작성 2026-07-07 · **P1(2020 덤프)·P2(운영 풀 덤프 20260702)·P3(로컬 실 DB 컷오버) 전부 verify 그린** +
> 서비스 레벨(admin API·PHP 페이지) 실동작 검증 완료(§6-B). 남은 개방 항목은 거버 실파일 업로드(§7)뿐.
> 구현: `samplepcb-web-mono-app/apps/api/src/scripts/migrate/` · 계획 원본: 플랜 cuddly-wiggling-perlis(승인 2026-07-06)
>
> **덤프 소재**: `D:\work\workspace_other\samplepcb_dump\` — `hyoh9150-20201221.dump.zip`(2020-12-21 백업),
> `hyoh9150-20260702.dump`(운영 풀 덤프, 666MB → 로컬 `samplepcb_legacy_full` 임포트),
> `samplepcb-backup-before-cutover-20260707.sql`(컷오버 직전 로컬 samplepcb 백업 — 복구용). 리포에는 덤프 미포함.

## 1. 두 모델의 차이 (변환의 이유)

| | 레거시 | 신규 |
|---|---|---|
| 거버 주문 | 제출마다 **g5_shop_item 생성**(운영 38,767건) — EAV `it_N`/`it_N_subj`에 사양, 실수량은 `it_stock_qty`, 주문자 정보까지 상품에 | 템플릿 상품 4종 앵커(`sp-pcb-std` 등) + **사양·파일은 `sp_order_spec`/`sp_quote`/`sp_file`(Prisma)** + cart 스냅샷 |
| cart 라인 | `ct_qty=1` 고정, `ct_price`=**공급가 총액**, item과 1:1 | `ct_qty=1`, `ct_price=0` + **`io_price`=부가세 포함 총액**, 옵션행(`io_id=quoteId`) 실등록 |
| 회원 귀속 | 상품엔 소유자 없음 — **cart.mb_id 매개**(고아 견적 51.6%는 귀속 불가) | spec.mbId 직접 소유 |
| 미수금 산식 | `cart(공급)+send+**floor(cart×0.1)**-수납` (VAT 별도항 — 레거시 shop.lib.php:1739 커스텀) | `cart(VAT포함)+send-수납` (`computeOrderMoney`, g5-db.ts) |
| 회원 확장 | `mb_1~13`+`mb_partner_auth`(+운영: 계좌 6컬럼·mb_14~20 JSON), **mb_id=이메일(255 확폭)** | `sp_member_profile` 명시 컬럼(여분필드 폐기 결정 2026-07-04의 연장) |
| 세금계산서 | `od_1~od_11`(주문서 무통장 섹션) | `sp_order_biz_info`(신규 Prisma 모델) |
| 주문 상태 | 22종(표준+생산 단계 커스텀) | 같은 한글 문자열 체계 16종(ACTIVE 13+취소류 3 — 신규가 레거시를 이식했으므로 대부분 그대로 통과) |

## 2. 확정 범위 (사용자 결정 2026-07-06)

1. **주문·자산 전부 이관**: order + cart + 배송지 주소록 + 포인트 원장 + 쿠폰 + 1:1문의.
2. **거버 상품은 주문 연결분만 변환**(운영 ~18,700건). 고아 견적·쇼핑/협력사 대기 cart 행은 스킵.
   레거시 자체 `sp_*`(sp_estimate 등)는 미이관 — 단 **주문된 ca20 라인은 sp_estimate 설문 JSON을 spec_json에 병합**해 실질 보존.
3. **회원 확장 필드 = sp_member_profile 확장**(계약 `AdminMemberBusiness` 필드명 정합, 잔여는 `legacyJson`). 신규 g5_member의 `mb_1~10`은 비움.
4. **실파일은 이관분만**: 거버 파일 → file.samplepcb.kr(sp_file.pathToken, 사전 업로드), 게시판 첨부·에디터/회원 이미지 → data/ 복사.
5. g5_menu·g5_content(레거시 마이페이지류는 정적 목업이었음)·운영성 테이블 미이관. **애매한 항목 발견 시 중단 → 사용자 확인**(게이트로 코드화).

## 2-B. 전 테이블 처분표 — 운영 96개 전수 (행수 = 운영 덤프 20260702 실측)

> 정본은 `manifest.ts` `TABLE_RULES`(게이트가 이 표로 전수 대조 — 미분류 발견 시 중단). 아래는 그 스냅샷.

### 변환 (1) — 신규 모델로 재구성

| 테이블 | 행수 | 행선지 |
|---|---|---|
| g5_shop_item | 45,137 | **주문 연결분만** → sp_order_spec + sp_quote(+sp_file) + 신규 g5_shop_cart(io 규약) + g5_shop_item_option. 고아 견적(주문 미연결)은 스킵(사용자 확정) |

### 복사+보정 (24) — 동명 테이블로 이관

| 테이블 | 행수 | 비고(보정) |
|---|---|---|
| g5_member | 6,245 | mb_1~10 비움(→profile), 신규 컬럼 기본값, admin/kpeter 스킵 → 타깃 6,246 |
| g5_member_social_profiles | 2,999 | 회원 삭제 고아 1건 제외 2,998 이관 |
| g5_point | 45,669 | 회원 매칭분 39,889 이관(레거시 mb_id 절단 고아 3,241행은 레거시 자체 결함 — 스킵·보고) |
| g5_shop_order | 15,924 | 전량. 금액 헤더는 VAT 변환 후 computeOrderMoney 재산출, od_1~11→sp_order_biz_info(11,085) |
| g5_shop_cart | 20,757 | 주문 연결 20,565만(견적 규약 재작성). 미연결(쇼핑 105·협력사 17·기타)은 스킵·보고 |
| g5_shop_order_address | 5,642 | 회원 주소록 — 5,639 이관(절단 고아 3) |
| g5_shop_category | 6 | 전량 |
| g5_shop_coupon (+coupon_log) | 2 (+0) | cp_id UNIQUE 게이트 후 전량 |
| g5_qa_config / g5_qa_content | 1 / 705 | 1:1문의 — qa_id 보존 전량 |
| g5_board / g5_group / g5_board_file | 9 / 1 / 222 | 동명(notice·qa)은 데이터만 주입, 신설 7종은 스킨 basic/gallery 정규화 |
| g5_auth | 8 | 회원 존재분만 |
| g5_write_{notice,qa,faq,data,customer_center,review,portfolio,production_s,open_market} | 28/706/37/38/9/87/0/0/11 | wr_id 보존(댓글·공지·첨부 참조 정합). open_market 은 P2 게이트 발견 후 추가 |

### 스킵 (46) — 운영성·파생·빈 테이블·설정(신규 유지)

| 그룹 | 테이블(행수) | 사유 |
|---|---|---|
| 설정(신규 유지) | g5_config(1) · g5_shop_default(1) | 신규 플랫폼 설정이 정본(사업자정보는 admin 설정 ⑱) |
| 지시상 미이관 | g5_menu(7) | 사용자 확정 |
| 컨텐츠 셸 | g5_content(15) | 레거시 마이페이지류도 정적 목업 — 신규 재구현 대상(본문류 수동 참고) |
| 운영 통계·로그 | g5_uniqid(275,376) · g5_visit(323,953) · g5_visit_sum(2,654) · g5_login(17) · g5_popular(174) | 방문/채번/접속 스냅샷 — 이관 가치 없음 |
| 임시·파생 | g5_autosave(94) · g5_board_new(8) · g5_board_good(0) · g5_mail(4) · g5_shop_order_data(1,693 — PG 임시) · g5_shop_cart_tmp(5,259 — 2022 멈춘 잔재, PHP 참조 0건) | 재생성/사문화 |
| 빈 테이블 | g5_memo · g5_scrap · g5_poll(_etc) · g5_faq(+master 1 — 실데이터는 write_faq) · g5_cert_history · g5_group_member · g5_new_win(26 — 팝업) · g5_shop_{order_delete, banner, event, event_item, coupon_zone, item_ext, item_option, item_qa, item_relation, item_stocksms, personalpay, sendcost, wish} · g5_shop_inicis_log(6) | 0행 또는 무가치 |
| SMS 플러그인 | sms5_book(3,461) · sms5_book_group(1) · sms5_{config,form,form_group,history,write}(0) | 주소록은 회원 연락처 파생 — 신규 sms5 에서 재동기화 |
| ⚠ 재고 여지 | **g5_shop_item_use(61)** — 상품 별점후기 | 2020 덤프 0건 기준 스킵 처분했으나 **운영엔 61건 실재**. 이관하려면 it_id 가 견적 생성 상품이라 상품 연결은 끊긴 채 목록성 이관만 가능 — 필요 시 재처분 |

### 미이관 — 레거시 자체 sp_* (25, 사용자 확정)

| 그룹 | 테이블(행수) |
|---|---|
| 견적 설문 | sp_estimate(305 — **주문된 ca20 라인은 설문 JSON 을 spec_json 에 병합해 실질 보존**) · sp_estimate_document(11) · sp_estimate_item(403) · sp_total_estimate(18) |
| 파트너 B2B | sp_partner_order(1)+document(14)+item(108) · sp_partner_estimate_document(49)+item(1,642) · sp_partner_chat_0(38)/1000(0) · sp_master_dealer_partner(2) · sp_pcb_partner_order(11)+document(6) · sp_outsourcing(5 — 사문화) |
| 부품(Smart BOM) | sp_pcb_parts(18,189) · sp_pcb_parts_price(23,461) · sp_pcb_parts_price_step(129,795) · sp_pcb_parts_{image,spec}(0) — 부품 DB 는 별도 트랙 |
| 기타 | sp_file(23) · sp_bom_document(21) · sp_shipment(11)+group(5) · sp_pcb_as_case(1) |

## 3. 실행 방법

```bash
cd samplepcb-web-mono-app/apps/api
cp .env.migration.example .env.migration   # 소스/타깃/미러 경로 설정 (리허설 = 사본 DB!)

pnpm migrate:gate    # 게이트만(처분표·컬럼·상태·길이·쿠폰·템플릿 검사)
pnpm migrate:dry     # 쓰기 없이 전 phase 변환 통계
pnpm migrate:files   # 거버 실파일 사전 업로드(컷오버 창 밖, --limit/--concurrency/--relink)
pnpm migrate:run     # 실행 (--phase=members,shop,boards,misc 선택 가능)
pnpm migrate:verify  # 검증 리포트(행수·금액 항등·참조 정합·센서스)
pnpm migrate:wipe    # (컷오버 전) 신규 테스트 거래 정리 — 목록 출력, --yes 로 실제 삭제
```

- 원장/리포트: `<플랫폼>/.tmp/migrate/ledger-<타깃DB>.json`, `report-*.json`, `verify-*.json` — 타깃 DB별 분리.
- **멱등 재실행이 원자성의 대체**(g5 무트랜잭션 전제): od 단위 완료 마커 + 자연키 존재검사
  (mb_id / od_id / (od_id, io_id=quoteId) / (it_id, io_id) / quoteId / bo_table+wr_id / qa_id).
  quoteId는 **UUIDv5(`od_id:ct_id`, 고정 네임스페이스)** — 결정적이라 재실행·파일 원장·연결이 전부 이 키로 수렴.
- run.ts 안전 가드: 소스=타깃 동일 DB 거부 · DATABASE_URL≠G5_DATABASE_URL(공유 DB 전제) 거부.

## 4. 게이트 (manifest.ts) — "애매하면 중단"의 코드화

실행 전 항상: ① 레거시 전 테이블을 처분표(convert/copy/skip/legacy-sp)와 대조 — 미분류 발견 시 중단
② 이관 테이블의 레거시 전용 컬럼 허용목록 대조(소리 없이 버려질 데이터 검출)
③ **절단 위험**: 레거시 컬럼 정의가 타깃보다 넓으면 실데이터 최대 길이 대조(sql_mode='' 환경에서 유일한 방어선)
④ od/ct 상태값 전수 대조(미지 상태 중단) ⑤ 쿠폰 cp_id UNIQUE 충돌(기이관 동일 행은 통과)
⑥ 템플릿 상품 4종 존재 ⑦ 엔진·규모 정보. 위반은 `--allow-unknown`으로만 강등 가능(검토 후 의식적으로).

## 5. 변환 규칙 요약

- **금액(치명)**: 레거시 라인 공급가 → 그룹(활성/취소류)별 `vat=floor(Σ×0.1)` 최대잔여법 배분으로 **부가세 포함가** 변환(`money-convert.ts`, 단위테스트). 헤더(od_cart_price/od_misu/od_tax_mny 등)는 신규 `computeOrderMoney`로 재산출 → **이후 admin 전이/취소 재계산과 항등**(verify "금액 항등" 0건 불일치 실증).
- **상태**: 동일 문자열 통과 + `전체취소→취소` 매핑 + od `부분취소`는 활성 라인 최전진 상태로 해소. 미지 상태는 게이트 중단(`status-map.ts` — g5-db.ts 비공개 상수 미러, 변경 시 동기).
- **EAV→spec**: **subj 문자열 기준**(슬롯 무관 — 세대별 슬롯 충돌 대응), 1세대 별칭·오탈자 정규화, menu 오염 정규화(+it_name 접두 폴백), 미지 subj는 `_legacy.rawSpec` 격리(`eav-mapper.ts`). `_legacy`에 itId/ctId/odId/원본명/공급가/연락처/설문 보존.
- **cart 재작성 한정**: `it_id·it_name("템플릿명 · 파일명")·ct_price=0·io_id·io_price·io_type=0·ct_option(buildOptionSummary)`만 재작성, **나머지 전부 보존**(ct_status·ct_qty·ct_notax·ct_send_cost·it_sc_*·ct_point·ct_history·ct_time/ip·**ct_stock_use(재고 판정 입력 — 0 강제 금지)**·ct_select=1).
- **회원**: 교집합 복사(+NOT NULL 무default 명시 채움), mb_1~10 제외, admin/kpeter 등 타깃 기존재 스킵(주소록은 예외 — 타깃 0건이면 이관). 프로필 승격 매핑은 schema.prisma 주석 참조.
- **처리 순서(od 단위)**: 헤더 → 라인마다 [옵션행 → cart(ct_id 확보) → SpQuote → SpOrderSpec(**ctId 포함 생성** — 반쪽 상태 창 없음) → SpFile(원장 pathToken)] → SpOrderBizInfo.
- **quoteStatus**: 주문까지 간 견적이므로 전건 `quoted` + `finalPrice`(VAT 포함), `pricedBy='legacy-migration'`, `priceVersion='legacy-migration'`.

## 6. P1 리허설 실증 (2026-07-07, 2020-12 덤프 → samplepcb 사본)

수치: 회원 863(+프로필 273·소셜 413·포인트 3,754행·주소록 632) · 주문 1,206 · 라인 1,487
(standard 1,248 / metalMask 91 / advance 22 / flexible 19 / ca20계열 11 / ca30계열 20 / unknown 76)
· spec/quote 각 1,438(상품행 부재 49는 플레인 복사) · 세금계산서 535 · 게시판 6종 신설+글 242·첨부 59
· 쿠폰 2 · 1:1 106. **verify 전 항목 통과 + 재실행 삽입 전부 0(완전 멱등)**. 전 phase 소요 ~2분(로컬).

**리허설이 잡아낸 것(게이트/검증의 존재 이유)**:
1. `g5_shop_coupon_zone` 처분 누락 → 게이트 중단으로 발견(스킵 등록).
2. **mb_id 절단**: 레거시는 이메일 아이디(255 확폭 운영, 최대 29자) ↔ 타깃 표준 20자 → 유니크 충돌.
   → `prepareTargetSchema`가 타깃의 모든 `mb_id` varchar(<255)를 255로 확폭(23개 테이블) + sp측 `mbId/pricedBy` VARCHAR(191) 마이그레이션. 게이트에 실데이터 길이 검사 신설.
3. **it_basic 최대 ~1MB** → SpOrderSpec.message TEXT(64KB) 절단 위험 → MEDIUMTEXT 확폭.
4. **레거시 od_misu 는 저장값이 레거시 자체 산식과도 559건 불일치**(2019 초기 VAT 항 부재 구산식·취소 잔재) → "레거시 misu 항등"은 불변식이 아니라 참고 대조로 강등. 정본 = 신규 산식 항등(0건 불일치).
5. 레거시 `g5_point.mb_id`는 20자 그대로라 **장문 아이디 회원의 포인트 원장이 레거시에서 이미 절단**(351행 고아) → 실태 보존+센서스 버킷 보고(잔액 mb_point는 회원 행으로 보존됨).

## 6-B. P2·P3 실증 (2026-07-07, 운영 풀 덤프 20260702 → 로컬 실 DB까지)

**P2 게이트가 잡은 운영 드리프트 5건과 처분**(전부 코드 반영):
`g5_shop_cart_tmp` 잔재 테이블(2022 멈춤·PHP 참조 0건)→skip · `open_market` 신설 게시판(글 11)→이관 목록 추가 ·
`mb_currency/sub_currency/country`(전원 KRW 기본값+실정보 5명)→legacyJson(KRW 제외) ·
`po_rel_id` 34자(코어가 mb_id 기록)→255 확폭 · `od_name` 261자/1,880건(운영 varchar(1000) 실사용)→1000 확폭.

**규모/결과**: 회원 6,245 · 주문 15,924 · 라인 20,565(spec/quote 20,443 + 오염 라인 122 플레인) ·
세금계산서 11,085 · 포인트 39,889행(레거시 절단 고아 3,241행 스킵) · 게시판 9종(공지 28·QA 706 등) ·
소셜 2,998(회원 삭제 고아 1 제외). **전체 실행 ~6분**, verify 전 항목 통과, 레거시 misu 참고 차이 890건
(자기산식 불일치 — §6 4번과 동일 성질). P3(로컬 실 samplepcb 컷오버)도 wipe→run→verify 그린.

**서비스 레벨 검증(실 API·PHP)**: `/api/admin/orders`(총 15,924·제작 단계 탭 카운트·상세의 과세 분해
64,000+6,400=70,400·PG 정보) · `/api/admin/members`(6,246·배타 카운트) · `/api/admin/pcb-projects`
(20,443·optionSummary·신청자 조인·cartState=ordered 파생) · PHP 공지/QA 게시판 목록·본문 렌더 — 전부 정상.

## 7. 운영 전환 절차 (P2·P3)

1. ~~P2 운영 덤프 리허설~~ ✅ 완료(§6-B — 20260702 덤프, verify 그린).
2. ~~P3 로컬 컷오버~~ ✅ 완료(§6-B — 로컬 samplepcb 에 운영 데이터 이관 완료, 백업으로 복구 가능).
3. **남은 개방 항목 — 거버 실파일**: 운영 `/gerber_files/` 미러(rsync 등, 서버 접근 필요)를 받아
   `MIGRATE_LEGACY_FILES_DIR` 지정 → `migrate:files`(동시성 6, ~1.87만 건 — 시간 실측) →
   `migrate:files -- --relink`(선이관 spec 에 sp_file 보충 — 주문은 이미 이관됐으므로 relink 경로가 정본).
   `data/file/open_market`·`member_image` 폴더도 운영 미러에서 복사(로컬 레거시 소스에 없음 — 리포트 노트).
4. **운영(진짜 프로덕션) 전환 시**: 같은 절차를 운영 인프라에서 반복 — 최신 덤프 재확보(20260702 이후 증분),
   wipe → run → verify → **화면 실측**(레거시 회원 로그인=구형 해시 자동 재해시 · 소셜 로그인 ·
   /shop/orderinquiry 상태 배지 · admin 드로어 전이 1회 왕복 후 원복 · 게시판 첨부 다운로드).
   비밀번호 없는 실계정 로그인 실측은 이 단계에서만 가능(로컬은 해시만 보유).

## 7-B. 운영 컷오버 런북 (수작업 잔여물 전부 명세 — 로컬 실증에서 도출)

> 원칙: **DB 항목은 전부 스크립트가 나른다**(소셜 설정도 misc phase 에 승격됨 — 수작업 금지),
> 코드 항목은 git 배포가 나른다. 아래 체크리스트 밖의 수작업이 새로 생기면 스크립트/문서에 먼저 승격할 것.

### T-준비 (컷오버 전, 여유 있게)

- [ ] **코드 배포**: 마이그레이션 커밋(코어 최소 수정 `lib/common.lib.php` get_member 필터 포함!)이 운영 코드에 포함됐는지 — 이 수정 없이는 이메일 아이디 회원 전원 로그인 불가(§8).
- [ ] **sp 스키마**: 운영 공유 DB에 `prisma migrate deploy`(4개 마이그레이션 — reset/dev 금지).
- [ ] **템플릿 상품 4종 시드**(`seed-template-items`) — 게이트가 부재 시 중단하므로 선행.
- [ ] **덤프 루틴 확정**: `mysqldump -u<계정> -p --default-character-set=utf8 hyoh9150 > hyoh9150-$(date).dump` — 리허설·최종 동일 명령. 리허설 덤프로 `migrate:gate` 돌려 **드리프트 0** 확인(20260702 이후 스키마 변경이 있으면 여기서 잡힘).
- [ ] **파일 미러**: 운영 `/gerber_files/`(rsync)·`data/file/open_market/`·`data/member_image/` 로컬/스테이징 미러 확보.
- [ ] **파일 사전 업로드**: `migrate:files`(FILE_SERVICE_TYPE=gerber, 동시성 6) — ~1.87만 건 소요 시간 실측이 곧 컷오버 창 산정 근거. 파일은 불변이라 며칠 전 미리 돌려도 안전(원장 재사용).
- [ ] `.env.migration` 운영값 작성(소스=최종 덤프 임포트 DB, 타깃=운영 공유 DB) + sp-node `.env`(SPCB_BRIDGE_URL 등 — HANDOFF WP3 항목).

### T-0 (컷오버 창)

1. 레거시 사이트 **쓰기 동결**(점검 모드) → 최종 덤프 → 임포트.
2. `migrate:wipe -- --yes`(신규 테스트 거래만 — 회원·게시판·설정 보존) ※ 운영 첫 개통이라 테스트 데이터가 없으면 스킵.
3. `migrate:gate` → `migrate:run` → `migrate:verify` **전 항목 통과 확인**(실측: 운영 전량 ~6분).
4. `migrate:files -- --relink`(최종 덤프에서 늘어난 신규 주문 파일 증분 + sp_file 보충).
5. **화면 실측**: 이메일 아이디 회원 로그인(자동 재해시) · 소셜 로그인(운영 도메인 콜백) · /shop/orderinquiry 상태 배지 · admin orders/quotes/members · 게시판 글/첨부.
6. DNS/nginx 전환.

### 사후

- [ ] 소셜 콜백 도메인 확인(도메인 변경 시 각 제공자 콘솔에 redirect URI 추가).
- [ ] CS 공지: 비회원 주문(95건) 조회는 관리자 대리조회(§8).
- [ ] 롤백 수단: 레거시는 읽기만 했으므로 **DNS 원복이 곧 롤백**. 신규 DB는 컷오버 직전 백업 보관.

## 8. 운영·CS 정책 메모

- **이메일 아이디 로그인(코어 최소 수정 — 기록된 예외, 2026-07-07)**: 이관 회원 3,224명의 mb_id 가
  이메일 형식인데, 신규 코어 `get_member()`(lib/common.lib.php:994)가 보안 패치로 영숫자·`_` 외
  문자를 거부해 **회원 조회 자체가 실패**했다(레거시는 이 필터를 주석 처리해 운영). 해시는 무죄 —
  구형 41자 폴백은 정상(실측: PASSWORD() 비교 identical). 조치: 허용 문자에 `@ . -` 3종만 추가
  (`[^0-9a-z_@.\-]` — 실데이터에 그 외 특수문자 0명). **subtree pull 충돌 시 같은 취지로 재적용.**
  실증: 이메일 아이디+구형 해시 시드 계정 HTTP 로그인 성공 + 코어가 첫 로그인에 자동 재해시
  (mb_password→`sha256:12000:…`, 구해시는 mb_password2 보관 — login_password_check 경로).
- **소셜 로그인 설정**: 소셜 키는 `g5_config`(cf_social_*·cf_naver/kakao/google/facebook/twitter/payco_*)
  에 있는데 g5_config 는 "신규 설정 유지" 처분이라 이관에서 제외됐었다 → **15개 컬럼만 선별 복사**
  (2026-07-07, cf_social_login_use=1 · servicelist naver,kakao,facebook,google,payco). 로그인 페이지
  소셜 버튼 노출 확인. ⚠ 프로바이더에 등록된 콜백 URL 은 운영 도메인(www.samplepcb.co.kr) 기준이라
  **로컬에선 인증 완주 불가**(버튼·설정 확인까지만) — 운영 전환 시 이관된 소셜 프로필 2,998명이
  (provider, identifier) 매칭으로 그대로 로그인된다.
- **비회원 주문 95건**: 신규 코어의 od_pwd 조회는 구형 해시 폴백이 없어(회원 로그인 경로만) 이관 후 비회원 주문조회 단절 → **관리자 대리조회**로 안내.
- 이관 견적은 `priceVersion='legacy-migration'` — **향후 "만료 견적 정리 배치"는 `sp_order_spec.quoteId` 참조 견적을 반드시 제외**(1.87만 건 삭제 후보화 방지, HANDOFF 결정 로그 기록).
- 관리자 회원 드로어의 "레거시 사업자 정보(mb_1~9)" 패널은 이관 후 빈값 — `sp_member_profile` 조회로 교체 필요(후속).
- `extend/sp_order_status.extend.php:22` `'A\S'` 오타(A/S가 고객 목록 '주문취소' 표기) — 기존 버그, 이관 데이터로 대량 노출되므로 수정 권장(후속).
- 신규 회원가입은 여전히 그누보드 표준(아이디 3~20자) — 이메일 아이디는 레거시 이관 회원에 한함(로그인은 확폭으로 정상).

## 9. 파일 색인

| 역할 | 위치(apps/api 기준) |
|---|---|
| 오케스트레이터/게이트 | `src/scripts/migrate/run.ts` · `manifest.ts`(처분표) |
| phase | `phases/01-members.ts` · `02-shop.ts`(핵심 변환) · `03-boards.ts` · `04-misc.ts` |
| 공용 lib | `lib/{money-convert,eav-mapper,status-map,schema-prep,g5-writer,ledger,context,util}.ts` (+ 단위테스트 3종) |
| 파일/정리/검증 | `upload-files.ts` · `wipe-test-data.ts` · `verify.ts` |
| 스키마 | `prisma/migrations/20260707010000_legacy_migration_profile_bizinfo` · `20260707040000_widen_mbid_mediumtext` |
| env | `.env.migration.example` (실파일 `.env.migration`은 gitignore) |
