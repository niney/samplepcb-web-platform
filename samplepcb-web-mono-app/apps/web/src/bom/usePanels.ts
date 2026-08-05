import { ref, watch } from 'vue';

// 스마트 BOM 셸 패널 접기 상태 — 상단바 접기 버튼(BomLayout)과 각 페이지의 우측
// 패널(홈=프로모 카드, 상세=AI 분석결과·주문 정보·예상 견적)이 공유하는 싱글턴.
// 데스크톱 선호는 localStorage 에 유지하되, 화면을 덮는 축소형 좌·우 패널은 페이지
// 진입마다 닫힌 상태로 시작해야 하므로 별도의 비영속 상태를 사용한다.

const leftOpen = ref(localStorage.getItem('bom.leftOpen') !== '0');
const rightOpen = ref(localStorage.getItem('bom.rightOpen') !== '0');
const compactLeftOpen = ref(false);
const compactRightOpen = ref(false);
watch(leftOpen, (v) => { localStorage.setItem('bom.leftOpen', v ? '1' : '0'); });
watch(rightOpen, (v) => { localStorage.setItem('bom.rightOpen', v ? '1' : '0'); });

export function useBomPanels(): {
  leftOpen: typeof leftOpen;
  rightOpen: typeof rightOpen;
  compactLeftOpen: typeof compactLeftOpen;
  compactRightOpen: typeof compactRightOpen;
} {
  return { leftOpen, rightOpen, compactLeftOpen, compactRightOpen };
}
