import { computed, ref, type ComputedRef, type Ref } from 'vue';

// 목록 배치 선택(체크박스) 공용 — 견적 관리·PCB 진행현황·견적요청·대기 큐가 같은 규칙을
// 쓰도록 한 곳에 둔다. 규칙은 견적 관리에서 정착한 것을 그대로 승계한다:
//   · 전체선택은 **현재 페이지 범위만** 다룬다(2만 건을 통째로 잡지 않게)
//   · 탭·검색·페이지가 바뀌면 목록이 달라지므로 호출부가 clear() 한다
//   · 헤더 체크박스는 부분 선택일 때 indeterminate

export interface RowSelection {
  selectedIds: Ref<number[]>;
  allSelected: ComputedRef<boolean>;
  someSelected: ComputedRef<boolean>;
  isSelected: (id: number) => boolean;
  toggleOne: (id: number) => void;
  toggleAll: (checked: boolean) => void;
  clear: () => void;
}

/** @param pageIds 현재 페이지에 보이는 행 id (반응형) */
export function useRowSelection(pageIds: ComputedRef<number[]>): RowSelection {
  const selectedIds = ref<number[]>([]);

  const allSelected = computed(
    () => pageIds.value.length > 0 && pageIds.value.every((id) => selectedIds.value.includes(id)),
  );
  const someSelected = computed(
    () => !allSelected.value && pageIds.value.some((id) => selectedIds.value.includes(id)),
  );

  return {
    selectedIds,
    allSelected,
    someSelected,
    isSelected: (id) => selectedIds.value.includes(id),
    toggleOne: (id) => {
      selectedIds.value = selectedIds.value.includes(id)
        ? selectedIds.value.filter((x) => x !== id)
        : [...selectedIds.value, id];
    },
    toggleAll: (checked) => {
      const pageSet = new Set(pageIds.value);
      selectedIds.value = checked
        ? [...new Set([...selectedIds.value, ...pageIds.value])]
        : selectedIds.value.filter((id) => !pageSet.has(id));
    },
    clear: () => {
      selectedIds.value = [];
    },
  };
}
