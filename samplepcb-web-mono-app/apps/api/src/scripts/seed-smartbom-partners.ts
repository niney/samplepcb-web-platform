// 스마트 BOM 파트너 시드·승격 — 설계 docs/SMARTBOM_PARTNER_RFQ.md §1.3. 멱등.
//  1) 공급사·자사 4행 시드(digikey/mouser/unikeyic + house samplepcb) — 레거시 하드코딩
//     mbNo(6035/6036/6045/6253)의 대체 정본. upsert 키 = supplierCode, 기존 행은 무수정
//     보존(관리자 수동 편집 우선).
//  2) 레거시 협력사 승격: SpMemberProfile.partnerAuth > 0 회원 → SpPartner(type=partner)
//     생성 + SpPartnerMember(owner) 연결. 멱등 키 = 해당 mbId 의 연결 존재.
// 실행: pnpm --filter api run smartbom:seed-partners [-- --dry]
import { PrismaClient } from '@prisma/client';
import type { PartnerCapabilityType } from '@sp/api-contract';

const dryRun = process.argv.includes('--dry');
const prisma = new PrismaClient();

// ── 1) 공급사·자사 시드 ────────────────────────────────────────────────────
const SUPPLIER_SEEDS = [
  { supplierCode: 'digikey', type: 'supplier', name: 'DigiKey', country: 'US', defaultCurrency: 'USD' },
  { supplierCode: 'mouser', type: 'supplier', name: 'Mouser Electronics', country: 'US', defaultCurrency: 'USD' },
  { supplierCode: 'unikeyic', type: 'supplier', name: 'UniKeyIC', country: 'CN', defaultCurrency: 'USD' },
  { supplierCode: 'samplepcb', type: 'house', name: '샘플피씨비', country: 'KR', defaultCurrency: 'KRW' },
] as const;

for (const seed of SUPPLIER_SEEDS) {
  const existing = await prisma.spPartner.findUnique({
    where: { supplierCode: seed.supplierCode },
  });
  if (existing !== null) {
    console.log(`skip supplier seed: ${seed.supplierCode} (#${String(existing.id)} 존재)`);
    continue;
  }
  if (dryRun) {
    console.log(`[dry] would seed ${seed.type}: ${seed.supplierCode} (${seed.name})`);
    continue;
  }
  const created = await prisma.spPartner.create({
    data: {
      type: seed.type,
      name: seed.name,
      supplierCode: seed.supplierCode,
      country: seed.country,
      defaultCurrency: seed.defaultCurrency,
      capabilities: ['part_sale'] satisfies PartnerCapabilityType[],
      status: 'approved',
    },
  });
  console.log(`seeded ${seed.type}: ${seed.supplierCode} → #${String(created.id)}`);
}

// ── 2) 레거시 협력사 승격(partnerAuth > 0) ─────────────────────────────────
// 등급 재해석(D5): 1=A/2=B/3=C(견적 참여 신뢰등급) → 견적 트랙 참여, 4=부품판매 → part_sale.
const capabilitiesOf = (partnerAuth: number): PartnerCapabilityType[] =>
  partnerAuth === 4 ? ['part_sale'] : ['bom_rfq', 'pcb_rfq'];

// 레거시 가짜 공급사 계정(mbId=Digikey/Mouser/UniKeyIC/samplepcb)은 승격 제외 —
// 조직 정본은 위 시드 행이고, 담당자 로그인이 필요하면 관리자 화면 '계정 연결'로
// 해당 조직에 하이브리드 연결한다(가짜 회원 승격 = 레거시 안티패턴 재생산 금지).
const excludedLegacySupplierIds: ReadonlySet<string> = new Set(
  SUPPLIER_SEEDS.map((s) => s.supplierCode),
);

const profiles = await prisma.spMemberProfile.findMany({
  where: { partnerAuth: { gt: 0 } },
  orderBy: { mbId: 'asc' },
});
console.log(`legacy partner candidates: ${String(profiles.length)}`);

let promoted = 0;
let skipped = 0;
let excluded = 0;
for (const profile of profiles) {
  if (excludedLegacySupplierIds.has(profile.mbId.toLowerCase())) {
    console.log(`exclude legacy supplier account: ${profile.mbId} (시드 조직으로 대체)`);
    excluded += 1;
    continue;
  }
  const linked = await prisma.spPartnerMember.findFirst({ where: { mbId: profile.mbId } });
  if (linked !== null) {
    skipped += 1;
    continue;
  }
  const name = profile.companyName?.trim();
  const partnerName = name !== undefined && name !== '' ? name : profile.mbId;
  if (dryRun) {
    console.log(
      `[dry] would promote: ${profile.mbId} → "${partnerName}" auth=${String(profile.partnerAuth)} kind=${profile.partnerKind ?? '-'}`,
    );
    promoted += 1;
    continue;
  }
  await prisma.$transaction(async (tx) => {
    const partner = await tx.spPartner.create({
      data: {
        type: 'partner',
        name: partnerName,
        defaultCurrency: 'KRW',
        capabilities: capabilitiesOf(profile.partnerAuth),
        status: 'approved',
        contactName: profile.managerName,
        contactPhone: profile.managerPhone,
        contactEmail: profile.managerEmail,
        legacyJson: {
          source: 'sp_member_profile',
          partnerAuth: profile.partnerAuth,
          partnerKind: profile.partnerKind,
          memberType: profile.memberType,
        },
      },
    });
    await tx.spPartnerMember.create({
      data: { partnerId: partner.id, mbId: profile.mbId, role: 'owner' },
    });
    console.log(`promoted: ${profile.mbId} → partner #${String(partner.id)} "${partnerName}"`);
  });
  promoted += 1;
}

console.log(
  `${dryRun ? '[dry] ' : ''}done — promoted ${String(promoted)}, already linked ${String(skipped)}, excluded ${String(excluded)}`,
);
await prisma.$disconnect();
