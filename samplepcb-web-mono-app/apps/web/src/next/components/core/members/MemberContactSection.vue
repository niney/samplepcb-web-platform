<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { PencilIcon, SearchIcon, XIcon } from '@lucide/vue';
import type { AdminMemberDetailType, AdminMemberInfoBodyType } from '@sp/api-contract';
import { useUpdateMemberInfo } from '@/admin/useAdminMembers';
import { useDaumPostcode, type DaumPostcodeData } from '@/lib/useDaumPostcode';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { useMemberErrorText } from './member-errors';

// 연락/주소 — 표시 ↔ [수정] 편집 토글(옛 드로어 같은 구역). 편집은 바뀐 필드만 PATCH 한다(부분 갱신).
// 회원을 바꾸면 서랍이 이 구역을 새로 띄우므로(key=mbId) 편집 중 값이 다른 회원으로 새지 않는다.
const props = defineProps<{ detail: AdminMemberDetailType }>();
const { t } = useI18n();
const errorText = useMemberErrorText();
const uid = useId();

const { mutate: updateInfo, isPending: infoPending, error: infoErr, reset: resetInfo } = useUpdateMemberInfo();
const infoError = computed<string | null>(() => errorText(infoErr.value));

interface EditForm {
  name: string;
  nick: string;
  email: string;
  hp: string;
  tel: string;
  zip: string;
  addr1: string;
  addr2: string;
  addr3: string;
}

// detail → 편집 폼 초기값. zip 은 표시용 조합("062-34")에서 하이픈을 떼어 5자리로 복원.
const editFormFromDetail = (d: AdminMemberDetailType): EditForm => ({
  name: d.name,
  nick: d.nick,
  email: d.email ?? '',
  hp: d.hp,
  tel: d.tel,
  zip: (d.addr?.zip ?? '').replace(/-/g, ''),
  addr1: d.addr?.addr1 ?? '',
  addr2: d.addr?.addr2 ?? '',
  addr3: d.addr?.addr3 ?? '',
});

const editing = ref(false);
const editForm = ref<EditForm>(editFormFromDetail(props.detail));

// 주소 검색(Daum) — 편집 폼 안에서 embed 패널을 토글. 스크립트 로드 실패는 버튼 아래 문구.
const { embed: embedPostcode } = useDaumPostcode();
const postcodeOpen = ref(false);
const postcodeFailed = ref(false);
const postcodePanel = ref<HTMLElement | null>(null);
// 이번 편집에서 주소 검색이 적용됐는지 + 선택 타입('R' 도로명/'J' 지번 — 코어 win_zip 이
// mb_addr_jibeon 에 저장하는 플래그와 동일). ''=검색 미적용. 적용됐으면 dirty 여부와 무관하게
// 전송한다 — 기존 플래그가 같은 값('R'→'R' 재검색)이어도 서버의 "미제공=미상 초기화"에
// 휩쓸리지 않게(감사에서 발견한 전송 누락 경로).
const appliedAddrType = ref<'' | 'R' | 'J'>('');

const startEditing = (): void => {
  editForm.value = editFormFromDetail(props.detail);
  resetInfo();
  postcodeOpen.value = false;
  postcodeFailed.value = false;
  appliedAddrType.value = '';
  editing.value = true;
};

const closeEditing = (): void => {
  editing.value = false;
  postcodeOpen.value = false;
  postcodeFailed.value = false;
};

// 주소 검색 열기 — embed 패널 렌더 후 Daum UI 를 끼워 넣는다. 로드 실패 시 문구 노출.
const openPostcode = (): void => {
  postcodeFailed.value = false;
  postcodeOpen.value = true;
  void nextTick(() => {
    const el = postcodePanel.value;
    if (el === null) return;
    embedPostcode(el, applyPostcode).catch(() => {
      postcodeFailed.value = true;
      postcodeOpen.value = false;
    });
  });
};

