import { AdminPcbExchangeRateResponse, apiRoutes } from '@sp/api-contract';
import { apiGet } from '@sp/shared';

/** PCB 결제통화→KRW 당일 TTS 환율. 캐시 미준비면 null이라 화면이 수동 입력을 요구한다. */
export async function fetchPcbExchangeRate(
  from: 'USD' | 'CNY',
): Promise<{ rate: number; rateDate: string | null } | null> {
  const res = await apiGet(
    `${apiRoutes.adminPcbExchangeRate}?from=${from}`,
    AdminPcbExchangeRateResponse,
  );
  return res.data;
}
