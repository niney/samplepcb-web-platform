<?php
// samplepcb 지난 견적 보관함 — 삭제된 거버 PCB 프로젝트(견적) 목록·영구 삭제
// URL: /shop/quotes/archive (정식, 루트 .htaccess) · /quotes-archive (슬러그 규칙 별칭)
//
// 들어오는 경로 두 가지 (둘 다 status='deleted' — 서버 pcb-projects.ts 참조):
//   ① 견적관리에서 [선택삭제]/[비우기] → DELETE API 소프트 삭제
//   ② 장바구니(코어 cartupdate)에서 삭제 → 목록 조회 시점 지연 반영(lazy reconcile)
//
// 영구 삭제(복원 없음): DELETE /api/pcb-projects/{id} — status='deleted' 건은 하드 삭제
// (실파일·sp_file·옵션 행·sp_quote·spec 파기). 확인은 alert 가 아닌 레이어 팝업(.sp-modal)로,
// 복구 불가를 명시한다. 파일서버 실패 시 spec 이 보존되므로 재클릭 = 재시도.
//
// 구조·디자인은 quotes.php 와 동일한 셸 + JS 렌더링(cart 카드 문법 재사용).

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $is_member, 테마 상수

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode(G5_URL . '/shop/quotes/archive'));
}

$g5['title'] = '지난 견적 보관함';
include_once(G5_THEME_PATH . '/head.php');

// 카드 썸네일 — quotes.php/cart.php 와 동일한 템플릿 상품 이미지.
// category → it_id 매핑은 sp-node g5-db.ts TEMPLATE_ITEMS 와 동일하게 유지할 것.
$sp_quote_thumbs = array();
foreach (array(
    'standard'  => 'sp-pcb-std',
    'metalmask' => 'sp-mask',
    'advance'   => 'sp-pcb-adv',
    'flexible'  => 'sp-pcb-flex',
) as $sp_cat => $sp_it_id) {
    $sp_quote_thumbs[$sp_cat] = get_it_image($sp_it_id, 96, 96);
}
?>

<link rel="stylesheet" href="<?php echo G5_THEME_CSS_URL; ?>/default_shop.css?ver=<?php echo G5_CSS_VER; ?>">

<div class="sp-quotes">
    <p class="sp-quotes__desc">
        견적관리 또는 장바구니에서 삭제한 견적이 보관되는 곳입니다.
        여기서 [영구 삭제]하면 거버 파일을 포함해 완전히 삭제되며 복구할 수 없습니다.
        <a href="<?php echo G5_URL; ?>/shop/quotes">견적관리로 돌아가기</a>
    </p>

    <p class="sp-quotes__status" id="sp-quotes-status">불러오는 중…</p>

    <div class="sp-cart-empty sp-quotes__empty" id="sp-quotes-empty" hidden>
        <i class="fa fa-archive" aria-hidden="true"></i>
        <p>보관된 견적이 없습니다.</p>
        <span class="sp-cart-empty-sub">견적관리나 장바구니에서 삭제한 견적이 이곳에 보관됩니다.</span>
        <?php /* 보관함이 비면 되돌아갈 곳 안내 — cart·견적관리 빈 화면과 같은 텍스트 링크 표현 */ ?>
        <span class="sp-cart-empty-sub">
            진행 중인 견적은 <a href="<?php echo G5_URL; ?>/shop/quotes">견적관리</a>에서 확인할 수 있습니다.
        </span>
    </div>

    <form class="sp-quotes__form" id="sp-quotes-form" onsubmit="return false;" hidden>
        <div class="sp-cart-body">
            <section class="sp-cart-list">
                <h2 class="sound_only">지난 견적 목록</h2>

                <div class="sp-cart-toolbar">
                    <span class="sp-chk">
                        <input type="checkbox" id="sp-quotes-check-all" class="selec_chk">
                        <label for="sp-quotes-check-all"><span></span>전체선택 <em id="sp_sel_cnt">0/0</em></label>
                    </span>
                    <div class="sp-cart-toolbar-btns btn_cart_del">
                        <button type="button" id="sp-archive-del-sel">선택 영구 삭제</button>
                        <button type="button" id="sp-archive-del-all">비우기</button>
                    </div>
                </div>

                <ul class="sp-cart-items" id="sp-quotes-rows"></ul>
            </section>
        </div>
    </form>
