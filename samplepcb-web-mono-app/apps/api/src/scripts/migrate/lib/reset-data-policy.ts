import type { DatabaseTarget } from '../../../lib/db-snapshot';
import { DEVELOP_ANCHOR_IT_ID, MARKET_ANCHOR_IT_ID, TEMPLATE_ITEMS } from '../../../lib/g5-db';

/** 회원·거래 행과 구분되는 사이트/업무 설정. 새 설정 테이블을 만들면 이 목록도 갱신한다. */
export const RESET_PRESERVED_TABLES: Readonly<Record<string, string>> = {
  _prisma_migrations: 'Prisma 적용 이력',
  g5_config: '사이트·최고관리자·인증 설정',
  g5_shop_default: '쇼핑몰·결제·사업자 설정',
  g5_menu: '메뉴',
  g5_content: '고정 페이지',
  g5_faq: 'FAQ 내용',
  g5_faq_master: 'FAQ 분류',
  g5_new_win: '팝업 설정',
  g5_board: '게시판 설정(글 수·공지 참조는 초기화)',
  g5_group: '게시판 그룹 설정',
  g5_qa_config: '1:1 문의 설정',
  g5_shop_category: '상품 분류 설정',
  g5_shop_banner: '배너·메인 슬라이드',
  g5_shop_sendcost: '추가 배송비 설정',
  g5_shop_coupon_zone: '쿠폰존 발급 설정',
  g5_shop_event: '기획전 설정',
  sp_config: '앱·가격 모드·연동 설정',
  sp_ai_usecase: 'AI 유스케이스 설정',
  sp_seo: 'SEO 설정',
  sp_mail_template: '메일 템플릿',
  sp_market_settings: '마켓 수수료 설정',
  sp_develop_settings: '개발의뢰 기본 조건·알림 설정',
};

export const RESET_ANCHOR_ITEM_IDS: readonly string[] = [
  ...Object.values(TEMPLATE_ITEMS), MARKET_ANCHOR_IT_ID, DEVELOP_ANCHOR_IT_ID,
];

/** 결제용 고정 상품과 그 상품끼리의 표시 설정만 보존한다. */
export const RESET_ANCHOR_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  g5_shop_item: ['it_id'],
  g5_shop_event_item: ['it_id'],
  g5_shop_item_relation: ['it_id', 'it_id2'],
};

export type ResetAction = 'preserve' | 'truncate' | 'anchors';

export function resetTableAction(table: string): ResetAction {
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`지원하지 않는 테이블 이름: ${table}`);
  if (Object.hasOwn(RESET_PRESERVED_TABLES, table)) return 'preserve';
  if (Object.hasOwn(RESET_ANCHOR_COLUMNS, table)) return 'anchors';
  if (/(?:^|_)(?:config|settings)(?:_|$)/.test(table)) {
    throw new Error(`보존 여부를 분류하지 못한 설정 테이블: ${table}`);
  }
  if (/^(g5_|sp_)/.test(table)) return 'truncate';
  throw new Error(`초기화 범위를 분류하지 못한 테이블: ${table}`);
}

export interface ResetTargets {
  target: DatabaseTarget;
  g5: DatabaseTarget;
  legacy: DatabaseTarget;
  runtime: DatabaseTarget;
  runtimeG5: DatabaseTarget;
}

function sameDatabase(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.database === b.database;
}

/** URL 비밀번호를 출력하지 않고 앱·이관의 실제 대상과 레거시 분리를 확인한다. */
export function assertResetTargets(targets: ResetTargets, execute: boolean, confirmation?: string): void {
  const { target, g5, legacy, runtime, runtimeG5 } = targets;
  for (const value of [target, g5, legacy, runtime, runtimeG5]) {
    if (!/^[a-zA-Z0-9_]+$/.test(value.database)
      || ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(value.database.toLowerCase())) {
      throw new Error('업무 DB만 초기화할 수 있습니다');
    }
  }
  if (![g5, runtime, runtimeG5].every((value) => sameDatabase(target, value))) {
    throw new Error('.env와 .env.migration의 DATABASE_URL/G5_DATABASE_URL 호스트·포트·DB가 모두 같아야 합니다');
  }
  // 기존 migrate:run과 같은 보수적 경계: 다른 호스트라도 소스와 같은 DB 이름은 거부한다.
  if (target.database.toLowerCase() === legacy.database.toLowerCase()) {
    throw new Error('레거시와 초기화 대상 DB 이름이 같습니다. 레거시는 초기화할 수 없습니다');
  }
  if (execute && confirmation !== target.database) {
    throw new Error(`실제 초기화에는 --yes --confirm-database ${target.database}가 필요합니다`);
  }
}
