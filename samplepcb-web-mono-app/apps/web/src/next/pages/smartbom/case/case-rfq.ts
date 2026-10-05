import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type { AdminBomRfqViewType, BomRfqReplyBodyType } from '@sp/api-contract';
import {
  useAdminRfqReply,
  useReissueRfqMagicLink,
  useStartAdminSupplierOfferRefresh,
} from '@/admin/useAdminBomRfqs';
import type { RfqReplyFormRow } from '@/next/components/smartbom/rfq-reply-form';
import type { CaseCore } from './case-core';

// 협력사 RFQ — 발송·비교 대화상자 여닫기, 대리 입력(회신 보기·수정), 매직링크 재발급(§6.9).
// 옛 화면 스크립트의 'RFQ 발송·대리 입력·비교 선정' 부분 그대로.
export function useCaseRfq(core: CaseCore) {
  const { detailId, scopeItems } = core;

  const sendOpen = ref(false);
  const compareOpen = ref(false);
  const replyRfq = ref<AdminBomRfqViewType | null>(null);
  const replyError = ref('');
  const rfqReply = useAdminRfqReply();
  const startSupplierRefresh = useStartAdminSupplierOfferRefresh();

  function openRfqReply(rfq: AdminBomRfqViewType): void {
    replyRfq.value = rfq;
    replyError.value = '';
  }

  // 매직링크 재발급(§6.9) — 확인은 패널이 담당, 여기선 호출만.
  const reissueLink = useReissueRfqMagicLink();
  const rfqLinkNotice = ref('');
  const rfqLinkError = ref('');
  async function reissueMagicLink(rfq: AdminBomRfqViewType): Promise<void> {
    if (detailId.value === null) return;
    rfqLinkNotice.value = '';
    rfqLinkError.value = '';
    try {
      await reissueLink.mutateAsync({ quoteId: detailId.value, rfqId: rfq.rfqId });
      rfqLinkNotice.value = `${rfq.partnerName}의 새 회신 링크가 발급되었습니다. 기존 이메일의 링크는 무효입니다 — [링크 복사]로 협력사에게 전달하세요.`;
    } catch (error) {
      rfqLinkError.value = error instanceof ApiRequestError ? error.message : '회신 링크 재발급에 실패했습니다.';
    }
  }

  // 대리 입력 폼의 행 — 요청 범위(전체 요청이면 현재 범위 전부)와 이미 받은 행 회신을 합친다.
  const replyRows = computed<RfqReplyFormRow[]>(() => {
    const rfq = replyRfq.value;
    if (rfq === null) return [];
    const replyByItem = new Map(rfq.items.map((item) => [item.quoteItemId, item]));
    const visibleItems =
      rfq.requestedItemIds === null
        ? scopeItems.value
        : scopeItems.value.filter((item) => rfq.requestedItemIds?.includes(item.id) === true);
    return visibleItems.map((item) => {
      const reply = replyByItem.get(item.id);
      const price = reply?.unitPrice ?? null;
      return {
        quoteItemId: item.id,
        mpn: item.mpn,
        manufacturerName: item.manufacturerName,
        description: item.description,
        orderQty: item.orderQty,
        reply:
          reply === undefined || price === null
            ? null
            : {
                unitPrice: price,
                replyQty: reply.replyQty,
                moq: reply.moq,
                stock: reply.stock,
                dateCode: reply.dateCode,
                leadTime: reply.leadTime,
                memo: reply.memo,
              },
      };
    });
  });

  async function submitReply(body: BomRfqReplyBodyType): Promise<void> {
    if (detailId.value === null || replyRfq.value === null) return;
    replyError.value = '';
    try {
      await rfqReply.mutateAsync({ quoteId: detailId.value, rfqId: replyRfq.value.rfqId, body });
      replyRfq.value = null;
    } catch (e) {
      replyError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
    }
  }

  return {
    sendOpen,
    compareOpen,
    replyRfq,
    replyError,
    rfqReply,
    startSupplierRefresh,
    openRfqReply,
    reissueLink,
    rfqLinkNotice,
    rfqLinkError,
    reissueMagicLink,
    replyRows,
    submitReply,
  };
}

export type CaseRfq = ReturnType<typeof useCaseRfq>;
