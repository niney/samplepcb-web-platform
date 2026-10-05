// RfqReplyForm 의 행 타입 — .vue 가 export 한 타입은 ESLint 프로그램에서 error 타입이 되므로 .ts 에 둔다
// (옛 components/smartbom/RfqReplyForm.vue 의 RfqReplyFormRow 와 같은 모양).
export interface RfqReplyFormRow {
  quoteItemId: string;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  orderQty: number;
  reply: {
    unitPrice: number | null;
    replyQty: number | null;
    moq: number | null;
    stock: number | null;
    dateCode: string | null;
    leadTime: string | null;
    memo: string | null;
  } | null;
  /**
   * 협력사가 올려 둔 보유 부품의 같은 품번 값(docs/PARTNER_PARTS.md) — **제안**이다.
   * 아직 회신하지 않은 행에만 프리필하고, 이미 쓴 값은 절대 덮지 않는다.
   * 관리자 대리 입력 화면에는 넘기지 않는다(협력사 자신의 원장이므로).
   */
  myStock?: {
    stockQty: number | null;
    dateCode: string | null;
    leadTime: string | null;
    unitPrice: number | null;
    currency: string | null;
    moq: number | null;
    uploadedAt: string;
  } | null;
}
