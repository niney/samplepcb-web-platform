import { computed, ref, type ComputedRef, type Ref } from 'vue';

// 라이트/다크 전환. 실제 색은 style.css 의 [data-theme="dark"] 가 CSS 변수를 다시 정의해서
// 바뀌고, 여기서는 그 속성과 저장값만 관리한다.
// 첫 값은 index.html 의 부팅 스크립트가 이미 심어 둔 것을 읽는다(깜빡임 방지).

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'sp-theme';

function currentAttr(): ThemeName {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

// 모듈 스코프 싱글턴 — 헤더 토글과 다른 화면이 같은 상태를 본다(usePanels 와 같은 방식).
const theme = ref<ThemeName>(currentAttr());

// 저장값이 없으면 OS 설정을 따라간다. 사용자가 한 번 고르면 그 선택이 우선한다.
const media = window.matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', (event) => {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  apply(event.matches ? 'dark' : 'light');
});

function apply(next: ThemeName): void {
  theme.value = next;
  document.documentElement.dataset.theme = next;
}

const isDark = computed(() => theme.value === 'dark');

function setTheme(next: ThemeName): void {
  apply(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 사생활 보호 모드 등 저장이 막힌 환경 — 이번 세션 동안만 적용된다.
  }
}

function toggleTheme(): void {
  setTheme(theme.value === 'dark' ? 'light' : 'dark');
}

export function useTheme(): {
  theme: Ref<ThemeName>;
  isDark: ComputedRef<boolean>;
  setTheme: (next: ThemeName) => void;
  toggleTheme: () => void;
} {
  return { theme, isDark, setTheme, toggleTheme };
}
