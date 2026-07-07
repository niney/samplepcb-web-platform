import { createI18n } from 'vue-i18n';
import { ko } from './locales/ko';
import { en } from './locales/en';

export const SUPPORTED_LOCALES = ['ko', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ko';

// 실서비스는 ko. en 은 준비용 스텁이라 미완 키는 fallback(ko)으로 메워짐.
export const i18n = createI18n({
  legacy: false, // Composition API 모드
  globalInjection: true, // 템플릿에서 $t 사용
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: { ko, en },
});
