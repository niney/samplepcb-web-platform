import { ref, watch } from 'vue';

// 스마트 BOM 셸 패널 접기 상태 — 상단바 접기 버튼(BomLayout)과 각 페이지의 우측
// 패널(홈=프로모 카드, 상세=AI 분석결과·주문 정보·예상 견적)이 공유하는 싱글턴.
// 선호는 localStorage 유지.

const leftOpen = ref(localStorage.getItem('bom.leftOpen') !== '0');
const rightOpen = ref(localStorage.getItem('bom.rightOpen') !== '0');
watch(leftOpen, (v) => { localStorage.setItem('bom.leftOpen', v ? '1' : '0'); });
watch(rightOpen, (v) => { localStorage.setItem('bom.rightOpen', v ? '1' : '0'); });

export function useBomPanels(): { leftOpen: typeof leftOpen; rightOpen: typeof rightOpen } {
  return { leftOpen, rightOpen };
}
