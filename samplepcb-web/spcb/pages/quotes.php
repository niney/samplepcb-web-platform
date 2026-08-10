<?php
// samplepcb 견적관리 — PCB(거버)·부품 BOM 견적 통합 목록 (D17, docs/SMARTBOM_PARTNER_RFQ.md §6)
// URL: /shop/quotes (정식, 루트 .htaccess 3번 규칙) · /quotes (2번 규칙 별칭)
//
// 구조: 이 페이지는 셸(테마 레이아웃 + 인증 유도)만 담당하고, 데이터는 브라우저 JS 가
// 같은 도메인의 sp-node API 두 곳을 호출해 **한 리스트**로 섞어 렌더한다(유형 배지+필터 탭).
//   인증: GET /spcb/api/me (세션→JWT 브리지) → Authorization: Bearer
//   PCB : GET /api/pcb-projects · 수량 PATCH · 삭제 DELETE · 주문 POST /order(배치)
//   BOM : GET /api/bom/quotes (목록 전용 — 작업·상세는 /app/bom) · 주문 POST /order(배치, D17)
//   주문은 **같은 유형끼리만** — PCB+BOM 혼합 결제 금지(이행·정산 분리, D17). 부품 BOM 은
//   회신 완료+확정가 건만 체크 가능하고, 서버가 확정가×1.1(부가세 포함)로 담는다(D16).
//   화면의 개별 금액과 선택 합계도 실제 장바구니 금액과 같은 부가세 포함 기준으로 표시한다.
//   삭제 툴바는 PCB 전용(부품 BOM 삭제·수정은 /app/bom 담당).
//
// 독립 모델(장바구니와 분리): PCB 목록 API 가 순수 견적(ctId 없음)만 내려준다.
// 장바구니에 담긴/주문된 건은 이 화면에 나오지 않고, 장바구니에서 삭제하면
// 서버가 지연 반영으로 보관함(/shop/quotes/archive)에 넣는다. 아래 JS 의
// cartState 분기(담김 배지·삭제 제외)는 하위호환 백스톱으로만 남아 있다.
//
// 디자인: cart.php(테마 오버라이드)와 같은 시각 문법 — 카드 목록(.sp-cart-item)과
// 주문요약(.sp-cart-summary) 클래스를 재사용(비쇼핑 부트스트랩이라 default_shop.css 직접 링크),
// 견적 전용 변형은 default_shop.css 의 "견적관리" 섹션(sp-quotes__*) 참조.

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $is_member, 테마 상수

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode(G5_URL . '/shop/quotes'));
}

$g5['title'] = '견적관리';
include_once(G5_THEME_PATH . '/head.php');

// 카드 썸네일 — cart.php 의 견적 행과 같은 그림이 나오도록 동일한 템플릿 상품
// 이미지(get_it_image)를 재사용한다. category → it_id 매핑은 sp-node
// g5-db.ts TEMPLATE_ITEMS 와 동일하게 유지할 것(bom = 부품 BOM 주문 앵커 상품).
$sp_quote_thumbs = array();
foreach (array(
    'standard'  => 'sp-pcb-std',
    'metalmask' => 'sp-mask',
    'advance'   => 'sp-pcb-adv',
    'flexible'  => 'sp-pcb-flex',
    'bom'       => 'sp-bom-parts',
) as $sp_cat => $sp_it_id) {
    $sp_quote_thumbs[$sp_cat] = get_it_image($sp_it_id, 96, 96);
}
?>

<link rel="stylesheet" href="<?php echo G5_THEME_CSS_URL; ?>/default_shop.css?ver=<?php echo G5_CSS_VER; ?>">

<?php $sp_account_active = 'quotes'; ?>
<div class="account-layout">
    <?php include G5_THEME_SHOP_PATH . '/_account_nav.php'; ?>
    <div class="account-main">
        <div id="wrapper_title"><?php echo $g5['title']; ?></div>

<?php /* 유형 필터 — 한 리스트를 [전체]·[PCB]·[부품 BOM]으로 거른다(탭이 아니라 필터).
        #bom 해시 딥링크(알림 메일 등)는 부품 필터로 진입한다. */ ?>
