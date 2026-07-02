<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

/*
 * sp-lite 장바구니 — 코어 shop/cart.php 가 G5_THEME_SHOP_PATH/cart.php 존재 시 include 후 return (코어 무수정 오버라이드).
 * 진입 시점에 $s_cart_id·$cart_action_url·$naverpay_button_js 준비 완료, before_check_cart_price 실행됨.
 * 기능 훅(form 이름·ct_chk·mod_options·#mod_option_frm·form_check 등)은 코어와 동일하게 유지.
 */

$g5['title'] = '장바구니';
include_once('./_head.php');

// 장바구니 목록 수집 (쿼리·계산은 코어와 동일)
$cart_items = array();
$tot_point = 0;
$tot_sell_price = 0;
$send_cost = 0;
$continue_ca_id = '';

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
          where a.od_id = '$s_cart_id' ";
$sql .= " group by a.it_id ";
$sql .= " order by a.ct_id ";
$result = sql_query($sql);

for ($i=0; $row=sql_fetch_array($result); $i++)
{
    // 상품별 합계금액
    $sum = sql_fetch(" select SUM(IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))) as price,
                              SUM(ct_point * ct_qty) as point,
                              SUM(ct_qty) as qty
                         from {$g5['g5_shop_cart_table']}
                        where it_id = '{$row['it_id']}'
                          and od_id = '$s_cart_id' ");

    if ($i == 0) // 계속쇼핑
        $continue_ca_id = $row['ca_id'];

    // 배송비 표기
    switch($row['ct_send_cost']) {
        case 1:  $ct_send_cost = '착불'; break;
        case 2:  $ct_send_cost = '무료'; break;
        default: $ct_send_cost = '선불'; break;
    }

    // 조건부무료
    if($row['it_sc_type'] == 2) {
        $sendcost = get_item_sendcost($row['it_id'], $sum['price'], $sum['qty'], $s_cart_id);
        if($sendcost == 0)
            $ct_send_cost = '무료';
    }

    $cart_items[] = array(
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

$cart_count = count($cart_items);
if ($cart_count)
    $send_cost = get_sendcost($s_cart_id, 0); // 배송비 계산

$tot_price = $tot_sell_price + $send_cost; // 총계 = 주문상품금액합계 + 배송비
?>

<!-- 장바구니 시작 { -->
<script src="<?php echo G5_JS_URL; ?>/shop.js?ver=<?php echo G5_JS_VER; ?>"></script>
<script src="<?php echo G5_JS_URL; ?>/shop.override.js?ver=<?php echo G5_JS_VER; ?>"></script>

<div id="sod_bsk" class="od_prd_list">

    <form name="frmcartlist" id="sod_bsk_list" class="2017_renewal_itemform" method="post" action="<?php echo $cart_action_url; ?>">

    <?php if (!$cart_count) { ?>

    <div class="sp-cart-empty">
        <i class="fa fa-shopping-cart" aria-hidden="true"></i>
        <p>장바구니에 담긴 상품이 없습니다.</p>
        <span class="sp-cart-empty-sub">원하는 상품을 담고 한 번에 주문해 보세요.</span>
        <a href="<?php echo G5_SHOP_URL; ?>/" class="sp-btn sp-btn-primary">쇼핑 계속하기</a>
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
                    <button type="button" onclick="return form_check('seldelete');">선택삭제</button>
                    <button type="button" onclick="return form_check('alldelete');">비우기</button>
                </div>
            </div>

            <ul class="sp-cart-items">
                <?php foreach ($cart_items as $idx => $item) { ?>
                <li class="sp-cart-item">
                    <span class="sp-chk sp-cart-item-chk">
                        <input type="checkbox" name="ct_chk[<?php echo $idx; ?>]" value="1" id="ct_chk_<?php echo $idx; ?>" checked="checked" class="selec_chk">
                        <label for="ct_chk_<?php echo $idx; ?>"><span></span><b class="sound_only">상품 선택</b></label>
                    </span>

                    <a href="<?php echo $item['it_url']; ?>" class="sp-cart-thumb"><?php echo $item['image']; ?></a>

                    <div class="sp-cart-info">
                        <input type="hidden" name="it_id[<?php echo $idx; ?>]" value="<?php echo $item['it_id']; ?>">
                        <input type="hidden" name="it_name[<?php echo $idx; ?>]" value="<?php echo get_text($item['it_name']); ?>">

                        <a href="<?php echo $item['it_url']; ?>" class="prd_name"><b><?php echo $item['it_name']; ?></b></a>

                        <?php if ($item['options']) { ?>
                        <div class="sod_opt"><?php echo $item['options']; ?></div>
                        <div class="sod_option_btn">
                            <button type="button" class="mod_options"><i class="fa fa-pencil" aria-hidden="true"></i> 선택사항수정</button>
                        </div>
                        <?php } ?>

                        <div class="sp-cart-meta">
                            <?php if ($item['ct_price'] > 0) { ?><span>판매가 <?php echo number_format($item['ct_price']); ?>원</span><?php } ?>
                            <?php if ($item['point'] > 0) { ?><span>포인트 <?php echo number_format($item['point']); ?>점</span><?php } ?>
                            <span>배송비 <?php echo $item['send_label']; ?></span>
                        </div>
                    </div>

                    <div class="sp-cart-calc">
                        <span class="sp-cart-qty">수량 <strong><?php echo number_format($item['qty']); ?></strong>개</span>
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
                <button type="button" onclick="return form_check('buy');" class="sp-btn sp-btn-primary btn_submit">주문하기</button>
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

    // 선택사항수정
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

function fsubmit_check(f) {
    if($("input[name^=ct_chk]:checked").length < 1) {
        alert("구매하실 상품을 하나이상 선택해 주십시오.");
        return false;
    }

    return true;
}

function form_check(act) {
    var f = document.frmcartlist;
    var cnt = f.records.value;

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
</script>
<!-- } 장바구니 끝 -->

<?php
include_once('./_tail.php');
