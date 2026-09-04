# 지시서 — 개발의뢰(sp-develop) P2 고객 앱: 견적 수락·결제·문의·검수 (worker A3)

리포 `D:\work\workspace_other\samplepcb-web-platform`. 브랜치 `feat/develop-mvp`(체크아웃됨 — 브랜치 변경·커밋 금지).
먼저 읽을 것: `docs/AI_WORKFLOW_PLAYBOOK.md` · `AGENTS.md` · `samplepcb-web-mono-app/AGENTS.md` · 정본 `docs/DEVELOP_FLOW.md`(§4·§5·§8) · P1 지시서 `docs/prompts/develop-phase1a-app.md`(규칙·디자인 토큰 동일).

## 0. 한 줄 요약
P1 고객 앱(`samplepcb-web-mono-app/apps/develop`, typecheck/lint 0, 브라우저 완주됨)에 **P2·P3 고객 행동**을 붙인다. 서버 라우트는 전부 있고 API 하네스(`ops/scripts/e2e-develop.mts`) 110/0 으로 검증됐다 — 화면만 만든다.

## 1. 불변식
P1 지시서 §1 과 같다(파일 스코프 `apps/develop/src/**`, 다른 패키지 읽기만, 타입 강성, 계약·`@sp/ui`, 커밋 금지, 네이티브 alert/confirm 금지). 다른 워커가 `apps/web`(관리자)에서 병렬 작업 중 — 그 파일에 손대지 말 것.

## 2. 서버 라우트(prefix `/api`, 소유자 JWT) — `apps/api/src/routes/develop-requests.ts` 가 실체(추측 금지)
| 행동 | 라우트 | body | 응답 | 실패 |
|---|---|---|---|---|
| 견적 수락 | `POST /develop/requests/:id/quotes/:qid/accept` | `DevelopQuoteAcceptBody` `{agree:true, name}` | `DevelopRequestDetailResponse`(갱신 상세) | 409 `QUOTE_NOT_OPEN`·`QUOTE_EXPIRED` |
| 견적 거절 | `POST …/quotes/:qid/decline` | `DevelopQuoteDeclineBody` `{reason?}` | 상세 | 409 `QUOTE_NOT_OPEN` |
| 문의·A/S | `POST …/comments` **multipart**(`payload` JSON 파트 = `DevelopCommentBody` `{body, asRequest}` + 파일 파트 임의 이름) | | `DevelopEventResponse` | 409 `INVALID_TRANSITION`(종결) |
| 마일스톤 결제 | `POST …/milestones/:mid/checkout` | 없음 | `DevelopCheckoutResponse` `{redirectUrl}` → `window.location.assign(redirectUrl)`(영카트 주문서) | 409 `NOT_PAYABLE`·`ALREADY_PAID`·`NO_CART_ID`·`ORDER_PENDING`, 503 `ANCHOR_ITEM_MISSING` |
| 검수 확정 / 수정 요청 | `POST …/deliveries/:eventId/confirm` · `…/changes` | `DevelopReviewDecisionBody` `{note?}` | 상세 | 409 `INVALID_TRANSITION` |
| 중간 확인 승인 / 수정 요청 | `POST …/review-requests/:eventId/approve` · `…/changes` | `{note?}` | `DevelopEventResponse` | |
결제 뒤 돌아온 화면은 상세를 **재조회**하면 lazy 승격이 반영된다(서버가 GET 에서 승격). `NO_CART_ID` 는 JWT 에 cartId 가 없을 때 — `useAuthStore().bootstrap()` 을 한 번 다시 부른 뒤 재시도(마켓 `ContractCard.vue` 의 checkout 관례 참고).

