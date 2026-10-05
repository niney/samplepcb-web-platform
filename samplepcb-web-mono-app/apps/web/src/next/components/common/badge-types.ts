import type { BadgeVariants } from '@/next/components/ui/badge';

// 상태 배지 공용 타입 — 모듈별 사전(pcb/pcb-badges.ts · smartbom/smartbom-badges.ts)이 함께 쓴다.
// 색은 뜻으로 고른다: warning=기다림·주의, info=진행, success=끝남·확정, danger=문제,
// secondary=중립·이력, outline=부가 표지. 같은 뜻은 모듈·화면이 달라도 같은 variant 를 쓴다.
// <Badge :variant="b.variant">{{ b.label }}</Badge>

export type BadgeVariant = NonNullable<BadgeVariants['variant']>;

export interface StatusBadge {
  label: string;
  variant: BadgeVariant;
}
