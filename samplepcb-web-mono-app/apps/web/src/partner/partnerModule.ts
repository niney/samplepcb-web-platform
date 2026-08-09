// 파트너 포털 모듈(BOM/PCB) 기억 — 진입 리졸버의 보조 신호(포털 재설계 R1).
// 단일 진실은 서버 tracks(조직 capabilities 파생)이고, 기억값은 두 트랙 조직의
// 마지막 사용 모듈을 복원할 때만 쓴다. 트랙이 회수되면 리졸버가 무효 처리한다.

export type PartnerModuleKey = 'bom' | 'pcb';

const KEY = 'sp.partnerModule';

export const readPartnerModule = (): PartnerModuleKey | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'bom' || v === 'pcb' ? v : null;
  } catch {
    return null;
  }
};

export const rememberPartnerModule = (module: PartnerModuleKey): void => {
  try {
    localStorage.setItem(KEY, module);
  } catch {
    /* 프라이빗 모드 등 — 기억 없이도 동작(BOM 우선 기본) */
  }
};
