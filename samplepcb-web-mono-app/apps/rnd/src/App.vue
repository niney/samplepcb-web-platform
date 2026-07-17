<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import {
  AiJobResponse,
  AiRunResponse,
  RndAiModelsResponse,
  RndFileClassifyResult,
  type RndFileClassifyResultType,
} from '@sp/api-contract';

interface CachedUpload {
  id: string;
  file: File;
}

interface BrowserCache {
  key: 'latest';
  requirements: string;
  documentRequirements?: string;
  model: string;
  documentModel?: string;
  files: CachedUpload[];
  result: RndFileClassifyResultType | null;
  document?: string | null;
}

const DB_NAME = 'samplepcb-rnd';
const STORE_NAME = 'file-classifier';
const CACHE_KEY = 'latest';
const CLIENT_ID_KEY = 'samplepcb-rnd-client-id';
const RECOMMENDED_MODEL = 'minimax-m3';
const RECOMMENDED_DOCUMENT_MODEL = 'glm-5.2';
const PRACTICAL_DOCUMENT_REQUIREMENTS = `- 설치 환경과 연속 운전 조건을 적어 주세요. 예: 공장 제어반 내부, 24시간 운전, -20~60℃
- 시제품 수량과 의뢰 포함 범위를 적어 주세요. 예: 10대, 회로·PCB 설계와 제작·조립용 데이터까지
- 제외 범위를 적어 주세요. 예: 부품 구매, PCB/PCBA 제작, 펌웨어, 인증 시험 제외
- 반드시 유지할 기능과 변경 가능한 부품을 구분해 주세요.
- EDA 원본, 보드 외형, 레이어 수, 커넥터 위치 등 미확정 사항을 적어 주세요.
- 필요한 산출물과 검수 항목을 적어 주세요. 예: Gerber, NC Drill, BOM, 좌표, ERC/DRC, CAM 검토`;
const files = ref<CachedUpload[]>([]);
const requirements = ref('');
const documentRequirements = ref('');
const models = ref<string[]>([]);
const selectedModel = ref('');
const documentModels = ref<string[]>([]);
const selectedDocumentModel = ref('');
const result = ref<RndFileClassifyResultType | null>(null);
const requestDocument = ref<string | null>(null);
const isLoadingModels = ref(false);
const isRunning = ref(false);
const isDocumentRunning = ref(false);
const isDragging = ref(false);
const message = ref('');
const error = ref('');

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('브라우저 저장소를 열 수 없습니다.')); };
  });
}

async function readCache(): Promise<BrowserCache | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(CACHE_KEY);
    request.onsuccess = () => { resolve(request.result as BrowserCache | undefined); };
    request.onerror = () => { reject(request.error ?? new Error('브라우저 캐시를 읽을 수 없습니다.')); };
    transaction.oncomplete = () => { db.close(); };
  });
}

async function saveCache(): Promise<void> {
  const db = await openDatabase();
  const cache: BrowserCache = {
    key: CACHE_KEY,
    requirements: requirements.value,
    documentRequirements: documentRequirements.value,
    model: selectedModel.value,
    documentModel: selectedDocumentModel.value,
    files: files.value,
    result: result.value,
    document: requestDocument.value,
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(cache, CACHE_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => { reject(transaction.error ?? new Error('브라우저 캐시를 저장할 수 없습니다.')); };
  });
}

function clientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing !== null) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, created);
  return created;
}

async function responseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `HTTP_${String(response.status)}`;
    throw new Error(code);
  }
  return body;
}

async function loadModels(): Promise<void> {
  isLoadingModels.value = true;
  error.value = '';
  try {
    const data = RndAiModelsResponse.parse(await responseJson(await fetch('/api/rnd/ai/models')));
    models.value = data.data.models;
    documentModels.value = data.data.documentModels;
    if (!models.value.includes(selectedModel.value)) {
      selectedModel.value = models.value.includes(RECOMMENDED_MODEL) ? RECOMMENDED_MODEL : (models.value[0] ?? '');
    }
    if (!documentModels.value.includes(selectedDocumentModel.value)) {
      selectedDocumentModel.value = documentModels.value.includes(RECOMMENDED_DOCUMENT_MODEL)
        ? RECOMMENDED_DOCUMENT_MODEL
        : (documentModels.value[0] ?? '');
    }
    message.value = `분류용 비전 모델 ${String(models.value.length)}개와 의뢰서용 모델 ${String(documentModels.value.length)}개를 불러왔습니다.`;
  } catch (caught) {
    error.value = caught instanceof Error ? `모델 목록을 불러오지 못했습니다: ${caught.message}` : '모델 목록을 불러오지 못했습니다.';
  } finally {
    isLoadingModels.value = false;
  }
}