<div class="sp-quotes-tabs" role="tablist" id="sp-quotes-filters">
    <button type="button" class="sp-quotes-tab is-active" data-filter="all">전체</button>
    <button type="button" class="sp-quotes-tab" data-filter="pcb">PCB</button>
    <button type="button" class="sp-quotes-tab" data-filter="bom">부품 BOM</button>
</div>

<div class="sp-quotes">
    <p class="sp-quotes__status" id="sp-quotes-status">불러오는 중…</p>

    <div class="sp-cart-empty sp-quotes__empty" id="sp-quotes-empty" hidden>
        <i class="fa fa-file-text-o" aria-hidden="true"></i>
        <p>접수된 견적이 없습니다.</p>
        <span class="sp-cart-empty-sub">
            거버 파일을 업로드하면 PCB 자동 견적을,
            BOM 파일(Excel)을 올리면 <a href="<?php echo G5_URL; ?>/app/bom" class="sp-link-archive">스마트 BOM</a>에서 부품 견적을 받아볼 수 있습니다.
        </span>
        <?php /* [비우기]로 다 지운 직후가 보관함을 찾는 순간 — 빈 상태에도 경로 제공 */ ?>
        <span class="sp-cart-empty-sub">
            장바구니에 담은 견적은 <a href="<?php echo G5_SHOP_URL; ?>/cart.php">장바구니</a>에서,
            삭제한 PCB 견적은 <a href="<?php echo G5_URL; ?>/shop/quotes/archive" class="sp-link-archive">지난 견적 보관함</a>에서 확인할 수 있습니다.
        </span>
    </div>

    <form class="sp-quotes__form" id="sp-quotes-form" onsubmit="return false;" hidden>
        <div class="sp-cart-body">

            <!-- 견적 목록 (PCB·부품 BOM 통합) -->
            <section class="sp-cart-list">
                <h2 class="sound_only">견적 목록</h2>

                <div class="sp-cart-toolbar">
                    <span class="sp-chk">
                        <input type="checkbox" id="sp-quotes-check-all" class="selec_chk">
                        <label for="sp-quotes-check-all"><span></span>전체선택 <em id="sp_sel_cnt">0/0</em></label>
                    </span>
                    <div class="sp-cart-toolbar-btns btn_cart_del">
                        <button type="button" id="sp-quotes-del-sel">선택삭제</button>
                        <button type="button" id="sp-quotes-del-all">비우기</button>
                    </div>
                </div>

                <div class="sp-quotes-mobile-order" aria-label="모바일 주문 요약">
                    <p>
                        <span id="sp-quotes-mobile-count">0건</span> 선택 ·
                        <strong><span id="sp-quotes-mobile-total">0</span>원</strong>
                        <small>국내 배송비는 주문서에서 별도 계산</small>
                    </p>
                    <button type="button" class="sp-btn sp-btn-primary btn_submit js-sp-quotes-direct">바로 주문</button>
                </div>

                <ul class="sp-cart-items" id="sp-quotes-rows"></ul>
            </section>

            <!-- 주문 요약 -->
            <aside class="sp-cart-side">
                <div class="sp-cart-summary">
                    <h2>주문 요약</h2>
                    <dl class="sp-cart-summary-row">
                        <dt>선택 견적</dt>
                        <dd><span id="sp-quotes-count">0건</span></dd>
                    </dl>
                    <dl class="sp-cart-summary-row sp-cart-summary-total">
                        <dt>선택 결제예상액 합계</dt>
                        <dd><strong id="sp-quotes-total">0</strong>원</dd>
                    </dl>
                    <p class="sp-cart-summary-note">
                        표시·합계 금액은 모두 부가세 포함 결제예상액입니다.
                        국내 배송비는 주문서에서 별도로 계산됩니다.
                        PCB 견적과 부품 BOM 견적은 각각 별도 주문으로 진행됩니다(같은 유형끼리 선택).
                        PCB 수량을 바꾸면 서버가 다시 견적합니다(확정·담김 상태 제외).
                    </p>
                </div>

                <div class="sp-cart-act">
                    <button type="button" class="sp-btn sp-btn-primary btn_submit js-sp-quotes-direct" id="sp-quotes-direct">바로 주문</button>
                </div>
            </aside>

        </div>
    </form>
