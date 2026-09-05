# 회사 위치 페이지 + 문의 접수(Contact Us) 검토 메모

> 상태: **결정 대기**(2026-09-06). 피그마 「GNB > 회사 위치」 두 프레임을 검토한 결과와, 폼으로 들어오는 새 문의를 어디서 받을지에 대한 진단.
> 관련: docs/FIGMA_PAGES.md(피그마 페이지 대장), docs/MAIL_LOG.md(발송 원장), 회사소개 `/about`·연혁 `/history` 구현(같은 패턴).

## 1. 피그마 프레임

| 프레임 | 노드 | 크기 | 내용 |
|---|---|---|---|
| GNB > 회사 위치 | 2122:6908 | 1920×2518 | 남색 배너(620px: "Office Location" + 영문 문구 + `Search the office / Choose continent` 드롭다운 + 점 세계지도·발광 점) → Contact Us 폼 → 푸터 |
| GNB > 회사 위치 (지사 선택 시, 위치 안내) | 2122:7157 | 1920×3030 | 같은 배너에 드롭다운 2개(`East Asia` / `Republic of Korea`) → 배너 하단에 걸친 흰 카드 「SamplePCB 위치 안내」(본사 A-1303호·070-8667-1080·info@samplepcb.co.kr, 공사 A-1407호 + 지도 700×650) → 같은 Contact Us 폼 → 푸터 |

두 프레임은 **한 페이지의 두 상태**(지사 선택 전/후). `/location` 한 페이지로 만들고, 기본은 선택 완료 상태(두 번째 프레임)로 보여 주면 된다. 드롭다운은 동작하되 실제 지사는 광명 한 곳이라 선택지가 하나.

### Contact Us 폼 필드(피그마 그대로)
- 2열: 이름 / 연락처 · 이메일 / 회사명·소속기관명 · 부서 / 직급 (input 600×72, 라벨 20px)
- 방문경로 라디오: 온라인검색 · 네이버 블로그 · 유투브 채널 · 사이트 직접 방문 · 지인 추천
- 문의 내용 textarea 1280×160
- 동의: (필수) 개인정보 수집·이용 동의 / (선택) 마케팅 활용 동의 + "내용보기" 버튼
- 「문의하기」 버튼 182×56, #1e64fd 계열

### 피그마 오류·애매(피그마대로 두거나 최소 교정하고 기록)
- 입력창 placeholder 가 회원가입 폼 복사본("Create password" / "Confirm your password") → 항목명에 맞는 문구로 써야 함.
- 문의 내용 textarea 의 라벨이 "직급"으로 중복 → "문의 내용".
- 두 번째 프레임 브레드크럼이 "회사연혁" → "회사위치".
- 배너 영문 문구 "We are a global SamplePCB company. We have offices worldwide…" 는 지사 한 곳인 실제와 어긋남 → 피그마대로 두고 기록.
- 대륙·국가 드롭다운은 선택지 하나짜리 형식 UI → 기록.
- 지도는 네이버 지도 **스크린샷**(2122:7330) → 레거시가 쓰던 구글 지도 임베드(iframe, API 키 불필요)로 살아있는 지도 권장. 레거시 `theme/samplepcb/company_v2/location.php` 에 광명SK테크노파크 임베드 URL 있음.
- 개인정보 수집·이용 동의 본문·마케팅 동의 문구는 피그마에 없음 → 개인정보처리방침 페이지(`content/privacy`) 링크로 대신하고 실제 문구 필요.
- 점 세계지도의 발광 점 3개(한국 부근)는 장식.

## 2. 문의 접수 경로 진단 — 지금 시스템에 무엇이 있나

- 일반 "문의 폼"을 받는 경로는 **없다**. 있는 것: 그누보드 게시판(qa 질문답변·faq·notice), PHP `mailer()`(lib/mailer.lib.php), sp-node `lib/mailer.ts` + 발송 원장 `sp_mail_log`(docs/MAIL_LOG.md), sp-vue 관리자 콘솔(`/app/admin/*`, 메일 이력 화면 `AdminMailLogs.vue` 포함), 로컬 메일은 Mailpit(docs/LOCAL_MAIL_TESTING.md).
- reCAPTCHA 같은 봇 방어는 없음.
- 주문 축의 "확인 요청"(/eq)·"A/S 접수"(/as)는 주문에 묶인 흐름이라 일반 문의와 다르다.