async function onFilesSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  await addFiles(Array.from(input.files ?? []));
  input.value = '';
}

async function addFiles(selected: File[]): Promise<void> {
  if (selected.length === 0) return;
  files.value = [...files.value, ...selected.map((file) => ({ id: crypto.randomUUID(), file }))];
  result.value = null;
  requestDocument.value = null;
  await saveCache();
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  isDragging.value = true;
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault();
  isDragging.value = false;
}

async function onDrop(event: DragEvent): Promise<void> {
  event.preventDefault();
  isDragging.value = false;
  await addFiles(Array.from(event.dataTransfer?.files ?? []));
}

async function removeFile(id: string): Promise<void> {
  files.value = files.value.filter((item) => item.id !== id);
  result.value = null;
  requestDocument.value = null;
  await saveCache();
}

function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForJob(jobId: string): Promise<RndFileClassifyResultType> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const params = new URLSearchParams({ clientId: clientId() });
    const data = AiJobResponse.parse(await responseJson(await fetch(`/api/rnd/ai/jobs/${jobId}?${params.toString()}`)));
    if (data.data.status === 'done') {
      if (data.data.json === null) throw new Error('분석 결과가 없습니다.');
      return RndFileClassifyResult.parse(JSON.parse(data.data.json) as unknown);
    }
    if (data.data.status === 'error') throw new Error(data.data.error ?? '분석에 실패했습니다.');
    message.value = `AI가 파일 묶음을 분석 중입니다… ${String(data.data.elapsedSecs)}초`;
    await sleep(2_000);
  }
  throw new Error('분석 시간이 초과되었습니다.');
}

async function runAnalysis(): Promise<void> {
  if (files.value.length === 0) {
    error.value = '분석할 파일을 추가해 주세요.';
    return;
  }
  if (selectedModel.value === '') {
    error.value = '먼저 사용할 모델을 선택해 주세요.';
    return;
  }
  isRunning.value = true;
  error.value = '';
  requestDocument.value = null;
  message.value = '파일을 안전하게 준비하고 있습니다…';
  try {
    const form = new FormData();
    for (const item of files.value) form.append('file', item.file, item.file.name);
    form.append('payload', JSON.stringify({
      clientId: clientId(),
      requirements: requirements.value,
      model: selectedModel.value,
    }));
    const started = AiRunResponse.parse(await responseJson(await fetch('/api/rnd/ai/file-classify', {
      method: 'POST',
      body: form,
    })));
    result.value = await waitForJob(started.data.jobId);
    message.value = started.data.cached ? '브라우저 세션의 동일 분석 결과를 다시 사용했습니다.' : '분석이 완료되었습니다.';
    await saveCache();
  } catch (caught) {
    error.value = caught instanceof Error ? `분석하지 못했습니다: ${caught.message}` : '분석하지 못했습니다.';
  } finally {
    isRunning.value = false;
  }
}

async function waitForDocument(jobId: string): Promise<string> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const params = new URLSearchParams({ clientId: clientId() });
    const data = AiJobResponse.parse(await responseJson(await fetch(`/api/rnd/ai/jobs/${jobId}?${params.toString()}`)));
    if (data.data.status === 'done') {
      if (data.data.md === null) throw new Error('개발의뢰서 결과가 없습니다.');
      return data.data.md;
    }
    if (data.data.status === 'error') throw new Error(data.data.error ?? '개발의뢰서 생성에 실패했습니다.');
    message.value = `AI가 PCB 설계 개발의뢰서를 작성 중입니다… ${String(data.data.elapsedSecs)}초`;
    await sleep(2_000);
  }
  throw new Error('개발의뢰서 생성 시간이 초과되었습니다.');
}

