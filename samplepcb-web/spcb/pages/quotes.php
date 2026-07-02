<?php
// samplepcb 견적관리 — 거버 PCB 프로젝트(견적) 목록·수량수정·주문
// URL: /shop/quotes (정식, 루트 .htaccess 3번 규칙) · /quotes (2번 규칙 별칭)
//
// 구조(뼈대): 이 페이지는 셸(테마 레이아웃 + 인증 유도)만 담당하고,
// 데이터는 브라우저 JS 가 같은 도메인의 sp-node API(/api/pcb-projects)를 호출한다.
//   인증: GET /spcb/api/me (세션→JWT 브리지) → Authorization: Bearer
//   주문: POST /api/pcb-projects/{id}/cart → g5_shop_cart 담김 → /shop/cart.php
//   수량: PATCH /api/pcb-projects/{id} (서버 재견적; 확정/담김 상태는 거부)
// ⚠ 디자인 미적용 상태 — 마크업 클래스(sp-quotes__*)만 잡아둠. cart.php 디자인과
//   같은 시각 문법으로 입힐 것.

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $is_member, 테마 상수

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode(G5_URL . '/shop/quotes'));
}

$g5['title'] = '견적관리';
include_once(G5_THEME_PATH . '/head.php');
?>

<div class="sp-quotes">
    <h1 class="sp-quotes__title">견적관리</h1>
    <p class="sp-quotes__desc">
        거버 업로드로 접수한 PCB 프로젝트 목록입니다.
        견적이 확정된 프로젝트는 선택하여 주문(장바구니 담기)할 수 있습니다.
    </p>

    <p class="sp-quotes__status" id="sp-quotes-status">불러오는 중…</p>

    <form class="sp-quotes__form" id="sp-quotes-form" onsubmit="return false;" hidden>
        <table class="sp-quotes__table">
            <thead>
                <tr>
                    <th><input type="checkbox" id="sp-quotes-check-all" title="전체 선택"></th>
                    <th>프로젝트</th>
                    <th>제품군</th>
                    <th>구분</th>
                    <th>수량</th>
                    <th>상태</th>
                    <th>견적가</th>
                    <th>출고예정</th>
                    <th>접수일</th>
                </tr>
            </thead>
            <tbody id="sp-quotes-rows"></tbody>
        </table>

        <div class="sp-quotes__actions">
            <button type="button" class="sp-quotes__order-btn" id="sp-quotes-order">선택 주문 (장바구니 담기)</button>
        </div>
    </form>
</div>

<script>
(function () {
    'use strict';

    var API_BASE = '/api/pcb-projects';
    var statusEl = document.getElementById('sp-quotes-status');
    var formEl = document.getElementById('sp-quotes-form');
    var rowsEl = document.getElementById('sp-quotes-rows');
    var token = null;

    var QUOTE_LABEL = { rfq: '견적 대기', priced: '자동견적', quoted: '견적 확정' };
    var CART_LABEL = { none: '', cart: '장바구니 담김', ordered: '주문됨' };
    var ERROR_MSG = {
        QUOTE_FINALIZED: '확정된 견적은 수량을 변경할 수 없습니다. 재견적이 필요하면 문의해 주세요.',
        IN_CART: '장바구니에 담긴 프로젝트입니다. 장바구니에서 삭제한 뒤 수정해 주세요.',
        ALREADY_IN_CART: '이미 장바구니에 담긴 프로젝트입니다.',
        ALREADY_ORDERED: '이미 주문된 프로젝트입니다.',
        NOT_PRICED: '견적가가 아직 없습니다. 견적 확정 후 주문할 수 있습니다.'
    };

    function fmtPrice(n) { return n === null ? '-' : n.toLocaleString('ko-KR') + '원'; }
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

    function render(items) {
        rowsEl.innerHTML = '';
        if (items.length === 0) {
            statusEl.textContent = '접수된 견적이 없습니다.';
            formEl.hidden = true;
            return;
        }
        statusEl.textContent = '';
        formEl.hidden = false;

        items.forEach(function (it) {
            var orderable = it.price !== null && it.cartState === 'none';
            var qtyEditable = it.quoteStatus !== 'quoted' && it.cartState === 'none';

            var tr = document.createElement('tr');
            tr.className = 'sp-quotes__row';
            tr.innerHTML =
                '<td><input type="checkbox" class="sp-quotes__check" value="' + it.projectId + '"' + (orderable ? '' : ' disabled') + '></td>' +
                '<td class="sp-quotes__name"></td>' +
                '<td>' + it.category + '</td>' +
                '<td>' + (it.orderCategory === 'mass' ? '양산' : '샘플') + '</td>' +
                '<td><input type="number" class="sp-quotes__qty" min="1" value="' + it.qty + '"' + (qtyEditable ? '' : ' disabled') + ' data-id="' + it.projectId + '" data-prev="' + it.qty + '"></td>' +
                '<td class="sp-quotes__state">' + QUOTE_LABEL[it.quoteStatus] + (CART_LABEL[it.cartState] ? ' · ' + CART_LABEL[it.cartState] : '') + '</td>' +
                '<td class="sp-quotes__price">' + fmtPrice(it.price) + '</td>' +
                '<td>' + (it.eta || '-') + '</td>' +
                '<td>' + fmtDate(it.createdAt) + '</td>';
            tr.querySelector('.sp-quotes__name').textContent = it.projectName; // XSS 안전 주입
            rowsEl.appendChild(tr);
        });
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

    // 전체 선택
    document.getElementById('sp-quotes-check-all').addEventListener('change', function (ev) {
        rowsEl.querySelectorAll('.sp-quotes__check:not(:disabled)').forEach(function (cb) {
            cb.checked = ev.target.checked;
        });
    });

    // 선택 주문 — 순차 담기 후 장바구니로 이동
    document.getElementById('sp-quotes-order').addEventListener('click', function () {
        var ids = Array.prototype.map.call(
            rowsEl.querySelectorAll('.sp-quotes__check:checked'),
            function (cb) { return cb.value; }
        );
        if (ids.length === 0) { alert('주문할 프로젝트를 선택해 주세요.'); return; }

        refreshToken().then(function () {
            var failed = [];
            return ids.reduce(function (chain, id) {
                return chain.then(function () {
                    return api('POST', '/' + id + '/cart').then(function (r) {
                        if (!r.ok) { failed.push(errMsg(r.json)); }
                    });
                });
            }, Promise.resolve()).then(function () {
                if (failed.length > 0) {
                    alert('일부 항목을 담지 못했습니다:\n' + failed.join('\n'));
                    if (failed.length === ids.length) { load(); return; }
                }
                location.href = '/shop/cart.php';
            });
        });
    });

    load();
})();
</script>

<?php
include_once(G5_THEME_PATH . '/tail.php');
