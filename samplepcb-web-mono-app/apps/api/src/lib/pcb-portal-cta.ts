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
  /** 대행 주체가 샘플피씨비가 아닐 때 그 조직명(마스터딜러가 발주한 건). */
  proxyName?: string | null;
}

// ⚠ 판정은 **멤버 존재 ∧ 조직 승인**이다(여정 13호 교정). 멤버만 보면 정지(suspended)
//   조직이 빠져나간다 — requirePartner 는 status!=='approved' 를 403 으로 막으므로,
//   정지 조직에 포털 버튼을 보내면 "누르면 막히는 CTA"라는 같은 결함이 된다. 계정이
//   없어서 못 쓰는 것과 배제돼서 못 쓰는 것은 협력사가 보는 결과가 동일하다.
//
// issuerPartnerId — 이 메일이 다루는 문서의 **발주처**(sp_pcb_po·sp_pcb_rfq 의 parentPartnerId).
//   0n(관리자 직접)이면 대행 주체는 샘플피씨비 담당자다. 마스터딜러가 발주한 건이면 대행 주체도
//   문의처도 그 마스터딜러다 — 하위 협력사는 계정 없이 쓰는 것이 기본이라(하위 협력사 직접 관리),
//   "샘플피씨비 담당자에게"라고 보내면 하위가 모르는 곳으로 문의가 간다. 조직의 소유자가 아니라
//   **그 문서의 발주처**로 판정한다: 관리자가 연결해 준 하위에도 똑같이 맞다.
export const resolvePcbPortalCta = async (
  partnerId: bigint,
  issuerPartnerId = 0n,
): Promise<PcbPortalCta> => {
  try {
    const usable = await prisma.spPartnerMember.count({
      where: { partnerId, partner: { status: 'approved' } },
    });
    if (usable > 0) return { hasPortalAccount: true, inquiryEmail: null };
    if (issuerPartnerId !== 0n) {
      const issuer = await prisma.spPartner.findUnique({
        where: { id: issuerPartnerId },
        select: { name: true, contactEmail: true },
      });
      if (issuer !== null) {
        return { hasPortalAccount: false, inquiryEmail: issuer.contactEmail, proxyName: issuer.name };
      }
    }
    const profile = await getShopEstimateProfile();
    return { hasPortalAccount: false, inquiryEmail: profile?.managerEmail ?? null };
  } catch {
    return { hasPortalAccount: true, inquiryEmail: null };
  }
};
