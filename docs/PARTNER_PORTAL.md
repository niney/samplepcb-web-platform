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
├─ /partner/parts            PartnerParts — 공통 영역(모듈 밖, tracks.parts)
│   parts/uploads/:id        PartnerPartUpload(← 보유 부품 — 열 역할 교정·반영)
└─ /partner/children         PartnerChildren — 공통 영역(tracks.pcb ∧ canManageChildren, §5.1)

/partner-invite/:token       PartnerInviteAccept — 포털 셸 밖(초대 수락, §5.1)
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

## 5.1 하위 협력사 직접 관리 (2026-10-09)

마스터딜러가 **포털에서 자기 하위 협력사를 등록·수정·삭제**한다(`/partner/children`, 공통 영역).
그전에는 관리자만 파트너 관리의 '마스터딜러 소속'에서 연결할 수 있었다(그 경로는 그대로 있다).

- **메뉴 노출** — 견적 트랙(PCB 제작·부품 조달) 중 하나라도 보유 ∧ 다른 마스터딜러의 하위가 아님
  (`access.canManageChildren`). 2단 제한이라 남의 하위는 하위를 둘 수 없다.
- **등록은 자동 승인** — 승인 절차를 두면 "쉽게 쓴다"는 목적이 깨진다. 조직(`type=partner`·국가 필수)과
  소속 링크가 한 번에 서고, **소유**(`sp_partner.ownerPartnerId`)와 등록 계정
  (`createdBy`)이 남는다. 사후 감독은 관리자 몫: 운영자 통지 메일(`partner_child_registered`),
  파트너 관리의 '마스터딜러 등록' 배지·필터(`origin=md`), 사업자번호·이메일이 같은 조직의 '중복 의심'.
- **회원은 만들지 않는다** — "정상 가입한 회원만 연결, 가짜 회원 없음"(SMARTBOM_PARTNER_RFQ §1)을
  지킨다. 하위는 계정 없이 매직링크로 견적을 회신하고, 발주 이후는 마스터딜러가 대행한다. 계정이
  필요하면 **초대**: 1회용 링크(64hex·14일, `sp_partner_invite`)를 메일로 보내고, 받은 사람이
  **자기 계정으로** 로그인해 수락하면 연결된다(`/partner-invite/:token` — 조회 공개, 수락 로그인).
  1계정=1조직 가드는 관리자 계정 연결과 같다. 그누보드 회원 삭제는 행을 지우지 않고 아이디를
  영구 보관하므로(`member_delete`) "함께 만들고 함께 지우기"는 애초에 성립하지 않는다.
- **대행 안내 메일** — 계정 없는 하위에 가는 메일은 포털 버튼 대신 대행 안내를 싣는데, 마스터딜러가
  발주한 건이면 대행 주체와 문의처가 그 마스터딜러다("발주처(조직명)"). 판정은 문서의 발주처로
  한다(`resolvePcbPortalCta` — PCB_PARTNER_TRACK.md 기록 참조).
- **진행 중 판정** — 삭제·사용 중지·소속 해제를 막는 "진행 중 건"은 두 트랙을 함께 센다: PCB 견적·발주
  (`activePairDocCount`) + 부품 조달의 회신 왕복 중 견적요청·수령 전 하위 발주(`activeBomPairDocCount`,
  SMARTBOM_PARTNER_RFQ D47-9).
- **맡길 일(트랙)** — 조직과 소속 링크는 트랙 공용이고, 하위마다 맡길 일을 정한다: PCB 제작 견적
  (`pcb_rfq`)·부품 조달 견적(`bom_rfq`). 줄 수 있는 것은 **내가 가진 견적 트랙 안**뿐이다
  (`resolveChildCapabilities` — 생략하면 내 트랙 전부, 내게 없는 트랙만 고르면 409
  `TRACK_NOT_ALLOWED`). 내 트랙이 하나뿐이면 화면에 고를 것이 없고, 둘이면 등록·수정 폼에 체크 상자가
  선다. 바꾼 값은 이후 배정부터 적용된다. 부품 조달 쪽 중개는 SMARTBOM_PARTNER_RFQ §6.42(2026-10-09 —
  그전에는 PCB 트랙에만 있어 화면이 "현재 PCB 제작 견적에만 쓰입니다"라고 밝혔다).
