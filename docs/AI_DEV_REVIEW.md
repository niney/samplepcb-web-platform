# AI 사전 검토서 — 재능마켓 의뢰 AI 산출물 재구성 (정본)

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
