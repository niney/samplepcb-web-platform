import type { GerberPriceModeType } from '@sp/api-contract';
import { prisma } from './prisma';

// sp_config 싱글 키 스토어 접근 — 코어 g5_config/g5_shop_default 를 건드리지 않는 sp 소유
// 설정(schema.prisma SpConfig). 현재 gerber_price_mode(거버 가격 해석: order|supply) 1키.

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