- **소유 경계** — 수정·삭제·초대는 내가 등록한 조직에만. 관리자가 연결해 준 하위는 목록에
  '관리자 연결'로 보이기만 한다(`NOT_OWNED`). 소유 조직은 다른 마스터딜러의 후보·관리자 직접
  배정 후보에 섞이지 않는다(관리자 PCB 배정 모달은 `origin=admin`).
- **삭제 = 이력이 없을 때만 진짜 삭제** — 문서 이력이 있으면 같은 버튼이 '사용 중지'
  (`status=suspended` + `ownerSuspendedAt`)로 수렴한다. 진행 중 견적·발주가 있으면 막는다
  (`RELATION_ACTIVE`, 관리자 소속 해제와 같은 판정 `activePairDocCount`). 마스터딜러는 **자기가
  중지한 것만** 되살린다 — 관리자가 상태를 바꾸면 표식이 지워져 `NOT_OWNER_SUSPENDED`.
- **첫 등록 = 마스터딜러 전환** — 진행 중 직속 발주가 있으면 막고(`PARENT_HAS_ACTIVE_POS`), 폼을
  열기 전에 어느 발주가 끝나야 하는지 보여 준다(`eligibility`). 발주 방식은 발주서마다 박제
  (`fulfillmentMode`)라 전환해도 진행 건은 바뀌지 않으므로 이 차단은 정책이다. 발주가 끊이지 않는
  협력사가 영영 걸리지 않게 **관리자만 사유를 남겨 넘는다**(파트너 관리의 `force`+`forceReason`,
  또는 대리 접속의 `forceReason` — 링크에 `forceNote`·`createdBy` 로 남는다). 구조 제약(2단 제한·
  승인 상태)은 강제로도 못 넘는다.

## 5.1.1 마스터딜러 지정 (2026-10-10)

그전에는 "하위 소속 링크가 하나라도 있으면 마스터딜러"라는 파생 판정뿐이라, 관리자가 하위 없이 마스터딜러를
만들 수 없었다. 이제 조직에 **표시**(`sp_partner.isMasterDealer`)가 있고 그것이 역할의 정본이다. 실제 위임의
근거는 여전히 소속 링크이고(발주 방식은 발주서마다 `fulfillmentMode` 로 박제), 표시는 화면·가드에만 쓴다.

- **켜지는 길 셋** — ① 관리자가 파트너 등록·수정에서 '마스터딜러'를 켠다(사람 협력사만, 아니면 400
  `NOT_PARTNER_TYPE`) ② 관리자가 하위를 연결한다 ③ 협력사가 포털에서 첫 하위를 등록한다(자기 등록 경로는
  유지 — 사용자 결정 2026-10-10). 마이그레이션(`20261010160000_partner_master_dealer_flag`)이 이미 하위가 있는
  조직을 켜 두었다.
- **끄기** — 관리자만, 하위가 없을 때만(409 `HAS_CHILDREN`). 하위를 지워도 표시는 남는다.
- **2단 제한** — 표시가 켜진 조직은 하위 후보에서 빠지고 하위로 연결할 수 없다(400 `CHILD_IS_MD`). 다른
  마스터딜러의 하위는 켤 수 없다(409 `PARENT_IS_CHILD`).
- **전환 가드** — 첫 하위 등록·연결의 진행 중 발주 차단(`PARENT_HAS_ACTIVE_POS`·`conversionBlock`)은 역할
  전환일 때만이다. 이미 지정된 조직은 막지 않는다.
- **화면** — 관리자 파트너 관리: 등록·상세 폼의 **유형 칸 옆** '마스터딜러' 체크(사람 협력사일 때만, 설명은 툴팁 —
  하위가 연결돼 있거나 다른 마스터딜러의 하위면 잠기고 툴팁이 이유를 말한다), 목록·상세 배지, 필터 '마스터딜러만'
  (`role=md`). 목록에서 바로 켜고 끄는 토글은 두지 않는다(행 클릭과 겹쳐 오조작·확인 단계 없음).
  포털 하위 협력사: 하위 0명이어도 지정된 조직엔 첫 등록 안내(`PartnerChildListData.isMasterDealer`).
