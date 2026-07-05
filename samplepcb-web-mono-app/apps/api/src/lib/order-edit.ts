// 주문 상세 편집 순수 매퍼 — AdminOrderInfoBody(카멜) → OrderInfoFields(od_ 화이트리스트).
// 라우트/DB 의존 없이 테스트한다(계약 shape → g5 컬럼 매핑). jibeon 은 코어 orderformupdate.php
// 처럼 **패스스루**(회원 ⑨-b 의 addr 변경 시 초기화와 다름 — 주문 편집은 FE 가 R/J/'' 를 명시
// 전송). zip 은 상세 스키마가 이미 zip1/zip2 분리라 그대로 매핑(코어는 합본 od_zip 서버 분해).
import type { AdminOrderInfoBodyType } from '@sp/api-contract';
import type { OrderInfoFields } from './g5-db';

export function orderInfoBodyToFields(body: AdminOrderInfoBodyType): OrderInfoFields {
  const f: OrderInfoFields = {};
  if (body.odName !== undefined) f.od_name = body.odName;
  if (body.odEmail !== undefined) f.od_email = body.odEmail;
  if (body.odTel !== undefined) f.od_tel = body.odTel;
  if (body.odHp !== undefined) f.od_hp = body.odHp;
  if (body.zip1 !== undefined) f.od_zip1 = body.zip1;
  if (body.zip2 !== undefined) f.od_zip2 = body.zip2;
  if (body.addr1 !== undefined) f.od_addr1 = body.addr1;
  if (body.addr2 !== undefined) f.od_addr2 = body.addr2;
  if (body.addr3 !== undefined) f.od_addr3 = body.addr3;
  if (body.addrJibeon !== undefined) f.od_addr_jibeon = body.addrJibeon;
  if (body.bName !== undefined) f.od_b_name = body.bName;
  if (body.bTel !== undefined) f.od_b_tel = body.bTel;
  if (body.bHp !== undefined) f.od_b_hp = body.bHp;
  if (body.bZip1 !== undefined) f.od_b_zip1 = body.bZip1;
  if (body.bZip2 !== undefined) f.od_b_zip2 = body.bZip2;
  if (body.bAddr1 !== undefined) f.od_b_addr1 = body.bAddr1;
  if (body.bAddr2 !== undefined) f.od_b_addr2 = body.bAddr2;
  if (body.bAddr3 !== undefined) f.od_b_addr3 = body.bAddr3;
  if (body.bAddrJibeon !== undefined) f.od_b_addr_jibeon = body.bAddrJibeon;
  if (body.depositName !== undefined) f.od_deposit_name = body.depositName;
  if (body.hopeDate !== undefined) f.od_hope_date = body.hopeDate;
  return f;
}
