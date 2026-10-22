// 위저드 스텝별 문구 — 피그마 「개발 의뢰」 01-1~01-5(Design done 70:566·70:868·70:11679·70:12081·70:12369).
// bar = 상단 바 제목, title·lead = 본문 큰 제목·부제, guide = 상단 바 가운데 안내(하늘색). 수정 화면은 title 만 섹션 제목으로 쓴다.
// 시안 오탈자는 바로잡았다(docs/FIGMA_PAGES.md "개발의뢰 위저드"): 4스텝 안내가 1스텝 문구 복사본이던 것, '확인 되지' 띄어쓰기 등.
import type { StepKey } from '../composables/useRequestForm';

interface StepCopy {
  bar: string;
  title: string;
  lead: string;
  guide: string;
}

export const STEP_COPY: Record<StepKey, StepCopy> = {
  menu: {
    bar: 'Step1. 개발 메뉴',
    title: '어떤 개발이 필요하신가요?',
    lead: '시스템 개발은 제품 개발에 필요한 전체 업무를 분석합니다. 개별 견적은 여러 분야를 함께 선택할 수 있습니다.',
    guide: '개발이 필요하신 분야를 선택해 주세요.',
  },
  describe: {
    bar: 'Step2. 의뢰 내용',
    title: '의뢰 내용을 알려주세요.',
    lead: '기술용어보다 개발 목적과 사용 상황을 중심으로 작성해도 충분합니다.',
    guide: '의뢰 내용을 입력해 주세요.',
  },
  questions: {
    bar: 'Step3. 세부 질문',
    title: '시스템 개발 추가 확인',
    lead: '입력 내용과 등록 자료에서 확인되지 않은 핵심 사항만 질문합니다.',
    guide: '시스템 개발 관련 내용을 확인해 주세요.',
  },
  production: {
    bar: 'Step4. 제작 계획',
    title: '시제품과 생산 계획',
    lead: '개발 과정의 시제품과 개발 완료 후 생산 계획을 나누어 확인합니다.',
    guide: '시제품과 생산 계획을 선택해 주세요.',
  },
  review: {
    bar: 'Step5. 검토·접수',
    title: '입력 내용을 확인해 주세요.',
    lead: '접수 후 담당자가 개발 범위·일정·비용을 검토하여 견적 제안서를 전달합니다.',
    guide: '입력 내용을 확인한 후 완료 버튼을 눌러 주세요.',
  },
};

// 개별 견적(시스템 개발이 아닐 때)의 3스텝 — 시안은 시스템 개발 판만 있어 같은 모양으로 문구만 바꾼다.
export const INDIVIDUAL_QUESTIONS_COPY: StepCopy = {
  bar: 'Step3. 세부 질문',
  title: '개별 개발 전문 질문',
  lead: '선택한 분야의 견적에 필요한 전문 사양입니다. 모르는 값은 담당자 제안 필요로 작성할 수 있습니다.',
  guide: '선택한 분야의 내용을 확인해 주세요.',
};

// 시안 컨트롤 모양(1920 기준) — 스텝 컴포넌트들이 같은 클래스를 쓴다.
export const WIZ = {
  section: 'flex flex-col gap-[26px]',
  sectionTitle: 'text-[20px] font-medium leading-[1.3] text-black sm:text-[22px]',
  sectionLead: 'text-[15px] font-medium leading-[1.3] text-[#666] sm:text-[16px]',
  question: 'text-[17px] font-medium leading-[1.3] text-black sm:text-[18px]',
  input:
    'h-[60px] w-full rounded-[10px] border border-[#d9d9d9] bg-white px-[18px] text-[18px] font-medium leading-[1.8] text-black outline-none placeholder:text-[#888] focus:border-[#2945e8] sm:h-[72px] sm:text-[20px]',
  textarea:
    'w-full rounded-[10px] border border-[#d9d9d9] bg-[#fafafa] px-[18px] py-[14px] text-[17px] font-medium leading-[1.8] text-black outline-none placeholder:text-[#888] focus:border-[#2945e8] sm:text-[18px]',
  selectBox:
    'relative flex h-[72px] w-full items-center rounded-[14px] border border-[#d9d9d9] bg-white px-[24px] sm:h-[90px] sm:px-[30px]',
  selectText: 'text-[18px] font-bold text-black sm:text-[20px]',
} as const;

// 칩(알약) — 선택 = 파란 2px 테두리·파란 글자. 탈출구(잘 모르겠음)는 점선으로 가른다.
export const chipClass = (on: boolean, escape = false): string =>
  [
    'flex min-h-[48px] items-center justify-center rounded-full bg-white px-[20px] py-[8px] text-[17px] font-bold leading-[1.3] transition-colors sm:min-h-[56px] sm:text-[20px]',
    on
      ? 'border-2 border-[#2945e8] text-[#2945e8]'
      : `border ${escape ? 'border-dashed' : ''} border-[#d9d9d9] text-black hover:border-[#9aa3ad]`,
  ].join(' ');
