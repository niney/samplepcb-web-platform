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

export const resolvePcbPortalCta = async (partnerId: bigint): Promise<PcbPortalCta> => {
  try {
    const members = await prisma.spPartnerMember.count({ where: { partnerId } });
    if (members > 0) return { hasPortalAccount: true, inquiryEmail: null };
    const profile = await getShopEstimateProfile();
    return { hasPortalAccount: false, inquiryEmail: profile?.managerEmail ?? null };
  } catch {
    return { hasPortalAccount: true, inquiryEmail: null };
  }
};
