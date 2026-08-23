# 협력사 포털 — BOM/PCB 모듈 분리 설계 (정본)

> 2026-08-10 재설계(R1~R2 구현 완료) · 2026-08-22 R3(사이드바 셸 + 워크큐 목록). 트랙별 업무 정본은
> 각각 [SMARTBOM_PARTNER_RFQ.md](SMARTBOM_PARTNER_RFQ.md)(BOM)·[PCB_PARTNER_TRACK.md](PCB_PARTNER_TRACK.md)(PCB) —
> 이 문서는 **포털의 정보 구조(IA)·진입 규칙·셸**의 정본이다.

## 1. 배경·원칙

혼합 홈(구 PartnerRfqs.vue)은 한 화면에 BOM 카드 4장과 PCB 섹션이 섞여 "보내기·회신·
발주"가 트랙별로 두 벌 존재했고, 보내기 화면도 두 개(📦 보내기 / 📦 PCB 보내기)라
오해를 낳았다(사용자 판정). **관리자 콘솔의 검증된 패턴(D9: 모듈 스위처 + 모듈별
메뉴·화면, 모듈 간 화면 공유 금지)을 포털에 미러**한다 — 컴포넌트 코드 재사용은 허용,
화면(라우트) 공유만 금지. 구 URL 은 리다이렉트 잔재 없이 완전 제거(사용자 방침).

