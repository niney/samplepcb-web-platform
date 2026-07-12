# AI 연동 — 시스템 구성도 자동 생성 (Ollama)

2026-07-12. 재능마켓 의뢰 위저드에 "시스템 구성도" 스텝을 추가하고, 그 기반으로 **범용 AI
유스케이스 실행 계층**을 신설했다. 프롬프트는 프로빙(모델 5종 × 변형 3종, 13런 + 사용자
피드백)으로 확정한 것이 기본값이다.

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

- 운영 서버에 로컬 Ollama 가 없으면 baseUrl=`https://ollama.com` + API 키(ollama.com 발급)로
  전환한다 — 클라이언트는 동일 코드 경로(Authorization Bearer).
- 마이그레이션 `20260712200000_ai_usecase_diagram`(sp_ai_usecase CREATE + diagramHtml ADD) —
  additive, `migrate deploy` 전용.
- 새 유스케이스 추가 = 계약 `AI_USECASES` + 레지스트리 def + (필요시 FE) — 설정 행·화면은
  자동(lazy 생성·목록 렌더).
- E2E: `e2e-market.mts` 에 diagramHtml 왕복 1항목 포함(총 92). LLM 실호출은 E2E 에 없음
  (Ollama 의존) — 실생성 검증은 수동/스크립트.
