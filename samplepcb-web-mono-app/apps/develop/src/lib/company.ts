// 회사 정보 — 푸터와 출력물 표지가 함께 쓴다. 값은 메인 사이트 푸터(PHP) 기본값과 같다 —
// PHP 는 쇼핑몰 설정(de_admin_*)이 있으면 그 값을 쓰지만 이 SPA 에는 공개 조회 API 가 없다.
export const COMPANY = {
  name: '주식회사 샘플피씨비',
  owner: '오혜영',
  addr: '경기도 광명시 하안로 60 광명SK테크노파크 A-1303,1407',
  fax: '02-6455-4490',
  saupja: '331-88-01750',
  tongsin: '2024-경기광명-0624',
  privacy: '오혜영',
  tel: '070-8667-1080~1',
  email: 'info@samplepcb.co.kr',
} as const;
