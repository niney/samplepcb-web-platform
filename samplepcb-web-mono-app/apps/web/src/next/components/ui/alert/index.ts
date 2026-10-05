import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Alert } from "./Alert.vue"
export { default as AlertDescription } from "./AlertDescription.vue"
export { default as AlertTitle } from "./AlertTitle.vue"

// 관리자 리뉴얼: 업무 상태 알림(정보·주의·완료·오류)을 화면마다 div 로 손수 칠하던 것을 여기로 모았다.
// 색은 next/theme.css 의 상태 토큰(*-soft 바탕 + 본색 글자), 여백은 size 두 단계로만.
export const alertVariants = cva(
  "relative w-full rounded-lg border text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        muted: "bg-muted/40 text-muted-foreground",
        info: "border-info/30 bg-info-soft text-info *:data-[slot=alert-description]:text-foreground/80",
        warning: "border-warning/30 bg-warning-soft text-warning *:data-[slot=alert-description]:text-foreground/80",
        success: "border-success/30 bg-success-soft text-success *:data-[slot=alert-description]:text-foreground/80",
        destructive:
          "border-destructive/30 bg-destructive-soft text-destructive [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90",
      },
      size: {
        default: "px-4 py-3",
        sm: "px-3 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