// 선택 완료 → 편집 폼 채움. 매핑은 그누보드 win_zip(js/common.js) 이식:
// zip=우편번호, addr1=도로명(R)/지번(J), addr3=도로명일 때 참고항목(법정동·건물명 조합),
// addrJibeon=선택 타입 플래그('R'/'J' — 코어 win_zip 동일), addr2 는 비우고 상세주소 입력 유도.
const applyPostcode = (data: DaumPostcodeData): void => {
  const isRoad = data.userSelectedType === 'R';
  let extra = '';
  if (isRoad) {
    if (data.bname !== '') extra += data.bname;
    if (data.buildingName !== '') {
      extra += extra !== '' ? `, ${data.buildingName}` : data.buildingName;
    }
    extra = extra !== '' ? `(${extra})` : '';
  }
  editForm.value.zip = data.zonecode;
  editForm.value.addr1 = isRoad ? data.roadAddress : data.jibunAddress;
  editForm.value.addr3 = extra;
  editForm.value.addr2 = '';
  appliedAddrType.value = data.userSelectedType;
  postcodeOpen.value = false;
};

// dirty 필드만 PATCH(부분 갱신). 변경 없으면 닫기, 성공 시 닫기.
const submitInfo = (): void => {
  const d = props.detail;
  const f = editForm.value;
  const orig = editFormFromDetail(d);
  const patch: AdminMemberInfoBodyType = {};
  if (f.name !== orig.name) patch.name = f.name;
  if (f.nick !== orig.nick) patch.nick = f.nick;
  if (f.email !== orig.email) patch.email = f.email;
  if (f.hp !== orig.hp) patch.hp = f.hp;
  if (f.tel !== orig.tel) patch.tel = f.tel;
  if (f.zip !== orig.zip) patch.zip = f.zip;
  if (f.addr1 !== orig.addr1) patch.addr1 = f.addr1;
  if (f.addr2 !== orig.addr2) patch.addr2 = f.addr2;
  if (f.addr3 !== orig.addr3) patch.addr3 = f.addr3;
  // 주소 형식 플래그는 검색이 적용됐을 때 항상 전송(dirty 무관 — 위 appliedAddrType 주석).
  // 검색 미적용이면 미전송 → 서버가 addr1 수동 변경 시에만 '' 초기화.
  if (appliedAddrType.value !== '') patch.addrJibeon = appliedAddrType.value;
  if (Object.keys(patch).length === 0) {
    closeEditing();
    return;
  }
  resetInfo();
  updateInfo(
    { mbId: d.mbId, ...patch },
    {
      onSuccess: () => {
        closeEditing();
      },
    },
  );
};
</script>