</div>

<?php /* 영구 삭제 확인 레이어 — alert 대체. 복구 불가 경고를 명시적으로 보여준다 */ ?>
<div class="sp-modal" id="sp-archive-modal" hidden>
    <div class="sp-modal__dim" data-modal-close></div>
    <div class="sp-modal__box" role="alertdialog" aria-modal="true" aria-labelledby="sp-archive-modal-title" aria-describedby="sp-archive-modal-desc">
        <h3 class="sp-modal__title" id="sp-archive-modal-title">
            <i class="fa fa-exclamation-triangle" aria-hidden="true"></i> 영구 삭제
        </h3>
        <p class="sp-modal__desc" id="sp-archive-modal-desc"></p>
        <p class="sp-modal__warn">거버 파일을 포함한 모든 데이터가 삭제되며, <strong>복구할 수 없습니다.</strong></p>
        <div class="sp-modal__btns">
            <button type="button" class="sp-btn sp-modal__cancel" data-modal-close>취소</button>
            <button type="button" class="sp-btn sp-btn-danger" id="sp-archive-modal-ok">영구 삭제</button>
        </div>
    </div>
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

    // category(소문자) → 템플릿 상품 썸네일 HTML (서버 생성 — 신뢰 가능)
    var THUMBS = <?php echo json_encode(array_map('strval', $sp_quote_thumbs), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); ?>;

    var QUOTE_LABEL = { rfq: '견적 대기', priced: '자동견적', quoted: '견적 확정' };
    var ERROR_MSG = {
        FILE_DELETE_FAILED: '파일 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        NOT_FOUND: '프로젝트를 찾을 수 없습니다.'
    };

    function fmtNum(n) { return n.toLocaleString('ko-KR'); }
    function fmtDate(iso) { return iso ? iso.slice(0, 10) : '-'; }
    function errMsg(body) {
        return (body && ERROR_MSG[body.error]) || (body && (body.message || body.error)) || '요청에 실패했습니다.';
    }

    function api(method, path) {
        return fetch(API_BASE + path, {
            method: method,
            headers: { 'Authorization': 'Bearer ' + token }
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
            var chkId = 'sp-archive-check-' + it.projectId;
            var li = document.createElement('li');
            li.className = 'sp-cart-item sp-quotes__item sp-quotes__item--locked';
            li.innerHTML =
                '<span class="sp-chk sp-cart-item-chk">' +
                    '<input type="checkbox" class="sp-quotes__check selec_chk" id="' + chkId + '" value="' + it.projectId + '">' +
                    '<label for="' + chkId + '"><span></span><b class="sound_only">선택</b></label>' +
                '</span>' +
                // 거버 썸네일(서명 프록시 URL — sp-node 발급이라 신뢰 가능), 없으면 템플릿 이미지 폴백
                '<span class="sp-cart-thumb">' + (it.thumbnailUrl
                    ? '<img src="' + it.thumbnailUrl + '" alt="">'
                    : (THUMBS[String(it.category).toLowerCase()] || '')) + '</span>' +
                '<div class="sp-cart-info">' +
                    '<span class="prd_name"><b class="sp-quotes__name"></b></span>' +
                    '<div class="sod_opt"><ul><li class="sp-quotes__opt"></li></ul></div>' +
                    '<div class="sp-cart-meta">' +
                        '<span class="sp-quotes__cat"></span>' +
                        '<span>' + (it.orderCategory === 'mass' ? '양산' : '샘플') + '</span>' +
                        '<span>접수 ' + fmtDate(it.createdAt) + '</span>' +
                    '</div>' +
                    '<div class="sp-quotes__badges">' +
                        badge(QUOTE_LABEL[it.quoteStatus], it.quoteStatus) +
                        badge('보관됨', 'cart') +
                    '</div>' +
                '</div>' +
                '<div class="sp-cart-calc">' +
                    '<span class="sp-cart-qty">수량 <strong>' + fmtNum(it.qty) + '</strong>개</span>' +
                    (it.price === null
                        ? '<span class="sp-quotes__pending">견적 대기</span>'
                        : '<strong class="sp-cart-sum">' + fmtNum(it.price) + '원</strong>') +
                '</div>';
            li.querySelector('.sp-quotes__name').textContent = it.projectName; // XSS 안전 주입
            li.querySelector('.sp-quotes__cat').textContent = it.category;
            li.querySelector('.sp-quotes__opt').textContent = it.optionSummary || '';
            rowsEl.appendChild(li);
        });

        updateSelCnt();
    }

    function updateSelCnt() {
        var all = rowsEl.querySelectorAll('.sp-quotes__check');
        var checked = rowsEl.querySelectorAll('.sp-quotes__check:checked');
        document.getElementById('sp_sel_cnt').textContent = checked.length + '/' + all.length;
        document.getElementById('sp-quotes-check-all').checked = all.length > 0 && all.length === checked.length;
    }

    function load() {
        return refreshToken()
            .then(function () { return api('GET', '?status=deleted'); })
            .then(function (r) {
                if (!r.ok) { throw new Error(errMsg(r.json)); }
                render(r.json.data.items);
            })
            .catch(function (e) {
                statusEl.textContent = '목록을 불러오지 못했습니다: ' + e.message;
            });
    }

    // ── 영구 삭제 확인 레이어 ────────────────────────────────────────────────
    var modalEl = document.getElementById('sp-archive-modal');
    var modalDescEl = document.getElementById('sp-archive-modal-desc');
    var modalOkEl = document.getElementById('sp-archive-modal-ok');
    var pendingIds = [];

    function openModal(ids) {
        pendingIds = ids;
        modalDescEl.textContent = '선택한 지난 견적 ' + ids.length + '건을 영구 삭제할까요?';
        modalEl.hidden = false;
        modalOkEl.focus();
    }

    function closeModal() {
        modalEl.hidden = true;
        pendingIds = [];
    }

    modalEl.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-modal-close]')) { closeModal(); }
    });
    document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape' && !modalEl.hidden) { closeModal(); }
    });

    modalOkEl.addEventListener('click', function () {
        var ids = pendingIds;
        closeModal();
        if (ids.length === 0) { return; }
        modalOkEl.disabled = true;
        refreshToken().then(function () {
            var failed = [];
            return ids.reduce(function (chain, id) {
                return chain.then(function () {
                    return api('DELETE', '/' + id).then(function (r) {
                        if (!r.ok) { failed.push(errMsg(r.json)); }
                    });
                });
            }, Promise.resolve()).then(function () {
                modalOkEl.disabled = false;
                if (failed.length > 0) {
                    statusEl.textContent = '일부 항목을 삭제하지 못했습니다: ' + failed[0];
                }
                load();
            });
        }).catch(function () {
            modalOkEl.disabled = false;
            statusEl.textContent = '요청에 실패했습니다. 잠시 후 다시 시도해 주세요.';
        });
    });

    function checkedIds(selector) {
        return Array.prototype.map.call(
            rowsEl.querySelectorAll(selector),
            function (cb) { return parseInt(cb.value, 10); }
        );
    }

    document.getElementById('sp-archive-del-sel').addEventListener('click', function () {
        var ids = checkedIds('.sp-quotes__check:checked');
        if (ids.length === 0) {
            statusEl.textContent = '삭제할 견적을 하나 이상 선택해 주세요.';
            return;
        }
        openModal(ids);
    });

    document.getElementById('sp-archive-del-all').addEventListener('click', function () {
        var ids = checkedIds('.sp-quotes__check');
        if (ids.length === 0) { return; }
        openModal(ids);
    });

    // 전체 선택
    document.getElementById('sp-quotes-check-all').addEventListener('change', function (ev) {
        rowsEl.querySelectorAll('.sp-quotes__check').forEach(function (cb) {
            cb.checked = ev.target.checked;
        });
        updateSelCnt();
    });

    // 개별 선택 → 카운트 갱신
    rowsEl.addEventListener('change', function (ev) {
        if (!ev.target.classList.contains('sp-quotes__check')) { return; }
        updateSelCnt();
    });

    load();
})();
</script>

<?php
include_once(G5_THEME_PATH . '/tail.php');
