# AI 연동 — 시스템 구성도 자동 생성 (Ollama)

2026-07-12. 재능마켓 의뢰 위저드에 "시스템 구성도" 스텝을 추가하고, 그 기반으로 **범용 AI
유스케이스 실행 계층**을 신설했다. 프롬프트는 프로빙(모델 5종 × 변형 3종, 13런 + 사용자
피드백)으로 확정한 것이 기본값이다.

같은 날 2차로 **인터뷰 파이프라인(Phase 1)** 을 얹었다 — 질문 기획 PDF(질문 설계서 v3 ·
ROC 질문 뱅크 v4) 기반, 별도 프로빙(P1~P4, 11런, `.tmp/ai-interview-probing/`)으로 검증 후
구현. 상세는 §6.

## 1. 구조 (3계층)

| 계층 | 저장/코드 | 내용 |
|---|---|---|
| 연결 | `sp_config` (`ai_base_url`, `ai_api_key`) | Ollama 주소·키. 키 원문은 어떤 API 응답에도 없음(마스킹만) |
| 유스케이스 | `sp_ai_usecase` (useCase PK) | enabled·model·promptTemplate. 행은 레지스트리 기준 **lazy 생성** |
| 실행 | `apps/api/src/lib/ai/` + `routes/ai.ts` | 얇은 Ollama 클라이언트 + 유스케이스 레지스트리 + 인메모리 잡 |

- **라우트는 범용, 정책은 케이스별**: `POST /api/ai/:useCase/run` 은 공통이지만 입력 스키마·
  프롬프트 바인딩은 `lib/ai/usecases.ts` 레지스트리가 유스케이스별로 명시한다.
- **비동기 잡**: 생성이 수 분(glm-5.2 ~3분)이라 run 은 jobId 즉시 반환 → `GET /api/ai/jobs/:id`
  5초 폴링. 잡은 인메모리(단일 인스턴스 전제) — 서버 재시작 시 소실=클라이언트 재시도.
- **스트리밍 필수**: Ollama 호출은 `stream:true` 로 받는다. 비스트림은 undici 헤더 타임아웃
  (~300s)에 걸려 장시간 생성이 실패한다(프로빙 실측).

## 2. 유스케이스: market.request-diagram

- 의뢰 위저드 "설명·자료" 뒤에 **관리자 활성 시에만** "시스템 구성도" 스텝이 나타난다
  (동적 스텝 — 비활성이면 스텝 자체가 없음). 생성 중에도 다음 스텝 진행 가능(비차단),
  완료 시 미리보기 반영. 미완료 상태로 제출하면 구성도 없이 등록된다.
- 결과는 `sp_market_project.diagramHtml`(MEDIUMTEXT, 512KB 상한)에 저장. 공개 범위는
  description 과 동일(설명에서 파생된 것). 상세 화면(고객·관리자) 표시.
- **렌더는 반드시 sandbox iframe(srcdoc)** — LLM 산출 HTML 을 DOM 에 직결하면 XSS.
- **외부 전송은 제목·분야·설명 텍스트뿐** — 사용자 첨부 파일은 절대 보내지 않는다(NDA 원칙).
  위저드에 전송 고지 문구 표시.
- 재생성 횟수 제한은 현재 없음(사용자 결정) — 남용 시 잡 시작 지점에 rate limit 추가.

## 3. 프로빙 확정 사항 (2026-07-12)

- **기본 모델 `glm-5.2:cloud`**(1위, ~170초) · 차선 `deepseek-v4-pro:cloud`(71초) ·
  `minimax-m3` 는 내용 최다지만 720초라 부적합 · `gpt-oss:120b` 는 레이아웃 붕괴.
- **참조 이미지 불필요**: 이미지 첨부 변형은 텍스트 상세 명세 변형보다 레이아웃이 무너졌다.
  참조 이미지의 내용 커버리지를 "도메인 중립 체크리스트"(전원 체인·저장/디버그·외부 시스템
  패널·옵션류)로 텍스트화한 프롬프트가 전 모델에서 승리 → **멀티모달 제약 없음**.
- 최소 지시는 스타일 미달 — 레이아웃 골격(3열·단일 svg viewBox·직교 연결선)과 색·표기
  규칙을 명시하는 것이 결정적.
- 부품은 역할명 + (TBD)/(Option)만 — 구체 모델명 표기 금지(사용자 확정).
- 기본 프롬프트 정본: `lib/ai/usecases.ts` `DIAGRAM_DEFAULT_PROMPT`(관리자가 화면에서 수정
  가능 — DB 값이 우선, 코드 기본값은 신규 행 생성 시에만 쓰임).

## 4. 관리자 화면

`/app/admin/settings` → "AI 연동" 탭:
- 연결: API 주소(기본 `http://127.0.0.1:11434` — 로컬 데몬이 클라우드 모델 프록시, 키 불요) ·
  API 키(입력=교체·비움=유지·체크=삭제, 저장 후엔 마스킹만 표시) · **연결 테스트**(모델 목록
  조회 — 성공 시 모델 셀렉트 datalist 로 사용).
