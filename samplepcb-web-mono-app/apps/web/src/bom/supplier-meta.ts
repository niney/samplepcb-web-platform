import favDigikey from '../assets/bom/fav-digikey.png';
import favMouser from '../assets/bom/fav-mouser.png';
import favUnikeyic from '../assets/bom/fav-unikeyic.png';
import favSamplepcb from '../assets/bom/fav-samplepcb.png';

// 공급사 배지(vueline 파비콘 방식) — BomQuoteRow·단일 검색 행이 공유하는 표시 메타.
// 공급사 추가 = 여기에 항목 추가(없으면 samplepcb 파비콘 + 원문 표기로 축퇴).
export const SUPPLIER_META: Record<string, { name: string; icon: string }> = {
  digikey: { name: 'Digikey', icon: favDigikey },
  mouser: { name: 'Mouser', icon: favMouser },
  unikeyic: { name: 'UniKeyIC', icon: favUnikeyic },
  samplepcb: { name: 'SamplePCB', icon: favSamplepcb },
};

export const SUPPLIER_FALLBACK_ICON = favSamplepcb;