</div>

<script>
(function () {
    'use strict';

    var API_BASE = '/api/pcb-projects';
    var BOM_API = '/api/bom/quotes';
    var statusEl = document.getElementById('sp-quotes-status');
    var emptyEl = document.getElementById('sp-quotes-empty');
    var formEl = document.getElementById('sp-quotes-form');
    var rowsEl = document.getElementById('sp-quotes-rows');
    var token = null;
    var currentFilter = 'all';

    // category(소문자) → 템플릿 상품 썸네일 HTML — cart.php 견적 행과 동일한 이미지
    var THUMBS = <?php echo json_encode(array_map('strval', $sp_quote_thumbs), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;

    var QUOTE_LABEL = { rfq: '견적 대기', priced: '자동견적', quoted: '견적 확정' };
    var CART_LABEL = {
        none: '', cart: '장바구니 담김', ordered: '주문됨',
        canceled: '주문 취소 · 재주문 가능'
    };
    var BOM_STATUS_LABEL = {
        draft: '작성 중', requested: '견적요청', reviewing: '검토 중',
        answered: '회신 완료', closed: '종료', canceled: '취소'
    };
    var ERROR_MSG = {
        QUOTE_FINALIZED: '확정된 견적은 수량을 변경할 수 없습니다. 재견적이 필요하면 문의해 주세요.',
        IN_CART: '장바구니에 담긴 프로젝트입니다. 장바구니에서 삭제한 뒤 다시 시도해 주세요.',
        ALREADY_ORDERED: '이미 주문된 견적입니다.',
        NOT_PRICED: '견적가가 아직 없습니다. 견적 확정 후 주문할 수 있습니다.',
        NOT_FOUND: '견적을 찾을 수 없습니다.',
        NO_ORDERABLE_ITEMS: '주문 가능한 항목이 없습니다.',
        CART_INSERT_FAILED: '장바구니 담기에 실패했습니다.',
        TEMPLATE_ITEM_MISSING: '상품 설정 오류입니다. 관리자에게 문의해 주세요.',
        NOT_ANSWERED: '회신 완료된 견적만 주문할 수 있습니다.',
        NOT_CONFIRMED: '확정가 안내 전입니다. 담당자 회신(확정가) 후 주문할 수 있습니다.',
        NO_CART_ID: '세션이 만료되었습니다. 새로고침 후 다시 시도해 주세요.'
    };

    function fmtNum(n) { return n.toLocaleString('ko-KR'); }
    function fmtDate(iso) { return iso ? iso.slice(0, 10) : '-'; }
    function vatIncludedBreakdown(total) {
        var normalizedTotal = Math.round(Number(total));
        var supply = Math.round(normalizedTotal / 1.1);
        return { supply: supply, vat: normalizedTotal - supply, total: normalizedTotal };
    }
    function vatExcludedBreakdown(supply) {
        var normalizedSupply = Math.round(Number(supply));
        var total = Math.round(normalizedSupply * 1.1);
        return { supply: normalizedSupply, vat: total - normalizedSupply, total: total };
    }
    function errMsg(body) {
        return (body && ERROR_MSG[body.error]) || (body && (body.message || body.error)) || '요청에 실패했습니다.';
    }

    function callApi(base, method, path, body) {
        return fetch(base + path, {
            method: method,
            headers: Object.assign(
                { 'Authorization': 'Bearer ' + token },
                body ? { 'Content-Type': 'application/json' } : {}
            ),
            body: body ? JSON.stringify(body) : undefined
        }).then(function (res) {
            return res.json().then(function (json) { return { ok: res.ok, json: json }; });
        });
    }
    function api(method, path, body) { return callApi(API_BASE, method, path, body); }
    function bomApi(method, path, body) { return callApi(BOM_API, method, path, body); }

    // 세션 → JWT (만료 10분 — 매 액션 전 재호출로 갱신)
    function refreshToken() {
        return fetch('/spcb/api/me', { credentials: 'include' }).then(function (res) {
            if (!res.ok) { throw new Error('not authenticated'); }
            return res.json();
        }).then(function (me) { token = me.token; });
    }

    function badge(label, cls) {
        return label ? '<span class="sp-badge sp-badge--' + cls + '">' + label + '</span>' : '';
    }

    // ── 행 렌더(유형별 템플릿) ────────────────────────────────────────────────
    function renderPcbRow(it) {
        // 체크박스는 cart.php 와 동일하게 "선택" 범용(주문·삭제 공용) — 주문됨만 잠금.
        // 주문/삭제 가능 여부는 버튼 동작에서 항목별로 거른다(담김 카드는 주문 시 행 재사용).
        var selectable = it.cartState !== 'ordered';
        var qtyEditable = it.quoteStatus !== 'quoted' && it.cartState === 'none';
        var chkId = 'sp-quotes-check-' + it.projectId;
        var payment = it.price === null ? null : vatIncludedBreakdown(it.price);

        var li = document.createElement('li');
        li.className = 'sp-cart-item sp-quotes__item' + (selectable ? '' : ' sp-quotes__item--locked');
        li.dataset.type = 'pcb';
        li.innerHTML =
            '<span class="sp-chk sp-cart-item-chk">' +
                '<input type="checkbox" class="sp-quotes__check selec_chk" id="' + chkId + '" value="' + it.projectId + '" data-price="' + (payment === null ? '' : payment.total) + '" data-cartstate="' + it.cartState + '"' + (selectable ? '' : ' disabled') + '>' +
                '<label for="' + chkId + '"><span></span><b class="sound_only">선택</b></label>' +
            '</span>' +
            // 거버 썸네일(서명 프록시 URL — sp-node 발급이라 신뢰 가능), 없으면 템플릿 이미지 폴백
            '<span class="sp-cart-thumb">' + (it.thumbnailUrl
                ? '<img src="' + it.thumbnailUrl + '" alt="">'
                : (THUMBS[String(it.category).toLowerCase()] || '')) + '</span>' +
            '<div class="sp-cart-info">' +
                '<span class="prd_name"><b class="sp-quotes__name"></b></span>' +
                // cart 의 sod_opt(ct_option)와 같은 사양 요약 — 서버 optionSummary 그대로
                '<div class="sod_opt"><ul><li class="sp-quotes__opt"></li></ul></div>' +
                '<div class="sp-cart-meta">' +
                    '<span class="sp-quotes__cat"></span>' +
                    '<span>' + (it.orderCategory === 'mass' ? '양산' : '샘플') + '</span>' +
                    (it.eta ? '<span>출고예정 ' + it.eta + '</span>' : '') +
                    '<span>접수 ' + fmtDate(it.createdAt) + '</span>' +
                '</div>' +
                '<div class="sp-quotes__badges">' +
                    badge('PCB', 'type') +
                    badge(QUOTE_LABEL[it.quoteStatus], it.quoteStatus) +
                    badge(CART_LABEL[it.cartState], 'cart') +
                '</div>' +
            '</div>' +
            '<div class="sp-cart-calc">' +
                '<span class="sp-cart-qty sp-quotes__qty-label">수량' +
                    '<input type="number" class="sp-quotes__qty" min="1" value="' + it.qty + '"' + (qtyEditable ? '' : ' disabled') + ' data-id="' + it.projectId + '" data-prev="' + it.qty + '">' +
                '</span>' +
                (payment === null
                    ? '<span class="sp-quotes__pending">견적 대기</span>'
                    : '<strong class="sp-cart-sum">' + fmtNum(payment.total) + '원</strong>' +
                      '<span class="sp-quotes__tax-detail">VAT 포함 · 공급가 ' + fmtNum(payment.supply) + '원 + 부가세 ' + fmtNum(payment.vat) + '원</span>') +
                // rfq(견적요청) 행은 배지만 '견적 대기'인데 금액은 자동견적가가 그대로 떠서,
                // 담당자 검토 결과인 줄 오해하기 쉽다. 지금 보이는 값의 정체와 다음 일을 밝힌다
                // (BOM 행의 '확정가 안내 후 주문 가능' 과 같은 배려).
                (it.quoteStatus === 'rfq'
                    ? '<span class="sp-quotes__pending">담당자 검토 중 — 확정가는 메일로 안내드립니다' +
                      (payment === null ? '' : '. 지금 보이는 금액은 자동견적가입니다') + '</span>'
                    : '') +
            '</div>';
        li.querySelector('.sp-quotes__name').textContent = it.projectName; // XSS 안전 주입
        li.querySelector('.sp-quotes__cat').textContent = it.category;
        li.querySelector('.sp-quotes__opt').textContent = it.optionSummary || '';
        return li;
    }

    // 부품 BOM 행 — 체크(주문 전용, 회신 완료+확정가 건만 활성) + [견적 보기](/app/bom).
    // 단건 주문도 체크 → [바로 주문] 문법으로 통일한다(상세 화면의 단건 주문은 별도 유지).
    function renderBomRow(q) {
        var canOrder = q.status === 'answered' && q.confirmedTotal !== null && q.orderState !== 'ordered';
        var supplyPrice = q.confirmedTotal !== null ? q.confirmedTotal : q.finalTotal;
        var payment = supplyPrice === null ? null : vatExcludedBreakdown(supplyPrice);
        var chkId = 'sp-bom-check-' + q.id;

        var li = document.createElement('li');
        li.className = 'sp-cart-item sp-quotes__item' + (canOrder ? '' : ' sp-quotes__item--locked');
        li.dataset.type = 'bom';
        li.innerHTML =
            '<span class="sp-chk sp-cart-item-chk">' +
                '<input type="checkbox" class="sp-bom__check selec_chk" id="' + chkId + '" value="' + q.id + '" data-price="' + (q.confirmedTotal === null ? '' : payment.total) + '"' + (canOrder ? '' : ' disabled') + '>' +
                '<label for="' + chkId + '"><span></span><b class="sound_only">선택</b></label>' +
            '</span>' +
            '<span class="sp-cart-thumb">' + (THUMBS.bom || '') + '</span>' +
            '<div class="sp-cart-info">' +
                '<span class="prd_name"><a class="sp-bom__name" href="<?php echo G5_URL; ?>/app/bom/' + q.id + '"><b></b></a></span>' +
                '<div class="sp-cart-meta">' +
                    '<span>부품 BOM</span>' +
                    '<span>품목 ' + q.includedCount + '/' + q.itemCount + '종</span>' +
                    (q.requestedAt ? '<span>요청 ' + fmtDate(q.requestedAt) + '</span>' : '<span>수정 ' + fmtDate(q.updatedAt) + '</span>') +
                '</div>' +
                '<div class="sp-quotes__badges">' +
                    badge('부품', 'type') +
                    badge(BOM_STATUS_LABEL[q.status] || q.status, q.status === 'answered' ? 'quoted' : q.status) +
                    badge(CART_LABEL[q.orderState], 'cart') +
                '</div>' +
            '</div>' +
            '<div class="sp-cart-calc">' +
                (payment !== null && payment.total > 0
                    ? '<strong class="sp-cart-sum">' + fmtNum(payment.total) + '원</strong>' +
                      '<span class="sp-quotes__tax-detail">VAT 포함 · ' + (q.confirmedTotal !== null ? '확정' : '예상') + ' 공급가 ' + fmtNum(payment.supply) + '원 + 부가세 ' + fmtNum(payment.vat) + '원</span>'
                    : '<span class="sp-quotes__pending">금액 산정 전</span>') +
                '<div class="sp-bom__acts">' +
                    (q.orderState === 'canceled'
                        ? '<span class="sp-quotes__pending">이전 주문 취소 — 다시 주문할 수 있습니다</span>' : '') +
                    // 회신 완료인데 확정가가 없으면 체크가 잠긴 이유를 보여준다(D16-1 게이트)
                    (q.status === 'answered' && q.confirmedTotal === null && q.orderState !== 'ordered'
                        ? '<span class="sp-quotes__pending">확정가 안내 후 주문 가능</span>' : '') +
                    '<a class="sp-btn" href="<?php echo G5_URL; ?>/app/bom/' + q.id + '">견적 보기</a>' +
                '</div>' +
            '</div>';
        li.querySelector('.sp-bom__name b').textContent = q.title; // XSS 안전 주입
        return li;
    }

    // ── 통합 렌더 — 두 트랙을 최신순으로 섞고, 실패한 트랙은 상태줄로 안내 ──────
    function render(pcbItems, bomItems, loadErrors) {
        rowsEl.innerHTML = '';
        var rows = [];
        pcbItems.forEach(function (it) {
            rows.push({ date: it.createdAt || '', el: renderPcbRow(it) });
        });
        bomItems.forEach(function (q) {
            rows.push({ date: q.requestedAt || q.updatedAt || '', el: renderBomRow(q) });
        });
        rows.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });

        statusEl.textContent = (loadErrors && loadErrors.length > 0) ? loadErrors.join(' · ') : '';
        if (rows.length === 0) {
            emptyEl.hidden = loadErrors && loadErrors.length > 0; // 오류면 빈 안내 대신 상태줄
            formEl.hidden = true;
            return;
        }
        emptyEl.hidden = true;
        formEl.hidden = false;
        rows.forEach(function (row) { rowsEl.appendChild(row.el); });
        applyFilter(currentFilter);
    }

    // ── 유형 필터 — 숨겨지는 행의 체크는 해제해 요약·주문 대상과 어긋나지 않게 ──
    function applyFilter(key) {
        currentFilter = key;
        rowsEl.querySelectorAll('li[data-type]').forEach(function (li) {
            var visible = key === 'all' || li.dataset.type === key;
            li.hidden = !visible;
            if (!visible) {
                li.querySelectorAll('input[type=checkbox]:checked').forEach(function (cb) { cb.checked = false; });
            }
        });
        document.querySelectorAll('#sp-quotes-filters .sp-quotes-tab').forEach(function (btn) {
            btn.classList.toggle('is-active', btn.dataset.filter === key);
        });
        updateSummary();
    }
    document.getElementById('sp-quotes-filters').addEventListener('click', function (ev) {
        var btn = ev.target.closest('.sp-quotes-tab');
        if (btn) { applyFilter(btn.dataset.filter); }
    });

    // 보이는(필터 통과) 행의 체크박스만 — PCB(.sp-quotes__check)·BOM(.sp-bom__check) 공용
    function visibleChecks(selector) {
        return Array.prototype.filter.call(rowsEl.querySelectorAll(selector), function (cb) {
            return !cb.closest('li').hidden;
        });
    }

    // 선택 변경 → 요약 패널(건수·합계)·전체선택 동기화.
    // PCB 체크는 주문·삭제 공용이라 가격 없는(rfq) 항목도 섞일 수 있음 —
    // 합계는 가격 있는 항목만 합산하고, 건수는 "선택 n건 (주문 가능 m건)" 으로 구분 표기.
    function updateSummary() {
        var all = visibleChecks('.sp-quotes__check:not(:disabled), .sp-bom__check:not(:disabled)');
        var checked = visibleChecks('.sp-quotes__check:checked, .sp-bom__check:checked');
        var total = 0;
        var orderableCnt = 0;
        checked.forEach(function (cb) {
            if (cb.dataset.price !== '') {
                total += parseInt(cb.dataset.price, 10);
                orderableCnt++;
            }
        });

        var countText = checked.length + '건' + (orderableCnt < checked.length ? ' (주문 가능 ' + orderableCnt + '건)' : '');
        var totalText = fmtNum(total);
        document.getElementById('sp-quotes-count').textContent = countText;
        document.getElementById('sp-quotes-total').textContent = totalText;
        document.getElementById('sp-quotes-mobile-count').textContent = countText;
        document.getElementById('sp-quotes-mobile-total').textContent = totalText;
        document.getElementById('sp_sel_cnt').textContent = checked.length + '/' + all.length;
        document.getElementById('sp-quotes-check-all').checked = all.length > 0 && all.length === checked.length;
    }

    function load() {
        return refreshToken()
            .then(function () {
                // 두 트랙 병렬 조회 — 한쪽이 실패해도 다른 쪽은 렌더한다
                return Promise.all([
                    api('GET', '').then(function (r) {
                        if (!r.ok) { throw new Error(errMsg(r.json)); }
                        return r.json.data.items;
                    }).catch(function (e) { return { error: e.message }; }),
                    bomApi('GET', '?page=1&pageSize=50').then(function (r) {
                        if (!r.ok) { throw new Error(errMsg(r.json)); }
                        return r.json.data.items;
                    }).catch(function (e) { return { error: e.message }; })
                ]);
            })
            .then(function (res) {
                var errs = [];
                var pcb = Array.isArray(res[0]) ? res[0] : (errs.push('PCB 견적을 불러오지 못했습니다: ' + res[0].error), []);
                var bom = Array.isArray(res[1]) ? res[1] : (errs.push('부품 BOM 견적을 불러오지 못했습니다: ' + res[1].error), []);
                render(pcb, bom, errs);
            })
            .catch(function (e) {
                statusEl.textContent = '목록을 불러오지 못했습니다: ' + e.message;
            });
    }

    // 수량 변경 → 서버 재견적 (가격은 항상 서버 계산) — PCB 행 전용 기능
    rowsEl.addEventListener('change', function (ev) {
        var input = ev.target;
        if (!input.classList.contains('sp-quotes__qty')) { return; }
        var qty = parseInt(input.value, 10);
        if (!(qty > 0)) { input.value = input.dataset.prev; return; }
        refreshToken()
            .then(function () { return api('PATCH', '/' + input.dataset.id, { qty: qty }); })
            .then(function (r) {
                if (!r.ok) {
                    alert(errMsg(r.json));
                    input.value = input.dataset.prev;
                    return;
                }
                load(); // 가격·상태가 함께 바뀌므로 목록 재조회
            });
    });

    // 견적 삭제 — cart.php 와 동일한 툴바 [선택삭제]/[비우기] 방식. **PCB 전용**
    // (부품 BOM 삭제·수정은 /app/bom 담당 — BOM 체크가 섞여 있으면 제외 안내).
    // 소프트 삭제(status='deleted' → "지난 견적" 보관함). 삭제 가능 = 보관(none) 상태만 —
    // 담김(cart)은 대상에서 제외하고 안내(서버 409 는 백스톱), 주문됨은 체크 자체가 잠김.
    function deleteQuotes(checkboxes, emptyMsg, bomCheckedCnt) {
        var targets = [];
        var excludedCart = 0;
        Array.prototype.forEach.call(checkboxes, function (cb) {
            if (cb.dataset.cartstate === 'none') { targets.push(parseInt(cb.value, 10)); }
            else if (cb.dataset.cartstate === 'cart') { excludedCart++; }
        });
        var notes = [];
        if (bomCheckedCnt > 0) { notes.push('부품 BOM 견적 ' + bomCheckedCnt + '건은 여기서 삭제할 수 없어 제외되었습니다(스마트 BOM에서 관리).'); }
        if (excludedCart > 0) { notes.push('장바구니에 담긴 항목 ' + excludedCart + '건은 제외되었습니다.'); }
        if (targets.length === 0) {
            alert(notes.length > 0 ? notes.join('\n') : emptyMsg);
            return;
        }
        if (!confirm('삭제한 견적은 "지난 견적" 보관함으로 이동됩니다. ' + targets.length + '건을 삭제할까요?')) { return; }
        refreshToken().then(function () {
            var failed = [];
            return targets.reduce(function (chain, id) {
                return chain.then(function () {
                    return api('DELETE', '/' + id).then(function (r) {
                        if (!r.ok) { failed.push({ id: id, error: (r.json && r.json.error) || '' }); }
                    });
                });
            }, Promise.resolve()).then(function () {
                if (failed.length > 0) { notes.push('일부 항목을 삭제하지 못했습니다:\n' + failedMsgs(failed)); }
                if (notes.length > 0) { alert(notes.join('\n')); }
                load();
            });
        });
    }

    document.getElementById('sp-quotes-del-sel').addEventListener('click', function () {
        deleteQuotes(
            visibleChecks('.sp-quotes__check:checked'),
            '삭제하실 PCB 견적을 하나 이상 선택해 주십시오.',
            visibleChecks('.sp-bom__check:checked').length
        );
    });

    document.getElementById('sp-quotes-del-all').addEventListener('click', function () {
        deleteQuotes(
            visibleChecks('.sp-quotes__check:not(:disabled)'),
            '삭제할 수 있는 PCB 견적이 없습니다.',
            0
        );
    });

    // 전체 선택 — 현재 필터에 보이는 행만
    document.getElementById('sp-quotes-check-all').addEventListener('change', function (ev) {
        visibleChecks('.sp-quotes__check:not(:disabled), .sp-bom__check:not(:disabled)').forEach(function (cb) {
            cb.checked = ev.target.checked;
        });
        updateSummary();
    });

    // 개별 선택 → 요약 갱신
    rowsEl.addEventListener('change', function (ev) {
        if (!ev.target.classList.contains('sp-quotes__check') && !ev.target.classList.contains('sp-bom__check')) { return; }
        updateSummary();
    });

    function failedMsgs(failed) {
        return (failed || []).map(function (f) {
            return '견적 ' + (f.projectId || f.quoteId || f.id) + ': ' + (ERROR_MSG[f.error] || f.error);
        }).join('\n');
    }

    // ── 바로 주문 — 같은 유형끼리만(D17: PCB+BOM 혼합 결제 금지) ────────────────
    // PCB: 배치 담기 + ct_select → 주문서. BOM: 배치 담기(각 견적 = 통째 1행) → 주문서.
    function orderSelectedQuotes() {
        var pcbChecked = visibleChecks('.sp-quotes__check:checked');
        var bomChecked = visibleChecks('.sp-bom__check:checked');
        if (pcbChecked.length === 0 && bomChecked.length === 0) {
            alert('주문할 견적을 선택해 주세요.');
            return;
        }
        if (pcbChecked.length > 0 && bomChecked.length > 0) {
            alert('PCB 견적과 부품 BOM 견적은 별도 주문으로 진행됩니다.\n같은 유형끼리만 선택해 주세요.');
            return;
        }

        if (bomChecked.length > 0) {
            var bomIds = bomChecked.map(function (cb) { return String(cb.value); });
            refreshToken().then(function () {
                return bomApi('POST', '/order', { ids: bomIds });
            }).then(function (r) {
                if (!r.ok) {
                    var detail = failedMsgs(r.json && r.json.failed);
                    alert(errMsg(r.json) + (detail ? '\n' + detail : ''));
                    load();
                    return;
                }
                var failed = r.json.data.failed;
                if (failed && failed.length > 0) {
                    alert('일부 견적은 주문에서 제외되었습니다:\n' + failedMsgs(failed));
                }
                location.href = r.json.data.redirectUrl;
            });
            return;
        }

        // PCB — 체크가 주문·삭제 공용이라 가격 없는(rfq) 항목은 여기서 걸러 안내 후 진행
        var ids = [];
        var pendingCnt = 0;
        pcbChecked.forEach(function (cb) {
            if (cb.dataset.price !== '') { ids.push(parseInt(cb.value, 10)); }
            else { pendingCnt++; }
        });
        if (ids.length === 0) { alert('주문 가능한 항목이 없습니다.'); return; }
        if (pendingCnt > 0 && !confirm('견적 대기 항목 ' + pendingCnt + '건은 주문에서 제외됩니다. 계속할까요?')) { return; }

        refreshToken().then(function () {
            return api('POST', '/order', { ids: ids });
        }).then(function (r) {
            if (!r.ok) {
                var detail = failedMsgs(r.json && r.json.failed);
                alert(errMsg(r.json) + (detail ? '\n' + detail : ''));
                load();
                return;
            }
            var failed = r.json.data.failed;
            if (failed && failed.length > 0) {
                alert('일부 항목은 주문에서 제외되었습니다:\n' + failedMsgs(failed));
            }
            location.href = r.json.data.redirectUrl;
        });
    }
    document.querySelectorAll('.js-sp-quotes-direct').forEach(function (button) {
        button.addEventListener('click', orderSelectedQuotes);
    });

    if (location.hash === '#bom') { currentFilter = 'bom'; applyFilter('bom'); }
    load();
})();
</script>

    </div><!-- /.account-main -->
</div><!-- /.account-layout -->

<?php
include_once(G5_THEME_PATH . '/tail.php');