async function runDocument(): Promise<void> {
  if (result.value === null) {
    error.value = '먼저 파일 분류를 완료해 주세요.';
    return;
  }
  if (selectedDocumentModel.value === '') {
    error.value = '개발의뢰서 생성 모델을 선택해 주세요.';
    return;
  }
  isDocumentRunning.value = true;
  error.value = '';
  message.value = '분류 결과와 원본 파일을 근거로 개발의뢰서를 준비하고 있습니다…';
  try {
    const form = new FormData();
    for (const item of files.value) form.append('file', item.file, item.file.name);
    const combinedRequirements = [requirements.value.trim(), documentRequirements.value.trim()]
      .filter((value) => value !== '')
      .join('\n\n[개발의뢰서 추가 요구사항]\n');
    form.append('payload', JSON.stringify({
      clientId: clientId(),
      requirements: combinedRequirements,
      model: selectedDocumentModel.value,
      classification: result.value,
    }));
    const started = AiRunResponse.parse(await responseJson(await fetch('/api/rnd/ai/request-document', {
      method: 'POST',
      body: form,
    })));
    requestDocument.value = await waitForDocument(started.data.jobId);
    message.value = started.data.cached ? '브라우저 세션의 동일 개발의뢰서를 다시 사용했습니다.' : 'PCB 설계 개발의뢰서 작성이 완료되었습니다.';
    await saveCache();
  } catch (caught) {
    error.value = caught instanceof Error ? `개발의뢰서를 만들지 못했습니다: ${caught.message}` : '개발의뢰서를 만들지 못했습니다.';
  } finally {
    isDocumentRunning.value = false;
  }
}

function fillPracticalDocumentRequirements(): void {
  documentRequirements.value = PRACTICAL_DOCUMENT_REQUIREMENTS;
  requestDocument.value = null;
}

function onDocumentRequirementsInput(): void {
  requestDocument.value = null;
}

