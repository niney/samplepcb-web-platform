# samplepcb_pricing_api body 케이스 정리

이 문서는 옵션 변경 시 `samplepcb_pricing_api.php`로 전달되는 request body가 실제로 어떻게 바뀌는지 정리한다. 확인 방법은 실제 브라우저(`https://local-gerber.samplepcb.co.kr`)에서 저장된 보드 `CNAW_PMU_R4-2.zip`(160mm x 156mm, 2층)을 로드한 뒤, `window.fetch`를 몽키패치해서 `samplepcb_pricing_api`로 나가는 모든 요청의 실제 body를 캡처하는 방식으로 진행했다. stub 없이 실제 요청/응답을 그대로 사용했다.

이후 다른 보드(`mood.zip`, 70.2mm x 70.2mm, 2층, stackup/drill/outline 미설정 경고가 있는 파일)로 한 번 더 재검증했다. Standard/Advance/FPCB의 key 구성과 기본값은 `width`/`length`(보드 실측값)만 다르고 나머지는 완전히 동일하게 재현됐다 — 아래 문서 내용이 특정 보드에 종속된 결과가 아님을 확인했다. 이 재검증 과정에서 최초 조사 때의 오기(誤記) 하나를 발견해 정정했다(“메뉴 탭 전환 시 보드가 풀린다” 항목 — 아래 참고).

## 요청 생성 위치

- 호출 함수: `src/api/price.ts`의 `getPriceingAPI()`
- 실제 전송: `src/api/comm.ts`의 `post()` → `fetch()` (JSON body, `Content-Type: application/json`)
- 개발 URL: `/gerber_api/samplepcb_pricing_api.php` (devServer 프록시 경유)
- body 생성: `src/OptionControl/index.tsx`(Options 컴포넌트)의 `priceBody` state를 채우는 `useEffect`
- 옵션 상태 변경: `src/state/reducer.ts`의 `CHANGE_SPECIFICATION`, `SET_DEFAULT_SPECIFICATION`, `UPDATE_SPECIFICATION`
- 옵션 기본값/선택지 정의: `src/OptionControl/data/*.ts` (`sampleStandard.ts`, `massStandard.ts`, `sampleAdvanceFR4.ts` 등 메뉴별 파일)

가격 API body는 아래 순서로 조립된다.

```ts
{
  ...DEFAULT_PRICE,
  ...priceSpec,
  ...(menu === MENU_METALMASK ? {gb_type: 'MetalMask'} : {}),
  menu: type,
  category,
}
```

`priceSpec`은 `specs` 객체를 그대로 순회해서 만든다. **body의 key는 각 옵션의 `cApiParam`이 아니라 `specs` 객체 자체의 key**다. 값은 대부분 `spec.value`를 쓰고, `panel`만 예외적으로 `spec.cApiValue`를 쓴다.

```ts
const priceSpec = Object.fromEntries(
  Object.entries(specs ?? {}).map(([key, value]) => [
    key,
    key === 'panel' ? value.cApiValue : value.value,
  ])
)
```

Metal Mask가 아니면서 `width`가 비어 있으면 실제 API를 호출하지 않고 초기값(`INITIAL_PRICE`)을 그대로 반환한다.

**hidden 필드도 body에 포함된다.** `specs`에서 특정 옵션이 UI상 `hidden: true`가 되어도 `Object.entries(specs)`에는 여전히 잡히므로, 화면에 보이지 않는 필드도 마지막 값 그대로 body에 실린다. (`finishedCopperAdvance`, Advance/FPCB의 `cutting` 등이 대표적인 예 — 아래 각 섹션에서 실제 캡처로 확인.)

## 공통 필드

모든 실제 API 요청에서 변하지 않는 필드:

| field | 값 |
| --- | --- |
| `ShipType` | `"10"` |
| `Country` | `"Korea"` |
| `CountryCode` | `"KR"` |
| `Postalcode` | `"123456"` |
| `City` | `"Seoul"` |
| `mm_comp` | `"DHL"` |

