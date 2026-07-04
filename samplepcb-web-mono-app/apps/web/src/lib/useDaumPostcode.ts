// Daum(카카오) 우편번호 서비스 lazy 로더 + embed 래퍼. 그누보드 win_zip(js/common.js)의
// 인라인 임베드 방식을 모노레포 자산으로 이식한다 — 관리자 드로어·사용자측 폼 어디서나
// 재사용할 범용 자산이라 특정 화면(드로어)에 의존하지 않는다. 필드 매핑(zip·도로명/지번·
// 참고항목·주소형식 플래그 R/J)은 호출부 oncomplete 가 담당하고, 이 모듈은 스크립트 로드와
// embed 만 한다.
//
// 스크립트는 1회만 로드하고 promise 를 캐시한다. 로드 실패 시 캐시를 비워(다음 호출 재시도)
// reject 하며, 호출부가 이를 받아 실패 문구를 노출한다(버튼 옆).

const POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

// daum.Postcode 최소 타입(외부 스크립트 — 필요한 필드만 수기 선언, any 금지).
// oncomplete 로 내려오는 값 중 주소 조립에 쓰는 필드만 추린다.
export interface DaumPostcodeData {
  zonecode: string; // 우편번호(5자리)
  roadAddress: string; // 도로명 주소
  jibunAddress: string; // 지번 주소('' 가능)
  autoJibunAddress: string; // 도로명만 있을 때 자동 매칭된 지번 주소('' 가능)
  userSelectedType: 'R' | 'J'; // 사용자가 고른 타입(R=도로명, J=지번)
  bname: string; // 법정동/법정리 이름
  buildingName: string; // 건물명
}

interface DaumPostcodeOptions {
  oncomplete: (data: DaumPostcodeData) => void;
}

interface DaumPostcodeInstance {
  embed: (el: HTMLElement) => void;
}

interface DaumNamespace {
  Postcode: new (options: DaumPostcodeOptions) => DaumPostcodeInstance;
}

declare global {
  interface Window {
    daum?: DaumNamespace;
  }
}

let loadPromise: Promise<DaumNamespace> | null = null;

function loadPostcodeScript(): Promise<DaumNamespace> {
  if (loadPromise !== null) return loadPromise;
  loadPromise = new Promise<DaumNamespace>((resolve, reject) => {
    const existing = window.daum;
    if (existing?.Postcode !== undefined) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = POSTCODE_SRC;
    script.async = true;
    script.addEventListener('load', () => {
      const loaded = window.daum;
      if (loaded?.Postcode !== undefined) {
        resolve(loaded);
      } else {
        loadPromise = null; // 로드는 됐으나 전역 미노출 — 실패 캐시하지 않음
        reject(new Error('daum.Postcode 를 찾지 못했습니다 (스크립트 로드 후)'));
      }
    });
    script.addEventListener('error', () => {
      loadPromise = null; // 실패를 캐시하지 않음 — 다음 호출에서 재시도
      reject(new Error('Daum 우편번호 스크립트 로드 실패'));
    });
    document.head.appendChild(script);
  });
  return loadPromise;
}

export function useDaumPostcode(): {
  embed: (el: HTMLElement, onComplete: (data: DaumPostcodeData) => void) => Promise<void>;
} {
  // el 에 우편번호 검색 UI 를 끼워 넣는다. 선택 완료 시 onComplete(data) 호출.
  // 스크립트 로드 실패 시 reject → 호출부가 실패 문구를 노출한다.
  const embed = async (
    el: HTMLElement,
    onComplete: (data: DaumPostcodeData) => void,
  ): Promise<void> => {
    const daum = await loadPostcodeScript();
    new daum.Postcode({ oncomplete: onComplete }).embed(el);
  };
  return { embed };
}