function downloadResult(): void {
  if (result.value === null) return;
  const payload = {
    requirements: requirements.value,
    model: selectedModel.value,
    analyzedAt: new Date().toISOString(),
    files: files.value.map((item) => ({ name: item.file.name, size: item.file.size, type: item.file.type })),
    result: result.value,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pcb-file-classification.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadDocument(): void {
  if (requestDocument.value === null) return;
  const url = URL.createObjectURL(new Blob([requestDocument.value], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pcb-design-development-request.md';
  anchor.click();
  URL.revokeObjectURL(url);
}

async function clearBrowserCache(): Promise<void> {
  files.value = [];
  requirements.value = '';
  documentRequirements.value = '';
  result.value = null;
  requestDocument.value = null;
  await saveCache();
  message.value = '이 브라우저의 연구 캐시를 비웠습니다.';
}

watch([requirements, documentRequirements, selectedModel, selectedDocumentModel, result, requestDocument], () => { void saveCache(); }, { deep: true });

onMounted(async () => {
  try {
    const cache = await readCache();
    if (cache !== undefined) {
      files.value = cache.files;
      requirements.value = cache.requirements;
      documentRequirements.value = cache.documentRequirements ?? '';
      selectedModel.value = cache.model;
      selectedDocumentModel.value = cache.documentModel ?? '';
      result.value = cache.result;
      requestDocument.value = cache.document ?? null;
      if (cache.files.length > 0) message.value = '이 브라우저에 캐시된 파일 묶음을 복원했습니다.';
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '브라우저 캐시를 복원하지 못했습니다.';
  }
  await loadModels();
});
</script>

<template>
  <main class="page-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">SAMPLEPCB R&amp;D</p>
        <h1>PCB 설계 파일 AI 분류</h1>
        <p>원본과 결과는 이 브라우저의 IndexedDB에만 캐시됩니다. 서버에는 영구 저장하지 않습니다.</p>
      </div>
      <button class="secondary" type="button" @click="clearBrowserCache">브라우저 캐시 비우기</button>
    </header>

    <section class="panel">
      <h2>1. 파일과 요구사항</h2>
      <label
        class="drop-zone"
        :class="{ dragging: isDragging }"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <input type="file" multiple @change="onFilesSelected">
        <strong>ZIP 또는 개별 파일 추가</strong>
        <span>ZIP은 안전 한도 안에서 재귀 해제합니다. 전체 업로드는 100MB까지이며, 이미지·PDF·엑셀·텍스트·Gerber·KiCad 파일을 읽습니다.</span>
      </label>
      <ul v-if="files.length > 0" class="file-list">
        <li v-for="item in files" :key="item.id">
          <span>{{ item.file.name }}</span>
          <small>{{ formatBytes(item.file.size) }} · {{ item.file.type || '형식 미상' }}</small>
          <button class="text-button" type="button" @click="removeFile(item.id)">제거</button>
        </li>
      </ul>
      <label class="field-label" for="requirements">분석 참고 요구사항 <small>(선택)</small></label>
      <textarea id="requirements" v-model="requirements" rows="5" placeholder="예: 회로도, PCB 레이아웃, BOM, 제조용 Gerber 파일이 무엇인지 구분해 주세요." />
    </section>

    <section class="panel run-panel">
      <div>
        <h2>2. 모델 선택 및 분석</h2>
        <p>한 번에 하나의 모델로 실행합니다. 모델 비교는 다음 단계에서 추가합니다.</p>
      </div>
      <div class="run-controls">
        <select v-model="selectedModel" :disabled="isLoadingModels || isRunning">
          <option value="" disabled>모델을 선택하세요</option>
          <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
        </select>
        <button class="secondary" type="button" :disabled="isLoadingModels || isRunning" @click="loadModels">
          {{ isLoadingModels ? '불러오는 중…' : '모델 새로고침' }}
        </button>
        <button class="primary" type="button" :disabled="isRunning" @click="runAnalysis">
          {{ isRunning ? '분석 중…' : '파일 분류 시작' }}
        </button>
      </div>
    </section>

    <p v-if="message !== ''" class="notice">{{ message }}</p>
    <p v-if="error !== ''" class="error">{{ error }}</p>

    <section v-if="result !== null" class="panel result-panel">
      <div class="result-heading">
        <div>
          <h2>3. 분류 결과</h2>
          <p>필드를 직접 편집할 수 있으며 변경 내용은 브라우저에 캐시됩니다.</p>
        </div>
        <button class="primary" type="button" @click="downloadResult">JSON 다운로드</button>
      </div>
      <label class="field-label" for="summary">묶음 요약</label>
      <textarea id="summary" v-model="result.summary" rows="4" />
      <p v-for="warning in result.warnings" :key="warning" class="warning">{{ warning }}</p>
      <article v-for="item in result.files" :key="item.id" class="classification-card">
        <div class="file-title">
          <strong>{{ item.id }}</strong>
          <span>{{ item.path ?? item.role }}</span>
        </div>
        <div class="classification-fields">
          <label>분류
            <select v-model="item.category">
              <option value="image">이미지</option><option value="pdf-document">PDF 문서</option><option value="spreadsheet">스프레드시트</option><option value="text-document">텍스트 문서</option><option value="schematic">회로도</option><option value="pcb-layout">PCB 레이아웃</option><option value="gerber-manufacturing">Gerber 제조 자료</option><option value="bom">BOM</option><option value="archive">압축 파일</option><option value="binary-unknown">알 수 없는 바이너리</option><option value="other">기타</option>
            </select>
          </label>
          <label>신뢰도
            <select v-model="item.confidence"><option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option></select>
          </label>
          <label class="wide">추정 역할<textarea v-model="item.role" rows="2" /></label>
          <label class="wide">근거<textarea v-model="item.evidence" rows="3" /></label>
        </div>
      </article>
    </section>

    <section v-if="result !== null" class="panel document-panel">
      <div class="result-heading">
        <div>
          <h2>4. PCB 설계 개발의뢰서</h2>
          <p>분류 결과와 원본 파일에서 다시 추출한 근거로 의뢰서 초안을 만듭니다. 모델은 의뢰서용 전체 후보에서 선택할 수 있습니다.</p>
        </div>
        <div class="run-controls">
          <select v-model="selectedDocumentModel" :disabled="isLoadingModels || isDocumentRunning">
            <option value="" disabled>의뢰서 모델을 선택하세요</option>
            <option v-for="model in documentModels" :key="model" :value="model">{{ model }}</option>
          </select>
          <button class="primary" type="button" :disabled="isDocumentRunning" @click="runDocument">
            {{ isDocumentRunning ? '의뢰서 작성 중…' : '개발의뢰서 만들기' }}
          </button>
        </div>
      </div>
      <div class="document-requirements">
        <div class="field-heading">
          <label class="field-label" for="document-requirements">개발의뢰서 추가 요구사항 <small>(권장)</small></label>
          <button class="text-button" type="button" @click="fillPracticalDocumentRequirements">실무 예시 채우기</button>
        </div>
        <textarea
          id="document-requirements"
          v-model="documentRequirements"
          rows="8"
          placeholder="사용 환경, 수량, 포함·제외 범위, 유지 기능, 미확정 사양, 산출물과 검수 방법을 적으면 의뢰서가 더 구체적이고 안정적으로 생성됩니다."
          @input="onDocumentRequirementsInput"
        />
      </div>
      <template v-if="requestDocument !== null">
        <label class="field-label" for="request-document">편집 가능한 개발의뢰서 초안</label>
        <textarea id="request-document" v-model="requestDocument" class="document-editor" rows="30" />
        <button class="primary" type="button" @click="downloadDocument">Markdown 다운로드</button>
      </template>
    </section>
  </main>
</template>
