import { BomQuoteConfig, type BomQuoteConfigType, type GerberPriceModeType } from '@sp/api-contract';
import { prisma } from './prisma';

// sp_config 싱글 키 스토어 접근 — 코어 g5_config/g5_shop_default 를 건드리지 않는 sp 소유
// 설정(schema.prisma SpConfig). gerber_price_mode(거버 가격 해석: order|supply),
// bom_quote(고객 BOM 견적 비용·검색 한도 — JSON 직렬화).

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
  usdKrwRate: null, // 미설정 = USD 오퍼 미환산 표시(정직) — 관리자가 채우면 환산 예상 표기
  // 실측: 부품 1건당 약 3콜(3공급사) — 100라인 BOM ≈ 300콜. 60은 실BOM에서 즉시 한도 초과였음.
  supplierSearchMaxCalls: 300,
  memberDailySearchLimit: 20,
  freshnessHours: 24, // 재고·가격 하루 변동은 "예상 견적" 수준에서 허용(확정은 관리자 검토)
};

export async function getBomQuoteConfig(): Promise<BomQuoteConfigType> {
  const row = await prisma.spConfig.findUnique({ where: { key: BOM_QUOTE_CONFIG_KEY } });
  if (row === null) return BOM_QUOTE_CONFIG_DEFAULTS;
  try {
    const parsed = BomQuoteConfig.safeParse(JSON.parse(row.value));
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
