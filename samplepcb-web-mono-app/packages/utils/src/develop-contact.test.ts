import { describe, expect, it } from 'vitest';
import {
  AdminDevelopRequestPatchBody,
  DEVELOP_CONTACT_FIELD_LABELS,
  developContactChanges,
  normalizeDevelopContact,
} from '@sp/api-contract';

// 개발의뢰 연락처 — 관리자 수정(docs/DEVELOP_FLOW.md §7.3)이 쓰는 정리·비교 순수 함수와 수정 본문 검사.
const base = { name: '이투이', company: '이투이랩', phone: '010-1234-5678', email: 'e2e@example.com', hours: '오후 2~6시' };

describe('normalizeDevelopContact', () => {
  it('앞뒤 공백을 걷고 빈 회사·연락 가능 시간은 null', () => {
    expect(normalizeDevelopContact({ name: ' 홍길동 ', company: '   ', phone: ' 010-0000-0000 ', email: ' a@b.co ', hours: '' })).toEqual({
      name: '홍길동',
      company: null,
      phone: '010-0000-0000',
      email: 'a@b.co',
      hours: null,
    });
  });
});

describe('developContactChanges', () => {
  it('바뀐 칸만 칸 순서대로 — 공백만 다른 값은 그대로로 본다', () => {
    expect(developContactChanges(base, { ...base, name: ' 이투이 ', company: '이투이랩 ' })).toEqual([]);
    expect(developContactChanges(base, { ...base, email: 'new@example.com', phone: '010-9999-0000' })).toEqual(['phone', 'email']);
    expect(developContactChanges(base, { ...base, company: '', hours: null })).toEqual(['company', 'hours']);
    expect(developContactChanges(base, { ...base, email: 'new@example.com' }).map((f) => DEVELOP_CONTACT_FIELD_LABELS[f])).toEqual(['이메일']);
  });
});

describe('AdminDevelopRequestPatchBody.contact', () => {
  it('등록과 같은 검사 — 이름 필수·전화번호 형식·이메일 형식, 회사·연락 가능 시간은 생략하면 null', () => {
    expect(AdminDevelopRequestPatchBody.safeParse({ contact: { name: '홍길동', phone: '010-0000-0000', email: 'a@b.co' } }).success).toBe(true);
    const parsed = AdminDevelopRequestPatchBody.parse({ contact: { name: '홍길동', phone: '010-0000-0000', email: 'a@b.co' } });
    expect(parsed.contact).toEqual({ name: '홍길동', company: null, phone: '010-0000-0000', email: 'a@b.co', hours: null });
    expect(AdminDevelopRequestPatchBody.safeParse({ contact: { ...base, name: ' ' } }).success).toBe(false);
    expect(AdminDevelopRequestPatchBody.safeParse({ contact: { ...base, phone: '전화 없음' } }).success).toBe(false);
    expect(AdminDevelopRequestPatchBody.safeParse({ contact: { ...base, email: 'not-an-email' } }).success).toBe(false);
  });
});
