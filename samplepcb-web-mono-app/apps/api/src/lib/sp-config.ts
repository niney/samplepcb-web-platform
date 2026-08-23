import {
  BomEstimateContactUpdate,
  PartnerPartConfig,
  BomQuoteConfig,
  type BomEstimateContactType,
  type BomEstimateContactUpdateType,
  type BomQuoteConfigType,
  type GerberPriceModeType,
  type PartnerPartConfigType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { PARTNER_PART_STALE_AFTER_DAYS } from './partner-parts';

// sp_config 싱글 키 스토어 접근 — 코어 g5_config/g5_shop_default 를 건드리지 않는 sp 소유
// 설정(schema.prisma SpConfig). gerber_price_mode(거버 가격 해석: order|supply),
// bom_quote(고객 BOM 견적 비용·검색 한도 — JSON 직렬화),
// bom_estimate_contact(BOM 견적서 전용 담당자 — JSON 직렬화).

const GERBER_PRICE_MODE_KEY = 'gerber_price_mode';

// 미설정 기본은 order — 현행 동작(거버값 = 주문가 포함가 그대로)을 보존한다.
export async function getGerberPriceMode(): Promise<GerberPriceModeType> {
  const row = await prisma.spConfig.findUnique({ where: { key: GERBER_PRICE_MODE_KEY } });
  return row?.value === 'supply' ? 'supply' : 'order';
}

export async function setGerberPriceMode(mode: GerberPriceModeType): Promise<void> {
  await prisma.spConfig.upsert({
    where: { key: GERBER_PRICE_MODE_KEY },
    create: { key: GERBER_PRICE_MODE_KEY, value: mode },
    update: { value: mode },
  });
}

// ── 고객 BOM 견적 설정 — 레거시 하드코딩(운송료 30000·관리비 25000)의 관리자 설정 승격 ──

const BOM_QUOTE_CONFIG_KEY = 'bom_quote';

export const BOM_QUOTE_CONFIG_DEFAULTS: BomQuoteConfigType = {
  defaultShippingFee: 30_000,
  defaultManagementFee: 25_000,
  // 수출입은행 매매기준율 + 2% 안전계수를 기본으로 사용한다. 수동값은 API/캐시 장애 폴백.
  usdKrwRate: null,
  usdKrwRateMode: 'auto',
  usdKrwAutoRateType: 'dealBasR',
  usdKrwSafetyMarginPercent: 2,
  usdKrwMaxAgeDays: 7,
  // 실측: 부품 1건당 약 3콜(3공급사) — 100라인 BOM ≈ 300콜. 60은 실BOM에서 즉시 한도 초과였음.
  supplierSearchMaxCalls: 300,
  memberDailySearchLimit: 20,
  freshnessHours: 24, // 재고·가격 하루 변동은 "예상 견적" 수준에서 허용(확정은 관리자 검토)
  // 현재 실험 동작을 유지한다. 관리자는 BOM 견적 설정에서 다음 검색부터 끌 수 있다.
  storedPartPrioritySearchEnabled: true,
};

export async function getBomQuoteConfig(): Promise<BomQuoteConfigType> {
  const row = await prisma.spConfig.findUnique({ where: { key: BOM_QUOTE_CONFIG_KEY } });
  if (row === null) return BOM_QUOTE_CONFIG_DEFAULTS;
  try {
    const value: unknown = JSON.parse(row.value);
    // 자동 환율 필드 도입 전 JSON도 기본값과 병합해 무중단 승격한다.
    const parsed = BomQuoteConfig.safeParse(
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { ...BOM_QUOTE_CONFIG_DEFAULTS, ...value }
        : value,
    );
    return parsed.success ? parsed.data : BOM_QUOTE_CONFIG_DEFAULTS;
  } catch {
    return BOM_QUOTE_CONFIG_DEFAULTS; // 손상 값 — 기본값 폴백(다음 저장이 복구)
  }
}

export async function setBomQuoteConfig(config: BomQuoteConfigType): Promise<void> {
  const value = JSON.stringify(config);
  await prisma.spConfig.upsert({
    where: { key: BOM_QUOTE_CONFIG_KEY },
    create: { key: BOM_QUOTE_CONFIG_KEY, value },
    update: { value },
  });
}

// ── 고객 BOM 견적서 전용 담당자 ────────────────────────────────────────────
// 개인정보 보호책임자(g5_shop_default.de_admin_info_*)를 덮어쓰지 않는다.
// 빈 쌍은 기존 정보관리책임자를 쓰겠다는 명시적 설정이며 DB 마이그레이션이 필요 없다.

const BOM_ESTIMATE_CONTACT_KEY = 'bom_estimate_contact';

export const BOM_ESTIMATE_CONTACT_DEFAULTS: BomEstimateContactUpdateType = {
  managerName: '',
  managerEmail: '',
};

export async function getBomEstimateContact(): Promise<BomEstimateContactUpdateType> {
  const row = await prisma.spConfig.findUnique({ where: { key: BOM_ESTIMATE_CONTACT_KEY } });
  if (row === null) return BOM_ESTIMATE_CONTACT_DEFAULTS;
  try {
    const value: unknown = JSON.parse(row.value);
    const parsed = BomEstimateContactUpdate.safeParse(value);
    return parsed.success ? parsed.data : BOM_ESTIMATE_CONTACT_DEFAULTS;
  } catch {
    return BOM_ESTIMATE_CONTACT_DEFAULTS;
  }
}

export async function setBomEstimateContact(contact: BomEstimateContactUpdateType): Promise<void> {
  const value = JSON.stringify(contact);
  await prisma.spConfig.upsert({
    where: { key: BOM_ESTIMATE_CONTACT_KEY },
    create: { key: BOM_ESTIMATE_CONTACT_KEY, value },
    update: { value },
  });
}

export function resolveBomEstimateContact(
  configured: BomEstimateContactType,
  fallback: BomEstimateContactType,
): BomEstimateContactType {
  return configured.managerName !== '' && configured.managerEmail !== ''
    ? { ...configured }
    : { ...fallback };
}

// ── 협력사 보유 부품 운영 설정(docs/PARTNER_PARTS.md) ──────────────────────
// 만료를 안 두는 대신 '낡음'을 표시로만 쓴다(P4). 기본값은 env 로 두되 **정본은 여기**다 —
// 재고표 갱신 주기가 협력사마다 달라 운영 중 조정이 필요하다.

const PARTNER_PART_CONFIG_KEY = 'partner_parts';

export const PARTNER_PART_CONFIG_DEFAULTS: PartnerPartConfigType = {
  staleAfterDays: PARTNER_PART_STALE_AFTER_DAYS,
};

export async function getPartnerPartConfig(): Promise<PartnerPartConfigType> {
  const row = await prisma.spConfig.findUnique({ where: { key: PARTNER_PART_CONFIG_KEY } });
  if (row === null) return PARTNER_PART_CONFIG_DEFAULTS;
  try {
    const parsed = PartnerPartConfig.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : PARTNER_PART_CONFIG_DEFAULTS;
  } catch {
    return PARTNER_PART_CONFIG_DEFAULTS; // 손상 값 — 기본값 폴백(다음 저장이 복구)
  }
}

export async function setPartnerPartConfig(config: PartnerPartConfigType): Promise<void> {
  const value = JSON.stringify(config);
  await prisma.spConfig.upsert({
    where: { key: PARTNER_PART_CONFIG_KEY },
    create: { key: PARTNER_PART_CONFIG_KEY, value },
    update: { value },
  });
}
