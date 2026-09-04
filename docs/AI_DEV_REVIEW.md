# AI 사전 검토서 — 재능마켓 의뢰 AI 산출물 재구성 (정본)

> **2026-09-02 v2 간소화 재편 — §12 가 §1·§2·§5 의 해당 부분을 대체한다.** 확정/확인 필요 2상태·9문항·
> 3스텝·그룹형 구성도는 v1 기록이며, 현재 구현은 §12 다.

2026-08-28 결정. 기존 `docs/AI_DIAGRAM.md`(2026-07-12~16, 4산출물 체계)를 **대체**한다. 옛 문서는
경위·프로빙 근거 기록으로만 남기며 구현 정본은 이 문서다.

## 0. 결정 요약 (사용자 확정 2026-08-28)

| # | 결정 | 근거 |
|---|---|---|
| 1 | AI 산출물은 **"AI 사전 검토서" 1건**(명세 JSON·ROC MD·분야별 카드·레거시 HTML 구성도 4종 폐기) | 사용 실적 0(DB 산출물 0건·유스케이스 전부 비활성), 프로토타입이 단일 문서 |
| 2 | **가격 산정 없음**, 개발일정은 **단계 순서만**(주수 없음 — 기간은 전문가 입찰 `durationDays`) | 객관화 불가·근거 없는 수치는 고객이 견적 기준으로 오용 |
| 3 | 항목은 **확정 / 확인 필요** 2상태. 근거(고객 원문 인용) 없는 확정은 서버가 강등·삭제 | 정확도는 프롬프트가 아니라 후처리 규칙이 담보 |
| 4 | 개발 분야 **회로·PCB·펌웨어 3종**만 선택 가능(enum은 읽기 호환 유지) | 플랫폼 성격(PCB 제조사) |
| 5 | `requestType`(개별/시스템 통합) 카드·자동 전환 **UI 제거**, 저장은 파생(2개 이상=`system`), **회사 전용 입찰 제한 폐지** | HW 3분야는 개인이 통으로 수행. "회로+PCB"가 통합이 되어 프리랜서 입찰이 막히던 문제 |
| 6 | 질문은 **고정 9문항 한 화면**(전부 "잘 모르겠어요" 탈출구) — 80문항 은행·선분석·추가 질문 루프 폐기 | 모름=확인 필요로 흘러가므로 질문을 줄일 이유가 없음 |
| 7 | 파이프라인 **2단**: 첨부 판독(비전 모델) → 검토서(주모델, 텍스트) | 주모델 `deepseek-v4-pro`는 텍스트 전용. 첨부 근거 인용 가능 |
| 8 | 프롬프트는 **코드 정본**(버전 태그). 관리자는 사용 토글·모델·첨부 판독 모델·**추가 지침 한 칸**·샘플 테스트·실행 이력만 | DB 프롬프트가 스키마와 어긋나 파서가 깨지는 구조 제거 |
| 9 | sp-rnd(파일 분류·PCB 의뢰서 실험) **삭제** — zip 전개·첨부 판독은 새 파이프라인에 흡수 | 실험 결론이 본 기능에 흡수됨 |
| 10 | 마켓 컨텐츠 너비 1152→**1440px**, 위저드 768→1152px | 검토서·구성도 가독 |
| 11 | 주모델 후보 `deepseek-v4-pro` 우선, 고급 모델 프로빙으로 확정(§9) | |

## 1. 산출물 구조

고객·전문가·관리자가 같은 JSON(`MarketDevReview`)을 같은 뷰(`DevReviewView`)로 본다. 프로토타입
(`samplepcb-development-review` 목업) 섹션과의 대응:

| 섹션 | 원천 | 생성 주체 |
|---|---|---|
| ① 의뢰 브리프 (단계·결과물·수량·전원·통신·외부연동·제약·인증·목표시점 + 핵심 요구 3~8줄) | 9문항 답변 → 코드 / 핵심 요구는 LLM(근거 필수) | 코드 + LLM |
| ② 시스템 구성도 | `DiagramSpec`(기존 스키마 재사용) → `@sp/utils renderDiagramSpecHtml` 결정적 SVG | LLM 명세 + 코드 렌더 |
| ③ 분야별 검토 포인트 (구현 방식·범위 / 주의 리스크+근거 / 확인 필요) | LLM | LLM |
| ④ 개발명세서 (분야별 항목·내용 표, 행마다 확정/확인 필요) | LLM | LLM |
| ⑤ 결과물 목록 | 분야 × 원하는 결과물 사전 | 코드 |
| ⑥ 개발 단계 순서 (기간 없음, 단계별 포함 결과물) | 분야 사전 | 코드 |
| ⑦ 전문가와 확정할 항목 | ③④의 확인 필요 + LLM `openQuestions` 병합·중복 제거 | 코드 파생 |
| 상단 | "확정 N · 확인 필요 M" 배지 + 고정 고지문 | 코드 |

고정 고지문(ROC 면책 대체): **"고객이 제공한 자료에 근거한 AI 사전 검토입니다. '확인 필요' 항목은
전문가 상담에서 확정됩니다."** 판정어("개발 가능·조건부 적합")·리스크 등급·금액·주수는 어디에도 없다.

### 1.1 계약 스키마 (`packages/api-contract/src/schemas/market-dev-review.ts`)

```ts
GroundedItem = { text ≤300, status: 'confirmed'|'needs_confirmation',
                 evidence ≤200 | null, question ≤200 | null, why ≤200 | null }

DevReviewLlmOutput = {            // LLM이 반환하는 부분 (format: JSON schema)
  summary ≤300,
  requirements: GroundedItem[] ≤8,
  diagram: DiagramSpec,           // questions_missing 은 무시(openQuestions 로 통일)
  areas: [{ area: 'circuit'|'pcb'|'firmware',
            scope: GroundedItem[] ≤8,
            risks: [{ text ≤300, evidence ≤200 }] ≤6,
            spec: [{ item ≤60, content: GroundedItem }] ≤15 }],
  openQuestions: [{ topic ≤60, question ≤200, why ≤200, area?: Area }] ≤15,
}

MarketDevReview = 후처리된 DevReviewLlmOutput + {
  version: 1,
  brief: { serviceAreas, answers: DevReviewAnswer[] },   // 서버가 생성 시점에 복사
  meta: { jobId, model, promptVersion, inputHash, generatedAt, attachmentFiles: string[] },
  stats: { confirmed, needsConfirmation },
}
```

결과물 목록·단계 순서·브리프 표시값은 저장하지 않고 `buildDevReviewView(review)`(계약의 순수 함수)가
렌더 시 파생한다 — 사전이 바뀌면 옛 검토서도 새 사전으로 보인다.

### 1.2 확정/확인 필요 후처리 규칙 (서버, 결정적)

원문 코퍼스 = 제목 + 설명 + 9문항 답변(선택지 라벨+메모) + 첨부 추출 텍스트 + 첨부 판독 결과. 비교는
공백 압축·소문자·문장부호 제거 후 부분 문자열, 실패 시 토큰 포함률 ≥ 0.7.

| 규칙 | 대상 | 처리 |
|---|---|---|
| R1 근거 | `confirmed` 항목의 `evidence`가 코퍼스에 없음 | `question`이 있으면 `needs_confirmation`, 없으면 **삭제** |
| R2 수치·품번 | 항목 텍스트의 수치+단위(V·A·mAh·mm·층·layer·주·대…)·품번 패턴(`[A-Z]{2,}[A-Z0-9]*\d{2,}`)이 코퍼스에 없음 | **삭제**(지어낸 값은 갭이 아니라 환각) |
| R3 질문 | `needs_confirmation` 항목에 `question` 없음 | 삭제 |
| R4 구성도 | 블록 라벨의 품번·수치가 코퍼스에 없음 → 제거 + `status=tbd`. 연결 `interface`가 코퍼스에 없음 → `''`(렌더 TBD) | 기존 규칙 유지 |
| R5 병합 | ③④의 `needs_confirmation` 질문 + `openQuestions` → 정규화 중복 제거 → `openQuestions` | |
| R6 빈 섹션 | 분야 `spec` 확정 0건 | 렌더가 "상담 후 작성" 한 줄(표 없음) |
| R7 리스크 | `risks[].evidence` R1 동일(근거 없으면 삭제) | |

프롬프트는 "관행상 통상 필요하다는 이유만으로 confirmed 금지·설계 결정(레이어 수·내부 전압·부품 선정
·기간)은 쓰지 말 것"을 지시하고, 그래도 나오면 R2가 걷어낸다.

## 2. 질문 9문항 (`DEV_REVIEW_QUESTIONS`, 계약 데이터)

전부 선택형(+선택 메모), 모든 문항에 `unknown`="잘 모르겠어요 — 전문가와 상의" 탈출구. 한 화면.

| 코드 | 질문 | 선택지 |
|---|---|---|
| `stage` | 현재 어느 단계인가요? | idea 아이디어·요구사항만 / spec 사양서·블록도 있음 / schematic 회로도 있음 / pcb PCB 설계본 있음 / production 양산 중 개선 / unknown |
| `deliverables` (복수) | 어떤 결과물을 받고 싶나요? | schematic 회로도 / bom BOM / artwork PCB 아트웍·거버 / prototype 시제품 조립·검증 / firmware 펌웨어 소스·바이너리 / docs 제작사양서·시험 기록 / unknown |
| `quantity` | 필요한 수량은? | proto_1_10 시제품 1~10 / proto_11_100 11~100 / mass 양산 예정 / unknown (+메모 "예: 1차 5대") |
| `power` (복수) | 전원은 어떻게 공급되나요? | battery / usb / adapter_dc DC 어댑터 / mains_ac 상용 AC / industrial_24v 산업용 24V / poe / unknown |
| `connectivity` (복수) | 통신·연결 방식은? | none / ble / wifi / lte / ethernet / usb / rs485_rs232 / can / lora / unknown |
| `external` (복수) | 함께 동작하는 외부 시스템이 있나요? | none / mobile_app / server_cloud / pc_software / existing_device 기존 장비·PLC / unknown |
| `constraints` | 크기·설치 환경 제약이 있나요? | none / has(메모 필수) / unknown |
| `certification` (복수) | 필요한 인증·규격은? | none / kc / ce_fcc / ul / medical_auto 의료·자동차 / unknown |
| `timeline` | 목표 시점은? | asap / within_1m / within_3m / flexible / unknown |