`category`는 URL 쿼리 `?category=sample` / `?category=mass`로만 결정된다. 화면 안에는 카테고리를 바꾸는 토글이 없다 — `App.tsx`가 마운트 시 `query.category`를 읽어 `dispatch(setCategory(...))`할 뿐이다.

`menu`는 헤더에서 클릭한 메뉴 이름이 아니라 reducer가 계산한 `type` 값이다.

| 상단 메뉴 | PCB선택(Material) | body `menu` |
| --- | --- | --- |
| Standard | FR-4 (고정) | `standard` |
| Advance | FR-4 | `advanceFR4` |
| Advance | METAL | `advanceMetal` |
| Advance | ROGERS | `advanceRogers` |
| FPCB | FPCB | `flexibleFPCB` |
| FPCB | Rigid-Flex | `flexibleRigid` |
| Metal Mask | (해당 없음) | `metalMask` |

**메뉴 탭 전환 시 보드는 유지된다.** 보드가 로드된 상태에서 Standard/Advance/FPCB 탭을 여러 번 오가며 재확인한 결과, 보드는 계속 로드된 채로 유지되고 spec 세트만 교체된다(`width`/`length`처럼 보드에서 온 값은 유지, 나머지는 그 메뉴의 기본값으로 리셋). 최초 조사 때 "메뉴 탭을 클릭하면 보드가 풀린다"고 기록했던 것은 잘못된 관찰이었다 — 페이지를 새로 고친 직후 저장된 보드를 클릭하고 곧바로 메뉴 탭을 클릭하는 과정에서 보드 로드(IndexedDB 조회)가 끝나기 전에 클릭이 겹쳐 발생한 일시적 현상으로 보이며, 이번에 같은 시퀀스를 여러 번 재현했지만 재발하지 않았다.

## Standard

### Sample — baseline

`CNAW_PMU_R4-2.zip` 로드 직후 캡처된 실제 body:

```json
{
  "ShipType": "10",
  "Country": "Korea",
  "CountryCode": "KR",
  "Postalcode": "123456",
  "City": "Seoul",
  "menu": "standard",
  "mm_comp": "DHL",
  "category": "sample",
  "Material": "FR-4",
  "FR4Tg": "TG130",
  "layers": "2",
  "width": "160",
  "length": "156",
  "qty": "5",
  "panel": "No",
  "edgerail": "no",
  "pcbThickness": "1.6",
  "solderMask": "green",
  "silkscreen": "white",
  "surfaceFinish": "hasl",
  "copperWeights": "1oz",
  "finishedCopperAdvance": "0.5oz",
  "mixTrace": "6/6mil",
  "minHole": "0.3mm",
  "goldfingers": "no",
  "differentDesign": "1",
  "viaProcess": "Tenting vias",
  "halfHole": "no",
  "etest": "Flying",
  "cutting": "Single"
}
```

`Material`(PCB선택)과 `FR4Tg`(PCB재료)는 Standard에서는 옵션이 하나뿐이라 실제로는 바꿀 수 없다(`FR-4`, `TG130` 고정). `viaProcess`도 옵션이 `Tenting vias` 하나뿐이고, `etest`도 `Flying` 하나뿐이다.

### 단순 필드 변경 (1:1 캡처)

같은 보드에서 필드 하나씩 바꾸고 캡처한 결과. 표시되지 않은 필드는 이전 값 그대로 유지된다.

