# 협력사 포털 — BOM/PCB 모듈 분리 설계 (정본)

> 2026-08-10 재설계(R1~R2 구현 완료). 트랙별 업무 정본은 각각
> [SMARTBOM_PARTNER_RFQ.md](SMARTBOM_PARTNER_RFQ.md)(BOM)·[PCB_PARTNER_TRACK.md](PCB_PARTNER_TRACK.md)(PCB) —
> 이 문서는 **포털의 정보 구조(IA)·진입 규칙·셸**의 정본이다.

## 1. 배경·원칙

혼합 홈(구 PartnerRfqs.vue)은 한 화면에 BOM 카드 4장과 PCB 섹션이 섞여 "보내기·회신·
발주"가 트랙별로 두 벌 존재했고, 보내기 화면도 두 개(📦 보내기 / 📦 PCB 보내기)라
오해를 낳았다(사용자 판정). **관리자 콘솔의 검증된 패턴(D9: 모듈 스위처 + 모듈별
메뉴·화면, 모듈 간 화면 공유 금지)을 포털에 미러**한다 — 컴포넌트 코드 재사용은 허용,
화면(라우트) 공유만 금지. 구 URL 은 리다이렉트 잔재 없이 완전 제거(사용자 방침).

## 2. 진입 규칙 — capability 가 단일 진실

모듈 노출·진입 근거 = 조직 `capabilities`(`bom_rfq`/`pcb_rfq` — 관리자 파트너 관리에서
부여·변경, `part_sale` 은 포털 모듈이 아님). 서버 `GET /api/partner/access` 가
`tracks: {bom, pcb}` 로 파생해 내려준다(관리자가 트랙을 바꾸면 다음 조회부터 반영).

```
/partner 진입(리졸버 PartnerEntry — 정식 진입점, 포털 메일 전수가 이 URL 만 가리킴):
  비파트너      → 안내(승인된 파트너 아님)
  트랙 0        → 안내(참여 트랙 없음 — 담당자 문의)
  트랙 1        → 그 모듈(기억값 무시)
  트랙 2        → localStorage 'sp.partnerModule' 기억값이 현재 트랙에 유효하면 그 모듈,
                  없거나 무효(트랙 회수)면 BOM 우선
```

- 기억은 모듈 홈 마운트 시 기록(`partner/partnerModule.ts`), 리졸버가 검증 후 사용.
- capability 없는 모듈 URL 직접 진입 → 모듈 홈이 안내 + 보유 모듈 링크(프론트 UX 가드 —
  보안 축은 기존 그대로: 서버가 배정 데이터 자체를 주지 않는다).
- 매직링크(`/rfq-reply`, `/pcb-rfq-reply`)는 포털 밖 공개 라우트 — 무관.

## 3. 정보 구조 (라우트 맵)

```
/partner                     PartnerEntry(리졸버)
├─ /partner/bom              PartnerBomHome — 회신할 견적·확인할 발주·📦 보내기·진행 발송·완료
│   bom/rfqs/:id             PartnerRfqDetail
│   bom/pos/:id              PartnerPoDetail
│   bom/ship                 PartnerShip([📦 보내기] §6.11 두 칸)
│   bom/shipments/done       PartnerShipmentsDone
├─ /partner/pcb              PartnerPcbHome — 회신할 견적·진행할 발주(EQ)·📦 보내기·진행 발송·완료
│   pcb/rfqs/:id             PartnerPcbRfqDetail
│   pcb/pos/:id              PartnerPcbPoDetail(발송은 읽기 요약 — 조작은 보드)
│   pcb/ship                 PartnerPcbShip([📦 PCB 보내기] 보드 — PCB §9 박스 모델)
│   pcb/shipments/done       PartnerPcbShipmentsDone(R2 신설 — BOM done 미러)
└─ /partner/remittances      PartnerPcbRemittances — 공통 영역(모듈 밖)
```

- **공통 영역**: 모듈 소속이 본질이 아닌 화면(수금 현황 등)은 억지 배속하지 않는다
  (사용자 결정). 현재 수금 데이터는 PCB 발주 대금뿐이라 셸 네비 노출 조건은 tracks.pcb —
  BOM 수금이 생기면 같은 자리에서 자연 확장.
- 셸(`layouts/PartnerLayout.vue`): 로고(→리졸버) + 모듈 스위처(BOM 부품/PCB 제작 —
  보유 트랙만) + 공통 네비(수금 현황) + 테마·프로필.

## 4. 홈 구성 (트랙 어휘 대칭)

| | BOM 홈 | PCB 홈 |
|---|---|---|
| 카드 4장 | 회신할 견적 / 확인할 발주 / 📦 보낼 물건 / 진행 중 발송 | 회신할 견적 / 진행할 발주(EQ·MD 입고 차례) / 📦 보낼 물건(+생산 진행 중 보조) / 진행 중 발송 |
| 섹션 | 회신할 견적·확인할 발주·진행 중 발송(카드) | 회신할 견적·진행할 발주 |
| 보조 | 모든 발주서·회신한 견적·완료 발송 링크 | 회신한 견적·완료 발송 링크 |

## 5. 완료 아카이브 (R2)

BOM `GET /partner/shipments?tab=done`(기존) 미러로 PCB
`GET /partner/pcb-shipments/done?page&pageSize` 신설(완료 = 최종 상태 도달 또는 입고
확인, 최신순 페이지네이션) + `PartnerPcbShipmentsDone` 화면. 홈엔 건수 링크만(§6.11).

## 6. 검증

- 서버 스모크(자족 시드→검증→무잔재): PCB 보드 29케이스 + access tracks 2케이스
  ALL PASS(2026-08-10 기준, scratchpad 소멸 전제 — E2E 정착은 아래).
- **E2E 기반 검증으로 전환 중**(사용자 방침) — 준비 작업은 별도 세션(e2e-test)이 진행,
  인수인계는 리포 루트 `HANDOFF_E2E_TEST.md`(gitignore). 준비 완료 후 본 구현 세션이
  시나리오 작성·실행.
- 남은 수동 확인: tester(협력1)·tester2(협력2) 로그인 실탐방 — 리졸버·스위처·두 홈·
  보내기 왕복·완료함·수금 네비(자격증명 입력 불가로 자동화 제외).

## 7. 이력

- 2026-08-10 R1: tracks 계약·리졸버·스위처·라우트 재편·홈 2분할·혼합 홈 제거 (`9582d3fd6`)
- 2026-08-10 R2: PCB 완료 발송 아카이브 신설, 이 문서 신설
- 선행: PCB 발송 박스 모델 재구성(`608fb1b12`, PCB_PARTNER_TRACK.md §9) · MD 소속 관리
  (`9d9dd4681`)