저장: `sp_market_project.interviewAnswers` 재사용 — `[{ code, choices: string[], note?: string }]`.
브리프 표시값은 `DEV_REVIEW_QUESTION_LABELS`에서 파생. 원문 공개 동의 UI는 없다 — 검토서와 같은
공개 범위(description 동일).

## 3. 파이프라인

```
위저드 3스텝 진입 → POST /api/ai/market.dev-review/run (multipart: payload + attachment[])
  ├ 첨부 추출(기존 attachment-extractor·archive: 텍스트/PDF/Office/이미지/zip)
  ├ [이미지·PDF 미리보기 있으면] 첨부 판독: 비전 모델, 파일(묶음)별 → { file, facts[{text, where}] , summary }
  │   → 텍스트로 attachmentContext 에 합침(근거 인용 대상)
  ├ 검토서: 주모델, format=JSON schema(DevReviewLlmOutput), think=프로빙 확정값
  ├ 후처리 R1~R7 → MarketDevReview
  └ sp_ai_job 에 결과 저장(status done) — 인메모리 잡 폐기
클라이언트 GET /api/ai/jobs/:id 폴링(5초) → { status, review, stage: 'attachments'|'review', elapsedSecs }
등록 POST /api/market/projects { devReviewJobId?, answers, … }
  └ 서버가 잡을 DB에서 읽어(소유자·done·useCase 일치) inputHash == 현재 원천 해시 검증
     → 불일치 400 REVIEW_STALE(클라이언트는 재생성 또는 검토서 제외) → devReview 컬럼 저장
```

- **클라이언트가 산출물 본문을 보내지 않는다** — 서버가 자기 저장분을 쓴다. 해시 대조·provenance
  라벨("고객 수정본"·"출처 미확인") 체계는 통째로 사라진다.
- 캐시: 동일 회원·모델·프롬프트 버전·입력 해시의 done 잡은 1시간 재사용(DB 조회).
- 원천 해시 = 제목·분야·설명·답변·첨부 SHA-256 목록. 등록 조건(예산·마감·방식·NDA)은 검토서
  원천이 아니다(신선도 단일 계층).
- 타임아웃: 검토서 600s, 첨부 판독 파일당 180s. 스트리밍 필수(기존 실측).
- Ollama 클라이언트 보강: `format`(JSON 스키마)·`think`(불리언)·`options.num_ctx`, 스트림의
  `message.thinking` 은 버린다. ollama.com 직결 태그는 `deepseek-v4-pro:0813`·`qwen3.5:397b`처럼
  `:cloud` 접미사가 없다(현재 기본 비전 모델 `qwen3.5:cloud`는 직결에서 존재하지 않음 → 교정).

## 4. 분야·의뢰 유형

- `MARKET_ACTIVE_SERVICE_AREAS = ['circuit','pcb','firmware']` — 위저드·전문가 등록·목록 필터·
  관리자 필터의 선택 UI 전부. 등록 스키마는 활성 3종만 허용. 읽기는 전체 enum 허용(라벨 사전 유지).
- 전문가 `serviceAreas` 읽기 정규화 = 활성 ∩ 저장값(`['any']→[]` 선례). 로컬 승인 전문가 1명은
  일회성 SQL 로 백필.
- `requestType`: 위저드 UI 제거. 서버가 `serviceAreas.length > 1 ? 'system' : 'individual'` 로
  저장(payload 필드 제거). 표시는 **분야 배지**로 통일: 1개→분야명, 2개→"회로 + PCB",
  3개→"풀 개발(회로·PCB·펌웨어)". 목록의 유형 필터 제거(분야 필터로 대체).
- `FULL_SERVICE_COMPANY_ONLY` 입찰 가드 삭제. 계약 refine(개별=분야 1개) 삭제.
- `categories`·`cadTools` 는 위저드 v2 이후 항상 빈 배열 — 그대로 둔다(프로필 축 유지).

## 5. 화면

### 5.1 의뢰 위저드 3스텝 (`apps/market`)

1. **설명·자료**: 분야 칩 3개(1개 이상) · 제목 · 설명 · 첨부 · AI 사전 검토 동의(기본 on, 해제 시
   스텝 [설명·자료, 검토·등록]).
2. **질문**: 9문항 한 화면(§2). AI 호출 없음.
3. **검토·등록**: 진입 시 검토서 생성 자동 시작(진행 표시 "첨부 확인 중 → 검토서 작성 중",
   30초~3분) · `DevReviewView` 미리보기 · "이 검토서를 의뢰에 포함"(기본 on) · 조건 폼(예산·마감·
   방식·NDA) · 등록. 포함 예정 검토서가 생성 중이면 등록 차단 + "검토서 없이 바로 등록" 탈출구.
   답변/설명을 고치면 "검토서 다시 만들기"(재생성 1회 호출, 루프 없음).

`useRequestWizardAi.ts`(712줄)·`StepInterview`·선분석·`understood` 카드·명세 요약·ROC·카드 UI는
전부 삭제. 셸 `RequestWizard.vue` 는 3스텝.

### 5.2 `DevReviewView.vue` (`apps/market/src/components/dev-review/`)

§1 표 순서대로 렌더. 확정 행=본문, 확인 필요 행=회색+배지+질문(+왜 필요한지). 근거는 행 펼침
"출처: 답변 ④ / 첨부 spec.pdf". 구성도는 기존 `DiagramViewer`(sandbox iframe, 결정적 SVG라 CSP
살균 불필요 — `diagram-srcdoc.ts` 삭제). 상세(`ProjectDetail`)·위저드 미리보기 공용. 관리자
(`apps/web`)는 Vue 공유 패키지가 없어 브리프·배지·구성도 SVG·확정할 항목만 축약 렌더.

### 5.3 너비

`MarketLayout.vue` 4곳·`Projects`·`ProjectDetail` `max-w-6xl`→`max-w-[1440px] px-6`, `RequestWizard`
`max-w-3xl`→`max-w-6xl`. 검토서의 구성도 영역은 컨테이너 폭 전체.

## 6. 관리자 AI 연동 (`/app/admin/settings` "AI 연동")

| 블록 | 내용 |
|---|---|
| 연결 | 기존 유지 — API 주소·키(env 우선 잠금)·연결 테스트(모델 목록) |
| 검토서 생성 | 사용 토글 · 주모델(datalist) · **첨부 판독 모델**(sp_config `ai_vision_model`) · **추가 지침**(≤2000자, 프롬프트 끝에 붙는 운영 지침 — 스키마·출력 규칙은 코드) · 프롬프트 버전(읽기 전용) · **샘플 테스트**(비식별 고정 픽스처로 미저장 모델·지침 실행 → 축약 렌더) |
| 실행 이력 | `sp_ai_job` 최근 50건: 시각·단계·모델·상태·소요·오류·회원(마스킹) |

라우트: `GET/PATCH /api/admin/settings/ai`(응답 `devReview:{enabled,model,extraInstructions,promptVersion}` +
`visionModel`), `POST /api/admin/settings/ai/test`, `GET /api/admin/settings/ai/models`,
`GET /api/admin/settings/ai/jobs`. 유스케이스 카드 반복·프롬프트 textarea·rnd 카드 제거.

## 7. 데이터·마이그레이션 (additive, `migrate deploy` 전용)

`20260828120000_market_dev_review`:
- `sp_market_project` ADD `devReview JSON NULL`.
- `sp_ai_usecase` ADD `extraInstructions TEXT NULL` (`promptTemplate` 는 새 유스케이스에서 미사용, `''`).
- CREATE `sp_ai_job`(id char(36) PK · useCase · mbId · status · stage · model · promptVersion ·
  inputHash · resultJson MEDIUMTEXT · error · startedAt · finishedAt · INDEX(mbId, startedAt) ·
  INDEX(useCase, mbId, model, promptVersion, inputHash, status)).
- 기존 `diagramHtml/diagramSpec/rocMd/postings/aiGenerationMeta/interviewAnswersSharedAt` 컬럼은
  유지(Prisma 주석 deprecated) — 코드는 읽지도 쓰지도 않고 응답 필드에서 제거. `sp_ai_usecase` 의
  옛 행 5개는 계약 허용목록에서 빠져 노출되지 않음(삭제 마이그레이션 없음, 선례 동일).

## 8. 삭제 목록

- 유스케이스 `market.request-diagram`·`request-structurize`·`request-roc`·`request-postings`·
  `rnd.file-classify`·`rnd.pcb-request-document` (정의·프롬프트·파서·관리자 샘플).
- `routes/rnd-ai.ts`·`apps/rnd` 앱·`rnd:probe`/`rnd:request-probe` 스크립트·nginx `/rnd` 스니펫.
- `lib/ai/jobs.ts`(인메모리)·`provenance.ts`·`admin-samples.ts`(재작성)·`interview-questions*`,
  계약 `ai-interview-questions.ts`(80문항)·`AiStructurizeRunBody`·`AiQuestionPreanalysis*`·
  `AiRocRunBody`·`AiPostingsRunBody`·`MarketPostingCards`·`MarketAiProvenance`·`Rnd*`.