| 변경 | body 변화 |
| --- | --- |
| 크기 X `160 -> 170` | `width: "170"` |
| 크기 Y `156 -> 165` | `length: "165"` |
| PCB색상 `green -> red` | `solderMask: "red"` |
| 실크색상 선택(검정) | `silkscreen: "Black"` (대문자 B — `white`는 소문자인데 `Black`만 대문자 옵션값) |
| 표면마감 `hasl -> enig` | `surfaceFinish: "enig"` |
| PCB두께 `1.6 -> 0.8` | `pcbThickness: "0.8"` |
| 동박두께 `1oz -> 2oz` | `copperWeights: "2oz"` |
| 패턴폭/간격 `6/6mil -> 8/8mil` | `mixTrace: "8/8mil"` |
| 최소홀크기 `0.3mm -> 0.2mm` | `minHole: "0.2mm"` |
| 골드핑거 `no -> yes` | `goldfingers: "yes"` |
| 파일갯수 `1 -> 3` | `differentDesign: "3"` |
| 반홀가공 `no -> yes` | `halfHole: "yes"` |
| 컷팅 `Single -> V-Cut` | `cutting: "V-Cut"` |

### 수량 `qty`

타이핑 중에는 입력값 그대로 요청이 나가고, blur(포커스 아웃) 시 5개 단위로 올림 보정된 값으로 다시 요청이 나간다. 실제 캡처:

| 동작 | body `qty` |
| --- | --- |
| `5` 지우고 `1` 입력 | `"1"` (한 글자 입력마다 즉시 요청) |
| 이어서 `2` 입력 (`12` 완성) | `"12"` |
| 입력창에서 Tab으로 blur | `"15"` (5 단위로 올림) |

Metal Mask는 이 규칙에서 예외다(아래 Metal Mask 섹션 참고). blur 시에도 입력값을 그대로 유지한다.

### 배열 `panel` / 지삽바 `edgerail`

`panel`은 body에서 유일하게 `cApiValue`를 쓰는 옵션이라 대소문자가 상황에 따라 다르다. 기본값은 `"No"`(대문자)지만, 사용자가 select를 다시 조작해 같은 가치를 골라도 `"no"`(소문자)로 내려간다.

| 동작 | body 변화 |
| --- | --- |
| 초기 상태 | `panel: "No"`, `edgerail: "no"` |
| 배열 `Yes` 선택 | `panel: "yes"`, `edgerail: "7mm"` (edgerail 옵션도 `No/5mm/7mm` → `5mm/7mm`로 줄고 기본값이 `7mm`로 바뀜) |
| panel X에 `2` 입력 | `panel: "2x0"` |
| panel Y에 `3` 입력 | `panel: "2x3"` (X, Y는 별도 필드가 아니라 `panel` 문자열에 합쳐짐) |
| 배열 `No`로 되돌림 | `panel: "no"`(소문자로 바뀜), `edgerail: "no"` |
| edgerail만 직접 `5mm`로 변경 | `panel`은 그대로, `edgerail: "5mm"`만 바뀜 |

### 층수 `layers`

`layers`는 다른 두 필드의 표시 여부/선택지를 바꾼다 (`sampleStandard.ts`의 `references`).

| 조건 | 영향 |
| --- | --- |
| `layers < 4` | `finishedCopperAdvance` 숨김 처리. **body에는 계속 포함**(직전 값 유지) |
| `layers >= 4` | `finishedCopperAdvance` 표시. 값은 그대로 유지(강제 변경 없음) |
| `layers === '2'` | `copperWeights` 선택지가 `1oz/2oz`로 제한, 값이 `1oz`로 강제 보정 |
| `layers !== '2'` | `copperWeights` 선택지에 `0.5oz`가 추가(기존 값은 유지) |

실제 캡처(`layers: 2 -> 4`, 이전에 `copperWeights`를 `2oz`로 바꿔둔 상태):

```json
{
  "layers": "4",
  "copperWeights": "2oz",
  "finishedCopperAdvance": "0.5oz",
  "...": "나머지 필드는 이전 값 유지"
}
```

`copperWeights`는 `2oz` 그대로 유지됐고(강제 변경 없음), `finishedCopperAdvance` select가 새로 화면에 나타났다(값은 hidden 상태에서 갖고 있던 `0.5oz` 그대로).

### Mass