- 유스케이스: 사용 토글 · 모델 · 프롬프트 템플릿(`{{title}}`/`{{serviceAreas}}`/`{{description}}` 치환).

## 5. 운영 메모

- **연결 우선순위: `.env`(AI_BASE_URL·AI_API_KEY) > 관리자 화면 저장값 > 기본값**
  (`http://127.0.0.1:11434`). 운영 키는 `.env` 파일 관리 권장(DB 에 안 남음) — env 가
  잡혀 있으면 관리자 화면의 해당 입력은 잠기고 ".env 값 우선" 안내가 뜬다.
  `.env.example` 의 AI 섹션 참조. env 변경은 API 재시작 후 반영.
- 운영 서버에 로컬 Ollama 가 없으면 `AI_BASE_URL=https://ollama.com` + API 키(ollama.com
  발급)로 전환한다 — 클라이언트는 동일 코드 경로(Authorization Bearer). ollama.com 직결
  시 모델명에 `:cloud` 접미사가 없을 수 있으니 연결 테스트 목록에서 재선택.
- 마이그레이션 `20260712200000_ai_usecase_diagram`(sp_ai_usecase CREATE + diagramHtml ADD) —
  additive, `migrate deploy` 전용.
- 새 유스케이스 추가 = 계약 `AI_USECASES` + 레지스트리 def + (필요시 FE) — 설정 행·화면은
  자동(lazy 생성·목록 렌더).
- E2E: `e2e-market.mts` 에 diagramHtml 왕복 + diagramSpec 왕복·파손 400 + rocMd 왕복·
  인터뷰 답변 미노출 + 포스팅 카드 왕복·분야 필터 + 전체서비스 입찰 403 포함(총 97).
  LLM 실호출은 E2E 에 없음(Ollama 의존) — 실생성 검증은 수동/스크립트.

## 6. 인터뷰 파이프라인 (Phase 1, 2026-07-12)

질문 기획 PDF(질문 설계서 v3 · ROC 질문 뱅크 v4)의 파이프라인
`질문/답변 → 구조화 → 구성도(+후속 문서)` 중 Phase 1(인터뷰+명세+구성도)을 구현.
**사용자 확정 3건**: 코어 10문항 내외 · ROC(작업검토지시서)는 Phase 2로 분리 ·
갭 감지(P3)는 별도 호출 없이 P1 의 questions_missing 으로 흡수.

### 구조 — spec JSON 이 피벗

- 유스케이스 3종: `market.request-structurize`(답변→**DiagramSpec JSON**) →
  `market.request-diagram-spec`(spec→구성도 HTML). 기존 `market.request-diagram`
  (설명→HTML 단발)은 **인터뷰 비활성 시 폴백**으로 유지 — 프롬프트가 DB(관리자 소유)라
  의미를 바꾸지 않고 유스케이스를 추가하는 쪽을 택했다.
- 위저드 게이트: structurize·diagram-spec **둘 다 활성**이면 인터뷰 UI, 아니면 legacy
  diagram 활성 시 기존 단발 UI. 스텝 자체는 셋 중 하나라도 활성이면 노출.
- **질문 뱅크는 데이터(코드)**: `@sp/api-contract` `AI_INTERVIEW_QUESTIONS`를 공통 3문항
  (개발 단계·결과물·보유 자료)과 분야별 모듈(회로/PCB/펌웨어·제품/기구·앱·서버·
  Linux/Windows SW)로 구성한다. `getApplicableAiInterviewQuestions(serviceAreas)`가 FE
  노출과 서버 미응답 계산의 단일 판정 함수다. 분야 미지정 시스템 통합은 공통 질문만,
  복수 분야는 질문 합집합을 사용한다. 전 문항 선택 사항 — 적용 질문의 미응답만 프롬프트의
  "미응답 항목"으로 넘어가 TBD·추가질문으로 돌아온다. LLM 역할은 구조화·추가질문 생성·
  렌더 3종뿐, 인터뷰 흐름은 결정적.
- 관리자 DB에 과거 하드웨어 전용 프롬프트가 저장돼 있어도 실행 시 `분야 적용 정책`을
  앞에 붙인다. 순수 앱·서버·Linux/Windows SW에는 전원·MCU·센서·PCB 블록 생성을 금지하고,
  제품·기구 단독 의뢰도 전자 하드웨어가 명시된 경우에만 해당 블록을 허용한다.
- 위저드 UX: 질문 폼 → "AI 구성 명세 만들기"(~30초) → **요약 카드(블록·그룹·TBD 목록) +
  AI 추가 질문(questions_missing, 보강 입력 → 재구조화)** → "이 명세로 구성도 생성"(~3분,
  비차단). 제출 시 `diagramSpec`(+`diagramHtml`) 저장.
- 저장: `sp_market_project.diagramSpec`(MEDIUMTEXT, 정규화 직렬화본) — 구성도의 원천
  데이터이자 Phase 2(ROC·포스팅 요약) 파생의 근원. 공개 범위는 description 동일.
  마이그레이션 `20260712230000_market_diagram_spec`(additive).

