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
  // 협력사 보유 부품(docs/PARTNER_PARTS.md) — 고객에게 조직 이름을 주지 않으므로
  // 배지도 중립 표기다(어느 협력사인지는 관리자 화면에서만 본다).
  partner: { name: '협력사', icon: favSamplepcb },
};

export const SUPPLIER_FALLBACK_ICON = favSamplepcb;