카테고리를 `mass`로 바꾸면(`?category=mass`) Standard에도 `mqty`(원판수량) 필드가 추가되고, `qty`와 `mqty`가 서로 계산된다.

Mass 로드 직후 baseline: `mqty: "1"`, `qty: "40"`, 나머지 키는 Sample Standard와 동일 + `category: "mass"`.

`qty` 변경 시 `mqty` 재계산 (`mqty = (qty * divVal / 1e6).toFixed(2)`):

| 동작 | body 변화 |
| --- | --- |
| `qty`를 `40 -> 80` | `qty: "80"`, `mqty: "2.00"` (divVal = width×length = 160×156 = 24960, `80*24960/1e6 = 1.9968 → "2.00"`) |

`mqty`를 직접 입력하면 반대로 `qty = floor(mqty * 1e6 / divVal)`:

| 동작 | body 변화 |
| --- | --- |
| `mqty`를 `5`로 입력 후 blur | `qty: "200"` (`floor(5*1e6/24960) = 200`) |
| 이 상태에서 `edgerail`을 `no -> 5mm`로 변경 | `mqty`는 `5`로 고정, `qty`가 새 divVal로 재계산됨: `qty: "187"` (divVal = `160*(156+2*5) = 26560`, `floor(5*1e6/26560) = 187`) |

즉 `qty` 변경 → `mqty` 재계산, `mqty`/`width`/`length`/`panel`/`edgerail` 변경 → `qty` 재계산이라는 방향이 실제로 확인된다. `panel`/`edgerail`이 없거나 `no`이면 계산에서 1(=0mm 추가 없음)로 취급된다.

Mass Standard에서만 추가로 확인된 옵션 차이:

- `panel` 옵션에 `고객사제공`(customer-provided)이 추가됨. 선택 시 `edgerail` 옵션이 `10mm` 하나로 고정.
- `edgerail` 옵션에 `10mm`이 추가됨.
- `viaProcess` 옵션에 `Open`이 추가됨(Sample Standard는 `Tenting vias` 하나뿐).

## Advance

### FR-4 — baseline (Sample)

Standard에서 Advance 메뉴로 전환한 직후:

```json
{
  "menu": "advanceFR4",
  "category": "sample",
  "Material": "FR-4",
  "FR4Tg": "TG150",
  "layers": "2",
  "width": "160",
  "length": "156",
  "qty": "5",
  "panel": "No",
  "edgerail": "no",
  "pcbThickness": "1.6",
  "solderMask": "green",
  "silkscreen": "white",
  "surfaceFinish": "hasl",
  "copperWeights": "1oz",
  "finishedCopperAdvance": "1oz",
  "mixTrace": "6/6mil",
  "minHole": "0.3mm",
  "goldfingers": "no",
  "differentDesign": "1",
  "impedance": "none",
  "viaProcess": "Tenting vias",
  "etest": "프로브",
  "cutting": "V-Cut"
}
```

Standard 대비 차이: `FR4Tg` 기본값이 `TG150`(Standard는 `TG130`), `finishedCopperAdvance` 기본값 `1oz`(Standard는 `0.5oz`), `impedance` 필드 추가, `etest` 기본값 `프로브`(Standard는 `Flying`), `cutting` 기본값 `V-Cut`(Standard는 `Single`). `halfHole` 키는 Advance FR-4에는 아예 없다.

선택지도 훨씬 넓어진다: `Material`에 `METAL`/`ROGERS` 추가, `FR4Tg`에 `TG170` 추가, `pcbThickness`가 `0.2~3.2`까지 세분화, `solderMask`에 `matteBlack`(무광검정) 추가, `surfaceFinish`에 `hardGold`/`ag` 추가, `copperWeights`가 `1/3oz~~12oz`까지 확장, `viaProcess`에 `Plugged vias/Not Covered/Buried/Blind` 추가, `etest`에 `BBT`/`No` 추가.

