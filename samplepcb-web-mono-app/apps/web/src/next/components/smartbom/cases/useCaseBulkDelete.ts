import { computed, ref, type ComputedRef, type Ref } from 'vue';

// 진행현황·견적관리 공용 — 현재 쪽 Case 체크 선택 + 일괄 영구 삭제 대화상자 상태(옛 두 화면이 같은
// 코드를 따로 들고 있던 것). 선택은 **현재 쪽만** 다룬다(2만 건을 통째로 잡지 않게) — 탭·쪽이 바뀌면
// 호출부가 clear() 한다. 삭제가 현재 쪽을 통째로 비웠으면 한 쪽 앞으로 물러난다(빈 쪽에 남지 않게).
export interface CaseBulkDelete {
  selectedIds: Ref<Set<string>>;
  selectedCount: ComputedRef<number>;
  headerChecked: ComputedRef<boolean | 'indeterminate'>;
  isSelected: (id: string) => boolean;
  toggleRow: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
  dialogIds: Ref<string[] | null>;
  openDialog: () => void;
  closeDialog: () => void;
  finish: (deletedIds: string[]) => void;
}

export function useCaseBulkDelete(rowIds: ComputedRef<string[]>, page: Ref<number>): CaseBulkDelete {
  const selectedIds = ref<Set<string>>(new Set());
  const dialogIds = ref<string[] | null>(null);
  let coversPage = false;

  const allSelected = computed(
    () => rowIds.value.length > 0 && rowIds.value.every((id) => selectedIds.value.has(id)),
  );
  const someSelected = computed(() => !allSelected.value && rowIds.value.some((id) => selectedIds.value.has(id)));

  const clear = (): void => {
    selectedIds.value = new Set();
  };

  return {
    selectedIds,
    selectedCount: computed(() => selectedIds.value.size),
    headerChecked: computed(() => (allSelected.value ? true : someSelected.value ? 'indeterminate' : false)),
    isSelected: (id) => selectedIds.value.has(id),
    toggleRow: (id) => {
      const next = new Set(selectedIds.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectedIds.value = next;
    },
    toggleAll: () => {
      const next = new Set(selectedIds.value);
      if (allSelected.value) for (const id of rowIds.value) next.delete(id);
      else for (const id of rowIds.value) next.add(id);
      selectedIds.value = next;
    },
    clear,
    dialogIds,
    openDialog: () => {
      const ids = rowIds.value.filter((id) => selectedIds.value.has(id));
      coversPage = allSelected.value;
      dialogIds.value = ids.length > 0 ? ids : null;
    },
    closeDialog: () => {
      dialogIds.value = null;
      coversPage = false;
    },
    finish: (deletedIds) => {
      const deleted = new Set(deletedIds);
      const next = new Set(selectedIds.value);
      for (const id of deleted) next.delete(id);
      const pageEmptied = coversPage && (dialogIds.value ?? []).every((id) => deleted.has(id));
      selectedIds.value = next;
      dialogIds.value = null;
      coversPage = false;
      if (pageEmptied && page.value > 1) page.value -= 1;
    },
  };
}