**R3(2026-08-22) — 하이브리드 셸.** R1 의 포털은 홈(오늘 할 일 카드)을 허브로 모든 하위
화면이 "← 홈"으로만 이어지는 허브-앤-스포크였다. 회신한 견적·모든 발주서는 홈에 접힌
아카이브로 쌓이고, A/S·완료된 발송·수금은 건수가 있을 때만 링크가 떠 포털의 지도를 학습할
수 없었으며, '내 차례' 신호는 홈을 벗어나면 사라졌다(사용자 지적: "관리자처럼 왼쪽 패널로
이동"). 그래서 **관리자 셸을 미러한 좌측 사이드바(모듈 메뉴 + 공통 그룹 + 배지)** 를 얹되,
포털의 기존 방식(모듈 홈 = 오늘 할 일 카드·진입 리졸버·모듈 기억·헤더 스위처)은 그대로
둔다. 사이드바가 가리킬 **워크큐 목록(견적요청·발주서)** 을 신설해 홈의 아카이브를 옮겼다.

## 2. 진입 규칙 — capability 가 단일 진실

모듈 노출·진입 근거 = 조직 `capabilities`(`bom_rfq`/`pcb_rfq` — 관리자 파트너 관리에서
부여·변경). 서버 `GET /api/partner/access` 가 `tracks: {bom, pcb, parts}` 로 파생해
내려준다(관리자가 트랙을 바꾸면 다음 조회부터 반영).
`part_sale`(→ `tracks.parts`)은 **모듈이 아니라 공통 영역**이라 모듈 스위처에는 등장하지
않고 사이드바 공통 그룹에만 뜬다(2026-08-23, docs/PARTNER_PARTS.md).

```
/partner 진입(리졸버 PartnerEntry — 정식 진입점, 포털 메일 전수가 이 URL 만 가리킴):
  비파트너      → 안내(승인된 파트너 아님)
  트랙 0        → 안내(참여 트랙 없음 — 담당자 문의)
  트랙 1        → 그 모듈(기억값 무시)
  트랙 2        → localStorage 'sp.partnerModule' 기억값이 현재 트랙에 유효하면 그 모듈,
                  없거나 무효(트랙 회수)면 BOM 우선
```

- 기억은 모듈 홈 마운트 시 기록(`partner/partnerModule.ts`), 리졸버가 검증 후 사용.
- capability 없는 모듈 URL 직접 진입 → 모듈 홈·목록이 안내 + 보유 모듈 링크(프론트 UX 가드 —
  보안 축은 기존 그대로: 서버가 배정 데이터 자체를 주지 않는다). 사이드바는 그 모듈 메뉴를
  그리지 않는다.
- 매직링크(`/rfq-reply`, `/pcb-rfq-reply`)는 포털 밖 공개 라우트 — 무관.

## 3. 정보 구조 (라우트 맵)

```
/partner                     PartnerEntry(리졸버)
├─ /partner/bom              PartnerBomHome — 오늘 할 일 카드 4장 + 회신할 견적·확인할 발주·진행 중 발송
│   bom/rfqs                 PartnerBomRfqs(R3 워크큐 — 탭 todo 회신할/done 회신함/all, ?tab=)
│   bom/rfqs/:id             PartnerRfqDetail(← 견적요청)
│   bom/pos                  PartnerBomPos(R3 워크큐 — 탭 todo 확인할/active 진행 중/done 완료/all)
│   bom/pos/:id              PartnerPoDetail(← 발주서)
│   bom/ship                 PartnerShip([📦 보내기] §6.11 두 칸 + R3: 진행 중 발송 카드)
│   bom/shipments/done       PartnerShipmentsDone
├─ /partner/pcb              PartnerPcbHome — 카드 4장 + A/S·미수금 배너 + 회신할 견적·진행할 발주·진행 중 발주(관전)
│   pcb/rfqs                 PartnerPcbRfqs(R3 워크큐 — todo/done/all)
│   pcb/rfqs/:id             PartnerPcbRfqDetail(← 견적요청)
│   pcb/pos                  PartnerPcbPos(R3 워크큐 — todo 내 차례/watching 진행 중/all)
│   pcb/pos/:id              PartnerPcbPoDetail(← 발주서 — 발송은 읽기 요약, 조작은 보드)
│   pcb/ship                 PartnerPcbShip([📦 PCB 보내기] 보드 — PCB §9 박스 모델)
│   pcb/shipments/done       PartnerPcbShipmentsDone
│   pcb/as                   PartnerPcbAs
├─ /partner/remittances      PartnerPcbRemittances — 공통 영역(모듈 밖, tracks.pcb)
└─ /partner/parts            PartnerParts — 공통 영역(모듈 밖, tracks.parts)
    parts/uploads/:id        PartnerPartUpload(← 보유 부품 — 열 역할 교정·반영)
```

- **공통 영역**: 모듈 소속이 본질이 아닌 화면(수금 현황·보유 부품)은 억지 배속하지 않는다
  (사용자 결정). 항목마다 노출 트랙이 달라 조건은 **메뉴 항목이 들고**(`requiresTrack`)
  셸이 건다 — 수금은 tracks.pcb(현재 데이터가 PCB 발주 대금뿐), 보유 부품은 tracks.parts.
  BOM 수금이 생기면 같은 자리에서 자연 확장.
- **보유 부품(2026-08-23)**: 협력사 재고표 업로드·원장. 모듈이 아니라 공통 영역인 이유는
  BOM/PCB 어느 쪽 업무도 아니고 조직의 자산이기 때문. 정본 [PARTNER_PARTS.md](PARTNER_PARTS.md).
- **워크큐 목록(R3)**: 서버 목록 API 는 전량 반환이라 탭·검색·페이지(20건)는 클라이언트에서.
  탭은 `?tab=`(기본 탭은 쿼리에서 생략, `partner/useRouteTab.ts`) — 홈 카드·메일 딥링크가 특정
  탭으로 바로 보낼 수 있다. 건수가 커지면 서버 페이지네이션으로 전환한다.

### 3.1 셸 (`layouts/PartnerLayout.vue`, R3)

관리자 `AdminLayout` 동형. 좌측 사이드바(w-60, `lg` 미만은 햄버거 드로어) + 헤더 + 본문.

- **사이드바** = 로고(→리졸버)·"파트너 포털"·조직명 / 활성 모듈 메뉴 그룹 / 공통 그룹(수금,
  tracks.pcb). 메뉴 정의는 `partner/menu.ts`(관리자 `admin/menu.ts` 동형 — `labelKey`(i18n
  `partner.*`)·`badge`·`activeRouteNames`). 활성 모듈 = 라우트에서 파생(`resolvePartnerModuleKey`),
  리졸버·공통 영역처럼 모듈 밖 라우트에선 리졸버와 같은 규칙(기억값 유효 → 그것, 아니면 보유 첫
  모듈). 상세(rfqs/:id·pos/:id)는 `activeRouteNames` 로 상위 메뉴가 켜진다.
- **배지** = "지금 움직여야 하는 수" — 견적요청(회신할)·발주서(확인할/내 차례)·📦 보내기(보낼 물건 +
  준비 중 박스 + BOM 내 차례 발송)·A/S(회신 대기)·수금(미수금 건). 데이터는 홈 카드와 **같은 쿼리
  캐시**(`partner/usePartnerWork.ts` — 목록 훅에 `enabled` 인자를 더해 트랙별로 켠다) 라 카드 숫자와
  어긋나지 않고 추가 요청도 없다. 건수가 커지면 서버 summary 엔드포인트로 전환.
- **헤더** = 햄버거(<lg) · 모듈 스위처(**보유 트랙이 2개일 때만** — 1트랙은 사이드바 상단 모듈명이
  정체성, 좁은 화면엔 헤더에 모듈명) · 테마(`AppThemeToggle` — 관리자·기본 셸과 공용 추출) ·
  사이트 홈 · 프로필.
- **본문** = 관리자와 같이 **좌측 정렬**(가운데 띄우지 않음, `p-3 sm:p-6`) + **최대 너비 1440px**(초광폭에서 줄이
  무한정 길어지지 않게 — 사용자 결정 2026-08-22). 보내기 보드도 같은 폭(2열 각 ~700px 로 충분, meta.wide 미사용).
- **페이지 헤더** = `components/partner/PartnerPageHeader.vue`(제목·부제·← 복귀·배지 슬롯) 로 통일.
  최상위 화면(홈·목록·보내기·완료·A/S·수금)은 복귀 링크 없음(사이드바가 이동), 상세만 "← 견적요청 /
  ← 발주서"(목록으로). 예전의 "← 홈 / ← 목록 / ← 파트너 홈" 혼재·A/S 의 복귀 링크 부재·수금의
  리졸버 경유 깜빡임을 한 번에 정리.
- 모듈 색 = 포털의 정체성(BOM indigo / PCB teal / 공통 amber) — 활성 메뉴·탭·CTA 가 같은 결.

## 4. 홈 구성 (트랙 어휘 대칭)

| | BOM 홈 | PCB 홈 |
|---|---|---|
| 카드 4장 | 회신할 견적 / 확인할 발주 / 📦 보낼 물건 / 진행 중 발송 | 회신할 견적 / 진행할 발주(EQ·MD 입고 차례) / 📦 보낼 물건(+생산 진행 중 보조) / 진행 중 발송 |
| 배너 | — | A/S 회신 대기(있을 때) · 미수금(있을 때) |
| 섹션 | 회신할 견적·확인할 발주(행 컴포넌트, "모든 … →" 목록 링크)·진행 중 발송(카드) | 회신할 견적·진행할 발주·진행 중 발주(관전 — MD 하위 반려·수주 위임 추적) |
| R3 에서 옮긴 것 | 모든 발주서·회신한 견적 아카이브·완료된 발송 링크 → 사이드바(발주서·견적요청·완료된 발송) | 회신한 견적 아카이브·완료된 발송·A/S 내역 링크 → 사이드바 |

행은 `components/partner/Partner{Bom,Pcb}{Rfq,Po}Row.vue` — 홈 섹션과 워크큐 목록이 같은 줄을
쓴다(할 일이면 CTA, 아니면 상태 배지 + "보기 →").

## 5. 완료 아카이브 (R2)

BOM `GET /partner/shipments?tab=done`(기존) 미러로 PCB
`GET /partner/pcb-shipments/done?page&pageSize` 신설(완료 = 최종 상태 도달 또는 입고
확인, 최신순 페이지네이션) + `PartnerPcbShipmentsDone` 화면. 홈엔 건수 링크만(§6.11) →
R3 부터 사이드바 메뉴(완료된 발송).

## 6. 검증

- 서버 스모크(자족 시드→검증→무잔재): PCB 보드 29케이스 + access tracks 2케이스
  ALL PASS(2026-08-10 기준, scratchpad 소멸 전제 — E2E 정착은 아래).
- **E2E 기반 검증**(사용자 방침) — `samplepcb-web-mono-app/e2e/`(vitest+playwright-core, 스텁 로그인).
  R3 검증(2026-08-22): `pnpm -F web typecheck`/`lint` clean · `e2e harness`(리졸버 3케이스 포함 7/7) ·
  `pcb-invoice-attach`(보내기 보드 URL 진입) green · 관찰 러너(협력1·협력2·tester2 스텁 로그인,
  14 화면 + 모바일 드로어)에서 pageerror/console error 0, 활성 메뉴·배지 = 카드 숫자 일치 확인.
  셸 라벨을 클릭하는 e2e 스펙은 0건(전부 URL 진입)이라 셸 교체의 e2e 영향 없음.
- 남은 수동 확인: tester(협력1)·tester2(협력2) 실로그인 실탐방 — 리졸버·스위처·두 홈·
  보내기 왕복·완료함·수금 네비(자격증명 입력 불가로 자동화 제외).

## 7. 이력

- 2026-08-10 R1: tracks 계약·리졸버·스위처·라우트 재편·홈 2분할·혼합 홈 제거 (`9582d3fd6`)
- 2026-08-10 R2: PCB 완료 발송 아카이브 신설, 이 문서 신설
- 2026-08-22 R3: 사이드바 셸(`PartnerLayout` 재작성·`partner/menu.ts`·배지 `usePartnerWork`)
  + 워크큐 목록 4화면(`bom/rfqs`·`bom/pos`·`pcb/rfqs`·`pcb/pos`, `?tab=`) + 페이지 헤더 통일
  (`PartnerPageHeader`) + 행 컴포넌트 4종 + BOM 보내기 화면에 진행 중 발송 + i18n `partner.*`
  + `AppThemeToggle` 공용 추출(관리자·기본 셸). 구 URL 변경 없음(추가만).
- 2026-08-23 보유 부품: 공통 영역 2화면(`/partner/parts`·`parts/uploads/:id`) +
  `tracks.parts`(= `part_sale`, 죽어 있던 capability 를 살림) + 공통 메뉴 항목별
  `requiresTrack` 조건. 정본 [PARTNER_PARTS.md](PARTNER_PARTS.md)
- 선행: PCB 발송 박스 모델 재구성(`608fb1b12`, PCB_PARTNER_TRACK.md §9) · MD 소속 관리
  (`9d9dd4681`)
