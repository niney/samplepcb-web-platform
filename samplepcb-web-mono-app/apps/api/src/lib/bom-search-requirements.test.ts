import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engineFetch } from './engine-client';
import {
  toEngineSearchRequirements,
  validateEngineSearchRequirements,
} from './bom-search-requirements';

vi.mock('./engine-client', () => ({ engineFetch: vi.fn() }));

const engineFetchMock = vi.mocked(engineFetch);

const storedConnectorRequirements = {
  version: 'bom-user-search-requirements-v2' as const,
  componentType: 'connector' as const,
  packageCode: null,
  mountStyle: 'through-hole' as const,
  pinCount: 4,
  pitch: '2.54mm',
  rowCount: 2,
  gender: 'male' as const,
  orientation: 'right-angle' as const,
  updatedAt: '2026-07-25T00:00:00.000Z',
  updatedBy: 'tester',
};

describe('sp-engine 검색 조건 정책 어댑터', () => {
  beforeEach(() => {
    engineFetchMock.mockReset();
  });

  it('부품별 분기 없이 camelCase 계약을 snake_case 엔진 입력으로 옮긴다', () => {
    expect(toEngineSearchRequirements(storedConnectorRequirements)).toEqual({
      version: 'bom-user-search-requirements-v2',
      component_type: 'connector',
      package: null,
      mount_style: 'through-hole',
      pin_count: 4,
      pitch: '2.54mm',
      row_count: 2,
      gender: 'male',
      orientation: 'right-angle',
    });
  });

  it('엔진의 필드 단위 정책 오류를 기술 판정 없이 전달한다', async () => {
    engineFetchMock.mockResolvedValue(new Response(JSON.stringify({
      policy_version: 'bom-search-requirement-policy-v1',
      valid: false,
      requirements: null,
      errors: [{
        field: 'pitch',
        code: 'invalid_value',
        message: 'pitch 값은 양수 mm 단위로 입력해야 합니다.',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(
      validateEngineSearchRequirements(storedConnectorRequirements),
    ).resolves.toEqual({
      status: 'invalid',
      errors: [{
        field: 'pitch',
        code: 'invalid_value',
        message: 'pitch 값은 양수 mm 단위로 입력해야 합니다.',
      }],
    });
    expect(engineFetchMock).toHaveBeenCalledWith(
      '/supplier-search/requirements/validate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('엔진 장애 시 로컬 규칙으로 우회하지 않는다', async () => {
    engineFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      validateEngineSearchRequirements(storedConnectorRequirements),
    ).resolves.toEqual({
      status: 'unavailable',
      error: 'Error: ECONNREFUSED',
    });
  });
});