<template>
  <SectionCard :title="t('admin.members.drawer.contact')">
    <template v-if="props.detail.status !== 'left' && !editing" #actions>
      <Button variant="outline" size="sm" @click="startEditing">
        <PencilIcon />
        {{ t('admin.members.drawer.edit.button') }}
      </Button>
    </template>

    <!-- 표시 -->
    <dl v-if="!editing" class="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      <dt class="text-muted-foreground">{{ t('admin.members.drawer.email') }}</dt>
      <dd class="min-w-0 break-all">{{ props.detail.email ?? '-' }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.members.drawer.phone') }}</dt>
      <dd class="tabular-nums">{{ props.detail.phone ?? '-' }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.members.drawer.address') }}</dt>
      <dd class="min-w-0">
        <template v-if="props.detail.addr !== null">
          <span v-if="props.detail.addr.zip !== ''" class="text-muted-foreground tabular-nums">[{{ props.detail.addr.zip }}]</span>
          {{ props.detail.addr.addr1 }} {{ props.detail.addr.addr2 }} {{ props.detail.addr.addr3 }}
        </template>
        <template v-else>-</template>
      </dd>
    </dl>

    <!-- 편집 (바뀐 필드만 전송) -->
    <div v-else class="flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel :for="`${uid}-name`">{{ t('admin.members.drawer.edit.name') }}</FieldLabel>
          <Input :id="`${uid}-name`" v-model="editForm.name" type="text" />
        </Field>
        <Field>
          <FieldLabel :for="`${uid}-nick`">{{ t('admin.members.drawer.edit.nick') }}</FieldLabel>
          <Input :id="`${uid}-nick`" v-model="editForm.nick" type="text" />
        </Field>
      </div>
      <Field>
        <FieldLabel :for="`${uid}-email`">{{ t('admin.members.drawer.edit.email') }}</FieldLabel>
        <Input :id="`${uid}-email`" v-model="editForm.email" type="email" />
      </Field>
      <div class="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel :for="`${uid}-hp`">{{ t('admin.members.drawer.edit.hp') }}</FieldLabel>
          <Input :id="`${uid}-hp`" v-model="editForm.hp" type="text" />
        </Field>
        <Field>
          <FieldLabel :for="`${uid}-tel`">{{ t('admin.members.drawer.edit.tel') }}</FieldLabel>
          <Input :id="`${uid}-tel`" v-model="editForm.tel" type="text" />
        </Field>
      </div>
      <Field>
        <FieldLabel :for="`${uid}-zip`">{{ t('admin.members.drawer.edit.zip') }}</FieldLabel>
        <div class="flex items-center gap-2">
          <Input
            :id="`${uid}-zip`"
            v-model="editForm.zip"
            type="text"
            inputmode="numeric"
            maxlength="5"
            class="w-28"
            :placeholder="t('admin.members.drawer.edit.zipPlaceholder')"
          />
          <Button type="button" variant="outline" size="sm" @click="openPostcode">
            <SearchIcon />
            {{ t('admin.members.drawer.edit.addrSearch') }}
          </Button>
        </div>
      </Field>
      <Alert v-if="postcodeFailed" variant="destructive" size="sm">
        <AlertDescription>{{ t('admin.members.drawer.edit.addrSearchFailed') }}</AlertDescription>
      </Alert>
      <!-- 주소 검색(Daum) embed 패널 — [주소 검색] 버튼 바로 아래(코어 win_zip 도 addr1 앞에 삽입).
           선택 완료 시 아래 우편번호·주소 필드를 채운다. -->
      <div v-if="postcodeOpen" class="overflow-hidden rounded-md border">
        <div class="flex items-center justify-between border-b py-1 pr-1 pl-3">
          <span class="text-muted-foreground text-xs">{{ t('admin.members.drawer.edit.addrSearch') }}</span>
          <Button type="button" variant="ghost" size="xs" @click="postcodeOpen = false">
            <XIcon />
            {{ t('admin.members.drawer.edit.addrSearchClose') }}
          </Button>
        </div>
        <div ref="postcodePanel" class="h-75 w-full" />
      </div>
      <Field>
        <FieldLabel :for="`${uid}-addr1`">{{ t('admin.members.drawer.edit.addr1') }}</FieldLabel>
        <Input :id="`${uid}-addr1`" v-model="editForm.addr1" type="text" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-addr2`">{{ t('admin.members.drawer.edit.addr2') }}</FieldLabel>
        <Input :id="`${uid}-addr2`" v-model="editForm.addr2" type="text" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-addr3`">{{ t('admin.members.drawer.edit.addr3') }}</FieldLabel>
        <Input :id="`${uid}-addr3`" v-model="editForm.addr3" type="text" />
      </Field>
      <Alert v-if="infoError !== null" variant="destructive" size="sm">
        <AlertDescription>{{ infoError }}</AlertDescription>
      </Alert>
      <div class="flex items-center gap-2">
        <Button type="button" :disabled="infoPending" @click="submitInfo">{{ t('admin.members.drawer.edit.save') }}</Button>
        <Button type="button" variant="ghost" @click="closeEditing">{{ t('admin.members.drawer.edit.cancel') }}</Button>
      </div>
    </div>
  </SectionCard>
</template>