- 마켓 `diagram-srcdoc.ts`·`RocViewer.vue`·`StepArea/StepInterview`·`useRequestWizardAi.ts`.
- 입찰 가드 `FULL_SERVICE_COMPANY_ONLY`·목록 `requestType` 필터·`shareInterviewAnswers`.
- E2E `e2e-market.mts`: 옛 AI 왕복 5건·전체서비스 403 케이스 → §10 케이스로 교체.
- `docs/AI_DIAGRAM.md` 본문 상단에 "대체됨" 배너, `MARKET_FLOW.md` §3 AI 단락 교체.

## 9. 모델 프로빙 (하네스 `apps/api/src/scripts/probe-dev-review.ts`, 보존)

- 픽스처 5종(`apps/api/src/scripts/fixtures/dev-review/`): ① 아이디어 단계 빈약 설명 ② 상세 요구
  PDF 첨부 ③ 거버+회로도 zip ④ 펌웨어 단독 ⑤ "모름" 다수. 각 픽스처에 골든 사실·있어야 할 확인
  필요 항목·금지 사실(지어내면 안 되는 수치/품번)을 명세.
- 후보: `deepseek-v4-pro:0813`(think on/off) · `deepseek-v4-flash:0731` · `glm-5.2` · `glm-5.3-flash` ·
  `kimi-k3` · `qwen3.5:397b` · `minimax-m3`. 비전: `qwen3.5:397b` · `kimi-k3` · `minimax-m3` · `gemma4:31b`.
- 채점(결정적): JSON 유효율 · 후처리 전 근거 없는 확정 수(환각) · 후처리 후 골든 사실 재현율 ·
  확인 필요 재현율 · 금지 사실 0건 · 소요시간 · 한국어 품질(육안).
- 결과는 이 절 하단에 표로 추가하고 기본 모델을 확정한다.

### 9.1 결과 (2026-08-28, ollama.com 직결, 픽스처 5종 × 1런, 원본 `.tmp/dev-review-probe/`)

| 모델 | 소요(초) | 성공 | 후처리 전→후 확정(범위) | R2 삭제(자료에 없는 수치·품번) | 골든 | 금지 | 비고 |
|---|---|---|---|---|---|---|---|
| **deepseek-v4-pro:0813 think=off** | **19~27** | 5/5 | 22~47 → 동일 | 0~2 | 9~10/10 | 0 | **기본 채택** — 근거 강등 0, 가장 빠름 |
| deepseek-v4-pro:0813 think=on | 48~75 | 5/5 | 4~46 | 0~2 | 동일 | 0 | 2~3배 느리고 지표 이득 없음 |
| glm-5.2 | 18~83 | 5/5 | 24~51 → 17~45 | 0~5 | 10/10 | 0 | **차선** — 항목 풍부하나 PDF 픽스처에서 지어낸 수치 5건(후처리가 제거) |
| deepseek-v4-flash:0731 | 23~83(1회 184) | 4/5 | 8~24 | 0~1 | 10/10 | 0 | JSON 미출력 1회, 항목 수 적음 |
| qwen3.5:397b | 109~167 | 5/5 | 2~47 → 2~46 | 0~1 | 9/10 | 0 | 느림. **첨부 판독(비전) 전용으로 채택** — PDF·블록도 사실 전량 정확 |
| kimi-k3 | 116~462 | 5/5 | 5~45 | 0~4 | 10/10 | 0 | 너무 느림 |
| glm-5.3-flash | 190~442 | 5/5 | 9~50 | 0~2 | 10/10 | 0 | 너무 느림 |
| minimax-m3 | 101~485 | 1/5 | — | — | — | — | JSON 에 제어 문자·따옴표 누락 4회 — 부적합 |

확정: 주모델 `deepseek-v4-pro:0813` · `think:false` · 첨부 판독 `qwen3.5:397b`(`lib/ai/usecases.ts` 상수).
ollama.com 직결은 `format`(JSON 스키마)을 무시해 코드펜스가 섞여 온다 — 파서가 벗기므로 옵션은 유지.
프로빙 중 교정 3건은 §1.2 규칙에 반영됐다: 답변 줄 인용("질문 → 답")을 근거로 인정 · 명세서 행 평면화
(중첩 `content` 객체는 모델이 문자열로 뭉갬) · 한국어 조사가 붙은 단위("1개가") 오탐 제거(`buildDevReviewCorpus`).
"모름" 다수 픽스처(05)는 확정 3~9·확인 필요 16~34 로 유보 규율이 작동한다.

## 10. 검증

- 단위: 후처리 규칙 R1~R7(픽스처 기반)·`buildDevReviewView`·질문 사전·요청 스키마.
- E2E(`e2e-market.mts`): `sp_ai_job` done 행 시드 → `devReviewJobId` 등록 → 공개 상세에 `devReview`
  노출·타인 잡 404·해시 불일치 400 `REVIEW_STALE`·`devReview:null` PATCH 제거 · 분야 2개 →
  `requestType=system` 파생 · 개인 전문가 입찰 200.
- 실호출 검증은 관리자 샘플 테스트 + 프로빙 하네스(LLM 호출은 E2E 에 없음).
- 사용자 육안 1회: 위저드 3스텝·검토서·상세·관리자 탭.

## 11. 진행 방식·이력

1. 정본(이 문서) — 직접. ✅
2. 프로빙 하네스·스키마·프롬프트·후처리·Ollama 클라이언트 보강 — **직접**(탐구형·판단 필요.
   출하 코드와 같은 모듈을 하네스가 실행). ✅ §9.1
3. 서버·계약·마이그레이션·관리자 API·삭제 — Opus 위임(`docs/prompts/dev-review-phase3-backend.md`) +
   전수 감사. ✅ e2e 101/0, 이탈 승인: `market-service-area.ts` leaf(순환 참조 회피)·`market-snapshot` 교체.
4. 마켓 화면 ∥ 관리자 화면 — Opus 2워커 병렬(`dev-review-phase4a-market.md` / `dev-review-phase4b-admin.md`,
   파일 스코프 상호배타) + 감사. ✅ 실브라우저 완주(실 LLM 71초·21초), 스크린샷 `.tmp/dev-review-ui/`.
   감사 교정: 관리자 구성도 scale-to-fit+모달, 실행 이력 KST, `@sp/shared apiGet` 스키마 제네릭을
   `ZodType<T, ZodTypeDef, unknown>` 로(`.catch()` 스키마의 입력 타입 추론 함정).
5. E2E·typecheck·lint·문서·위키·사용자 육안 → 커밋.

알려진 잔여: `apps/web`·`apps/market` 의 `MarketDevReview.parse(raw)` 재검증은 4번 교정 뒤 불필요(무해) ·
위저드를 라우트 이탈하면 잡 추적이 끊겨 재진입 시 재실행(서버 1시간 캐시가 LLM 재호출은 막음) ·
관리자 축약본의 개발명세서 표는 마켓 `DevReviewView` 만 렌더.

## 12. v2 간소화 재편 (2026-09-02, 사용자 확정)

목표 하나: **의뢰자는 이 분야를 모른다고 전제하고, 물어보는 것과 보여주는 것을 최소화한다.** 프로토타입
(`samplepcb-development-review` 목업)의 섹션 언어를 따르되 정해지지 않은 것은 만들지 않는다 — 확정된
것만 요약·검토하고, 나머지는 "전문가와 상의할 항목" 한 목록으로 넘긴다.

### 12.1 결정 (사용자 확정 4건 + 파생)

| # | 결정 | 근거 |
|---|---|---|
| 12 | 위저드 **2스텝**(의뢰 내용 → 검토·등록), 질문은 **활성 4문항**(현재 상태·수량·함께 쓰는 것·목표 시점)을 1단계에 인라인 | 전원·통신·인증·제약·결과물 문항은 비전문가가 답할 수 없다. 설명에 적었으면 검토서가 쓰고, 없으면 상의 항목으로 흐른다 |
| 13 | 검토서는 **확정만** — 항목 상태 축 폐지. 근거 없는 항목·자료에 없는 수치는 강등이 아니라 **삭제**. 상의 항목 ≤6 | v1 은 명세 5~15행 강제·확인 필요 행·상의 20개로 9,000px 를 넘겼다 |
| 14 | "항목별 견적 및 결과물" → **작업 항목 및 결과물**, 금액 없음(전문가 입찰이 정함) → **09-03 섹션 자체 제거**(개발 단계와 함께, §12.2 주석) | 08-28 결정 2 유지 → 정적 안내라 정보량 0 |
| 15 | "기술개발 검토 결과"에 **판정 배지·리스크 등급 없음** — 분야별 한 줄 + 상의 항목 | 08-28 결정 유지(근거 없는 확신 노출 금지) |
| 16 | 분야 칩 3개 유지 + 쉬운 설명 한 줄 + **"잘 모르겠어요 — 전부 맡길게요"(=풀 개발)** | 전문가 매칭·입찰 구조 무변경 |
| 17 | 구성도는 **입력 → 메인 보드 → 출력·연동 3열 카드 고정**(그룹·id·연결 그래프 폐지), 코드 렌더 유지 | 예시 사이트 모양. 구조 결함(끊긴 참조)이 생길 수 없고 모델 부담이 준다 |
| 18 | 품번은 고객이 말한 것만(예시의 "Korlinx NX40" 같은 표기는 자료에 있을 때만) · 기간은 단계 순서만 · 상세 페이지 뼈대 유지, 검토서 블록만 예시 룩 | 08-28 결정 4·2 유지 |

### 12.2 산출물 구조 v2 (`MarketDevReview` version 2)

