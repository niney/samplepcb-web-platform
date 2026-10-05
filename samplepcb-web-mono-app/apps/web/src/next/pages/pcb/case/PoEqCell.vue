<script setup lang="ts">
import { CornerDownLeftIcon, DownloadIcon, HistoryIcon, MessageSquareTextIcon, UploadIcon, XIcon } from '@lucide/vue';
import { canEditPcbEqFile, type AdminPcbPoViewType } from '@sp/api-contract';
import { downloadAdminPcbEqFile } from '@/admin/useAdminPcbPos';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { usePcbCaseContext } from './usePcbCase';

// 발주 행의 EQ(스텐실: 문의·첨부) 칸 — 협력사 산출물(eq·working·coord·inquiry)과 관리자 회신(reply)을
// 줄로 갈라 방향을 보이게 한다. 최신만 펼치고 이전 업로드는 [이전 N]으로(여정 22호).
const props = defineProps<{ po: AdminPcbPoViewType }>();

const {
  specId,
  stencilInquiryOf,
  eqFilesShown,
  eqOlderCount,
  eqHistoryOpen,
  toggleEqHistory,
  pickEqFileAdmin,
  removeEqFileAdmin,
  replyFilesOf,
} = usePcbCaseContext();

const download = (fileId: number, name: string): void => {
  if (specId.value === null) return;
  void downloadAdminPcbEqFile(specId.value, props.po.poId, fileId, name);
};
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <!-- 스텐실 — 협력사가 보낸 고객문의사항(현행 제출분). 확인/보완을 결정하는 근거 본문이라 첨부보다 먼저 선다. -->
    <div
      v-if="stencilInquiryOf(po) !== null"
      class="bg-info-soft text-info max-w-72 rounded-md px-2 py-1 text-xs"
      :title="stencilInquiryOf(po)?.note"
    >
      <span class="inline-flex items-center gap-1 font-medium">
        <MessageSquareTextIcon class="size-3.5" />
        고객문의사항
      </span>
      <span class="mt-0.5 line-clamp-3 block whitespace-pre-wrap">{{ stencilInquiryOf(po)?.note }}</span>
    </div>

    <div class="flex flex-wrap items-center gap-1">
      <ButtonGroup v-for="f in eqFilesShown(po)" :key="f.fileId">
        <Button
          :variant="f.isLatest ? 'outline' : 'ghost'"
          size="xs"
          :title="`${f.fileType.toUpperCase()} · ${f.name}${f.isLatest ? ' (최신)' : ' — 이전 업로드입니다. 승인 근거로 쓰지 마세요.'}${f.afterReject ? ' · 반려 뒤 새로 올라온 보완분입니다.' : ''}`"
          @click="download(f.fileId, f.name)"
        >
          <HistoryIcon v-if="!f.isLatest" />
          <DownloadIcon v-else />
          {{ f.fileType }}
          <template v-if="!f.isLatest"> · 이전</template>
          <template v-else-if="f.afterReject">
            · 보완
            <span class="bg-success size-1.5 rounded-full" />
          </template>
        </Button>
        <Button
          v-if="po.status === 'issued'"
          :variant="f.isLatest ? 'outline' : 'ghost'"
          size="icon-xs"
          title="첨부 삭제(대행)"
          aria-label="첨부 삭제(대행)"
          @click="void removeEqFileAdmin(po, f.fileId)"
        >
          <XIcon />
        </Button>
      </ButtonGroup>
      <Button
        v-if="eqOlderCount(po) > 0"
        variant="ghost"
        size="xs"
        title="같은 종류로 다시 올라온 이전 파일입니다 — 승인 근거는 최신으로 보세요."
        @click="toggleEqHistory(po.poId)"
      >
        {{ eqHistoryOpen.includes(po.poId) ? '이전 숨기기' : `이전 ${eqOlderCount(po)}` }}
      </Button>
      <!-- D11 대행 업로드 — 발주접수(잠금 전)에서만, 협력사 대신 첨부. 스텐실은 좌표파일(필수)과 문의 사진
           (선택)만 연다(협력사 화면과 같은 규칙). -->
      <template v-if="po.status === 'issued'">
        <template v-if="po.track === 'stencil'">
          <Button
            variant="ghost"
            size="xs"
            title="좌표파일 대행 첨부 — 확인 후 고객도 내려받게 됩니다."
            @click="pickEqFileAdmin(po, 'coord')"
          >
            <UploadIcon />
            좌표파일
          </Button>
          <Button
            variant="ghost"
            size="xs"
            title="고객문의사항에 곁들일 사진 대행 첨부(선택 · 여러 장 가능)"
            @click="pickEqFileAdmin(po, 'inquiry')"
          >
            <UploadIcon />
            문의 사진
          </Button>
        </template>
        <template v-else>
          <Button variant="ghost" size="xs" @click="pickEqFileAdmin(po, 'eq')">
            <UploadIcon />
            eq
          </Button>
          <Button variant="ghost" size="xs" @click="pickEqFileAdmin(po, 'working')">
            <UploadIcon />
            working
          </Button>
        </template>
      </template>
      <span v-else-if="po.eqFiles.length === 0" class="text-muted-foreground text-xs">—</span>
    </div>

    <!-- 관리자 회신 — 우리가 협력사에게 **보내는** 첨부(수정지시 도면·마크업). 승인요청을 받은 상태에서도
         붙일 수 있다(그때가 회신할 순간이다 — 계약 canEditPcbEqFile). -->
    <div
      v-if="replyFilesOf(po).length > 0 || canEditPcbEqFile('reply', po.status)"
      class="flex flex-wrap items-center gap-1 border-t border-dashed pt-1.5"
    >
      <span class="text-info inline-flex items-center gap-1 text-xs font-medium">
        <CornerDownLeftIcon class="size-3.5" />
        회신
      </span>
      <ButtonGroup v-for="f in replyFilesOf(po)" :key="f.fileId">
        <Button
          variant="outline"
          size="xs"
          class="max-w-48"
          :title="`관리자 회신 · ${f.name} — 협력사가 포털에서 받습니다`"
          @click="download(f.fileId, f.name)"
        >
          <DownloadIcon />
          <span class="truncate">{{ f.name }}</span>
        </Button>
        <Button
          v-if="canEditPcbEqFile('reply', po.status)"
          variant="outline"
          size="icon-xs"
          title="회신 첨부 삭제"
          aria-label="회신 첨부 삭제"
          @click="void removeEqFileAdmin(po, f.fileId)"
        >
          <XIcon />
        </Button>
      </ButtonGroup>
      <Button
        v-if="canEditPcbEqFile('reply', po.status)"
        variant="ghost"
        size="xs"
        title="협력사에게 돌려보낼 수정지시 파일을 첨부합니다 — 반려 메일이 첨부 사실을 알립니다."
        @click="pickEqFileAdmin(po, 'reply')"
      >
        <UploadIcon />
        회신 첨부
      </Button>
    </div>
  </div>
</template>
