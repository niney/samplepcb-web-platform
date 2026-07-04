<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * sp-lite 장바구니 — 코어 shop/cart.php 가 G5_THEME_SHOP_PATH/cart.php 존재 시 include 후 return (코어 무수정 오버라이드).
 * 진입 시점에 $s_cart_id·$cart_action_url·$naverpay_button_js 준비 완료, before_check_cart_price 실행됨.
 * 기능 훅(form 이름·ct_chk·mod_options·#mod_option_frm·form_check 등)은 코어와 동일하게 유지.
 *
 * 거버 견적 행(템플릿 상품 4종)은 코어 GROUP BY(it_id) 를 풀어 **건별 카드**로 보여준다.
 * PCB 가격은 비선형이라 코어 수량변경(io_price×수량, 선형)이 틀리므로, 견적 행의
 * 수량변경·주문·삭제는 모두 ct_id 단위로 sp-node 를 경유한다(하단 JS):
 *   수량: PATCH /api/pcb-projects/{id}  (서버 재견적 → cart 행 io_price/ct_option 동기화)
 *   주문: POST  /api/pcb-projects/order (행 단위 ct_select → orderform 직행)
 *   삭제: DELETE /api/pcb-projects/{id} (cart 행 제거 → "지난 견적" 보관함)
 * 일반 상품(견적 템플릿이 아닌 행)이 섞이면 그 상품엔 코어 폼(form_check) 경로를 쓰되,
 * 코어(cartupdate)는 선택·삭제가 it_id 단위라 같은 템플릿의 미체크 견적까지 쓸어담는다:
 *   주문: 미체크 견적 ct_id 를 쿠키(sp_cart_deselect)로 전달 → orderform 진입 시
 *         extend/sp_quote_cart.extend.php 가 ct_select=0 보정
 *   삭제: 견적은 혼합 카트에서도 항상 sp-node DELETE 로 지우고, 코어 폼엔 일반 상품만 남긴다
 */

$g5['title'] = '장바구니';
include_once('./_head.php');

// 거버 견적 행(템플릿 상품) — sp-node g5-db.ts TEMPLATE_ITEMS 와 동일하게 유지.
$sp_quote_it_ids = array('sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex');
$sp_ph = implode(',', array_map(function ($x) { return "'" . sql_real_escape_string($x) . "'"; }, $sp_quote_it_ids));

$cart_items = array();
$tot_point = 0;
$tot_sell_price = 0;
$send_cost = 0;
$continue_ca_id = '';

// ── (1) 일반 상품 — 코어와 동일한 it_id 집계(견적 템플릿 제외) ──────────────
$sql = " select a.ct_id,
                a.it_id,
                a.it_name,
                a.ct_price,
                a.ct_point,
                a.ct_qty,
                a.ct_status,
                a.ct_send_cost,
                a.it_sc_type,
                b.ca_id,
                b.ca_id2,
                b.ca_id3
           from {$g5['g5_shop_cart_table']} a left join {$g5['g5_shop_item_table']} b on ( a.it_id = b.it_id )
          where a.od_id = '$s_cart_id'
            and a.it_id not in ($sp_ph)
          group by a.it_id
          order by a.ct_id ";
$result = sql_query($sql);
for ($i=0; $row=sql_fetch_array($result); $i++)
{
    $sum = sql_fetch(" select SUM(IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))) as price,
                              SUM(ct_point * ct_qty) as point,
                              SUM(ct_qty) as qty
                         from {$g5['g5_shop_cart_table']}
                        where it_id = '{$row['it_id']}'
                          and od_id = '$s_cart_id' ");

    if ($continue_ca_id === '') // 계속쇼핑
        $continue_ca_id = $row['ca_id'];

    switch($row['ct_send_cost']) {
        case 1:  $ct_send_cost = '착불'; break;
        case 2:  $ct_send_cost = '무료'; break;
        default: $ct_send_cost = '선불'; break;
    }

    if($row['it_sc_type'] == 2) {
        $sendcost = get_item_sendcost($row['it_id'], $sum['price'], $sum['qty'], $s_cart_id);
        if($sendcost == 0)
            $ct_send_cost = '무료';
    }

    $cart_items[] = array(
        'is_quote'   => false,
        'ct_id'      => $row['ct_id'],
        'it_id'      => $row['it_id'],
        'it_name'    => stripslashes($row['it_name']),
        'it_url'     => shop_item_url($row['it_id']),
        'image'      => get_it_image($row['it_id'], 96, 96),
        'options'    => print_item_options($row['it_id'], $s_cart_id),
        'qty'        => $sum['qty'],
        'ct_price'   => $row['ct_price'],
        'point'      => $sum['point'],
        'send_label' => $ct_send_cost,
        'sell_price' => $sum['price'],
    );

    $tot_point      += $sum['point'];
    $tot_sell_price += $sum['price'];
}

// ── (2) 거버 견적 행 — 건별(ct_id) 카드. GROUP BY 를 풀어 각 견적을 따로 보여준다 ──
// 견적 행은 ct_price=0, 가격은 io_price(견적 총액), ct_qty=1. 실수량·projectId 는
// 하단 JS 가 sp-node(/cart-items)에서 받아 카드의 수량 입력을 채운다.
$sqlq = " select a.ct_id,
                 a.it_id,
                 a.it_name,
                 a.ct_price,
                 a.ct_send_cost,
                 a.io_price,
                 a.ct_option,
                 b.ca_id
            from {$g5['g5_shop_cart_table']} a left join {$g5['g5_shop_item_table']} b on ( a.it_id = b.it_id )
           where a.od_id = '$s_cart_id'
             and a.it_id in ($sp_ph)
           order by a.ct_id ";
$resultq = sql_query($sqlq);
for ($i=0; $row=sql_fetch_array($resultq); $i++)
{
    $price = (int) $row['ct_price'] + (int) $row['io_price']; // ct_qty=1 → 행 총액 = io_price

    if ($continue_ca_id === '')
        $continue_ca_id = $row['ca_id'];

    switch($row['ct_send_cost']) {
        case 1:  $ct_send_cost = '착불'; break;
        case 2:  $ct_send_cost = '무료'; break;
        default: $ct_send_cost = '선불'; break;
    }

    $cart_items[] = array(
        'is_quote'   => true,
        'ct_id'      => $row['ct_id'],
        'it_id'      => $row['it_id'],
        'it_name'    => stripslashes($row['it_name']),
        'it_url'     => G5_URL.'/shop/quotes',
        'image'      => get_it_image($row['it_id'], 96, 96), // JS 가 거버 썸네일로 교체
        'options'    => $row['ct_option'], // 사양 요약 문자열 (buildOptionSummary)
        'qty'        => 1, // 표시용 초기값 — JS 가 실수량으로 교체
        'ct_price'   => $row['ct_price'],
        'point'      => 0,
        'send_label' => $ct_send_cost,
        'sell_price' => $price,
    );

    $tot_sell_price += $price;
}

$cart_count = count($cart_items);
if ($cart_count)
    $send_cost = get_sendcost($s_cart_id, 0); // 배송비 계산

$tot_price = $tot_sell_price + $send_cost; // 총계 = 주문상품금액합계 + 배송비
?>

<!-- 장바구니 시작 { -->
<script src="<?php echo G5_JS_URL; ?>/shop.js?ver=<?php echo G5_JS_VER; ?>"></script>
<script src="<?php echo G5_JS_URL; ?>/shop.override.js?ver=<?php echo G5_JS_VER; ?>"></script>

<style>
.sp-cart-qty-input{width:4.5em;padding:.25rem .4rem;text-align:center;border:1px solid #d0d5dd;border-radius:6px;font-size:14px;}
.sp-cart-qty-input:disabled{background:#f2f4f7;color:#98a2b3;cursor:not-allowed;}
.sp-cart-item--quote .sp-cart-qty{display:flex;align-items:center;gap:.4rem;}
</style>

<div id="sod_bsk" class="od_prd_list">

    <form name="frmcartlist" id="sod_bsk_list" class="2017_renewal_itemform" method="post" action="<?php echo $cart_action_url; ?>">

    <?php if (!$cart_count) { ?>

    <div class="sp-cart-empty">
        <i class="fa fa-shopping-cart" aria-hidden="true"></i>
        <p>장바구니에 담긴 상품이 없습니다.</p>
        <span class="sp-cart-empty-sub">원하는 상품을 담아 한 번에 주문할 수 있습니다.</span>
        <?php /* 견적 행을 지워 비워진 직후가 보관함을 찾는 순간 — 빈 상태에도 경로 제공 */ ?>
        <span class="sp-cart-empty-sub">
            PCB 견적은 <a href="<?php echo G5_URL; ?>/shop/quotes">견적관리</a>에서,
            삭제한 견적은 <a href="<?php echo G5_URL; ?>/shop/quotes/archive" class="sp-link-archive">지난 견적 보관함</a>에서 확인할 수 있습니다.
        </span>
    </div>

    <?php } else { ?>

    <div class="sp-cart-body">

        <!-- 상품 목록 -->
        <section class="sp-cart-list">
            <h2 class="sound_only">장바구니 상품 목록</h2>

            <div class="sp-cart-toolbar">
                <span class="sp-chk">
                    <input type="checkbox" name="ct_all" value="1" id="ct_all" checked="checked" class="selec_chk">
                    <label for="ct_all"><span></span>전체선택 <em id="sp_sel_cnt"><?php echo $cart_count; ?>/<?php echo $cart_count; ?></em></label>
                </span>
                <div class="sp-cart-toolbar-btns btn_cart_del">
                    <button type="button" onclick="return spCartDelete('sel');">선택삭제</button>
                    <button type="button" onclick="return spCartDelete('all');">비우기</button>
                </div>
            </div>

            <ul class="sp-cart-items">
                <?php foreach ($cart_items as $idx => $item) { ?>
                <li class="sp-cart-item<?php echo $item['is_quote'] ? ' sp-cart-item--quote' : ''; ?>"<?php if ($item['is_quote']) { ?> data-ctid="<?php echo (int) $item['ct_id']; ?>"<?php } ?>>
                    <span class="sp-chk sp-cart-item-chk">
                        <input type="checkbox" name="ct_chk[<?php echo $idx; ?>]" value="1" id="ct_chk_<?php echo $idx; ?>" checked="checked" class="selec_chk"<?php if ($item['is_quote']) { ?> data-quote="1"<?php } ?>>
                        <label for="ct_chk_<?php echo $idx; ?>"><span></span><b class="sound_only">상품 선택</b></label>
                    </span>

                    <?php /* 견적 카드는 data-itid 마킹 — 하단 JS 가 대표 거버 썸네일로 교체 */ ?>
                    <a href="<?php echo $item['it_url']; ?>" class="sp-cart-thumb"<?php if ($item['is_quote']) { ?> data-itid="<?php echo $item['it_id']; ?>"<?php } ?>><?php echo $item['image']; ?></a>

                    <div class="sp-cart-info">
                        <input type="hidden" name="it_id[<?php echo $idx; ?>]" value="<?php echo $item['it_id']; ?>">
                        <input type="hidden" name="it_name[<?php echo $idx; ?>]" value="<?php echo get_text($item['it_name']); ?>">

                        <a href="<?php echo $item['it_url']; ?>" class="prd_name"><b><?php echo $item['it_name']; ?></b></a>

                        <?php if ($item['options']) { ?>
                        <div class="sod_opt"><?php echo $item['is_quote'] ? get_text($item['options']) : $item['options']; ?></div>
                        <?php if (!$item['is_quote']) { ?>
                        <div class="sod_option_btn">
                            <button type="button" class="mod_options"><i class="fa fa-pencil" aria-hidden="true"></i> 선택사항수정</button>
                        </div>
                        <?php } ?>
                        <?php } ?>

                        <div class="sp-cart-meta">
                            <?php if (!$item['is_quote'] && $item['ct_price'] > 0) { ?><span>판매가 <?php echo number_format($item['ct_price']); ?>원</span><?php } ?>
                            <?php if ($item['point'] > 0) { ?><span>포인트 <?php echo number_format($item['point']); ?>점</span><?php } ?>
                            <span>배송비 <?php echo $item['send_label']; ?></span>
                            <?php if ($item['is_quote']) { /* sp-node DELETE → 보관함 이동 */ ?>
                            <span>삭제 시 <a href="<?php echo G5_URL; ?>/shop/quotes/archive" class="sp-link-archive">지난 견적 보관함</a>으로 이동</span>
                            <?php } ?>
                        </div>
                    </div>

                    <div class="sp-cart-calc">
                        <?php if ($item['is_quote']) { /* 견적 행: 수량 인라인 변경 → 서버 재견적(하단 JS) */ ?>
                        <span class="sp-cart-qty">수량
                            <input type="number" class="sp-cart-qty-input" min="1" step="1" value="<?php echo (int) $item['qty']; ?>" data-prev="<?php echo (int) $item['qty']; ?>" disabled aria-label="수량">
                            개
                        </span>
                        <?php } else { ?>
                        <span class="sp-cart-qty">수량 <strong><?php echo number_format($item['qty']); ?></strong>개</span>
                        <?php } ?>
                        <strong class="sp-cart-sum"><span id="sell_price_<?php echo $idx; ?>" class="total_prc"><?php echo number_format($item['sell_price']); ?></span>원</strong>
                    </div>
                </li>
                <?php } ?>
            </ul>
        </section>

        <!-- 주문 요약 -->
        <aside class="sp-cart-side">
            <div id="sod_bsk_tot" class="sp-cart-summary">
                <h2>주문 요약</h2>
                <dl class="sp-cart-summary-row">
                    <dt>상품금액</dt>
                    <dd><?php echo number_format($tot_sell_price); ?>원</dd>
                </dl>
                <dl class="sp-cart-summary-row sod_bsk_dvr">
                    <dt>배송비</dt>
                    <dd><?php echo $send_cost ? number_format($send_cost).'원' : '무료'; ?></dd>
                </dl>
                <?php if ($tot_point > 0) { ?>
                <dl class="sp-cart-summary-row sod_bsk_pt">
                    <dt>적립 예정 포인트</dt>
                    <dd><?php echo number_format($tot_point); ?>점</dd>
                </dl>
                <?php } ?>
                <dl class="sp-cart-summary-row sp-cart-summary-total sod_bsk_cnt">
                    <dt>총 결제금액</dt>
                    <dd><strong><?php echo number_format($tot_price); ?></strong>원</dd>
                </dl>
                <p class="sp-cart-summary-note">선택한 상품만 주문서에 담깁니다. 최종 금액은 주문서에서 다시 계산됩니다.</p>
            </div>

            <div id="sod_bsk_act" class="sp-cart-act">
                <input type="hidden" name="url" value="./orderform.php">
                <input type="hidden" name="records" value="<?php echo $cart_count; ?>">
                <input type="hidden" name="act" value="">
                <button type="button" onclick="return spCartOrder();" class="sp-btn sp-btn-primary btn_submit">주문하기</button>
                <a href="<?php echo shop_category_url($continue_ca_id); ?>" class="sp-btn sp-btn-ghost btn01">쇼핑 계속하기</a>

                <?php if ($naverpay_button_js) { ?>
                <div class="cart-naverpay"><?php echo $naverpay_request_js.$naverpay_button_js; ?></div>
                <?php } ?>
            </div>
        </aside>

    </div>

    <?php } ?>
    </form>
</div>

<script>
$(function() {
    var close_btn_idx;

    // 선택사항수정 (일반 상품 전용 — 견적 행엔 버튼이 렌더되지 않는다)
    $(".mod_options").click(function() {
        var it_id = $(this).closest(".sp-cart-item").find("input[name^=it_id]").val();
        var $this = $(this);
        close_btn_idx = $(".mod_options").index($(this));

        $.post(
            "./cartoption.php",
            { it_id: it_id },
            function(data) {
                $("#mod_option_frm").remove();
                $this.after("<div id=\"mod_option_frm\"></div><div class=\"mod_option_bg\"></div>");
                $("#mod_option_frm").html(data);
                price_calculate();
            }
        );
    });

    // 모두선택
    $("input[name=ct_all]").on("click", function() {
        $("input[name^=ct_chk]").prop("checked", $(this).is(":checked"));
        sp_update_sel_cnt();
    });

    // 개별선택 → 전체선택·선택수 동기화
    $(document).on("change", "input[name^=ct_chk]", function() {
        var $all = $("input[name^=ct_chk]");
        $("input[name=ct_all]").prop("checked", $all.length === $all.filter(":checked").length);
        sp_update_sel_cnt();
    });

    function sp_update_sel_cnt() {
        var $all = $("input[name^=ct_chk]");
        $("#sp_sel_cnt").text($all.filter(":checked").length + "/" + $all.length);
    }

    // 옵션수정 닫기
    $(document).on("click", "#mod_option_close, .mod_option_bg", function() {
        $("#mod_option_frm, .mod_option_bg").remove();
        $(".mod_options").eq(close_btn_idx).focus();
    });
    $("#win_mask").click(function () {
        $("#mod_option_frm").remove();
        $(".mod_options").eq(close_btn_idx).focus();
    });
});

// 코어 폼 제출(일반 상품 폴백 경로) — buy/seldelete/alldelete
function fsubmit_check(f) {
    if($("input[name^=ct_chk]:checked").length < 1) {
        alert("구매하실 상품을 하나이상 선택해 주십시오.");
        return false;
    }
    return true;
}

function form_check(act) {
    var f = document.frmcartlist;

    if (act == "buy")
    {
        if($("input[name^=ct_chk]:checked").length < 1) {
            alert("주문하실 상품을 하나이상 선택해 주십시오.");
            return false;
        }
        f.act.value = act;
        f.submit();
    }
    else if (act == "alldelete")
    {
        f.act.value = act;
        f.submit();
    }
    else if (act == "seldelete")
    {
        if($("input[name^=ct_chk]:checked").length < 1) {
            alert("삭제하실 상품을 하나이상 선택해 주십시오.");
            return false;
        }
        f.act.value = act;
        f.submit();
    }
    return true;
}

// ── 거버 견적 행: ct_id 단위 sp-node 연동 (수량 재견적·주문·삭제) ────────────
(function () {
    'use strict';

    var API = '/api/pcb-projects';
    var token = null;

    // 견적 카드가 하나도 없으면(일반 상품만) sp-node 경로 불필요 — 코어 폼만 쓴다.
    var quoteCards = Array.prototype.slice.call(document.querySelectorAll('.sp-cart-item--quote'));
    var hasNonQuote = document.querySelectorAll('#sod_bsk .sp-cart-item:not(.sp-cart-item--quote)').length > 0;

    var ERR = {
        QUOTE_FINALIZED: '확정된 견적은 수량을 변경할 수 없습니다. 재견적이 필요하면 문의해 주세요.',
        ALREADY_ORDERED: '이미 주문된 견적입니다.',
        REQUOTE_RFQ_IN_CART: '이 수량은 자동견적이 불가합니다. 장바구니에서 빼고 견적을 요청해 주세요.',
        CART_SYNC_FAILED: '금액 동기화에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        CART_DELETE_FAILED: '장바구니에서 삭제하지 못했습니다. 다시 시도해 주세요.',
        NOT_PRICED: '견적가가 아직 없습니다.',
        NO_ORDERABLE_ITEMS: '주문 가능한 항목이 없습니다.',
        TEMPLATE_ITEM_MISSING: '상품 설정 오류입니다. 관리자에게 문의해 주세요.',
        NOT_FOUND: '견적을 찾을 수 없습니다.'
    };
    function emsg(b) { return (b && ERR[b.error]) || (b && (b.message || b.error)) || '요청에 실패했습니다.'; }

    function refreshToken() {
        return fetch('/spcb/api/me', { credentials: 'include' }).then(function (res) {
            if (!res.ok) { throw new Error('not authenticated'); }
            return res.json();
        }).then(function (me) { token = me.token; });
    }

    function api(method, path, body) {
        return fetch(API + path, {
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

    // 견적 카드 보강: 실수량·projectId·거버 썸네일 (sp-node /cart-items)
    function enrich() {
        if (quoteCards.length === 0) { return Promise.resolve(); }
        return refreshToken()
            .then(function () { return api('GET', '/cart-items'); })
            .then(function (r) {
                if (!r.ok) { return; }
                var map = {};
                (r.json.data.items || []).forEach(function (it) { map[String(it.ctId)] = it; });
                quoteCards.forEach(function (li) {
                    var it = map[li.getAttribute('data-ctid')];
                    if (!it) { return; }
                    var input = li.querySelector('.sp-cart-qty-input');
                    if (input) {
                        input.value = it.qty;
                        input.setAttribute('data-prev', it.qty);
                        input.setAttribute('data-id', it.projectId);
                        if (it.quoteStatus === 'quoted') {
                            input.title = '확정 견적은 수량을 변경할 수 없습니다';
                        } else {
                            input.disabled = false;
                        }
                    }
                    var img = li.querySelector('.sp-cart-thumb img');
                    if (it.thumbnailUrl && img) { img.src = it.thumbnailUrl; }
                    var chk = li.querySelector('input[name^=ct_chk]');
                    if (chk) { chk.setAttribute('data-id', it.projectId); }
                });
            })
            .catch(function () { /* 보강 실패 시 표시가는 그대로, 수량 입력은 비활성 유지 */ });
    }

    // 수량 변경 → 서버 재견적(담김 상태 cart 행 동기화) → 새로고침
    document.addEventListener('change', function (ev) {
        var input = ev.target;
        if (!input.classList || !input.classList.contains('sp-cart-qty-input')) { return; }
        var id = input.getAttribute('data-id');
        if (!id) { return; }
        var qty = parseInt(input.value, 10);
        if (!(qty > 0)) { input.value = input.getAttribute('data-prev'); return; }
        if (String(qty) === input.getAttribute('data-prev')) { return; }
        input.disabled = true;
        refreshToken()
            .then(function () { return api('PATCH', '/' + id, { qty: qty }); })
            .then(function (r) {
                if (!r.ok) {
                    alert(emsg(r.json));
                    input.value = input.getAttribute('data-prev');
                    input.disabled = false;
                    return;
                }
                location.reload(); // 행 금액·총계가 함께 바뀌므로 서버 렌더 새로고침
            })
            .catch(function () { input.disabled = false; });
    });

    // 선택된 견적 카드의 projectId 목록
    function selectedQuoteIds() {
        var ids = [];
        quoteCards.forEach(function (li) {
            var chk = li.querySelector('input[name^=ct_chk]');
            var pid = chk && chk.getAttribute('data-id');
            if (chk && chk.checked && pid) { ids.push(parseInt(pid, 10)); }
        });
        return ids;
    }
    function checkedQuoteCount() {
        var n = 0;
        quoteCards.forEach(function (li) {
            var chk = li.querySelector('input[name^=ct_chk]');
            if (chk && chk.checked) { n++; }
        });
        return n;
    }
    function nonQuoteChecked() {
        return document.querySelectorAll('#sod_bsk .sp-cart-item:not(.sp-cart-item--quote) input[name^=ct_chk]:checked').length > 0;
    }

    // 미체크 견적 ct_id 를 쿠키로 전달 — 코어 폼(cartupdate)은 선택이 it_id 단위라 같은
    // 템플릿의 미체크 견적까지 ct_select=1 로 쓸어담는다. orderform 진입 시 extend
    // (sp_quote_cart.extend.php)가 이 쿠키를 읽어 ct_select=0 으로 보정한다(1회용).
    // 항상 새로 세팅(빈 값 포함) — 이전 주문 시도의 잔존 쿠키가 오발동하지 않게.
    function setDeselectCookie() {
        var ids = [];
        quoteCards.forEach(function (li) {
            var chk = li.querySelector('input[name^=ct_chk]');
            if (chk && !chk.checked) { ids.push(li.getAttribute('data-ctid')); }
        });
        document.cookie = 'sp_cart_deselect=' + ids.join('-') + '; path=/; max-age=600';
    }

    // 주문하기 — 체크가 견적뿐이면 sp-node(/order, 행 단위 선택). 일반 상품이 체크돼
    // 있으면 코어 폼(cartupdate) + 쿠키 보정(setDeselectCookie 참고).
    window.spCartOrder = function () {
        setDeselectCookie();
        if (nonQuoteChecked()) { return form_check('buy'); }
        var ids = selectedQuoteIds();
        if (ids.length === 0) {
            alert(checkedQuoteCount() > 0
                ? '견적 정보를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
                : '주문하실 상품을 하나 이상 선택해 주세요.');
            return false;
        }
        refreshToken()
            .then(function () { return api('POST', '/order', { ids: ids }); })
            .then(function (r) {
                if (!r.ok) { alert(emsg(r.json)); return; }
                location.href = r.json.data.redirectUrl;
            });
        return false;
    };

    // 삭제 — 견적 행은 혼합 카트에서도 항상 ct_id 단위 sp-node DELETE(→ 보관함).
    // 코어 삭제(cartupdate)도 it_id 단위라 같은 템플릿의 미체크 견적까지 지워버리므로,
    // 견적을 먼저 sp-node 로 지운 뒤 일반 상품만 코어 폼으로 잇는다.
    function spCartDelete(mode) {
        var isAll = (mode === 'all');
        var ids;
        if (isAll) {
            ids = [];
            quoteCards.forEach(function (li) {
                var chk = li.querySelector('input[name^=ct_chk]');
                var pid = chk && chk.getAttribute('data-id');
                if (pid) { ids.push(parseInt(pid, 10)); }
            });
        } else {
            ids = selectedQuoteIds();
        }

        // 지울 견적이 없으면 코어 폼만으로 충분 (체크된 견적이 있는데 projectId 가
        // 없다 = enrich 실패 — 코어 폼으로 넘기면 it_id 오폭이라 여기서 멈춘다)
        if (ids.length === 0) {
            if (!isAll && checkedQuoteCount() > 0) {
                alert('견적 정보를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
                return false;
            }
            if (hasNonQuote) { return form_check(isAll ? 'alldelete' : 'seldelete'); }
            alert(isAll ? '삭제할 견적이 없습니다.' : '삭제하실 견적을 하나 이상 선택해 주세요.');
            return false;
        }

        var msg = isAll
            ? '장바구니를 비울까요? 견적 ' + ids.length + '건은 "지난 견적" 보관함으로 이동됩니다.'
            : '선택한 항목을 삭제할까요? 견적 ' + ids.length + '건은 "지난 견적" 보관함으로 이동됩니다.';
        if (!confirm(msg)) { return false; }

        refreshToken().then(function () {
            var failed = 0;
            return ids.reduce(function (chain, id) {
                return chain.then(function () {
                    return api('DELETE', '/' + id).then(function (r) { if (!r.ok) { failed++; } });
                });
            }, Promise.resolve()).then(function () {
                if (failed > 0) { alert(failed + '건을 삭제하지 못했습니다.'); }
                // 일반 상품 삭제가 남았으면 견적 체크를 풀고(코어 it_id 삭제 오폭 방지) 코어 폼으로
                if (hasNonQuote && (isAll || nonQuoteChecked())) {
                    quoteCards.forEach(function (li) {
                        var chk = li.querySelector('input[name^=ct_chk]');
                        if (chk) { chk.checked = false; }
                    });
                    form_check(isAll ? 'alldelete' : 'seldelete');
                    return;
                }
                location.reload();
            });
        });
        return false;
    }
    window.spCartDelete = spCartDelete;

    // 카트 재진입 시 이전 주문 시도의 쿠키 제거 — 다른 진입점(견적관리 등) 주문에 오발동 방지
    document.cookie = 'sp_cart_deselect=; path=/; max-age=0';

    enrich();
})();
</script>
<!-- } 장바구니 끝 -->

<?php
include_once('./_tail.php');