| 섹션(화면 순서) | 원천 | 생성 |
|---|---|---|
| 헤더 — 분야 배지 · 확정 N · 상의 M · 요약 한 줄 | 코드 + LLM `summary` | |
| ① 고객 의뢰내용 — 분야·4문항 답변 표 + 핵심 개발 요구사항(✓ 목록, ≤5) | 답변 → 코드 / 요구는 LLM(근거 필수) | 코드 + LLM |
| ② 제안 시스템 구성도 + 요약 3칸(데이터 흐름·핵심 설계·확장 방향) | `DevReviewDiagram` → `@sp/utils renderDevReviewDiagramHtml` 결정적 SVG | LLM 명세 + 코드 렌더 |
| ③ 기술개발 검토 결과 — 분야별 한 줄(`areas[].summary`) + 전문가와 상의할 항목(≤6) | LLM | LLM |
| ④ 개발명세서 — 분야별 확정 행(`item`·`text`, ≤6)만, 0행이면 "상담 후 작성" | LLM(근거 필수) | LLM |
| 고지문 | 상수 `DEV_REVIEW_DISCLAIMER` | 코드 |

> **2026-09-03 제거** — ⑤ 작업 항목 및 결과물 · ⑥ 개발 단계. 둘 다 분야 체크박스로만 결정되는 코드 사전(정적 안내)이라
> 정보량이 0 인데 AI 검토서 안에 있어 AI 가 판단한 것처럼 읽혔다. 비전문가 의뢰자 ↔ 전문가 사이 "요약 + 기초 자산"
> 컨셉에서 이 두 섹션은 어느 독자에게도 새 정보를 주지 않아 제거(PRJ-0059 실측 평가 결과). 결과물·단계는 전문가
> 입찰(`durationDays`·항목별 견적)이 말한다. `buildDevReviewView` 의 `workItems`·`phases` 도 같이 삭제.

근거(`evidence`)는 저장하되 고객 화면에는 펼치지 않는다(관리자 축약본 `DevReviewSummary` 만 표시).

```ts
DevReviewFact = { text ≤200, evidence ≤200 | null }            // 확정만 — 근거 없으면 삭제
DevReviewSpecRow = DevReviewFact + { item ≤30 }
DevReviewDiagram = {
  columns: { inputs ≤16, board ≤16, outputs ≤16 },            // 기본 '입력'·'메인 보드'·'출력·연동'
  inputs: [{ label ≤30, detail ≤40, icon }] ≤5,                 // 센서·신호·버튼·전원 입력
  board: { label ≤30, detail ≤40, chips: string[≤16] ≤8 },     // 보드 안 기능 블록
  outputs: [{ label, detail, icon }] ≤5,                        // 출력 장치·앱·서버·PC·기존 장비
  linkIn ≤24, linkOut ≤24,                                      // 고객 자료에 있는 연결 방식만, 없으면 ''
  notes: { flow ≤50, design ≤50, extension ≤50 },
}
icon ∈ sensor·signal·power·button·display·motor·relay·wireless·phone·cloud·pc·device·chip·storage·other
DevReviewLlmOutput = { summary ≤200, requirements: Fact[] ≤5, diagram, areas: [{ area, summary ≤160, spec: SpecRow[] ≤6 }], openQuestions: [{ question ≤120, why ≤120 }] ≤6 }
MarketDevReview = { version: 2, brief: { serviceAreas, answers }, …LlmOutput(후처리 뒤), meta }
```

v1(version 1) 저장분은 `MarketDevReview.safeParse` 실패 → `toDevReview` 가 null(검토서 없음)로 취급한다.
로컬 테스트 의뢰 몇 건뿐이라 이관하지 않는다(`hasDevReview` 는 컬럼 존재 기준이라 목록 배지가 남을 수
있다 — 상세는 null). 옛 `DiagramSpec`·`renderDiagramSpecHtml` 은 삭제됐다.

### 12.3 후처리 규칙 v2 (`lib/ai/dev-review.ts`, 결정적)

| 규칙 | 대상 | 처리 |
|---|---|---|
| R1 근거 | `requirements`·`spec` 행의 `evidence` 가 코퍼스에 없음 | **삭제** |
| R2 수치·품번 | 행 텍스트의 수치+단위·품번 패턴이 코퍼스에 없음 | **삭제**. 요약·분야 한 줄·구성도 라벨·칩·메모는 삭제 대신 **그 토큰만 제거**(괄호 묶음째 — "개발(ESP32 기반)" → "개발"), 라벨이 비면 카드·칩 삭제 |
| R4 구성도 | `linkIn`·`linkOut` 이 코퍼스에 없음 | `''`(화살표만) |
| R5 상의 항목 | 토큰 자카드 ≥0.5 인 질문 | 접고 최대 6개 |
| R6 빈 명세 | 분야 `spec` 0행 / `summary` 빈 문자열 | 뷰가 "상담 후 작성" |

코퍼스 = 제목 + 설명 + 답변(질문→답·라벨: 답 두 형식) + 첨부 추출 텍스트 + 첨부 판독 결과(§1.2 와 동일 정규화).
프롬프트 `dev-review.v2` 는 비전문가 어휘·확정만·설계 결정 금지·상의 항목 ≤6 을 지시한다(코드 정본).

### 12.4 화면 v2

- **위저드 2스텝**(`apps/market` `useRequestWizardForm`·`StepDescribe`·`StepReview`): 1단계 = 분야 카드 3개(한 줄 설명) + "잘 모르겠어요 — 전부 맡길게요" · 제목 · "무엇을 만들고 싶은가요?" · 4문항(전부 선택, `잘 모르겠어요` 탈출구) · 첨부 · AI 동의. 2단계 = 검토서 생성·미리보기·조건 폼(변경 없음). `StepQuestions.vue`·`DevReviewItemList.vue` 삭제.
- **`DevReviewView.vue`**: §12.2 순서. 예시 목업의 섹션 라벨(CUSTOMER BRIEF / SYSTEM ARCHITECTURE / AI REVIEW / DEVELOPMENT SPECIFICATION / WORK ITEMS / DEVELOPMENT STEPS).
- **구성도 렌더러** `@sp/utils renderDevReviewDiagramHtml`: 캔버스 1200px, 양옆 밝은 패널(아이콘 카드), 가운데 다크 보드 카드 + 칩 격자(짧은 칩 2열·긴 칩 전체 폭), 열 사이 화살표+연결 라벨, 빈 열은 "해당 없음" 점선 카드. `DiagramViewer` 는 `<svg width height>` 로 축소·모달(변경 없음).
- **관리자** `DevReviewSummary.vue`: 확정 N·상의 M 배지, 요구(근거), 분야 한 줄+명세 행(근거), 상의 항목, 구성도, JSON.
- 계약: `DEV_REVIEW_ACTIVE_QUESTIONS`(4) / `DEV_REVIEW_QUESTIONS`(9, 읽기 호환) / `DevReviewActiveAnswers`(실행·등록 payload). 질문 라벨은 쉬운 말로 바뀌었다(코드 불변).

### 12.5 프로빙 v2 (하네스 §9 재사용, 픽스처 5종 답변을 4문항으로 축소·빠진 정보는 설명에 흡수)

채점 = 후처리 전→후 확정 수 · R1/R2 삭제 · 골든 · 금지 0 · 상의 항목 재현 · 소요 · 구성도 입력/칩/출력 수.
구성도 모양은 `*.diagram.html` 을 브라우저로 육안 감사. 결과와 채택 모델은 §12.6 에 기록한다.

### 12.6 프로빙 v2 결과 (2026-09-02, ollama.com 직결, 픽스처 5종 × 1런, think=off, 원본 `.tmp/dev-review-probe/v2-batch2/`)

| 모델 | 소요(초) | 성공 | 확정(전→후) 범위 | R1/R2 삭제 | 골든 | 금지 | 기대 상의 항목 | 구성도(입력/칩/출력) | 비고 |
|---|---|---|---|---|---|---|---|---|---|
| **deepseek-v4-pro:0813** | **5~12** | 5/5 | 3~14 → 동일 | 0 | 전량(29/29) | 0 | 17/17 | 전 픽스처 채움(05 는 출력 0 — 자료에 연동 대상 없음) | **기본 유지** — 가장 빠르고 빠짐 없음 |
| kimi-k2.7-code | 8~25 | 5/5 | 6~18 → 6~17 | 0 | 전량 | 0 | 15/17 | 03·05 칩 0~4 | 차선 — 항목 풍부, 03 에서 칩 0 |
| mistral-large-3:675b | 15~25 | 5/5 | 2~14 → 동일 | 0 | 전량 | 0 | 13/17 | 채움 | 02 상의 항목 2/4 |
| glm-5.2 | 14~25 | 5/5 | 2~15 → 동일 | 0 | 전량 | 0 | 15/17 | 채움 | 상의 항목 수 3~5로 적음 |
| qwen3.5:397b | 7~20 | 5/5 | 2~15 → 동일 | 0 | 전량 | 0 | 12/17 | **03·04·05 칩 0** | 구성도 약함 — 첨부 판독(비전) 전용 유지 |
| gpt-oss:120b | 8~26 | 5/5 | 1~14 → 1~14 | 0 | **23/29**(02 8/10·03 5/7) | 0 | 12/17 | 채움 | 골든 누락 |
| nemotron-3-ultra | 41~86 | 5/5 | 4~18 → 4~17 | R2 2 | 전량 | 0 | 14/17 | 채움 | 너무 느림, 지어낸 수치 2건(후처리가 제거) |
| glm-5.3 | — | 0/1 | — | — | — | — | — | — | **제외** — think=off 를 무시하고 추론문을 content 에 흘려 JSON 파싱 실패, 02 에서 10분 행 |

확정: 주모델 `deepseek-v4-pro:0813` · `think:false` · 첨부 판독 `qwen3.5:397b`(변경 없음, `lib/ai/usecases.ts`).
"모름" 다수 픽스처(05)는 확정 1~6·상의 항목 3~6 으로 유보 규율이 작동한다. 근거 없는 항목(R1)은 전 모델 0건 —
v2 프롬프트의 "확정만" 지시가 먹혀 후처리는 안전망으로만 남았다. 실브라우저 완주(`e2e/tools/dev-review-v2-walk.ts`,
deepseek 10초)·스크린샷 `e2e/output/dev-review-v2/`, e2e-market 101/0.

## 12.7 PCB 담당자 프롬프트 실측과 절충 (2026-09-03)

