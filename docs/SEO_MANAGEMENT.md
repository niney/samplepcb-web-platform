# SEO 관리 (sp_seo) — 설계 정본

> 영카트/그누보드5에 사실상 없는 **페이지별 SEO**(title·description·OG·canonical·JSON-LD)를,
> **관리 UI는 sp-vue 관리자 / 실제 meta 출력은 sp-php SSR**로 신설한다.
> 이 문서가 SEO 관리의 **단일 설명원본**. 확정일 2026-07-10(독립 검토 회수 완료).

## 왜 필요한가 (코어 현황)

그누보드5/영카트 코어의 SEO 관련 기능은 **두 가지가 전부**다:

| 항목 | 필드 | 한계 |
|---|---|---|
| 홈페이지 제목 | `g5_config.cf_title` | 전역 `<title>` 접미사 1벌 |
| 추가 메타태그 | `g5_config.cf_add_meta` | 전역 **raw HTML 1벌**, 편집 UI는 코어 `adm/config_form.php:745` |

→ meta description·OG·canonical·robots·sitemap·구조화데이터(JSON-LD)가 **전무**하고, 있는 것도 전역 고정이라 페이지·상품별 최적화가 불가능하다.

## 아키텍처 — 슬로프 선례를 재사용

슬라이드 이관(`theme/sp-lite/inc/main_slider.php` ↔ sp-vue `/app/admin/slides`)과 **같은 "관리=sp-vue / 소비=sp-php 같은 DB 공유"** 분리. 차이점은 **저장 테이블이 기존 g5_ 재사용이 아니라 신규 `sp_seo`(Prisma 소유)** 라는 것.

```
[관리]  sp-vue /app/admin/seo  →  sp-node /api/admin/seo  →  Prisma  →  sp_seo
[소비]  sp-php 테마 head.sub.php  →  (read-only 1쿼리 SELECT)  →  sp_seo  →  <head> 메타 출력
```

**핵심 전제**: SEO 메타는 크롤러·OG 스크래퍼가 **초기 HTML의 `<head>`** 를 보므로 **반드시 sp-php가 서버렌더**한다. sp-vue(`/app` 하위 SPA)는 크롤러가 못 보므로 **관리 UI 전용**이다.

## 확정 결정 (독립 검토 회수됨)

### ① 소비측 매칭 = 옵션 B (테마가 페이지 전역변수로 자체 판별)

- **코어 비수정**: 코어 `head.sub.php:6-8`이 비관리자 전 페이지를 `require_once(G5_THEME_PATH.'/head.sub.php')`로 위임 → **수정 대상은 테마 `theme/sp-lite/head.sub.php` 1파일**.
- **URL 파싱이 아니라 "스크립트 basename + 페이지 전역변수" 매칭**을 쓴다. 근거:
  - PHP `include`는 호출 스코프를 상속한다. `shop/item.php:12`가 `$it`을 해석해 세팅한 뒤 head를 include하므로 테마 head.sub.php에서 **`$it`/`$it_id`가 해석된 값으로 직접 보인다**(코어 head.sub.php:78도 `$bo_table`을 정의 없이 참조 — 확립된 패턴).
  - 상품 URL은 rewrite로 `item.php?it_seo_title=...`(it_id 없음)로도 들어온다(`lib/shop.uri.lib.php:159,176`). 따라서 `$_GET['it_id']`에 의존하면 SEO-title URL에서 깨진다 → **item.php가 정규화한 `$it['it_id']`를 써야 한다**.
- 매칭 키:
  - 상품 상세: `basename==item.php` && `$it['it_id']` → `scope=item, refKey=it_id`
  - 게시판: `$bo_table` 존재 → `scope=board, refKey=bo_table` (P3)
  - spcb 정적 페이지: `basename` (예: `reviews.php`) → `scope=page, refKey=basename` (P1)
  - 그 외/홈: `scope=global, refKey=''`

### ② 저장 = 신규 `sp_seo`(Prisma 소유, 공유 DB)

`cf_add_meta` 확장 기각(전역 1벌 + 코어 config_form 수정). 하우스 관례 준수:

- **ENUM 금지 → `String`+주석**, **camelCase 네이티브 + `@@map`**, **`@@unique([scope, refKey])`**.
- **canonical은 저장 원칙 아님** — `G5_DOMAIN=''`(호스트 무관 설계)라 절대 URL을 박으면 drift. 기본은 `host+path` 계산, `sp_seo.canonical`은 **수동 오버라이드 전용**(대개 null).
- **`jsonLd` 컬럼 없음** — Product JSON-LD는 `$it`에서 자동 유도가 낫다(맹점 a). 나중에 필요하면 additive `ALTER ADD`.
- `refKey` 단일 문자열로 충분, board는 `bo_table` 단위만. sp-php가 `sp_*`를 직접 SELECT하는 건 규율 위반 아님(선례 `theme/sp-lite/inc/main_reviews.php:16`, `spcb/pages/reviews.php:22`).

