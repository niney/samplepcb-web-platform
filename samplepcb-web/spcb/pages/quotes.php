<?php
// samplepcb 견적관리 — 거버 PCB 프로젝트(견적) 목록·수량수정·주문
// URL: /shop/quotes (정식, 루트 .htaccess 3번 규칙) · /quotes (2번 규칙 별칭)
//
// 구조: 이 페이지는 셸(테마 레이아웃 + 인증 유도)만 담당하고,
// 데이터는 브라우저 JS 가 같은 도메인의 sp-node API(/api/pcb-projects)를 호출한다.
//   인증: GET /spcb/api/me (세션→JWT 브리지) → Authorization: Bearer
//   바로 주문: POST /api/pcb-projects/order (배치 담기+ct_select 선택) → /shop/orderform.php
//   수량: PATCH /api/pcb-projects/{id} (서버 재견적; 확정/담김 상태는 거부)
//   삭제: DELETE /api/pcb-projects/{id} (소프트 삭제 → "지난 견적" 보관함; 담김/주문됨 거부)
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
?>

<link rel="stylesheet" href="<?php echo G5_THEME_CSS_URL; ?>/default_shop.css?ver=<?php echo G5_CSS_VER; ?>">

<div class="sp-quotes">
    <p class="sp-quotes__desc">
        거버 업로드로 접수한 PCB 프로젝트 목록입니다.
        견적가가 있는 프로젝트를 선택해 바로 주문할 수 있습니다.
    </p>

    <p class="sp-quotes__status" id="sp-quotes-status">불러오는 중…</p>

    <div class="sp-cart-empty sp-quotes__empty" id="sp-quotes-empty" hidden>
        <i class="fa fa-file-text-o" aria-hidden="true"></i>
        <p>접수된 견적이 없습니다.</p>
        <span class="sp-cart-empty-sub">거버 파일을 업로드하면 자동 견적을 받아볼 수 있습니다.</span>
    </div>

    <form class="sp-quotes__form" id="sp-quotes-form" onsubmit="return false;" hidden>
        <div class="sp-cart-body">

            <!-- 견적 목록 -->
            <section class="sp-cart-list">
                <h2 class="sound_only">견적 목록</h2>

                <div class="sp-cart-toolbar">
                    <span class="sp-chk">
                        <input type="checkbox" id="sp-quotes-check-all" class="selec_chk">
                        <label for="sp-quotes-check-all"><span></span>전체선택 <em id="sp_sel_cnt">0/0</em></label>
                    </span>
                </div>

                <ul class="sp-cart-items" id="sp-quotes-rows"></ul>
            </section>

            <!-- 주문 요약 -->
            <aside class="sp-cart-side">
                <div class="sp-cart-summary">
                    <h2>주문 요약</h2>
                    <dl class="sp-cart-summary-row">
                        <dt>선택 견적</dt>
                        <dd><span id="sp-quotes-count">0</span>건</dd>
                    </dl>
                    <dl class="sp-cart-summary-row sp-cart-summary-total">
                        <dt>선택 견적가 합계</dt>
                        <dd><strong id="sp-quotes-total">0</strong>원</dd>
                    </dl>
                    <p class="sp-cart-summary-note">
                        배송비는 주문서에서 계산됩니다.
                        선택한 견적만 주문서에 담기며, 수량을 바꾸면 서버가 다시 견적합니다(확정·담김 상태 제외).
                    </p>
                </div>

                <div class="sp-cart-act">
                    <button type="button" class="sp-btn sp-btn-primary btn_submit" id="sp-quotes-direct">바로 주문</button>
                </div>
            </aside>

        </div>
    </form>
</div>