### 후보 비교

| 방식 | 장점 | 단점 |
|---|---|---|
| **A. 그누보드 게시판(질문답변)에 글로 저장** | 코드 거의 없음, 관리자 알림 메일은 게시판 설정으로 가능 | 부서·직급·방문경로·동의 같은 구조 필드가 없음(wr_1~wr_10 편법), 공개 게시판이라 스팸·노출, 관리는 /adm 게시판 화면 |
| **B. PHP 단독: 새 g5 테이블 + `mailer()` 로 메일** | 반나절 | 플랫폼 관례(Prisma·발송 원장·sp-vue 관리자)에서 벗어난 별도 섬. 동의 기록·상태 관리도 따로 만들어야 함 |
| **C. sp-node: `sp_contact_inquiry` 모델 + `POST /api/contact` + 관리자 `/app/admin/inquiries` + 알림 메일(원장 기록)** | 구조 필드·동의 기록(시각·IP)·상태(신규/처리중/완료)·발송 이력을 기존 틀로 재사용. honeypot·rate limit 넣기 쉬움 | 하루 정도. 공유 DB 마이그레이션(추가 전용, `migrate deploy` 규율) |

### 추천: C
- 이유: 개인정보 동의를 받는 폼이라 **동의 시각·IP 보관**이 필요하고, 방문경로는 나중에 **집계**해야 하는 마케팅 필드. 둘 다 A·B로는 어색하다. 관리자가 문의를 보는 곳도 이미 sp-vue 콘솔로 모이고 있다.
- MVP 범위
  1. Prisma `SpContactInquiry`(`sp_contact_inquiry`): name, phone, email, company, dept, position, source(방문경로 enum), content, privacyAgreedAt, marketingAgreedAt(null 허용), ip, userAgent, mbId(로그인 시), status(new/in_progress/done), memo, createdAt. 추가 전용 마이그레이션.
  2. 계약 `packages/api-contract/src/schemas/contact.ts` + 라우트 `apps/api/src/routes/contact.ts`: `POST /api/contact`(무인증, honeypot 필드, IP 기준 rate limit, zod 검증) → 저장 → 담당자 알림 메일(info@samplepcb.co.kr, kind `contact_inquiry`) + 접수자 자동 회신(kind `contact_inquiry_ack`) — 둘 다 `recordMailLog`.
  3. 관리자: `GET /api/admin/contact`(목록·상태 필터) · `PATCH /api/admin/contact/:id`(status·memo) + `AdminInquiries.vue`(목록·상세·상태 변경, 메일 이력은 MailLogList 재사용).
  4. sp-php `/location`(`spcb/pages/location.php` + `css/location.css` + `img/location/`): 배너·카드·지도·폼. 폼은 같은 도메인 `/api/contact` 로 fetch, 성공 시 안내 문구, 실패 시 인라인 오류.
- 나중: 마케팅 동의 목록 내보내기, 알림톡, reCAPTCHA(스팸이 실제로 오면).

## 3. 결정할 것
1. 접수 방식 A / B / **C(추천)**.
2. 담당자 알림 수신 주소(기본 info@samplepcb.co.kr)와 자동 회신 여부.
3. 개인정보 수집·이용 동의 문구(법무)와 보관 기간.

## 4. 구현 순서(C 확정 시)
① sp-node 모델·API·알림 메일 → ② 관리자 문의함 → ③ `/location` 페이지 → ④ 데스크톱 좌표·390px 모바일 계측 → ⑤ FIGMA_PAGES.md 기록·커밋. 페이지 구현 패턴은 `/about`·`/history` 와 같다(`spcb/pages/<slug>.php` + `css/<slug>.css` + `img/<slug>/`, 배너 블록 재사용, 피그마 y−94).
