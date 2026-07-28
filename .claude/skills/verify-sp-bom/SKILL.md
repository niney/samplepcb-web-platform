---
name: verify-sp-bom
description: 고객 BOM 업로드 플로우(sp-vue → sp-node → sp-engine)를 헤드리스로 실행해 스프레드시트/CSV/BOM 파일 하나 또는 폴더 전체의 견적·행별 후보 API 결과를 캡처하고, 원본을 독립적으로 검사해 추출·검색·선정·실패 근거를 대조한다. BOM 회귀 점검, 픽스처 일괄 검토, 브라우저 없는 재현, "업로드된 BOM 결과가 맞는지 확인해줘" 요청에 사용한다.
---

# Verify SP BOM

실제 고객 경로(sp-node 공개 API)를 그대로 태워서 결과를 캡처하고, 원본과 대조한다.
실행·계약은 리포 러너(`apps/api/src/scripts/verify-bom-upload.ts`)에 맡기고, 판단은 독립 원본 검사로 한다.

## 워크플로

### 1. 범위 확정 + 원본 먼저 검사

요청된 파일/폴더를 확정하고 지원 확장자(`xlsx`, `xlsm`, `xls`, `csv`, `tsv`, `bom`)를 열거한다.
**러너 실행 전에** 원본을 독립적으로 읽어 근거를 먼저 기록한다. sp-engine 출력은 절대 기준선으로 쓰지 않는다.

- 시트명, 헤더 행, 유효 데이터 행 수;
- 조달 대상 행 vs 제목/구분 행, DNP·NC, PCB, 서비스, 기구물 행;
- 대표 행의 MPN·값·수량·패키지·제조사·부품 유형;
- 병합 셀, 변형 헤더, 수량 표기, 인코딩 위험;
- 원본 근거로 직접 뒷받침되는 기대치만 (실시간 가격·재고 추측 금지).

CSV/TSV는 Read로 충분하다. 엑셀은 `apps/api`에 있는 `exceljs`로 구조를 덤프한다 — 스크래치패드에 스크립트를 쓰고 `apps/api` 컨텍스트에서 실행한다:

```ts
// <scratchpad>/dump-bom.ts
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(process.argv[2]!);
workbook.eachSheet((sheet) => {
  console.log(`## ${sheet.name} rows=${sheet.rowCount} cols=${sheet.columnCount}`);
  sheet.eachRow((row, index) => {
    if (index <= 30) console.log(index, JSON.stringify(row.values));
  });
});
```

```powershell
pnpm --dir samplepcb-web-mono-app/apps/api exec tsx "<scratchpad>\dump-bom.ts" "D:\path\to\BOM.xlsx"
```

폴더 입력이면 모든 워크북을 구조적으로 훑고, 이상 결과가 나온 파일만 깊게 본다.

### 2. 부작용을 먼저 알린다

러너는 **실제 로컬 임시 견적을 만들고**, 원본 파일을 업로드하며, 공급사 API 쿼터를 소모하고, 카탈로그 인제스트를 유발할 수 있다.
후보 선정, 검색 조건 변경, RFQ 발행, 결과 삭제는 하지 않는다.

URL이 있다는 이유만으로 운영에 실행하지 않는다. 로컬이 아닌 환경은 사용자 토큰(`BOM_VERIFY_TOKEN`)이나 PHP 세션(`BOM_VERIFY_COOKIE`)을 쓴다. `--allow-local-token`은 승인된 개발 호스트 밖에서 하드 차단된다.

### 3. 리포 러너 실행

리포 루트에서:

```powershell
pnpm --dir samplepcb-web-mono-app/apps/api bom:verify "D:\path\to\BOM.xlsx" `
  --allow-local-token --local-member-id "claude-bom-verify"
```

주요 옵션 (`--help`로 전체 확인):

| 옵션 | 기본값 |
| --- | --- |
| `--base-url <URL>` | `https://local-web.samplepcb.co.kr` |
| `--output <폴더>` | `.tmp/bom-verification/<시각>` |
| `--timeout-minutes <분>` | 30 (파일당) |
| `--candidate-concurrency <n>` | 4 |
| `--no-part-data-retry` | 부품정보 실패 시 화면의 재시도 생략 |

인증 세션이 있으면 `BOM_VERIFY_TOKEN` 또는 `BOM_VERIFY_COOKIE`를 프로세스 환경에 넣고 `--allow-local-token`은 뺀다. **두 값은 출력하거나 파일에 남기지 않는다.**

폴더 입력은 재귀·결정적·파일 단위 순차 실행이다. 다중 시트 워크북은 엔진이 BOM으로 분류한 시트를 **전부** 선택하므로, 사람이 UI로 돌린 결과와 비교할 때 이 자동 정책을 반드시 명시한다.

서비스가 죽어 있으면 실패 산출물을 보존하고 정확한 엔드포인트와 상태 코드를 보고한다. sp-engine을 직접 호출하는 우회는 금지 — sp-node 정책·영속화·로컬 카탈로그·인제스트·결과 반영을 통째로 건너뛴다.

### 4. 정본 산출물 읽기

해석 전에 `references/output-schema.md`를 읽는다. 순서:

1. 루트 `manifest.json`, `report.md`;
2. 파일별 `summary.json`, `report.md`;
3. `quote-detail.json` (최종 화면 데이터 원본);
4. 활성 행마다 `candidates/<itemId>.json`;
5. `comparison-pages/*.json`;
6. `api-trace.jsonl` (요청 순서·상태·지연).

원시 API 응답이 정본이고 Markdown 리포트는 속도용 파생물이다. 화면 매치 그룹 수치는 sp-vue와 러너가 **같은 `@sp/utils` 순수 표현 함수**를 import하므로 그대로 비교해도 된다.

### 5. 독립 대조

독립 관찰한 원본 행마다 캡처된 근거와 대조한다:

- 행 매핑: 원본 시트/행/레퍼런스 지정자;
- 추출: `extraction.payload`, `originalMpn`, `originalValue`, 패키지, 수량, 제조사;
- 포함 여부: 활성 아이템 vs 제외/비조달 의도;
- 검색: `localCatalogTrace`, `searchTrace.attempts`, 폴백 사용, 한도, 오류;
- 후보: 후보 수, 정체성/스펙 충돌, 미충족 요구조건, 적격성, 오퍼, 선정/추천 키;
- 최종 표시: 매치 그룹, 선정 출처·반영 상태, 확인 필요 여부, 수량 상태, 가격 유무, 재고 상태.

구분해서 쓴다:

- 확정된 추출·정책 결함;
- 의도된 보수적 검토 판단;
- `partDataStatus`·타임아웃·API 오류·호출 한도로 인한 **캡처 미완**;
- 공급사 결과·가격·재고·캐시의 실시간 변동.

기계적 체크가 초록이라는 것만으로 의미적 정확성을 주장하지 않는다. 그 체크는 플로 완주와 캡처 완전성만 증명한다.

### 6. 보고

총계와 확정 불일치를 먼저 낸다. 이슈마다 파일·시트·원본 행·견적 ID·아이템 ID·원본 근거·캡처 결과·차이 원인을 붙인다. 재현 가능한 결함과 공급사 변동을 분리하고, 완주하지 못한 파일을 나열한다.

산출물은 `.tmp/bom-verification/`(gitignore됨)에 남긴다. 사용자가 따로 요청하지 않는 한 서버 측 견적·파일을 지우지 않는다.
