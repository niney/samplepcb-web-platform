# Local BOM extraction corpus

`bom-extraction-engine` 전체 추출 경로를 실제 BOM으로 검증하는 로컬 전용
corpus다. 고객·실전 원본, `manifest.local.json`, 검증 보고서는 Git에 포함하지
않는다.

## 저장 원칙

- 원본은 SHA-256당 한 번만 보관하되, 이름이 유일하면
  `workbooks/<원본 파일명>`을 그대로 사용한다.
- 서로 다른 내용이 같은 파일명을 쓰는 경우에만
  `workbooks/collisions/<SHA 8자리>/<원본 파일명>`으로 격리한다.
- 원래 파일명과 중복 출처는 manifest의 `original_paths`에 모두 남긴다.
- 정답은 파일이 아니라 시트 단위로 작성한다.
- `header`는 분류·anchor·다중/반복 헤더 블록을, `extraction`은 component 행과
  선택적 열 역할을 소유한다.
- 새 실파일 패턴은 개인정보를 제거한 합성 테스트로도
  `packages/bom-extraction-engine/tests/`에 고정한다.

## 검증

`samplepcb-parts-engine`에서 실행한다.

```powershell
uv run python scripts/verify-bom-extraction-corpus.py --check headers
uv run python scripts/verify-bom-extraction-corpus.py --check extraction
uv run python scripts/verify-bom-extraction-corpus.py --check all
```

runner는 canonical 파일 선언 여부, SHA-256, 원본 provenance, 시트 목록,
BOM/비-BOM 분류와 선택한 계약을 검사한다. 반복 헤더는
`allowed_anchor_rows_1based` 중 어느 anchor를 선택해도 동일한 전체 블록을
복구하면 통과할 수 있다.

파일의 정체성은 표시 파일명이 아니라 manifest의 전체 SHA-256이다. 동일 SHA가
여러 원본 이름을 가졌다면 대표 원본명 하나를 저장하고 나머지는
`original_paths` 별칭으로 보존한다.

## 정답 작성 원칙

1. 엔진 결과를 보기 전에 원본 셀·병합 구조로 정답을 작성한다.
2. 대량 corpus는 독립 분할 판독 후 이견 시 교차 판독과 원본 감사를 거친다.
3. manifest는 파일 SHA-256과 결합하며, 내용이 바뀌면 즉시 실패해야 한다.
4. `non_bom`·`ambiguous`를 편의상 BOM으로 승인하지 않는다.