### 검증 계층 (프로빙 실측 기반)

- **DiagramSpec zod 스키마**: enum 이탈은 `.catch`로 안전값 흡수(프로빙 실측 — glm·deepseek
  모두 SWD 연결에 `flow:"debug"` 슬립), 구조 결함은 `normalizeDiagramSpec`이 보정(미정의
  그룹 자동 생성·끊긴 연결 제거·중복 블록 제거). **실패 대신 복구가 원칙.**
- 러너: parseResult throw 시 동일 프롬프트 재호출(structurize 는 1회) — JSON 완전 파손만
  재시도 대상. 서버 저장 시에도 재검증(`parseDiagramSpecString`) — 파손 spec 은 400
  `INVALID_DIAGRAM_SPEC` (이관 specJson `_legacy` 교훈: 저장 전 형태 통제).
- 프롬프트 보강: 그룹 수 2~7 상한(8개→렌더 겹침 실측) · 하드웨어/소프트웨어별 그룹
  후보 분리(순수 SW 의뢰에 전원·MCU 블록 생성 금지) · 서버 연동
  답변 시 External System 블록 강제 · 미확정 점검 체크리스트(안테나·인증·방열·검사·커넥터
  ·소비전류) · 답변에 없는 모델명 금지.

### 프로빙 근거 (2026-07-12, `.tmp/ai-interview-probing/`)

- P1 구조화 4런: JSON 유효 4/4·환각 0·TBD 규율 준수. P2 렌더 2런: 라벨 충실도 49/49
  (골든 30/30 + P1 산출 파이프라인 19/19). P3 갭 감지 3런: 크리티컬 재현율 16/16,
  부분 답변 인지 후속질문. P4 ROC 1런: 서식 10/10 — Phase 2 근거 확보.
- 스모크: `.tmp/smoke-interview.mts`(활성화→structurize→렌더→원복, apps/api 에서
  `tsx --env-file=.env ../../.tmp/smoke-interview.mts`).

### Phase 2 — 작업검토지시서 (2026-07-12 구현)

- 유스케이스 `market.request-roc`: 구성 명세 + 인터뷰 답변 + 의뢰 텍스트 → 10섹션
  마크다운 지시서(프로빙 P4 프롬프트의 의뢰 분야 일반형). 서식 게이트(섹션 8개 미만
  재시도 1회) + (TBD)·9번 수집 규율.
- **노출 정책**: description 과 동일(구성도와 같은 원칙) — 견적 낼 전문가·검수자가 보는
  것이 목적. 포스팅 유형별(회로/PCB/FW…) 분리는 포스팅 시스템 트랙(별도)에서.
- 저장: `sp_market_project.rocMd`(MEDIUMTEXT) + `interviewAnswers`(JSON, **응답 미노출**
  저장 전용 — 재생성·Phase 3 파생의 근원). 마이그레이션 `20260713010000_market_roc_answers`.
  원천(spec) 제거 시 파생(rocMd) 동반 제거.
- 위저드: 명세 확정 후 "작업검토지시서 생성(선택)"(~1분) → 미리보기 + 첨부 체크.
  게이트는 인터뷰 활성 && roc 활성. 상세 화면(고객·전문가)은 `RocViewer`
  (마크다운 **라인 파서** 렌더 — LLM 산출이므로 v-html 금지).

### Phase 3 — 분야별 포스팅 카드 + 전체서비스 입찰 제한 (2026-07-12 구현)

**사용자 확정 3건**: ① 단일 의뢰 유지 + 분야별 AI 카드(분리 입찰 아님 — 계약·정산이
프로젝트당 1건 구조) ② 전체서비스(시스템 통합) 제한은 **입찰만**(목록·상세는 공개,
기획 PDF §13.4 의 완화형) ③ 검수자 포스팅은 제외(검수자 역할 자체가 없어 별도 기획).

- 유스케이스 `market.request-postings`: 명세+답변 → 분야별 카드 JSON(요약·작업범위·
  산출물·확인 필요 리스크). 의뢰 분야 코드만 허용, 중복 카드 dedupe, 재시도 1.
- 저장 `sp_market_project.postings`(JSON, `MarketPostingCards`) — 서버가 의뢰 분야 밖
  카드를 걸러 저장, 응답은 `toPostings` 로 형태 정규화(파손분 null). 공개 범위는
  description 동일. spec 제거 시 동반 제거. 마이그레이션 `20260713020000_market_postings`.
- **입찰 정책**: `requestType=system` && `expertType=individual` → 403
  `FULL_SERVICE_COMPANY_ONLY`(market-bids 가드 사슬). FE 는 useExpertMe 로 같은 규칙을
  선반영(버튼 숨김 + 안내 문구), 상세 포스팅 섹션에 제한 배지 표시.
- 위저드: 명세 확정 후 "분야별 카드 생성(선택)" → 카드 미리보기 + 첨부 체크.

검수자 포스팅·분리 입찰(포스팅 엔티티)은 미구현 — 검수자 역할 기획이 서면 별도 트랙.
