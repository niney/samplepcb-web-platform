<script setup lang="ts">
import type { BomInvoiceDataType, BomInvoiceItemType } from '@sp/api-contract';

// 상업송장 미리보기 문서 — InvoiceEditorDialog 가 이 DOM 을 html2canvas 로 그대로 찍어 PDF 를 만든다.
// 옛 InvoiceEditorModal 의 미리보기 마크업을 그대로 옮겼다. 문서는 테마(다크)와 무관한 흰 종이여야 하고
// 캡처 결과가 곧 제출 서류라 서체·크기·선이 옛 것과 같아야 해서, 인라인 스타일을 쓴다
// (견적서 EstimateSheet 와 같은 "인쇄 문서" 예외 — docs/ADMIN_NEXT_UI.md).
defineProps<{
  inv: BomInvoiceDataType;
  rowTotal: (it: BomInvoiceItemType) => number;
  grandTotal: number;
  fmtMoney: (n: number) => string;
}>();
</script>

<template>
  <div
    style="width: 760px; margin: 0 auto; background: #fff; color: #111; padding: 24px; font-family: Arial, 'Malgun Gothic', sans-serif; font-size: 12px"
  >
    <div style="text-align: center; font-weight: 700; font-size: 14px; color: #333; padding-bottom: 6px; border-bottom: 1px solid #ccc">
      {{ inv.companyName || ' ' }}
    </div>
    <div style="text-align: center; font-weight: 800; font-size: 20px; letter-spacing: 1px; padding: 10px 0">
      COMMERCIAL INVOICE <span style="font-size: 14px">商业发票</span>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin-top: 6px">
      <tr>
        <td style="width: 62%; vertical-align: top; border: 1px solid #ccc; padding: 6px">
          <div style="font-weight: 700; font-size: 11px; color: #555; margin-bottom: 3px">SHIPPER 寄货人</div>
          <div><b>{{ inv.companyName }}</b></div>
          <div>{{ inv.shipperName }}</div>
          <div style="color: #333">{{ inv.shipperAddress }}</div>
          <div>TEL: {{ inv.shipperTel }}</div>
        </td>
        <td style="vertical-align: top; border: 1px solid #ccc; padding: 6px">
          <div>COUNTRY OF ORIGINAL 发件地国家</div>
          <div style="font-weight: 700; margin-bottom: 6px">{{ inv.countryOfOrigin }}</div>
          <div>COUNTRY OF DESTINATION 目的地国家</div>
          <div style="font-weight: 700">{{ inv.countryOfDestination }}</div>
        </td>
      </tr>
      <tr>
        <td style="vertical-align: top; border: 1px solid #ccc; padding: 6px">
          <div style="font-weight: 700; font-size: 11px; color: #555; margin-bottom: 3px">CONSIGNEE 收货人</div>
          <div><b>{{ inv.consigneeCompany }}</b></div>
          <div>{{ inv.consigneeContact }}</div>
          <div style="color: #333">{{ inv.consigneeAddress }}</div>
          <div>TEL: {{ inv.consigneeTel }} &nbsp; FAX: {{ inv.consigneeFax }}</div>
          <div>EMAIL: {{ inv.consigneeEmail }}</div>
        </td>
        <td style="vertical-align: top; border: 1px solid #ccc; padding: 6px">
          <div>Invoice No.: <b>{{ inv.invoiceNo }}</b></div>
          <div>Manufacture 原产国: {{ inv.countryOfManufacture }}</div>
          <div>Date 日期: {{ inv.invoiceDate }}</div>
          <div>NET 净重: {{ inv.netWeight }}</div>
          <div>Gross 毛重: {{ inv.grossWeight }}</div>
        </td>
      </tr>
    </table>

    <table style="width: 100%; border-collapse: collapse; margin-top: 8px">
      <thead>
        <tr style="background: #eee">
          <th style="border: 1px solid #ccc; padding: 4px; text-align: left">DESCRIPTION 品名</th>
          <th style="border: 1px solid #ccc; padding: 4px">HS CODE</th>
          <th style="border: 1px solid #ccc; padding: 4px">NO.OF UNIT</th>
          <th style="border: 1px solid #ccc; padding: 4px">CUR</th>
          <th style="border: 1px solid #ccc; padding: 4px">UNIT VALUE</th>
          <th style="border: 1px solid #ccc; padding: 4px">TOTAL VALUE</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in inv.items" :key="i">
          <td style="border: 1px solid #ccc; padding: 4px">{{ it.description }}</td>
          <td style="border: 1px solid #ccc; padding: 4px; text-align: center">{{ it.hsCode }}</td>
          <td style="border: 1px solid #ccc; padding: 4px; text-align: center">{{ it.qty }}</td>
          <td style="border: 1px solid #ccc; padding: 4px; text-align: center">{{ it.currency }}</td>
          <td style="border: 1px solid #ccc; padding: 4px; text-align: right">{{ it.unitValue !== null ? fmtMoney(it.unitValue) : '' }}</td>
          <td style="border: 1px solid #ccc; padding: 4px; text-align: right">{{ fmtMoney(rowTotal(it)) }}</td>
        </tr>
        <tr>
          <td colspan="5" style="border: 1px solid #ccc; padding: 4px; text-align: right; font-weight: 700">
            Total Value 总申报价值 ({{ inv.currency }})
          </td>
          <td style="border: 1px solid #ccc; padding: 4px; text-align: right; font-weight: 700">{{ fmtMoney(grandTotal) }}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 16px; display: flex; justify-content: space-between; color: #333">
      <div>Signature / Title 寄货人签署 / 职位 : ____________</div>
      <div>Date 日期 : {{ inv.invoiceDate }}</div>
    </div>
    <div style="margin-top: 10px; color: #333">Company Stamp 公司印章 :</div>
  </div>
</template>
