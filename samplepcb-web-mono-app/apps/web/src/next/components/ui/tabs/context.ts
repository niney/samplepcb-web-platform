import type { ComputedRef, InjectionKey } from "vue"

// 관리자 리뉴얼: 탭 모양 두 가지 — TabsList 가 정하고 TabsTrigger 가 따른다.
// line    = 옛 관리자 화면의 밑줄 탭(기본). 줄 전체의 밑줄은 감싸는 쪽이 border-b 로 그린다(QueueTabs 처럼).
// segment = shadcn 기본의 회색 바탕 알약 전환(좁은 칸 안의 보기 전환 — 부품 확인 작성/고객 미리보기).
export type TabsVariant = "line" | "segment"

export const TABS_VARIANT_KEY: InjectionKey<ComputedRef<TabsVariant>> = Symbol("tabs-variant")
