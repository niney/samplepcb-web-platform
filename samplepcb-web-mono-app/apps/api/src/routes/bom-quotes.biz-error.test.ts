import { describe, expect, it } from 'vitest';
import { BizError } from './bom-quotes';

// 고객 BOM 라우트는 같은 상태 코드로 **두 형태**의 오류를 낸다:
//   ① 봉투형 `{result:false, error:'CODE'}` — 화면이 코드로 분기하는 자리
//   ② @fastify/sensible 표준형 `{statusCode, error, message}` — `reply.conflict('…')`
// 응답 스키마가 한 쪽만 선언하면 다른 쪽이 **직렬화에서 막혀 500 으로 뒤바뀐다**.
// 2026-08-16 실측: 견적요청 후 시트 변경이 409("견적요청 후에는 시트를 변경할 수
// 없습니다") 대신 500(FST_ERR_FAILED_ERROR_SERIALIZATION)으로 나갔다. 부하가 높을 때
// 더 자주 보였을 뿐(공급사 확인 중 분기가 열려서), 결함은 상시 존재했다.
describe('BizError (고객 BOM 라우트 오류 응답 스키마)', () => {
  it('봉투형을 받는다 — 화면이 코드로 분기하는 자리', () => {
    expect(BizError.safeParse({ result: false, error: 'INVALID_SHEET_SELECTION' }).success).toBe(
      true,
    );
  });

  it('sensible 표준형을 받는다 — reply.conflict()/badRequest() 가 내는 모양', () => {
    const conflict = { statusCode: 409, error: 'Conflict', message: '견적요청 후에는 시트를 변경할 수 없습니다' };
    expect(BizError.safeParse(conflict).success, 'sensible 형태가 막히면 409 가 500 이 된다').toBe(
      true,
    );
  });

  it('둘 중 어느 모양도 아니면 거부한다 — 스키마가 아무거나 통과시키면 안 된다', () => {
    expect(BizError.safeParse({ result: true, error: 'X' }).success).toBe(false);
    expect(BizError.safeParse({ error: 'Conflict' }).success).toBe(false); // message 누락
    expect(BizError.safeParse({ message: '…' }).success).toBe(false); // error 누락
  });
});