**hidden 필드 확인 — `cutting`은 `panel`에 종속된다.** `sampleAdvanceFR4.ts`에서 `panel`의 `references`가 `cutting`의 `hidden`을 제어한다: `panel === 'no'`이면 `cutting` select가 화면에서 숨겨지고, `panel === 'yes'`이면 나타난다. 하지만 숨겨진 상태에서도 body에는 `cutting` 값이 항상 포함된다(위 baseline에서 `panel: "No"`인데도 `cutting: "V-Cut"`이 있는 이유). `panel`을 `Yes`로 바꾸면 select가 나타나고 옵션은 `V-Cut/Tap Route/Both`(Standard의 `Single`이 없음)로 바뀐다.

### METAL — Material 전환

Advance에서 Material을 `METAL`로 바꾼 순간 spec 세트 전체가 교체된다:

```json
{
  "menu": "advanceMetal",
  "category": "sample",
  "Material": "METAL",
  "FR4Tg": "알루미늄(1W)",
  "wvoltage": "500V",
  "layers": "2",
  "width": "160",
  "length": "156",
  "qty": "5",
  "panel": "No",
  "edgerail": "no",
  "pcbThickness": "1.6",
  "solderMask": "white",
  "silkscreen": "black",
  "surfaceFinish": "osp",
  "copperWeights": "1oz",
  "mixTrace": "4/4mil",
  "minHole": "0.2mm",
  "goldfingers": "no",
  "differentDesign": "no",
  "impedance": "none",
  "viaProcess": "Tenting vias",
  "etest": "프로브",
  "cutting": "V-Cut"
}
```

FR-4 대비: `wvoltage`(내전압) 추가, `finishedCopperAdvance` 키 없음, `FR4Tg` 기본값이 재질 이름(`알루미늄(1W)`, 옵션: `알루미늄(2W)/Steel/Bronze`)으로 바뀜, `solderMask`/`silkscreen`/`surfaceFinish` 기본값도 흰색/검정/osp로 바뀜. **`differentDesign`이 텍스트 입력(`"1"`, `"3"`처럼 개수)이 아니라 select(`"no"`/`"yes"`)로 바뀐다** — FR-4/Rogers는 파일 개수를 입력받지만 METAL은 여러 디자인 여부만 묻는다.

### ROGERS — Material 전환

```json
{
  "menu": "advanceRogers",
  "category": "sample",
  "Material": "ROGERS",
  "FR4Tg": "4350B",
  "layers": "2",
  "width": "160",
  "length": "156",
  "qty": "5",
  "panel": "no",
  "edgerail": "no",
  "pcbThickness": "1.6",
  "solderMask": "green",
  "silkscreen": "white",
  "surfaceFinish": "ag",
  "copperWeights": "1oz",
  "finishedCopperAdvance": "1oz",
  "mixTrace": "6/6mil",
  "minHole": "0.3mm",
  "goldfingers": "no",
  "differentDesign": "no",
  "impedance": "no",
  "viaProcess": "Tenting vias",
  "etest": "프로브",
  "cutting": "V-Cut"
}
```

FR-4처럼 `finishedCopperAdvance`는 있지만 METAL처럼 `differentDesign`은 select다. `FR4Tg` 기본값은 Rogers 재질명(`4350B`). `surfaceFinish` 기본값은 `ag`.

**주의(불일치)**: `impedance`의 "없음" 값이 메뉴마다 다르다 — FR-4/METAL은 `"none"`, ROGERS는 `"no"`. 서버 쪽에서 두 값을 모두 처리하는지 확인이 필요할 수 있다.

### Mass Advance

Mass에서 Advance FR-4로 전환하면 Sample 세트에 `mqty`와 `category: "mass"`만 추가되고 나머지 key/기본값은 동일하다.

```json
{
  "menu": "advanceFR4",
  "category": "mass",
  "mqty": "1",
  "qty": "40",
  "...": "Sample Advance FR-4와 동일"
}
```

