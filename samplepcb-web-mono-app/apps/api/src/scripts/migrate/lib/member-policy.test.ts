import { describe, expect, it } from 'vitest';
import { planExistingAdminUpdate } from './member-policy';

const cols = ['mb_no', 'mb_id', 'mb_name', 'mb_level', 'mb_password', 'mb_password2'];
const legacy = { mb_no: 1, mb_id: 'admin', mb_name: '레거시 관리자', mb_level: 10, mb_password: '*legacy', mb_password2: '' };
const installed = { mb_no: 99, mb_id: 'admin', mb_name: '설치 관리자', mb_level: 2, mb_password: 'sha256:install', mb_password2: '' };

describe('기존 admin 최초 이관', () => {
  it('설치 관리자 정보를 레거시로 갱신하고 기존 회원 번호는 보존한다', () => {
    expect(planExistingAdminUpdate(legacy, installed, cols, new Set(['kpeter']))).toEqual({
      mb_name: '레거시 관리자', mb_level: 10, mb_password: '*legacy', mb_password2: '',
    });
  });

  it('같은 비밀번호를 신규 코어가 재해시한 경우 해시와 앵커를 보존한다', () => {
    const target = { ...legacy, mb_no: 99, mb_password: 'sha256:rehash', mb_password2: '*legacy' };
    expect(planExistingAdminUpdate(legacy, target, cols, new Set())).toEqual({});
  });

  it('레거시 비밀번호가 바뀌면 새 해시를 반영하고 이전 앵커를 비운다', () => {
    const target = { ...legacy, mb_password: 'sha256:rehash', mb_password2: '*old' };
    expect(planExistingAdminUpdate(legacy, target, cols, new Set())).toEqual({
      mb_password: '*legacy', mb_password2: '',
    });
  });

  it('일반 기존 계정 및 명시적으로 보호한 admin은 보존한다', () => {
    expect(planExistingAdminUpdate({ ...legacy, mb_id: 'kpeter' }, installed, cols, new Set())).toBeNull();
    expect(planExistingAdminUpdate(legacy, installed, cols, new Set(['admin']))).toBeNull();
  });

  it('동일 데이터 재이관은 회원 UPDATE를 만들지 않는다', () => {
    const set = planExistingAdminUpdate(legacy, installed, cols, new Set());
    expect(planExistingAdminUpdate(legacy, { ...installed, ...set }, cols, new Set())).toEqual({});
  });
});