<script>
(function () {
    'use strict';

    var API_BASE = '/api/pcb-projects';
    var statusEl = document.getElementById('sp-quotes-status');
    var emptyEl = document.getElementById('sp-quotes-empty');
    var formEl = document.getElementById('sp-quotes-form');
    var rowsEl = document.getElementById('sp-quotes-rows');
    var token = null;

    var QUOTE_LABEL = { rfq: '견적 대기', priced: '자동견적', quoted: '견적 확정' };
    var CART_LABEL = { none: '', cart: '장바구니 담김', ordered: '주문됨' };
    var ERROR_MSG = {
        QUOTE_FINALIZED: '확정된 견적은 수량을 변경할 수 없습니다. 재견적이 필요하면 문의해 주세요.',
        IN_CART: '장바구니에 담긴 프로젝트입니다. 장바구니에서 삭제한 뒤 다시 시도해 주세요.',
        ALREADY_ORDERED: '이미 주문된 프로젝트입니다.',
        NOT_PRICED: '견적가가 아직 없습니다. 견적 확정 후 주문할 수 있습니다.',
        NOT_FOUND: '프로젝트를 찾을 수 없습니다.',
        NO_ORDERABLE_ITEMS: '주문 가능한 항목이 없습니다.',
        CART_INSERT_FAILED: '장바구니 담기에 실패했습니다.',
        TEMPLATE_ITEM_MISSING: '상품 설정 오류입니다. 관리자에게 문의해 주세요.'
    };

    function fmtNum(n) { return n.toLocaleString('ko-KR'); }
    function fmtDate(iso) { return iso ? iso.slice(0, 10) : '-'; }
    function errMsg(body) {
        return (body && ERROR_MSG[body.error]) || (body && (body.message || body.error)) || '요청에 실패했습니다.';
    }

    function api(method, path, body) {
        return fetch(API_BASE + path, {
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

    function render(items) {
        rowsEl.innerHTML = '';
        if (items.length === 0) {
            statusEl.textContent = '';
            emptyEl.hidden = false;
            formEl.hidden = true;
            return;
        }
        statusEl.textContent = '';
        emptyEl.hidden = true;
        formEl.hidden = false;

        items.forEach(function (it) {
            // 담김(cart) 카드도 바로 주문 대상 — 서버가 기존 cart 행을 재사용한다
            var orderable = it.price !== null && it.cartState !== 'ordered';
            var qtyEditable = it.quoteStatus !== 'quoted' && it.cartState === 'none';
            // 삭제는 보관(none) 상태만 — 담김/주문됨은 서버도 409 로 거부(수량 수정과 동일 정책)
            var deletable = it.cartState === 'none';
            var delTitle = deletable ? '삭제'
                : (it.cartState === 'cart' ? '장바구니에서 먼저 삭제해 주세요' : '주문된 견적은 삭제할 수 없습니다');
            var chkId = 'sp-quotes-check-' + it.projectId;

            var li = document.createElement('li');
            li.className = 'sp-cart-item sp-quotes__item' + (orderable ? '' : ' sp-quotes__item--locked');
            li.innerHTML =
                '<span class="sp-chk sp-cart-item-chk">' +
                    '<input type="checkbox" class="sp-quotes__check selec_chk" id="' + chkId + '" value="' + it.projectId + '" data-price="' + (it.price === null ? '' : it.price) + '"' + (orderable ? '' : ' disabled') + '>' +
                    '<label for="' + chkId + '"><span></span><b class="sound_only">선택</b></label>' +
                '</span>' +
                '<div class="sp-cart-info">' +
                    '<span class="prd_name"><b class="sp-quotes__name"></b></span>' +
                    '<div class="sp-cart-meta">' +
                        '<span class="sp-quotes__cat"></span>' +
                        '<span>' + (it.orderCategory === 'mass' ? '양산' : '샘플') + '</span>' +
                        (it.eta ? '<span>출고예정 ' + it.eta + '</span>' : '') +
                        '<span>접수 ' + fmtDate(it.createdAt) + '</span>' +
                    '</div>' +
                    '<div class="sp-quotes__badges">' +
                        badge(QUOTE_LABEL[it.quoteStatus], it.quoteStatus) +
                        badge(CART_LABEL[it.cartState], 'cart') +
                    '</div>' +
                '</div>' +
                '<div class="sp-cart-calc">' +
                    '<span class="sp-cart-qty sp-quotes__qty-label">수량' +
                        '<input type="number" class="sp-quotes__qty" min="1" value="' + it.qty + '"' + (qtyEditable ? '' : ' disabled') + ' data-id="' + it.projectId + '" data-prev="' + it.qty + '">' +
                    '</span>' +
                    (it.price === null
                        ? '<span class="sp-quotes__pending">견적 대기</span>'
                        : '<strong class="sp-cart-sum">' + fmtNum(it.price) + '원</strong>') +
                '</div>' +
                '<button type="button" class="sp-quotes__del" data-id="' + it.projectId + '"' + (deletable ? '' : ' disabled') + ' title="' + delTitle + '">' +
                    '<i class="fa fa-times" aria-hidden="true"></i><span class="sound_only">견적 삭제</span>' +
                '</button>';
            li.querySelector('.sp-quotes__name').textContent = it.projectName; // XSS 안전 주입
            li.querySelector('.sp-quotes__cat').textContent = it.category;
            rowsEl.appendChild(li);
        });

        updateSummary();
    }

    // 선택 변경 → 요약 패널(건수·합계)·전체선택 동기화
    function updateSummary() {
        var all = rowsEl.querySelectorAll('.sp-quotes__check:not(:disabled)');
        var checked = rowsEl.querySelectorAll('.sp-quotes__check:checked');
        var total = 0;
        checked.forEach(function (cb) { total += parseInt(cb.dataset.price || '0', 10); });

        document.getElementById('sp-quotes-count').textContent = String(checked.length);
        document.getElementById('sp-quotes-total').textContent = fmtNum(total);
        document.getElementById('sp_sel_cnt').textContent = checked.length + '/' + all.length;
        document.getElementById('sp-quotes-check-all').checked = all.length > 0 && all.length === checked.length;
    }

    function load() {
        return refreshToken()
            .then(function () { return api('GET', ''); })
            .then(function (r) {
                if (!r.ok) { throw new Error(errMsg(r.json)); }
                render(r.json.data.items);
            })
            .catch(function (e) {
                statusEl.textContent = '목록을 불러오지 못했습니다: ' + e.message;
            });
    }

    // 수량 변경 → 서버 재견적 (가격은 항상 서버 계산)
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

    // 견적 삭제 — 소프트 삭제(status='deleted' → "지난 견적" 보관함), 목록에서만 사라짐
    rowsEl.addEventListener('click', function (ev) {
        var btn = ev.target.closest ? ev.target.closest('.sp-quotes__del') : null;
        if (!btn || btn.disabled) { return; }
        if (!confirm('삭제한 견적은 "지난 견적" 보관함으로 이동됩니다. 삭제할까요?')) { return; }
        refreshToken()
            .then(function () { return api('DELETE', '/' + btn.dataset.id); })
            .then(function (r) {
                if (!r.ok) { alert(errMsg(r.json)); return; }
                load();
            });
    });

    // 전체 선택
    document.getElementById('sp-quotes-check-all').addEventListener('change', function (ev) {
        rowsEl.querySelectorAll('.sp-quotes__check:not(:disabled)').forEach(function (cb) {
            cb.checked = ev.target.checked;
        });
        updateSummary();
    });

    // 개별 선택 → 요약 갱신
    rowsEl.addEventListener('change', function (ev) {
        if (!ev.target.classList.contains('sp-quotes__check')) { return; }
        updateSummary();
    });

    function selectedIds() {
        return Array.prototype.map.call(
            rowsEl.querySelectorAll('.sp-quotes__check:checked'),
            function (cb) { return parseInt(cb.value, 10); }
        );
    }

    function failedMsgs(failed) {
        return (failed || []).map(function (f) {
            return '프로젝트 ' + f.projectId + ': ' + (ERROR_MSG[f.error] || f.error);
        }).join('\n');
    }

    // 바로 주문 — 배치 담기 + 행 단위 주문 선택(ct_select) 후 주문서로 직행
    document.getElementById('sp-quotes-direct').addEventListener('click', function () {
        var ids = selectedIds();
        if (ids.length === 0) { alert('주문할 프로젝트를 선택해 주세요.'); return; }

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
    });

    load();
})();
</script>

<?php
include_once(G5_THEME_PATH . '/tail.php');