PCB 담당자가 준 "전자제품 개발 검토용 시스템 구성도" 프롬프트(MCU 중앙·입력 좌·출력 우·통신 상단·전원 체인
하단·저장/디버그·절연·모든 선에 인터페이스·TBD·노란 메모)를 세 단계로 실측했다. 하네스·원본은
`.tmp/dev-review-probe/{rich,v2-stepB,v2-stepC,v2-stepD}/`.

### A. 프롬프트대로(JSON 출력형으로 옮긴 실험 하네스 `scripts/probe-dev-review-rich.ts`) — 5모델 × 5픽스처

| 축 | 결과 | 판정 |
|---|---|---|
| 블록(MCU·입력·출력·통신·전원·저장) | 근거 있음 33~100%, **지어냄 0~1건**(나머지는 TBD) — 근거 인용 강제가 먹힌다 | 블록 자체는 안전 |
| 연결선 인터페이스(GPIO·I2C·UART…) | 표기 100% 이지만 **자료에 있는 것 0~50%**, 나머지는 TBD 또는 지어냄(mistral 02: 13개 중 8개 지어냄) | 사용 불가 |
| 전원선 전압 | 첨부에 전압 명세가 없으면 **전량 지어냄**(01: 1/1·8/8, 04: 3/3·6/6) | 사용 불가 |
| 전원 체인(AC/DC→DC/DC→LDO) | 아이디어 단계(01·05)는 **0/3~0/6 근거**, 자료 있는 02·03 도 절반 | 설계 결정이라 고객 자료로 채울 수 없음 |
| 절연·저장/디버그 | 04(RS-485·AC)에 1~2건 절연 표시 — 그럴듯하나 검증 불가, 저장/디버그는 거의 TBD | 전문가 판단 영역 |
| 파싱 | kimi-k3 1회·mistral 1회 JSON 제어문자 실패 | |

결론: 블록은 살지만 "공학 구성도"를 만드는 요소(인터페이스명·전압·전원 체인·절연)는 대부분 TBD 이거나
지어낸 값이다. 아이디어 단계 의뢰는 40~60% 가 TBD 상자가 된다 — v1 실측과 같다. **고객용 화면에는
채택하지 않는다.** 전문가용 상세 보기가 필요해지면 "블록 + TBD 명시"까지만 가능하다는 것이 실측 한계다.

### B. 절충선 적용(출하) — 3모델 × 6픽스처, 회귀 0

- 프롬프트: 분류 예시 목록(입력/출력/칩 — 측정부는 입력) · 같은 장치 여러 개는 "×N" · 저항·커패시터·핀·층수 금지 ·
  **tbd 규칙**(고객이 "정하지 않았다·제안 받고 싶다"고 말한 항목만) · 자료 간 불일치는 확정에서 빼고 상의 항목으로.
- 스키마: `DevReviewDiagramNode.tbd`·`board.tbd`(catch false). 렌더러: 점선 테두리 + "미정" 표식.
- 화면: "전문가와 상의할 항목"(노란 메모 역할)을 구성도 바로 아래로 이동, "구성도에 없는 것은 아직 정해지지 않은 것" 안내.
- 실측: tbd 는 3모델 모두 고객이 미정이라 말한 카드에만 붙었다(02 온습도 센서 · 05 진동 센서 · 06 온도 센서, kimi 는 전원·앱까지).
  **자료 간 불일치 규칙은 3모델 모두 안 지켰다**(06: 설명 12V / 첨부 24V — deepseek 은 24V 를 확정, kimi·mistral 은 질문은 내면서도 24V 를 확정).
  → 후처리 **R8** 신설: 설명(제목·설명·답변)과 첨부의 같은 단위 수치 집합이 서로 겹치지 않으면 불일치. 그 값을 품은
  확정 항목 삭제, 구성도 라벨은 값만 제거 + 미정, 상의 항목 맨 앞에 "자료 간 확인 필요: 전압 — 설명 12V / 첨부 24V"
  자동 삽입, 같은 값을 말하는 모델 질문은 접는다. 판정 단위는 전압·전류·전력·층수·온도·주파수·배터리 용량만
  (수량·크기는 "시제품 5대 vs 팬 2대"처럼 다른 물건이 섞여 오탐 — 실측으로 제외).
- D 검증(02·03·06 × deepseek·kimi): 06 은 금지 0(12V·24V 어느 쪽도 확정 안 됨)·불일치 1·삭제 2, 첨부가 있는 02·03 은 오탐 0.

### C. 하드웨어 체크리스트를 상의 항목 규칙으로 — 3모델 × 6픽스처

Control Box 예시의 의도를 일반화해 "해당하는 경우에만" 묻는 규칙 6개(큰 부하·AC → 절연·보호 / 유선 통신 → 절연·규약 /
무선 → 안테나·전파 인증 / 전원 종류 없음 / 기록·저장 / 설치 환경). 구성도 카드나 확정 항목으로는 만들지 않는다.

| 픽스처 | 절연 질문 | 안테나 질문 | 비고 |
|---|---|---|---|
| 04 RS-485+AC+릴레이 | deepseek·kimi ○, mistral ✕ | — | 의도대로 |
| 02 Ethernet+경광등 접점 | deepseek ○ | — | |
| 01 Wi-Fi | ✕(정상) | deepseek·mistral ○ | |
| 03 Wi-Fi+펌프 | ✕ | ✕(3모델 모두 설치 환경을 물음) | 6개 캡 안에서 밀림 |
| 05 모름 다수 | ✕(정상 — 해당 없음) | — | 오탐 없음 |

부작용: 상의 항목 캡 6 안에서 체크리스트 질문이 사례 질문(01 의 모터·크기)을 밀어낸다 → "고객 자료에서 직접 나온
질문 뒤에 둔다"를 추가. 골든·R1·R2 회귀 없음(kimi 02 9/10, mistral 03 6/7 는 캡 영향). 채택.

정리: A 는 채택 안 함(실측 근거 위와 같음), B·C 는 출하. 프롬프트 버전은 `dev-review.v2` 유지(스키마 additive).

### 12.8 kimi-k3 · glm-5.3 추가 프로빙 (2026-09-03, B+C+R8 프롬프트, 픽스처 6종)

| 모델 | 소요(초) | 성공 | 확정(전→후) | R1/R2 | 골든 | 금지 | 기대 상의 항목 | 구성도 | 비고 |
|---|---|---|---|---|---|---|---|---|---|
| kimi-k3 | 11~27 | 6/6 | 4~18 → 4~18(03 은 선택 외 분야 5행 제거) | 0 | 31/32 | 0 | 15/24 | 채움(01 입력 0 은 deepseek 과 동일) | 품질은 deepseek 급, 상의 항목이 적음(02 는 3개). R8 06 작동 |
| glm-5.3 | **186~516** | 6/6(재파싱 포함) | 6~21 → 동일 | 0 | 32/32 | 0 | 18/24 | 채움 | **가장 촘촘한 명세(02 확정 21)**·상의 항목 전량 근접. 단 think=off 를 무시하고 추론문 100KB 를 content 에 흘려 건당 3~9분 |

glm-5.3 의 실패 원인은 파서였다 — 추론문 속 초안 JSON·어긋난 따옴표 뒤에 최종 JSON 이 오는 형태. `extractJsonObject` 를
열 0 의 `{` 에서 새로 시작해 균형을 맞추는 후보(마지막부터) → 문자열 인식 균형 객체 → 비인식 → naive 순으로 바꾸고,
문자열 안 원시 제어문자(kimi-k3·mistral 실측)도 이스케이프한다. 들여쓴 `{` 를 후보로 삼으면 정돈된 JSON 의 마지막
배열 원소가 뽑히므로(실측) 열 0 만 본다. 이 교정으로 glm-5.3 원문 6/6 이 파싱된다.

판정: 정확도만 보면 glm-5.3 ≥ deepseek ≈ kimi-k3 이지만, 의뢰자가 위저드에서 기다리는 시간(deepseek 5~12초 vs
glm-5.3 3~9분)이 결정적이라 **기본은 deepseek-v4-pro:0813 유지**. glm-5.3 은 관리자 샘플 테스트나 "정밀 재생성"
같은 비동기 옵션에 쓸 수 있다(파서는 이미 견딘다).

### 12.9 범례·페이지 크기 (2026-09-03, 렌더러 옵션)

PCB 담당자 프롬프트의 "제목 상단 중앙·범례·A3 가로"는 LLM 이 아니라 렌더러 몫이라 옵션으로 넣었다
(`renderDevReviewDiagramHtml(diagram, frame)`, `DevReviewDiagramFrame = { title, meta, page, legend }`).

| 옵션 | 내용 | 실측 |
|---|---|---|
| `title`·`meta` | 상단 중앙 제목 띠(프로젝트명 + "검토안 V1 · 모델 · 생성일") | 마켓 `DevReviewView`·관리자 축약본이 프로젝트명을 넘긴다 |
| `legend` (기본 on) | 하단 범례 5종 — 입력·출력 장치 / 보드 기능 블록 / 연결(방식 표기는 자료에 있을 때만) / 미정 / 해당 없음 | 이 도면에 실제로 쓰이는 표기만. 절연·전압·색 구분은 표기 자체가 없어 범례도 없다 |
| `page: 'auto'` (기본) | 내용 높이대로(1200 × 330~480) | 카드 안 미리보기에 맞음 |
| `page: 'wide'` | 1200 × 675 (16:9) | 화면 공유·모달용. 여백이 적당 |
| `page: 'a3'` | 1200 × 849 (√2, A3 가로) | 인쇄·PDF 감. 보통 크기 도면은 위아래 여백이 크고, 빈약한 의뢰는 도면이 가운데 떠 보인다 |