스키마: `apps/api/prisma/schema.prisma`의 `SpSeo` / 마이그레이션 `migrations/20260710000000_add_sp_seo/`.

### ③ 소비 경로 = 직접 DB 조회 (API 호출 아님)

렌더 경로에 sp-node HTTP 호출 금지(지연·장애 전파). `main_slider.php`처럼 `sql_query` 직접. **단 등급이 높다**(전 페이지 경유):
- **엔티티 + global을 1쿼리로 통합** 조회 후 앱단에서 폴백 병합.
- **`sql_fetch($sql, false)` 방어**(에러 시 die 금지) — SEO 조회 실패가 페이지를 죽이면 안 된다.

### 보너스 — 코어 훅 `html_process_add_meta`

코어에 `run_replace('html_process_add_meta', '')` 훅이 실재한다(`lib/common.lib.php:3404-3413`, 출력버퍼 flush 시 `<title>` 직전 주입). `extend/` 자동로드(`common.php:836-853`)로 **코어·테마 0수정**도 가능. **단 이 훅은 `<title>` 텍스트를 못 바꾼다** → 상품 title 최적화가 SEO 핵심이라 **주 구현은 테마 head.sub.php, 훅은 예비**로만 쓴다.

## 폴백 & 자동 유도

출력 각 필드의 결정 순서:

```
metaTitle:       엔티티 override → scope 기본 → global 기본 → 자동($it 유도) → 코어 $g5_head_title
metaDescription: 엔티티 override → scope 기본 → global 기본 → 자동($it 유도/게시판 본문 발췌)
ogImage:         엔티티 override → 자동($it 대표이미지) → global 기본
canonical:       override(있으면) → host+path 계산
robots:          override → (기본: index,follow)
```

**핵심(맹점 a)**: `sp_seo`를 유일 소스로 두지 않는다. 상품은 `$it`에서 og:title/이미지·JSON-LD를 **자동 유도가 기본**(`shop/item.php:195` sns_title 선례), `sp_seo`는 오버라이드용. → 레코드 0건에도 상품 SEO가 뜬다.

## cf_add_meta 이중출력 정책 (맹점 c)

코어·테마 head 모두 `cf_add_meta`를 **무조건 echo**한다(코어 `head.sub.php:54-55`, 테마 `head.sub.php:69-70`). SEO 브릿지가 og/description을 추가 출력하므로 중복 위험 → **`cf_add_meta` 는 소유권/검증 태그(google-site-verification, naver 등) 전용**으로 운영 정책을 못박는다. description·OG는 반드시 sp_seo 경로로만.

## 단계 (Phasing)

| 단계 | 범위 | 비고 |
|---|---|---|
| **P1** | 전역 기본(title 접미사·description·og_image·canonical) + 홈 + **spcb 정적 페이지**(scope=page, basename 매칭) | 매칭 난제 회피, 즉효. sp-vue `AdminSeo.vue` 1화면 |
| **P2** | 상품 per-item 오버라이드 + `$it` 자동유도 **Product JSON-LD** | ⚠ **착수 전 실제 상품 수 확인**(맹점 b, ~5종 추정·미검증 → ROI 낮으면 자동유도만으로 종결) |
| **P3** | 게시판(scope=board) + 동적 `sitemap.xml` + `robots.txt` | 코어에 아예 없는 항목 신설 |

## 검증 노트 / 함정

- **모바일 head 걱정 불필요**: sp-lite가 `theme.config.php:9` `G5_THEME_DEVICE='pc'` → `common.php:737-742`가 `G5_IS_MOBILE=false` 강제 → 전 기기 PC 파일. 모바일 브릿지 경로 자체가 안 탄다.
- **ogImage 절대 URL**: OG 스크래퍼는 상대경로를 못 읽는다 → 소비측이 `G5_DATA_URL`+host로 절대화.
- **공유 DB 규율**: 마이그레이션은 **추가 전용(CREATE/ALTER ADD)만**, `prisma migrate deploy`로 적용. `migrate dev`/`reset` **절대 금지**(g5_* 60개 drift → 전체 reset 요구). 상세 `schema.prisma:6-11`.
- `SpSeo`(및 소급 `SpReview`) 모델 주석에 "sp-php read-only 참조" 명기.

## 비범위

- 이 문서 시점에는 **P1 설계·스키마까지**. 라우트/Vue 화면 구현은 후속.
- 다국어(hreflang)·AMP·Twitter Card 세부는 현재 비범위(필요 시 additive 확장).

## 산출물 위치

- 스키마: `samplepcb-web-mono-app/apps/api/prisma/schema.prisma` (`SpSeo`)
- 마이그레이션: `.../prisma/migrations/20260710000000_add_sp_seo/migration.sql`
- (후속) 라우트: `apps/api/src/routes/admin-seo.ts` · 계약 `packages/api-contract/src/schemas/seo.ts` · 화면 `apps/web/src/pages/admin/AdminSeo.vue`
- (후속) 소비 브릿지: `samplepcb-web/theme/sp-lite/inc/seo_head.php` (head.sub.php에서 include)