METAL/ROGERS도 마찬가지로 `mqty`가 추가되는 구조로 확인된다(`types.ts`의 `massAdvance*Options`에 `SPEC_QTYOFMST` 포함).

## FPCB

### FPCB — baseline

```json
{
  "menu": "flexibleFPCB",
  "category": "sample",
  "Material": "FPCB",
  "FR4Tg": "POLYAMIDE",
  "layers": "2",
  "width": "160",
  "length": "156",
  "qty": "5",
  "panel": "No",
  "edgerail": "no",
  "pcbThickness": "0.08",
  "solderMask": "yellow",
  "silkscreen": "white",
  "mixTrace": "0.06mm",
  "minHole": "0.15mm",
  "goldfingers": "no",
  "gusset": "None",
  "surfaceFinish": "enig",
  "surfaceFinishWeights": "1U",
  "copperWeights": "1oz",
  "finishedCopperAdvance": "1oz",
  "MTare": "None",
  "etest": "프로브",
  "differentDesign": "1",
  "impedance": "none",
  "halfHole": "no"
}
```

Standard/Advance에는 없는 `gusset`(보강판), `surfaceFinishWeights`(표면마감두께), `MTare`(3M Tape) 필드가 추가되고, `viaProcess`/`cutting` 키는 없다. `pcbThickness` 기본값이 `0.08`(연성 재질), `solderMask` 기본값이 `yellow`.

### Rigid-Flex — Material 전환

```json
{
  "menu": "flexibleRigid",
  "category": "sample",
  "Material": "Rigid-Flex",
  "layers": "2",
  "width": "160",
  "length": "156",
  "qty": "100",
  "panel": "no",
  "edgerail": "no",
  "mat": "폴리아미드+FR4",
  "pcbThickness": "1.6",
  "mixTrace": "6/6mil",
  "minHole": "0.3mm",
  "surfaceFinish": "hasl",
  "goldfingers": "no",
  "differentDesign": "1",
  "halfHole": "no"
}
```

FPCB보다 필드가 훨씬 적다 — `FR4Tg`/`copperWeights`/`surfaceFinishWeights`/`gusset`/`MTare`/`etest`/`impedance` 키가 전부 없다. 대신 `mat`(재료, 기본값 `폴리아미드+FR4`)이 새로 생긴다. `qty` 기본값이 `100`으로 다른 메뉴(`5`)와 다르다.

## Metal Mask

### baseline

Metal Mask는 보드(width) 없이도 API를 호출한다. `gb_type: "MetalMask"`가 항상 추가된다.

```json
{
  "ShipType": "10",
  "Country": "Korea",
  "CountryCode": "KR",
  "Postalcode": "123456",
  "City": "Seoul",
  "menu": "metalMask",
  "mm_comp": "DHL",
  "category": "sample",
  "frame": "nonFramework",
  "size": "300x400",
  "sizeExtra": "",
  "stencilSide": "Top Side",
  "minHoleSize": "0.12",
  "qty": "1",
  "gb_type": "MetalMask"
}
```

### 옵션 변경 케이스

| 동작 | body 변화 |
| --- | --- |
| `frame: nonFramework -> framework` | `frame: "framework"`, `size: "650x550"`(옵션도 `300x400/direct` → `320x320/370x470/400x320/450x320/650x550/736x736/800x736`로 완전히 바뀜, `direct`는 사라짐) |
| framework 상태에서 size를 `736x736`으로 선택 | `size: "736x736"` |
| `frame: framework -> nonFramework` | `frame: "nonFramework"`, `size: "300x400"`(framework 쪽 옵션은 사라지고 `direct`가 다시 나타남) |
| nonFramework에서 `size: direct` 선택 | `size: "direct"`, `sizeExtra: ""` |
| 직접입력 칸에 `123x456` 입력 | `sizeExtra: "123x456"` |
| `qty`에 `13` 입력 후 blur | `qty: "13"` — 일반 PCB처럼 5개 단위로 보정하지 않고 입력값 그대로 유지된다 |