페이지 모드는 내용이 짧으면 세로 가운데 배치 + 범례 하단 고정, 내용이 길면 페이지가 늘어난다(잘림 없음).
같이 고친 것: 연결 라벨이 열 사이 80px 를 넘어 옆 패널을 덮던 문제 → 8자 두 줄·10px 로 접는다.
기본은 화면용 `auto`. 인쇄용 A3 는 모달 "크게 보기"나 PDF 내보내기를 붙일 때 `page:'a3'` 로 켜면 된다
(브라우저 인쇄로 A3 가로 한 장에 들어가는 비율).

### 12.10 기술개발 검토 결과 보강 (2026-09-03, A 준비 상태 · B 답변↔자료 정합 · C 검토 관찰)

**왜** — PRJ-0059(분산형 버스 LED 컨트롤러 v2, docx 설명서 첨부) 실측 평가에서 ③ 기술개발 검토 결과는 분야별
한 줄 요약뿐이라 바로 아래 개발명세서와 겹쳤다(정보량 0). 같은 실측에서 답변(아이디어만·장치 단독)과 자료(넷리스트·
PC 연동)의 **범주 모순**을 R8(단위 수치)도 모델도 못 잡았다. ⑤ 작업 항목·⑥ 개발 단계는 정적 안내라 제거(§12.2).

**이 섹션이 답할 질문** — 명세서 = "무엇이 확정됐나", 상의 항목 = "무엇을 물어야 하나", 검토 결과 = **"분야별로
얼마나 준비됐고, 전문가 눈에 이 개발의 핵심이 뭔가"**.

| 층 | 내용 | 원천 | 계약 |
|---|---|---|---|
| A 준비 상태 | 분야 카드마다 `자료에서 확정 n`(명세 행) · `상담에서 정할 것 m`(그 분야로 분류된 상의 항목) · 0/0이면 "자료에 이 분야 내용이 없습니다" · 첨부 n건 읽음 · 분야 공통 상의 k건 | 코드(`buildDevReviewAreaCards`) | `openQuestions[].area: circuit\|pcb\|firmware\|general`(`.catch('general')`, 구저장분 호환) |
| B 답변↔자료 정합 (R9) | 현재 상태 = 아이디어만·모름 ∧ 설명·첨부에 회로도·넷리스트·거버·KiCad·부품표·PCB 레이아웃 → `stage` / 함께 쓰는 것 = 없음 ∧ PC·스마트폰·앱·서버(TCP·웹 서버 제외)·클라우드·MQTT·PLC·HMI·기존 장비 → `external`. 단서 뒤 10자 안 부정("회로도는 없다")은 제외. **답변은 코퍼스에 넣지 않고 설명·첨부만 훑는다.** 검토 결과 노란 박스 + 상의 항목(불일치 다음, 모델 질문 앞, area general) | 코드 `detectAnswerChecks` + 프롬프트 한 줄("답변과 자료 확인 필요: …") | `MarketDevReview.checks[]{code, answer, found, text}`(`.catch([])`) |
| C 검토 관찰 | 분야당 0~2줄, 자료의 사실 둘 이상을 잇는 "무엇이 핵심인가". evidence 인용 필수 | LLM + 후처리 | `areas[].observations[]{text, evidence}`(`.catch([])`) |

**C 의 후처리(관찰은 사실 연결이지 권고가 아니다 — v1 "리스크" 행 교훈)**
1. 사실과 같은 R1·R2·R8(근거 없음·자료 밖 수치·불일치 값 → 삭제).
2. 판단 어휘 삭제: `권장|추천|권고|해야|돼야|되어야|필요|바람직|리스크|위험|주의|고려|우려|제안`.
3. 명세 행·**상의 항목**과 토큰 자카드 ≥0.5 면 삭제(질문이 행동으로 이어지는 자리라 관찰 쪽을 버린다).

**프로빙 (deepseek-v4-pro:0813, think=off, 픽스처 01~08, `.tmp/dev-review-probe/2026-09-03T10-16-38`·`…T10-2x`)**

| 항목 | 결과 |
|---|---|
| 관찰 생성→잔존 | 1차 26→15, 필터 강화 뒤 14→5 (4픽스처). 버린 것은 전부 "…이 필요합니다"류 권고와 상의 항목 중복 |
| 잔존 관찰 근거 밖 | **0** (전부 evidence 코퍼스 일치, 금지 토큰 0) |
| 잔존 예 | "-25°C 저온 동작과 IP65 보호가 회로 부품 선정의 핵심 조건" · "초안 거버에는 외곽선과 드릴만 있어 전 배선을 새로 그리는 작업" · "넷리스트는 PASS 이나 VCAP·벌크 커패시터·U1.144 핀 배정이 미확정" |
| R9 | 픽스처 08(07 자료 + PRJ-0059 답변) 2건 감지: stage(PCB 레이아웃·넷리스트·KiCad·부품표) · external(PC). 나머지 7픽스처 0(오탐 없음). "TCP 서버" 오탐 1건 → lookbehind 로 제외 |
| 상의 항목 분야 | 모델이 `area` 를 안정적으로 채움(예: 07 c4 p1 f1). 구저장분은 전부 general |
| 지연 | +1~3s (프롬프트 +600자) |

**결론** — A+B+C 모두 채택. C 는 잔존률이 낮지만(≈35%) 남는 것은 근거 있는 핵심 지적이라 카드 가치가 있고,
없으면 빈 채로 둔다(억지 생성 금지). 프롬프트 버전 `dev-review.v2.1`. 관리자 축약본은 관찰(근거 포함)·정합 알림을
같이 보여준다. 남은 것: 의뢰자 "맞아요/달라요" 피드백 동선(미기획).

### 12.11 구성도 무제약 프로빙 (2026-09-04, kimi-k3:cloud, `e2e/specs/dev-review-diagram-free.e2e.test.ts`)

**질문** — 3열 카드·JSON 스키마·후처리를 전부 빼고 "이 자료로 시스템 구성도를 만들어 달라"는 한 문장만 주면
모델이 무엇을 내놓는가. 입력 = 제목 + 설명(버스 LED 컨트롤러) + docx 설명서 추출 텍스트(20,161자). 지시문은
첫 줄 한 문장뿐, 형식·언어·범위 지시 없음. 화면·DB 무관, 첨부 추출기와 ollama 클라이언트만 실코드.

| 회차 | 시간 | thinking | 출력 | 형식 | 자료 부품 7종 | 자료 밖 품번 |
|---|---|---|---|---|---|---|
| 1 | 407s | 80k자 | 4,832자 | ASCII 박스 그림 3장 + 표 + 프로토콜 요약 | 6/7(SDRAM 품번만 "32MB"로) | 0 |
| 2 | 499s | 109k자 | 7,208자 | ASCII 5장(1장은 스스로 "복잡하다"며 다시 그림) + 표 3 + 전원 트리 | 6/7(같음) | 0 |

**관찰**
- 형식은 두 번 다 **ASCII 박스 그림**(Mermaid·SVG 아님). 모델이 마지막 줄에 "Mermaid·PPT 로도 변환해 드릴 수
  있다"고 덧붙인다. 2회차의 첫 그림은 선이 엉켜 모델 스스로 폐기하고 다시 그렸다 — 텍스트 도면은 폭·정렬이
  불안정하다.
- 근거 밖 사실은 사실상 0. IP 매핑(192.168.10.10+주소)·명령 코드(0x12~0x22)·핀(PE2-4·PB14·PD3)·종단 120Ω·
  AP2112K·TVS·페라이트 전부 docx 에 있다. 추론으로 보탠 것은 "이더넷 스위치"·"멀티드롭"·"데이지 체인"·"설정
  단말" 네 단어 — 자료의 구조(PC 1대 ↔ 4대, RS485 버스)에서 나오는 합리적 보충이고 틀린 것은 없다.
- 정보 밀도는 **설계자 수준**(핀 번호·저항값·디커플링 개수·명령 코드). §12.7 에서 확인한 대로 자료가 완성 설계서라
  가능한 것이며, 아이디어 단계 의뢰(01·05 픽스처)라면 같은 프롬프트가 지어내거나 TBD 로 채울 것이 뻔하다(미실측).
- 언어는 한국어 본문 + 규격·부품명 영문. 비전문가가 읽을 표현은 아니다.
- 지연 407~499s, thinking 8~11만 자 — 위저드 동기 대기(≤6분)에 못 들어간다.

**판단** — 모델의 "이해"는 충분하다(부품·연결·흐름을 빠짐없이 복원). 부족한 것은 **표현 매체**다: 텍스트 도면은
화면에 못 싣고, 비전문가 의뢰자에게는 과밀하다. 따라서 현행 구조(모델은 내용을 JSON 으로, 렌더는 코드가)를
버릴 이유는 없고, 바꿀 수 있는 것은 **렌더 레이아웃의 자유도**다 — 자료가 충분할 때 모델이 낸 블록·연결을
3열이 아닌 일반 그래프(블록도)로 그리는 옵션. 다음 실측은 같은 무제약 입력에 "Mermaid flowchart 로" 한 줄만
더한 변형(형식만 제약)으로, 렌더 가능한 출력이 유지되는지 보는 것.

**변형 — "HTML 형식으로 만들어 주세요." 한 문장 추가 (2026-09-04, kimi-k3:cloud 1회, `…-html/`)**

| 시간 | thinking | 출력 | 내용 | 자료 부품 | 자료 밖 품번 |
|---|---|---|---|---|---|
| 499s | 65k자 | 36k자(코드 펜스 안 완전한 HTML, 인라인 CSS + SVG 2장 + 표 4) | ① 차량 토폴로지 SVG(PC→스위치 없이 4대, 이더넷 실선·RS485 점선·HUB75·+5V 배전, 범례) ② 보드 내부 SVG(J1→U3→U1→U5~U10→J2/J6, U2·U4·전원·설정, 범례) ③ 프로토콜 프레임·OPCODE 표·전원 트리 | 7/7 | 0 |