- **검증** — e2e `journey:mddesignate` 7/7(지정 등록·필터·공급사 거절·후보 제외·하위 연결 거절·포털 안내·
  하위 있는 동안 끄기 거절·자기 등록 자동 지정·관리자 화면 체크 등록·하위 있는 마스터딜러 체크 잠금) · `journey:children` 7/7 회귀(CH5 는
  강제 등록 뒤 지정이 남는 것을 확인하고 관리자가 끈 뒤 관리자 화면 경로를 본다).

## 5.2 관리자 대리 접속 (2026-10-09)

관리자가 **그 조직의 자리에서 포털을 쓴다** — 파트너 관리 상세의 [포털로 보기]가
`/app/partner?actAs=<조직 id>` 를 새 탭으로 연다(계정 없는 조직·정지된 조직도 열린다).

- **방식** — 그누보드 세션을 바꿔 그 회원으로 로그인하지 않는다(무계정 조직엔 불가능하고 세션
  쿠키 충돌을 다시 부른다). 관리자 토큰 + 요청 헤더 `x-sp-act-as-partner` 하나이고, 판정은
  `requirePartner`·`/partner/access` 두 곳이 같은 함수(`lib/partner-act-as.ts`)를 쓴다. 관리자가
  아니면 403. 화면 쪽 상태는 탭 단위(sessionStorage)라 관리 콘솔 탭은 영향받지 않는다.
- **읽기·쓰기 모두 된다.** 접근 범위는 그 조직의 것뿐이다(라우트의 소속 검사는 그대로).
- **기록** — ① 쓰기 요청은 전부 `sp_partner_act_log`(관리자·조직·경로·결과)에 남고 파트너 관리
  상세의 '대리 접속 이력'에 보인다. ② 이력에 주체 자리가 있는 곳은 관리자 대행 표기를 따른다:
  EQ 전이 `byRole=ADMIN`, EQ·선적 첨부 `uploadedBy=ADMIN`, 박스·포장 이벤트 `actorType=ADMIN`
  (관리자 화면의 만능 대행 D11 과 같은 표기 — PCB 는 `{kind:'admin'}` 액터). A/S 첨부만은
  `PARTNER` 그대로다 — 그 값이 주체가 아니라 "접수 자료/회신 자료" 구분이기 때문이다.
- **셸** — 대리 접속 중에는 붉은 띠가 조직명과 "관리자 대행으로 기록됩니다"를 늘 보이고,
  [나가기]는 상태를 지우고 파트너 관리로 통째로 새로 읽는다(포털 조회 캐시를 버린다).

## 6. 검증

- 하위 협력사 직접 관리·대리 접속(2026-10-09): `e2e journey:children` 7/7(등록·소유 경계·초대·
  삭제/사용 중지·전환 가드와 강제 전환·대리 접속 권한과 기록·화면) · 거버 없이 같은 경로를 밟는
  회귀 13본 green · 거버 제출로 시작하는 여정 1호·2호·4호·12호·20호 green · api 단위 테스트 ·
  typecheck·lint(변경 파일) clean.
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
- 2026-10-09 하위 협력사 직접 관리(§5.1) + 관리자 대리 접속(§5.2): 공통 메뉴 `children`
  (`requiresChildren`) · `PartnerChildren`·`PartnerInviteAccept` 화면 · 셸 대리 접속 띠 ·
  `sp_partner` 소유 3컬럼·`sp_partner_invite`·`sp_partner_act_log`(마이그레이션
  `20261009120000_partner_children_self_service` — 운영은 `migrate deploy` 필요)
- 2026-10-10 마스터딜러 지정(§5.1.1): `sp_partner.isMasterDealer`(마이그레이션
  `20261010160000_partner_master_dealer_flag` — 운영은 `migrate deploy` 필요) · 관리자 등록·수정 체크·배지·필터 ·
  포털 하위 0명 안내 · e2e `journey:mddesignate`
- 선행: PCB 발송 박스 모델 재구성(`608fb1b12`, PCB_PARTNER_TRACK.md §9) · MD 소속 관리
  (`9d9dd4681`)
