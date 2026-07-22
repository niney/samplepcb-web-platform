# sp-engine 후보 판단 단일화 구현 프롬프트

아래 지시를 `samplepcb-parts-engine`의 공급사 검색 엔진을 수정하는 작업에 사용한다.

## 목표

BOM 원본과 공급사 후보 사이의 기술적 판단은 sp-engine만 수행한다. sp-node와 sp-vue가 엔진 상태·문자열·스펙을 다시 해석해 호환성이나 선택 가능 여부를 만들지 않도록, 후보마다 완결된 결정 계약을 반환한다.

가격, 환율, 재고, MOQ, 주문 배수, 견적 상태와 권한은 업무 시스템인 sp-node의 책임이다. sp-node는 엔진이 기술적으로 허용한 후보 안에서만 구매 조건을 계산할 수 있다.

## 필수 계약

각 `CandidateMatch`에 `decision`을 추가한다.

```json
{
  "decision_policy_version": "supplier-candidate-decision-v3",
  "selection_eligibility": "automatic | manual_review | blocked",
  "match_relation": "exact | variant | spec-compatible | unresolved",
  "auto_eligible": true,
  "manual_selectable": true,
  "reason_codes": ["identity_exact"],
  "identity_key": "엔진이 만든 안정 그룹 키",
  "technical_evidence_key": "기술 근거 동등성 비교용 안정 키",
  "verified_requirement_count": 2,
  "required_requirement_count": 3,
  "verification_complete": false,
  "strict_category_coverage": false,
  "lifecycle_state": "active | caution | unknown"
}
```

`ComponentSearchResult`에는 `identity_fallback: boolean`을 추가한다. 품번 검색 결과가 없어 확정 스펙 검색으로 전환한 경우에만 `true`다. 소비자가 `initial_query`와 `query`를 비교해 폴백 여부를 재추론하게 해서는 안 된다.

`identity_key`는 공급사별 같은 제조사·MPN 상품을 하나의 선택 후보로 묶는 키다. 제조사 별칭과 제조사 미상 후보의 병합 여부까지 엔진이 결정한다. `technical_evidence_key`는 가격·재고 비교를 허용할 만큼 기술 근거가 같은 후보에 동일하게 부여한다.

## 판단 불변식

- 정규화 MPN이 정확히 같으면 제조사 불일치·미상·추론 상태와 무관하게 `automatic`, `auto_eligible=true`, `manual_selectable=true`로 반환한다. 제조사 확인 사유와 세부 평가는 표시 근거로 계속 보존한다.
- 검증된 제조사 별칭은 불일치 근거를 만들지 않는다.
- 정확 MPN과 전기 스펙, 패키지, 부품 종류, 실장 방식, 직경 등 실제 기술 조건이 충돌해도 불일치 세부 평가를 보존하고 `automatic`, `auto_eligible=true`, `identity_exact_requirement_conflict`로 반환한다. 조달 정책은 이 후보를 자동 선정하며 별도 사용자 확인을 요구하지 않는다.
- 정확 MPN은 공급사에 일부 상세 스펙이 없어도 동일 주문 코드라는 정체성이 확인되면 자동 자격을 유지할 수 있다.
- 포장 접미사 등 변형 MPN과 파라메트릭 후보의 실제 기술 조건 충돌은 `blocked`, `manual_selectable=false`다.
- `spec_compatible` 후보는 모든 hard requirement가 확인되고, 부품 종류별 핵심 필드가 완전히 검증된 경우에만 자동 자격을 갖는다. 누락이나 충돌이 있으면 차단한다.
- `INPUT_CONFLICT` 같은 검색 상태를 거짓으로 `VERIFIED_EXACT`로 바꾸지 않는다. 검색 상태와 선택 자격은 서로 다른 축이다.
- NRND/EOL/obsolete/discontinued 해석은 엔진에서 `lifecycle_state`로 확정한다. 수명주기 주의 상태 자체는 기술 선택을 차단하지 않되 소비자가 별도 경고할 수 있어야 한다.
- 근거가 부족하거나 결정 계약을 생성할 수 없으면 안전하게 `blocked`로 축퇴한다.

## 물리 조건

BOM의 `package`, `value_raw`, `description`에서 실장 방식(SMD/SMT/표면실장, THT/through-hole/삽입형/리드형)과 원통형 부품 직경을 추출해 hard requirement로 계획한다. 공급사 `normalized_specs`, `attributes`, `package`, `description`에서 같은 실제 값을 읽어 검증한다.

동일 `identity_key`의 여러 공급사가 서로 다른 실장 방식이나 허용 오차를 넘는 직경을 주장하면 엔진에서 `mount_style_source_conflict` 또는 `diameter_mm_source_conflict`를 남긴다. 충돌 근거가 있는 정확 MPN 후보는 자동 선정 자격을 유지하고, 변형·파라메트릭 후보는 차단한다. 한 공급사에 값이 없고 다른 독립 공급사에 일관된 값이 있으면 확인된 값을 사용할 수 있다.

## 경계와 버전

- 엔진 내부 모델은 `extra="forbid"`를 유지한다.
- 검색 결과 스키마 버전을 올린다.
- 새 판단 필드가 추가되어도 원본 엔진 JSON은 그대로 보존할 수 있게 한다.
- sp-node는 이 계약을 관대하게 수신하되, `decision`이 없는 후보를 자체 규칙으로 복구하지 않고 차단한다.
- sp-vue는 `selection_eligibility`, `reason_codes`, 검증 수치와 수명주기 상태를 표시할 뿐 재판정하지 않는다.

## 필수 테스트

- 정확 MPN + 제조사 일치: `automatic`.
- 정확 MPN + 제조사 불일치만 존재: `automatic`, 자동 선정.
- 정확 MPN + 제조사 불일치 + 상세 스펙 누락: `automatic`, 자동 선정.
- 정확 MPN + 실제 스펙 또는 물리 조건 충돌: `automatic`, 자동 선정, 불일치 세부 평가 유지.
- 포장 접미사 변형 MPN: 엔진이 변형으로 검증한 경우에만 자동 가능.
- 포장 접미사 변형 MPN + 실제 조건 충돌: `blocked`.
- 스펙 검색의 hard requirement 누락/충돌: `blocked`.
- 스펙 검색의 필수 카테고리 조건 완전 충족: `automatic`.
- 품번 미검색 후 스펙 재검색: `identity_fallback=true`.
- 동일 정확 MPN 공급사 간 실장/직경 불일치: 충돌 근거 후보도 자동 선정 자격 유지.
- NRND/EOL 문자열: `lifecycle_state=caution`.
- 결정 키와 정렬이 같은 입력에서 항상 결정적임.

완료 후 Python 전체 테스트, 정적 검사, sp-node 계약 테스트, sp-vue 타입 검사까지 통과시키고 실제 BOM 한 건에서 엔진 원본 결정과 저장 스냅샷, 화면의 선택 가능 상태가 일치하는지 확인한다.