브라우저에 그대로 열리는 완성 페이지가 나왔다. 선 색·범례·영역 구분·표까지 §12.7 PCB 담당자 프롬프트가 요구한 표현
규칙 대부분을 **지시 없이** 갖췄고, 자료 밖 부품·수치는 없었다. 다만 (a) 근거가 완성 설계서라서 가능한 밀도이고,
(b) 499s 라 동기 생성에는 못 들어가며, (c) HTML/SVG 는 회차마다 구조가 달라 화면에 그대로 싣기 전에 sandbox
iframe + CSP(현행 뷰어 방식)와 자료 밖 토큰 검사(R2)를 같은 원문에 적용해야 한다. 아이디어 단계 입력에서의 거동은
미실측.

**같은 HTML 지시 — deepseek-v4-pro:cloud 1회 (2026-09-04, `…T20-51-20-html/`)**

| 시간 | thinking | 출력 | 내용 | 자료 부품 | 자료 밖 품번 |
|---|---|---|---|---|---|
| 20s | 0.8k자 | 17k자 HTML(CSS 카드, SVG 0·표 0) | PC 카드 → 이더넷 띠 → 컨트롤러 4장(IP·MCU·SDRAM·SW1·J2/J6 칩) → RS485 띠 → LED 패널 4장 → 범례 4 → 시스템 요약 6줄 | 4/7 (PHY·SDRAM 품번·레벨시프터 없음) | 0 |

kimi-k3 와 같은 입력·같은 한 문장인데 결과의 층위가 다르다. kimi 는 설계자용(보드 내부 블록·핀·전원 트리·OPCODE 표,
499s), deepseek 은 **고객용 토폴로지 한 장**(보드 내부 없음, 20s). 둘 다 자료 밖 사실은 0. 즉 형식 한 문장은
"렌더 가능한 출력"을 보장하지만 **밀도·층위는 모델이 정한다** — 서비스가 원하는 층위(비전문가 의뢰자 + 전문가
기초 자산)를 얻으려면 결국 "보드 내부 블록을 포함" 같은 범위 지시가 필요하고, 그 지시가 쌓이면 현행 프롬프트로
돌아온다. 남은 실측: 아이디어 단계 입력(첨부 없음)에서의 거동.

## 13. v3 재설계 — 분야 레지스트리·3스텝 위저드·정밀 구성도 (2026-09-04, 사용자 확정)

> **이 절이 §4·§5·§12.2~§12.4 의 해당 부분을 대체한다.** v2(2026-09-02)까지는 프로토타입이라 저장 데이터를 버리고
> 재구현했다(마이그레이션 `20260904090000_market_v3_areas_registry` 가 옛 컬럼을 지운다). 검토서 후처리 규칙
> (R1~R9, §12.3·§12.7~§12.10)과 프로빙 결론은 그대로 살아 있다.

### 13.1 결정

| # | 결정 | 근거 |
|---|---|---|
| 19 | 개발 분야 **5종**(회로·PCB·펌웨어·**앱·서버**) — 의뢰·전문가 등록·필터 모두 동시에 연다. "잘 모르겠어요 — 전부 맡길게요" = 5종 전부 | 사용자 확정. 참고 사이트(talent-market-customer)의 앱·서버 분야 |
| 20 | 위저드 **3스텝** — ① 의뢰 내용(분야·제목·설명·참고 자료·AI 동의) ② **몇 가지만 더**(공통 4문항 + 선택 분야마다 [분야별 질문 · 희망 개발툴·언어 · 추가자료 슬롯]) ③ 검토·등록 | 1스텝이 길어졌고 2스텝은 분야가 확정된 뒤라 조건부 렌더가 자연스럽다 |
| 21 | 희망 툴·언어는 **"전문가 추천"이 기본**(빈 선택), 접힌 섹션. 참고 사이트의 분야별 목록 채택 | §12 원칙(비전문가가 답할 수 없는 건 묻지 않는다)과의 절충 |
| 22 | 분야별 추가자료는 1스텝 참고 자료와 **별개** — 2스텝에서 슬롯(회로도·거버·기존 소스·화면 시안·API 명세 …)별로 받고 `sp_file.area`·`slot` 컬럼에 저장 | 사용자 확정. fileType 에 접미를 겹쳐 쓰지 않고 필드를 더한다 |
| 23 | **분야 레지스트리 하나에서 전부 파생** — 분야·질문·툴·슬롯·프롬프트 조각의 정본 `market-areas.ts`. 분야 추가 = 항목 1개 + 프로빙 픽스처 1개, 질문·툴·슬롯 추가 = 항목만 | 확장·수정에 대비(사용자 요청) |
| 24 | 저장 스키마는 `z.enum` 이 아니라 **문자열 + 레지스트리 검증** — 분야를 빼도 옛 저장분 파싱이 깨지지 않고 라벨만 "(종료)". JSON 컬럼은 `version` 동봉 | 같은 이유 |
| 25 | **정밀 시스템 구성도** = AI 산출물 2(비동기) — kimi-k3 thinking high(§12.11 프로빙 채택안)를 **등록 뒤 서버 큐**로 돌리고 완성되면 상세에 붙고 메일. 위저드는 기다리지 않는다(검토서의 3열 카드가 즉시 자리를 채운다) | 566초·thinking 14만 자라 동기 UX 불가, 요청당 비용도 통제 필요 |
| 26 | 정밀 구성도 **게이트** — 첨부 텍스트 ≥800자 또는 설명 ≥500자 또는 (설계 단계 답변 ∧ 첨부 있음)일 때만 자동 생성. 미달은 `skipped` + 관리자·소유자 수동 생성 | 아이디어 단계 입력은 TBD 상자로 채워질 뿐(§12.11 미실측 영역) |

### 13.2 분야 레지스트리 (`packages/api-contract/src/schemas/market-areas.ts`)

```ts
MarketAreaDef = {
  code, label, short, hint, kind: 'hardware' | 'software',
  questions: MarketQuestionDef[],          // 분야별 질문 — code 는 `${area}.${name}` 네임스페이스
  tools: { label, options: [{code,label}] }, // 희망 툴·언어(빈 선택 = 전문가 추천)
  attachmentSlots: [{code,label,hint}],     // 2스텝 추가자료 슬롯 → sp_file(area, slot)
  prompt: { what, specItems, checks },      // 검토서·구성도 프롬프트 조각
}
MARKET_AREAS = [circuit, pcb, firmware, app, server]   // 순서 = 화면 순서
MARKET_COMMON_QUESTIONS = [stage, quantity, external, timeline]  // 공통 4문항(§12 유지)
```

파생: `MARKET_AREA_CODES`·`marketAreaLabel`·`marketAreaBadge`(1개=분야명 · 2~4개="회로 + PCB" · 5개="풀 개발(…)")·
`sortMarketAreas`·`marketQuestionsFor(areas)`·`marketAnswerIssues(answers, areas)`(중복·미지 문항·선택 분야 밖·미지
선택지·단일 선택·메모 필수)·`MarketTools {version:1, byArea:{area:[code]}}`·`normalizeMarketTools`·`marketToolRows`·
`parseMarketAttachmentField('attachment:circuit:schematic')`. 분야별 질문은 현재 3개(`pcb.outline`·`app.platform`·
`server.scale`) — 비전문가가 답할 수 있는 것만.

프롬프트에서의 쓰임: 검토서 `buildDevReviewAreaBlock` 이 선택 분야의 `what`·`specItems`·`checks` 를 `[개발 분야]`
블록으로 조립하고, 구성도 노드에 `develop`(이번 의뢰에서 새로 만드는 앱·서버 카드 — 기존 연동 대상과 구분,
렌더러가 "개발" 표식) 이 생겼다. 프롬프트 버전 `dev-review.v3`.

### 13.3 저장 구조

| 테이블 | v3 |
|---|---|
| `sp_market_project` | `serviceAreas`(string[]) · `tools`(MarketTools) · `answers`(MarketAnswers, 옛 `interviewAnswers` 개명) · `devReview`(v3) · `devDiagram`(MarketDevDiagram 메타) · `devDiagramHtml`(살균 HTML). 삭제: `specialties`·`cadTools`·`diagramSpec`·`rocMd`·`interviewAnswersSharedAt`·`postings`·`aiGenerationMeta` |
| `sp_market_expert` | `serviceAreas` · `tools`. 삭제: `categories`·`cadTools` |
| `sp_file` | `area`·`slot`(nullable — 의뢰 슬롯 첨부만) |
| `sp_ai_usecase` | `think`(off\|low\|medium\|high) 추가. 유스케이스 2종 `market.dev-review`·`market.dev-diagram` |

계약: `MarketProjectCreatePayload` = `{ title, serviceAreas, tools, description, answers, aiConsent, devReviewJobId?, ndaRequired, budgetRange, deadline, method, targetExpertId? }`. multipart 파트 = `attachment`(일반) + `attachment:<area>:<slot>`(슬롯, 레지스트리·선택 분야 검증 → 400 `ATTACHMENT_FIELD_INVALID`). 검토서 입력 해시의 첨부 항목은 `${파트명}:${sha256}` 정렬 앞 10개(`routes/ai.ts devReviewAttachmentHashes` — 등록 라우트와 공유).

### 13.4 화면

- 위저드(`apps/market` `useRequestWizardForm`·`StepDescribe`·`StepDetails`·`StepReview`·`QuestionField`): 2스텝 카드는 레지스트리 데이터로만 그린다. 툴은 `<details>` 접힘 + "전문가 추천" 칩 기본. 슬롯 첨부는 `slotFiles["area:slot"]`. 검토서 신선도 서명은 제목·분야·설명·답변·첨부 전체(파트명 포함) — 툴은 원천이 아니다.
- 전문가 등록·프로필: `AreaToolsPicker`(분야 5종 + 분야별 툴). 목록 필터 `serviceArea`·`tool`.
- 의뢰 상세: 브리프 행(`buildDevReviewBriefRows(answers)`, 검토서 없이도)·희망 툴 행·슬롯 라벨 붙은 첨부·**정밀 구성도 섹션**(`DevDiagramSection` — 상태 배지·sandbox iframe 미리보기·전체 문서 모달·소유자 재생성).
- 관리자: 의뢰 상세에 툴·답변·정밀 구성도(감사 요약·강제 재생성), AI 설정에 정밀 구성도 블록(사용·모델·thinking·추가 지침).

