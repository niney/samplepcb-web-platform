<?php
// samplepcb 부품 확인 — 결제 후 부품 확인 요청 목록 (docs/SMARTBOM_PARTNER_RFQ.md §6.39 D43)
// URL: /shop/parts-confirm (루트 .htaccess 3번 규칙) · /parts-confirm (2번 규칙 별칭)
//
// 왜 이 페이지가 있나: 결제한 부품 주문에서 재고 소진·MOQ 증가처럼 고객 결정이 필요한 일이 생기면
// 조달이 멈춘다. 메일을 놓친 고객도 마이페이지에서 "지금 내가 답할 게 있나"를 바로 알게 한다.
//
// 구조 — 목록은 목록만 한다(제조 확인 /shop/eq 와 같은 결정):
//   · 데이터는 서버사이드 브리지(extend/sp_bom_confirm.extend.php → sp-node /api/bom/confirms/mine).
//   · **선택 폼은 여기 없다.** 행은 주문 상세(#bomc-{id})로 보낸다 — 메일이 쓰는 바로 그 링크다.
//     선택지·근거 팝업·추가결제 버튼이 두 곳에서 갈리면 안 된다.

include_once __DIR__ . '/../../common.php';

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode(G5_URL . '/shop/parts-confirm'));
}

// 모수: 기본은 고객 차례(확인 대기 + 추가결제 대기), all 이면 이력까지.
$sp_bc_scope = (isset($_GET['scope']) && $_GET['scope'] === 'all') ? 'all' : 'open';
$sp_bc_data  = function_exists('sp_bom_confirms_mine')
    ? sp_bom_confirms_mine($sp_bc_scope)
    : array('requests' => array(), 'openCount' => 0);
$sp_bc_rows  = $sp_bc_data['requests'];
$sp_bc_open  = (int) $sp_bc_data['openCount'];

$g5['title'] = '부품 확인';
include_once(G5_THEME_PATH . '/head.php');
?>

<link rel="stylesheet" href="<?php echo G5_THEME_CSS_URL; ?>/default_shop.css?ver=<?php echo G5_CSS_VER; ?>">

<?php $sp_account_active = 'bomc'; ?>
<div class="account-layout">
    <?php include G5_THEME_SHOP_PATH . '/_account_nav.php'; ?>
    <div class="account-main">
        <div id="wrapper_title"><?php echo $g5['title']; ?></div>

        <div class="sp-eqm sp-bcm">
            <p class="sp-eqm__intro">
                결제하신 부품 주문에서 확인이 필요한 부품입니다. 회신해 주셔야 해당 부품의 조달이 이어집니다.
            </p>

            <div class="sp-quotes-tabs" role="tablist">
                <a class="sp-quotes-tab<?php echo $sp_bc_scope === 'open' ? ' is-active' : ''; ?>"
                   href="<?php echo G5_URL; ?>/shop/parts-confirm">확인 대기<?php if ($sp_bc_open) { ?> <span class="sp-eqm__cnt"><?php echo number_format($sp_bc_open); ?></span><?php } ?></a>
                <a class="sp-quotes-tab<?php echo $sp_bc_scope === 'all' ? ' is-active' : ''; ?>"
                   href="<?php echo G5_URL; ?>/shop/parts-confirm?scope=all">전체</a>
            </div>

            <?php if (empty($sp_bc_rows)): ?>
                <p class="sp-eqm__empty">
                    <?php if ($sp_bc_scope === 'open'): ?>
                        회신하실 부품 확인 요청이 없습니다.
                    <?php else: ?>
                        아직 부품 확인 요청을 받은 적이 없습니다.
                    <?php endif; ?>
                </p>
            <?php else: ?>
                <ul class="sp-eqm__list">
                <?php foreach ($sp_bc_rows as $rq):
                    $st   = sp_bom_confirm_status_label($rq['status']);
                    $open = ($rq['status'] === 'requested');
                    $pay  = !empty($rq['settlement']) && !empty($rq['settlement']['canCheckout']);
                    $link = G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode($rq['odId']) . '#bomc-' . (int) $rq['id'];
                ?>
                    <li class="sp-eqm__item<?php echo ($open || $pay) ? ' is-open' : ''; ?>">
                        <div class="sp-eqm__head">
                            <span class="sp_eq_badge <?php echo $st['cls']; ?>"><?php echo $st['label']; ?></span>
                            <strong class="sp-eqm__proj"><?php echo get_text($rq['quoteTitle']); ?></strong>
                            <?php if ($open && !empty($rq['overdue'])): ?>
                                <span class="sp_eq_badge sp_eq_no">회신 기한 지남</span>
                            <?php elseif ($open && !empty($rq['dueOn'])): ?>
                                <span class="sp_eq_due">회신 기한 <?php echo get_text($rq['dueOn']); ?></span>
                            <?php endif; ?>
                            <?php if ($pay): ?>
                                <span class="sp_eq_badge sp_eq_no">추가결제 대기 <?php echo number_format((int) $rq['settlement']['amount']); ?>원</span>
                            <?php endif; ?>
                        </div>

                        <p class="sp-eqm__msg"><?php echo get_text($rq['issueSummary']); ?></p>

                        <div class="sp-eqm__foot">
                            <span class="sp-eqm__meta">
                                요청 <?php echo date('Y-m-d', strtotime($rq['requestedAt'])); ?>
                                · 주문 <?php echo get_text($rq['odId']); ?>
                                · 부품 <?php echo (int) $rq['issueCount']; ?>건
                                <?php if (!empty($rq['settlement']) && !$pay): ?>
                                    · <?php echo get_text($rq['settlement']['statusLabel']); ?>
                                <?php endif; ?>
                            </span>
                            <a class="sp-eqm__go" href="<?php echo $link; ?>">
                                <?php echo $open ? '확인하고 회신하기' : ($pay ? '추가결제 하러 가기' : '내용 보기'); ?>
                            </a>
                        </div>
                    </li>
                <?php endforeach; ?>
                </ul>
            <?php endif; ?>
        </div>

    </div><!-- /.account-main -->
</div><!-- /.account-layout -->

<?php
include_once(G5_THEME_PATH . '/tail.php');
