// 회원 회사명의 공통 우선순위: sp 프로필 → 레거시 mb_2 → 미등록.
export function resolveMemberCompany(profileCompany: string | null, legacyMb2: string): string | null {
  const stored = profileCompany?.trim() ?? '';
  return stored || legacyMb2.trim() || null;
}