### 13.5 정밀 시스템 구성도 (`apps/api/src/lib/ai/dev-diagram.ts`·`dev-diagram-runner.ts`)

- 프롬프트 `dev-diagram.v1` = §12.11 R4 프롬프트의 일반 규칙(배치·연결선·표현·정보 처리) + 픽스처 전용 교정 9개를 일반화한 것(요약 박스 선행·양방향 화살촉·viewBox 1900×1200·채널 그룹 2행·절연 경계·통신 블록 누락 금지) + `[개발 분야]`(레지스트리) + **앱·서버가 있으면 시스템 토폴로지 SVG 한 장 추가**(장치↔앱↔서버↔기존 장비, 개발 대상/기존 표식) + 도면 뒤 섹션 제목(공통 3 + 분야마다 1).
- 실행: `AI_USECASE_DEFS['market.dev-diagram'] = { kimi-k3, think 'high', temperature 0, seed 42, timeout 900s }`. 관리자가 모델·thinking 단계·추가 지침을 바꿀 수 있다. `:cloud` 접미는 404 시 러너가 붙였다 뗐다 재시도(ollama.com 직결 ↔ 로컬 프록시).
- 흐름: 등록(aiConsent ∨ 검토서 포함) → `requestDevDiagram` → 프로세스 내 큐(동시 1) → `running` → 파일서버에서 첨부 내려받아 같은 추출기로 코퍼스 재구성 → 게이트(§13.1 #26) → 생성 → **살균**(script·foreignObject·이벤트 속성·외부 URL·iframe 등 제거, CSP 메타 삽입) → **감사**(svg 수·섹션 수·자료 밖 수치·품번(R2 함수 재사용)·자료 핵심 품번 누락) → SVG 0 이면 1회 재시도 → `done` + 메일(`market_dev_diagram_ready`) | `error`. 서버 재시작 시 `resumeDevDiagramQueue` 가 queued/running 을 다시 태운다.
- 감사 결과는 삭제·강등에 쓰지 않고 **기록만**(전문가용 초안이라 자료 밖 표기도 TBD·검토 항목으로 보이는 편이 낫다). 화면은 "자료에 없는 표기 n건(전문가 확인)"으로만 알린다.
- 라우트: `POST /api/market/projects/:id/dev-diagram`(소유자 — 유스케이스 꺼짐 409 `USECASE_DISABLED`, 진행 중 409 `DEV_DIAGRAM_RUNNING`) · `POST /api/admin/market/projects/:id/dev-diagram`(강제).
- 프로빙 스펙 `e2e/specs/dev-diagram-probe.e2e.test.ts` 는 이 모듈의 함수를 그대로 import 한다(§9 규율). `DIAGRAM_FORCE=1` 로 게이트를 무시해 아이디어 단계 거동을 실측할 수 있다. 결과는 §13.6.

### 13.6 프로빙 v3 (2026-09-04, kimi-k3 thinking high · temperature 0 · seed 42, 원본 e2e/output/dev-diagram/2026-09-04T01-46-48/)

| 픽스처 | 입력 | 게이트 | 소요 | thinking | SVG | 섹션 | 자료 밖 표기 | 빠진 품번 | 골든 | 금지 |
|---|---|---|---|---|---|---|---|---|---|---|
| 07 버스 LED(회로·PCB·펌웨어) | 설명 + docx 20,826자 | 통과 | **300s** | 53,550자 | 1 | 6 | 0 | 10 → 규칙 보정 뒤 감소(패키지·핀 이름 제외) | 4/4 | 0 |
| 09 축사 모니터(회로·펌웨어·**앱·서버**, 아이디어 단계·첨부 없음) | 설명 560자 | 강제(FORCE) | **141s** | 20,333자 | **2**(토폴로지 + 하드웨어) | 7 | 3(4개·32°C·1대 — 설명의 "32도"·수량 표기 차이) | 0 | 4/4 | 0 |

관찰 — 07 은 §12.11 R4 실측과 같은 밀도(MCU 중앙·전원 체인·절연·양방향 화살촉·노란 검토 메모·검토 섹션 6개)를 픽스처 전용 교정 없이 **일반 규칙만으로** 냈고 300초(프로빙 566초보다 빠름). 09 는 앱·서버 분야가 있을 때 **시스템 토폴로지 SVG 가 먼저** 나오고(장치 ×6 · Wi-Fi 공유기 "기존" · 클라우드 서버·Android 앱 "개발 대상" 표식, HTTP/MQTT TBD), 하드웨어 블록도는 부품명 전부 TBD·출력 영역 "제어 출력 없음(향후 환풍기)"로 자료 밖 사실을 만들지 않았다. 분야별 검토사항(회로·펌웨어·앱·서버) 4절이 모두 생성됐다. → 아이디어 단계도 설명이 500자 이상이면 쓸 만하다고 판단해 게이트의 설명 기준을 600→**500자**로 낮췄다(첨부 없음·짧은 설명은 여전히 생략). 감사의 "빠진 품번"은 패키지(QFN-24-1EP)·핀 이름(SDA10)이 섞여 규칙에 제외 목록을 더했다. 살균 제거 노드 0(모델이 스크립트·외부 리소스를 쓰지 않았다).

실브라우저 완주(`e2e/tools/dev-review-v2-walk.ts`, 3스텝으로 갱신) — 5분야 카드·2단계(공통 4문항 + 분야별 카드 5개)·deepseek 검토서 10초·등록 #77·상세(브리프 행·희망 툴·정밀 구성도 섹션·5분야 검토 카드)·관리자 드로어 pageErrors 0. e2e-market 하네스 **118/0**(101→118: 슬롯 첨부 area/slot·툴 정규화·분야 밖 질문 400·미지 툴 400·dev-diagram 403/409). 단위: api 976 · utils(레지스트리 11 + 렌더러 8) · dev-diagram 6.

### 13.7 시스템 구성도 단일화 — 3단계 병렬 시작 · 플로팅 알림 (2026-09-04, 사용자 확정)

| # | 결정 | 근거 |
|---|---|---|
| 27 | 검토서 안의 3열 카드 "제안 시스템 구성도"를 **없애고** kimi 정밀 SVG 하나만 **"시스템 구성도"** 로 둔다(검토서 `MarketDevReview` **v4** — `diagram` 삭제, 렌더러 `renderDevReviewDiagramHtml`·`DiagramViewer`·R4 규칙 삭제) | 두 구성도가 한 화면에 있어 헷갈림. 검토서 프롬프트도 짧아진다 |
| 28 | 구성도 잡은 **3단계 진입 시 검토서 잡과 병렬로** 시작한다(`POST /ai/market.dev-review/run` → `{ jobId, diagramJobId, diagramSkipReason }`). 프로젝트 없이 사용자 소유 `sp_ai_job` 으로 돌고 결과(메타+살균 HTML)를 잡 행에 둔다. 등록 payload `devDiagramJobId` 로 서버가 소유자·입력 해시를 대조해 연결(done 이면 본문 복사, 진행 중이면 완료 시 러너가 연결된 프로젝트에 쓴다). 대조 실패는 **등록을 막지 않는다** | 등록 뒤 시작보다 5~10분 앞당긴다. 위저드는 여전히 기다리지 않는다 |
| 29 | 같은 입력 해시면 **진행 중 잡도 재사용**(1시간 창) — 3단계 재진입·검토서 재생성이 kimi 를 다시 돌리지 않는다. 위저드 이탈분 비용은 받아들인다 | 비용 통제 |
| 30 | **플로팅 트레이**(우하단, 로그인 사용자의 자기 의뢰) — `GET /market/my/dev-diagrams`(진행 중 + 24시간 내 완료·실패·생략)를 진행 중일 때만 10초 폴링. 알약 "생성 중 n건 · 경과", 펼치면 목록(불확정 바·경과·상세 링크), 완료는 "보기"/"닫기"까지 남고 닫은 건 localStorage 기억. **완료 알림은 이 브라우저가 진행 중을 본 적 있는 건만**(다른 기기·앱을 닫았다 온 사람은 메일), 위저드(/request)에서는 진행 중만 표시 — 같은 내용으로 다시 의뢰할 때 24시간 전 완료분이 튀어나오던 혼동의 교정. 같은 입력의 잡 재사용은 3단계 카드에 "재사용" 한 줄로 표기(run 응답 diagramCached). 헤더 배지·SSE 는 안 한다 | 화면을 벗어나도 완료를 알 수 있게. 진행률 % 는 LLM 이 주지 않는다 |
| 31 | 재시작 복구 — 프로젝트에 연결된 running 잡은 저장분에서 소스를 재구성해 재실행, **연결 안 된 잡(3단계에서만 시작)은 소스가 메모리에만 있어 `ABANDONED`** 로 종료(위저드의 "다시 만들기"가 새 잡을 연다) | 소스를 잡 행에 저장하지 않는 대신 단순함 |

화면: `DevReviewView` 의 ② 자리가 `DevDiagramSection`(상태 카드 → 완성 SVG, "전문가와 상의할 항목" 박스는 그대로 아래). 3단계는 진행 메타만(본문 null), 상세는 완성본 + 소유자 재생성. 관리자 축약본(`DevReviewSummary`)에서 구성도가 빠지고 `AdminMarketProjects` 의 구성도 섹션이 유일한 관리자 화면. 트레이 `DevDiagramTray`(`MarketLayout` 에 상시 마운트).
