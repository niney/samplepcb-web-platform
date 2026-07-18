import { computed, type Ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import {
  BomJobResponse,
  BomResultResponse,
  BomSupplierResultResponse,
  BomSupplierStartResponse,
  apiRoutes,
} from '@sp/api-contract';

const jobsPath = `${apiRoutes.adminBom}/jobs`;

// 업로드 → 파싱 잡 생성
export function useUploadBom() {
  return useMutation({
    mutationFn: (form: FormData) => apiSendForm('POST', jobsPath, form, BomJobResponse),
  });
}

// 파싱 잡 상태 폴링 (running 동안만)
export function useBomJob(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom', 'job', jobId.value]),
    queryFn: () => apiGet(`${jobsPath}/${jobId.value ?? ''}`, BomJobResponse),
    enabled: computed(() => jobId.value !== null),
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 1500 : false),
    retry: false,
  });
}

// 추출 결과(G-shape) — 잡 완료 시에만 조회
export function useBomResult(jobId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom', 'result', jobId.value]),
    queryFn: () => apiGet(`${jobsPath}/${jobId.value ?? ''}/result`, BomResultResponse),
    enabled: computed(() => enabled.value && jobId.value !== null),
    retry: false,
  });
}

// 공급사 검색 시작
export function useStartSupplierSearch() {
  return useMutation({
    mutationFn: (jobId: string) =>
      apiSend('POST', `${jobsPath}/${jobId}/supplier-search`, undefined, BomSupplierStartResponse),
  });
}

// 공급사 검색 상태 폴링
export function useSupplierSearchStatus(jobId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom', 'supplier', 'status', jobId.value]),
    queryFn: () => apiGet(`${jobsPath}/${jobId.value ?? ''}/supplier-search`, BomSupplierStartResponse),
    enabled: computed(() => enabled.value && jobId.value !== null),
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 2000 : false),
    retry: false,
  });
}

// 공급사 검색 결과 — 완료 시에만 조회
export function useSupplierSearchResult(jobId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom', 'supplier', 'result', jobId.value]),
    queryFn: () =>
      apiGet(`${jobsPath}/${jobId.value ?? ''}/supplier-search/result`, BomSupplierResultResponse),
    enabled: computed(() => enabled.value && jobId.value !== null),
    retry: false,
  });
}
