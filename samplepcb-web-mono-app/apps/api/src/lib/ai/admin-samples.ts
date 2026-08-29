import type { DevReviewSource } from './dev-review';

// 관리자 "샘플 테스트"는 개인정보·실제 의뢰를 전송하지 않고 코드 버전으로 고정한 비식별
// 샘플을 쓴다. 내용은 프로빙 픽스처 `src/scripts/fixtures/dev-review/01-idea-only.json`
// (아이디어 단계·빈약한 설명·첨부 없음)을 그대로 옮긴 것 — 첨부가 없어 비전 모델을 타지
// 않으므로 주모델·추가 지침만 순수하게 검증한다. 픽스처가 바뀌면 여기도 같이 갱신할 것
// (단위 테스트가 두 사본의 동형을 지킨다).

export const DEV_REVIEW_ADMIN_SAMPLE: DevReviewSource = {
  title: '반려견 자동 급식기 제어 보드',
  serviceAreas: ['circuit', 'pcb', 'firmware'],
  description:
    '집을 비울 때 정해진 시간에 사료를 주는 자동 급식기를 만들고 싶습니다. 스마트폰으로 급식 시간을 설정하고 급식 기록을 확인하고 싶어요. 아직 아이디어 단계라 회로나 부품은 정해진 게 없습니다. 사료가 나오는 부분은 기구 업체가 따로 만들 예정입니다.',
  answers: [
    { code: 'stage', choices: ['idea'] },
    { code: 'deliverables', choices: ['schematic', 'artwork', 'firmware', 'prototype'] },
    { code: 'quantity', choices: ['proto_1_10'], note: '먼저 3대' },
    { code: 'power', choices: ['unknown'] },
    { code: 'connectivity', choices: ['wifi'] },
    { code: 'external', choices: ['mobile_app'] },
    { code: 'constraints', choices: ['unknown'] },
    { code: 'certification', choices: ['unknown'] },
    { code: 'timeline', choices: ['within_3m'] },
  ],
  attachmentContext: '',
  attachmentFiles: [],
};

export function getDevReviewAdminSample(): DevReviewSource {
  return DEV_REVIEW_ADMIN_SAMPLE;
}
