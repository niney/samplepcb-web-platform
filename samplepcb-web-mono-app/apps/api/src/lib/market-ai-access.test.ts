import { describe, expect, it } from 'vitest';
import { canExpertViewInterviewAnswers } from './market';

const now = new Date('2026-07-15T00:00:00Z');
const openProject = {
  status: 'bidding',
  bidDeadlineAt: new Date('2026-07-20T00:00:00Z'),
  requestType: 'individual',
  method: 'open',
  targetExpertId: null,
};
const approvedCompany = { id: 1n, status: 'approved', expertType: 'company' };

describe('AI 인터뷰 원문 전문가 공개 자격', () => {
  it('입찰 가능한 승인 전문가에게 공개한다', () => {
    expect(canExpertViewInterviewAnswers({
      project: openProject,
      expert: approvedCompany,
      awardedExpertId: null,
      now,
    })).toBe(true);
  });

  it('시스템 통합 의뢰의 개인 전문가와 지정 외 전문가는 제외한다', () => {
    expect(canExpertViewInterviewAnswers({
      project: { ...openProject, requestType: 'system' },
      expert: { ...approvedCompany, expertType: 'individual' },
      awardedExpertId: null,
      now,
    })).toBe(false);
    expect(canExpertViewInterviewAnswers({
      project: { ...openProject, method: 'targeted', targetExpertId: 2n },
      expert: approvedCompany,
      awardedExpertId: null,
      now,
    })).toBe(false);
  });

  it('마감 뒤에는 채택 전문가만 계속 볼 수 있다', () => {
    const closed = { ...openProject, bidDeadlineAt: new Date('2026-07-14T00:00:00Z') };
    expect(canExpertViewInterviewAnswers({
      project: closed,
      expert: approvedCompany,
      awardedExpertId: null,
      now,
    })).toBe(false);
    expect(canExpertViewInterviewAnswers({
      project: closed,
      expert: { ...approvedCompany, status: 'suspended' },
      awardedExpertId: approvedCompany.id,
      now,
    })).toBe(true);
  });
});
