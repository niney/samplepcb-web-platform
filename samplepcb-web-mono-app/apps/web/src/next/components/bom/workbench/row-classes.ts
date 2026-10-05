import { badgeVariants } from '@/next/components/ui/badge';
import { buttonVariants } from '@/next/components/ui/button';
import { cn } from '@/next/lib/utils';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// 작업대 가상 스크롤 행(QuoteRow·PriceBreaks) 전용 클래스 — 행 안에서는 Button·Badge·Checkbox·InputGroup
// 컴포넌트 대신 **같은 variant 함수의 결과**를 네이티브 원소에 바로 준다. 모양은 키트와 같고, 행마다 붙던
// 컴포넌트 인스턴스(Primitive·Presence·CheckboxRoot …)만 뺀다. 클래스는 모듈에서 한 번만 계산한다.
//
// 근거(2026-10-06 실측, 940행 견적 #366, 스크롤 30단 = 행 약 100개 마운트·해제, Vue app.config.performance):
//   컴포넌트판 행 자체 비용 148ms(Primitive 36·Button 18·Badge 17·Checkbox 계열 22·InputGroup 계열 15…)
//   vs 옛 화면 43ms, 메인 스레드 시간 466~507ms vs 320~346ms. 지시대로 옛 표 내부 구조로 두고 클래스만 토큰으로.

const BADGE_VARIANTS: readonly BadgeVariant[] = [
  'default',
  'secondary',
  'destructive',
  'outline',
  'success',
  'warning',
  'info',
  'danger',
];

/** <span :class="ROW_BADGE[variant]"> — <Badge :variant> 와 같은 모양. */
export const ROW_BADGE = Object.fromEntries(
  BADGE_VARIANTS.map((variant) => [variant, badgeVariants({ variant })]),
) as Record<BadgeVariant, string>;

export const ROW_SUPPLIER_BADGE = cn(badgeVariants({ variant: 'outline' }), 'mb-1 w-full');
export const ROW_FLOATING_BADGE = cn(badgeVariants({ variant: 'info' }), 'absolute top-0 left-0');

export const ROW_PACKAGING_BUTTON = cn(buttonVariants({ variant: 'outline' }), 'w-40 justify-between');
export const ROW_CONFIRM_BUTTON = cn(buttonVariants({ size: 'xs' }), 'mt-1.5 w-40');
export const ROW_TRACE_BUTTON = cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'max-w-48 justify-start');
export const ROW_ACTION_BUTTON = {
  secondary: cn(buttonVariants({ variant: 'secondary', size: 'xs' }), 'w-22'),
  outline: cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'w-22'),
  ghost: cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'w-22'),
} as const;
export const ROW_LINK_BUTTON = buttonVariants({ variant: 'link', size: 'xs' });

/** ui/checkbox 의 모양(data-state=checked 일 때 주색). role="checkbox" 버튼에 준다. */
export const ROW_CHECKBOX =
  'border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 grid size-4 shrink-0 place-content-center rounded-sm border shadow-xs outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30';

/** ui/input-group(입력 + 뒤 글자) 의 모양 — 감싸는 상자·입력·뒤 글자. */
export const ROW_QTY_FIELD =
  'border-input focus-within:border-ring focus-within:ring-ring/50 mt-2 flex h-8 w-40 min-w-0 items-center rounded-md border shadow-xs focus-within:ring-3 dark:bg-input/30';
export const ROW_QTY_INPUT =
  'min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50';
export const ROW_QTY_SUFFIX = 'text-muted-foreground shrink-0 pr-3 text-sm';
