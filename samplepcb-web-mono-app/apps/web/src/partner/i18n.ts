import { computed, inject, onScopeDispose, provide, ref, watch, type ComputedRef, type InjectionKey } from 'vue';
import { commonMessages } from './locales/common';
import { partsMessages } from './locales/parts';
import { bomMessages } from './locales/bom';
import { pcbMessages } from './locales/pcb';
import { shipmentMessages } from './locales/shipment';
import {
  PARTNER_LOCALE_STORAGE_KEY, formatPartnerDate, formatPartnerMoney, isPartnerLocale,
  partnerIntlLocale, translatePartnerMessage,
  type PartnerLocale, type PartnerMessages, type PartnerParams,
} from './i18n-core';

export const partnerMessages: PartnerMessages = {
  ...bomMessages, ...pcbMessages, ...shipmentMessages, ...partsMessages, ...commonMessages,
};

function storedLocale(): PartnerLocale {
  try {
    const value = localStorage.getItem(PARTNER_LOCALE_STORAGE_KEY);
    return isPartnerLocale(value) ? value : 'ko';
  } catch { return 'ko'; }
}

// Preference is shared by portal descendants, never by the app's global vue-i18n instance.
const selectedLocale = ref<PartnerLocale>(storedLocale());
const partnerScope: InjectionKey<ComputedRef<boolean>> = Symbol('partner-language-scope');

export function setPartnerLocale(value: string): void {
  if (!isPartnerLocale(value)) return;
  selectedLocale.value = value;
  try { localStorage.setItem(PARTNER_LOCALE_STORAGE_KEY, value); } catch { /* private browsing */ }
}

export function providePartnerI18n() {
  const enabled = computed(() => true);
  provide(partnerScope, enabled);
  const context = createPartnerI18n(enabled);
  // Teleported dialogs also inherit the correct document language. Restore it when leaving.
  if (typeof document !== 'undefined') {
    const previousLanguage = document.documentElement.lang;
    watch(context.locale, (language) => { document.documentElement.lang = language; }, { immediate: true });
    onScopeDispose(() => { document.documentElement.lang = previousLanguage; });
  }
  return context;
}

/** Explicit override is used only by the app-level confirmation host, outside RouterView. */
export function usePartnerI18n(scope?: ComputedRef<boolean>) {
  const enabled = scope ?? inject(partnerScope, computed(() => false));
  return createPartnerI18n(enabled);
}

function createPartnerI18n(enabled: ComputedRef<boolean>) {
  const locale = computed(() => enabled.value ? selectedLocale.value : 'ko');
  const pt = (source: string, params?: PartnerParams): string =>
    translatePartnerMessage(partnerMessages, source, locale.value, enabled.value, params);
  const pn = (value: number): string => new Intl.NumberFormat(partnerIntlLocale(locale.value)).format(value);
  const pd = (value: string | null | undefined): string => formatPartnerDate(value, locale.value);
  const pm = (value: number, currency: string): string => formatPartnerMoney(value, currency, locale.value);
  return { pt, pn, pd, pm, locale, enabled };
}
