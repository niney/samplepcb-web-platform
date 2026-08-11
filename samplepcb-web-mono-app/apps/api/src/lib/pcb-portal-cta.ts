import { prisma } from './prisma';
import { getShopEstimateProfile } from './g5-db';

// ── 무계정 조직 포털 CTA 판정(재점검 #15) — docs/PCB_PARTNER_TRACK.md §5.4 ────
// 연결 계정(sp_partner_member) 0인 조직에 "포털에서 진행" 버튼을 보내면 열어도
// 로그인에서 막히는 실행 불가 CTA 가 된다. 멤버 유무를 조회해 없으면 대행 안내
// (+운영자 문의처)로 치환하도록 협력사향 메일 빌더에 hasPortalAccount/inquiryEmail
// 을 싣는다. EQ 결정 메일(admin-pcb-pos 라우트 로컬)에서 시작해 협력사향 포털 CTA
// 메일 전수(발주서·선적 차례·입고 확인·A/S 접수·RFQ 폴백)로 확대하며 lib 로 승격.
// 조회 실패는 발송을 막지 않는다(기본 true — 버튼 유지가 안전한 폴백).

export interface PcbPortalCta {
  hasPortalAccount: boolean;
  inquiryEmail: string | null;
}

// ⚠ 판정은 **멤버 존재 ∧ 조직 승인**이다(여정 13호 교정). 멤버만 보면 정지(suspended)
//   조직이 빠져나간다 — requirePartner 는 status!=='approved' 를 403 으로 막으므로,
//   정지 조직에 포털 버튼을 보내면 "누르면 막히는 CTA"라는 같은 결함이 된다. 계정이
//   없어서 못 쓰는 것과 배제돼서 못 쓰는 것은 협력사가 보는 결과가 동일하다.
export const resolvePcbPortalCta = async (partnerId: bigint): Promise<PcbPortalCta> => {
  try {
    const usable = await prisma.spPartnerMember.count({
      where: { partnerId, partner: { status: 'approved' } },
    });
    if (usable > 0) return { hasPortalAccount: true, inquiryEmail: null };
    const profile = await getShopEstimateProfile();
    return { hasPortalAccount: false, inquiryEmail: profile?.managerEmail ?? null };
  } catch {
    return { hasPortalAccount: true, inquiryEmail: null };
  }
};