## 3. 확정 설계
- **QuoteCard**(`components/detail/QuoteCard.vue`): `status==='sent'` 이고 유효기간 안이면 하단에 **수락 패널**(표준 조건 접힘 + "위 조건에 동의합니다" 체크 + 이름 입력(연락처 이름 프리필) + `견적 수락` 버튼) + `거절`(인라인 사유 입력, 선택). `expired` 는 "유효기간이 지났습니다 — 담당자에게 재견적을 요청하세요" 안내. accepted 견적의 마일스톤 표에 **결제 버튼**(`payable` 인 행만, 금액·시점 표기) + `paid` 행은 결제일·주문번호(`payment.odId`)·`payment.odStatus==='주문'` 이면 "입금 확인 중" 배지. 결제 버튼은 로딩·에러 인라인.
- **문의 작성기**(`components/detail/CommentComposer.vue`): 타임라인 섹션 상단 — textarea + 파일 첨부(`FileDropZone` variant slot 재사용 가능) + 보내기. `status==='completed'` 이면 "A/S 요청으로 보내기" 토글(`asRequest`). 종결(cancelled/declined)이면 작성기 숨김. 전송 후 상세 재조회(invalidate).
- **검수 패널**: `status==='delivered'` 이면 타임라인의 마지막 `deliverable`(payload.final) 이벤트 아래 **검수 확정 / 수정 요청** 버튼(각각 인라인 메모 선택). 확정 시 잔금 마일스톤이 payable 되므로 안내 문구("확정 후 잔금 결제가 열립니다") 한 줄. 검수 기한(`reviewDays`·`deliveredAt`)으로 자동확정 예정일 표기.
- **확인 요청 응답**: 타임라인의 `review_request` 이벤트 중 **아직 답하지 않은 것**(그 뒤에 review_approved/changes 이벤트가 없는 것)에 `승인 / 수정 요청` 버튼(+메모).
- **Me.vue**: `nextAction` 칩 클릭 → 상세의 해당 섹션 앵커(`#quotes`·`#timeline`).
- **에러 코드 → 문구**: `lib/error-msg.ts` 사전에 위 코드들이 이미 있다. 없는 코드는 추가.
- 훅: `api/useDevelopRequests.ts` 에 `useAcceptQuote`·`useDeclineQuote`·`usePostComment`(multipart)·`useCheckoutMilestone`·`useDeliveryDecision`·`useReviewRequestDecision` 추가, 성공 시 `['develop']` invalidate.

## 4. 검증
1. `pnpm --filter develop typecheck && pnpm --filter develop lint` → 0.
2. 브라우저(P1 지시서 §4 (a) 방식 — e2e helpers 스텁 로그인, nginx 통합 도메인 `https://local-web.samplepcb.co.kr/develop/`): 상세에서 수락 패널 → 수락 → 마일스톤 결제 버튼 → checkout 호출이 `redirectUrl` 을 돌려주는지(실제 이동은 주문서라 확인만; `NO_CART_ID` 면 재부트스트랩 경로가 도는지) → 문의 작성 → 검수 패널 렌더. 데이터는 API 하네스가 만든 `[e2e]` 의뢰를 쓰거나(`cd samplepcb-web-mono-app/apps/api && pnpm exec tsx --env-file=.env ../../../ops/scripts/e2e-develop.mts run` 이 3건 생성, 끝나면 `cleanup`), 관리자 JWT 로 견적을 하나 만들어 발송한다(하네스 `quoteBody` 참고). **AI 실행 라우트는 부르지 말 것.** pageErrors 0.
3. 만든 데이터는 `[e2e]` 접두, 끝나면 정리(하네스 cleanup 또는 직접 삭제).

## 5. 함정
- 마일스톤 `payment` 는 카트행이 있을 때만(null 허용). `payable` 은 서버 파생 — 화면이 다시 계산하지 말 것.
- 수락 패널 이름 기본값은 `detail.contact.name`.
- 결제 리다이렉트는 같은 오리진(`/shop/orderform.php`) — `window.location.assign`.
- `.vue` 발 타입 ESLint 오탐(리포 메모리) — 추론 타입 + `as const`.

## 6. 문서·보고
`docs/DEVELOP_FLOW.md` §7.2 단락에 P2 화면 한두 줄 보강. 최종 보고 = 변경 파일 / 이탈 / 계약·서버 요청 / 검증 결과(방식·pageErrors·만든 데이터 정리 여부) / 남긴 이슈.
