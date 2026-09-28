import { computed, ref, type ComputedRef, type Ref } from 'vue';

// 라이트/다크 전환. 실제 색은 style.css 의 [data-theme="dark"] 가 CSS 변수를 다시 정의해서
// 바뀌고, 여기서는 그 속성과 저장값만 관리한다.
// 첫 값은 index.html 부팅 스크립트와 같은 규칙으로 저장값·OS 설정에서 읽는다. 문서 속성은
// 읽지 않는다 — BOM 셸 경로에선 부팅 스크립트가 라이트로 고정해 두므로 선택과 다를 수 있다.

export type ThemeName = 'light' | 'dark';

const STORAGE_KEY = 'sp-theme';

// 저장값이 없으면 OS 설정을 따라간다. 사용자가 한 번 고르면 그 선택이 우선한다.
const media = window.matchMedia('(prefers-color-scheme: dark)');

function preferredTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return media.matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// 모듈 스코프 싱글턴 — 헤더 토글과 다른 화면이 같은 상태를 본다(usePanels 와 같은 방식).
const theme = ref<ThemeName>(preferredTheme());

// 자기 색 체계가 고정된 셸(BOM — 어두운 크롬 + 밝은 본문 단일 모드)이 떠 있는 동안
// 문서 속성만 덮는다. 저장된 선택(theme)은 그대로라 셸을 떠나면 원래 테마로 돌아간다.
let pinned: ThemeName | null = null;

media.addEventListener('change', (event) => {
  if (localStorage.getItem(STORAGE_KEY) !== null) return;
  apply(event.matches ? 'dark' : 'light');
});

function syncAttr(): void {
  document.documentElement.dataset.theme = pinned ?? theme.value;
}

function apply(next: ThemeName): void {
  theme.value = next;
  syncAttr();
}

function pinTheme(next: ThemeName | null): void {
  pinned = next;
  syncAttr();
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
  pinTheme: (next: ThemeName | null) => void;
} {
  return { theme, isDark, setTheme, toggleTheme, pinTheme };
}
