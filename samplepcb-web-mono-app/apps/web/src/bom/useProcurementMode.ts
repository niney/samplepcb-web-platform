import { ref } from 'vue';
import type { BomQuoteProcurementModeType } from '@sp/api-contract';

const STORAGE_KEY = 'sp-bom-procurement-mode';

function storedMode(): BomQuoteProcurementModeType {
  if (typeof window === 'undefined') return 'sample';
  return window.localStorage.getItem(STORAGE_KEY) === 'mass' ? 'mass' : 'sample';
}

const preferredMode = ref<BomQuoteProcurementModeType>(storedMode());

/**
 * 새 견적의 기본 조달 모드. 상세 화면에서는 서버에 저장된 견적 모드가 우선이고,
 * 전환 성공 후 이 선호값도 갱신해 다음 업로드가 같은 모드로 시작한다.
 */
export function useBomProcurementMode() {
  const setPreferredMode = (mode: BomQuoteProcurementModeType): void => {
    preferredMode.value = mode;
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, mode);
  };
  return { preferredMode, setPreferredMode };
}