## 정리 — 옵션 변경이 body에 반영되는 방식

1. **단순 select/text 변경**: 대부분은 변경한 key 하나만 바뀌고 나머지는 유지된다.
2. **`panel`**: `cApiValue`를 쓰기 때문에 초기값(`"No"`)과 재선택 값(`"no"`)의 대소문자가 다르다. panelX/Y는 `panel` 문자열 하나(`"2x3"`)로 합쳐진다.
3. **`qty`/`mqty`**: Sample은 blur 시 5 단위 올림(Metal Mask는 예외). Mass는 `qty`↔`mqty`가 `divVal`(=panel/edgerail을 반영한 실면적)을 매개로 상호 재계산된다.
4. **hidden 필드도 body에 실린다**: `layers<4`일 때의 `finishedCopperAdvance`, `panel==='no'`일 때의 Advance/`cutting`처럼 화면에서 숨겨진 옵션도 `specs` 상태에 남아있는 값 그대로 매 요청에 포함된다.
5. **메뉴/재질 전환은 필드 일부 교체가 아니라 spec 세트 전체 교체**다. Standard/Advance-FR4/Advance-METAL/Advance-ROGERS/FPCB/Rigid-Flex/MetalMask는 서로 key 구성이 다른 독립된 객체이며, 전환 시 이전 메뉴의 값은 사라지고 그 메뉴의 기본값으로 다시 시작한다. **단, 로드된 보드 자체(`width`/`length`의 원본, 파일)는 메뉴를 전환해도 풀리지 않고 유지된다.**
6. **카테고리(`sample`/`mass`)는 URL 쿼리로만 바뀐다.** 화면 안 토글은 없고, mass는 대부분의 PCB 메뉴에 `mqty`가 추가된다.
7. **같은 값을 다시 선택하면 요청이 나가지 않는다.** `OptionControl/index.tsx`의 `handleSpecOption`은 `spec.value !== changeValue`일 때만 `dispatch`한다. 이미 선택된 옵션을 select에서 다시 골라도(예: `green`이 선택된 상태에서 `green`을 다시 선택) state가 바뀌지 않으므로 가격 API 요청 자체가 발생하지 않는다. 반면 텍스트 필드(`width` 등)는 같은 값을 다시 넣어도 매 keystroke마다 `onChange`가 불려 요청이 나갈 수 있다(3번 항목의 `qty` 타이핑 케이스 참고).

## 재검증 로그

- 2차 검증 보드: `mood.zip`(70.2mm x 70.2mm, 2층). stackup/drill/outline 미설정 경고가 떠 있는 상태였지만 가격 API는 정상적으로 호출되고 정상 응답(공급가격 35,000원)을 받았다 — 레이어 경고 상태가 가격 API 호출 자체를 막지는 않는다.
- Standard → Advance → FPCB → Standard 순으로 반복 전환하며 매번 body를 캡처했고, 매번 `width`/`length`만 보드 실측값(`70.2`)으로 유지된 채 나머지 key 구성·기본값은 `CNAW_PMU_R4-2.zip` 기준 결과와 완전히 일치했다.
- 최초 조사에서 기록했던 "메뉴 탭 클릭 시 보드가 풀린다"는 이번 재검증에서 재현되지 않아 오기로 판단, 위 "공통 필드" 섹션에서 정정했다.

## 활용 (2026-07-03 추가)

이 문서의 케이스 매트릭스는 신규 가격 엔진의 **레거시 실측 패리티 체계**의 근거가 됐다:
`apps/api/src/scripts/capture-legacy-pricing-goldens.ts` 가 위 케이스들을 라이브 레거시 API 에
재생해 fixture 를 만들고, `legacy-parity.test.ts` 가 신규 엔진과 대조한다.
운영 절차는 `docs/pricing-engine-parity.md` 참조.
