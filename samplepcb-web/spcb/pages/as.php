<?php
// samplepcb A/S 접수 — 주문을 가로지르는 "접수할 주문 + 내 접수 내역" (docs/PCB_PARTNER_TRACK.md P5)
// URL: /shop/as (루트 .htaccess 3번 규칙) · /as (2번 규칙 별칭)
//
// 왜 이 페이지가 있나: A/S 접수 폼은 주문 상세 안에만 있어, 고객이 새로 접수하려면 주문내역에서
// 배송 완료 주문을 찾아 상세를 열어야 했고, 낸 접수의 진행 상태는 그 주문을 다시 열어야만
// 보였다. 이 페이지는 **낼 수 있는 것·낸 것**을 한 화면에 세운다.
//
// 구조 — 목록은 목록만 한다(확인 요청 /shop/eq 와 같은 원칙):
//   · 접수 폼은 여기 없다. PCB 는 주문 상세 A/S 섹션(#sp_as_wrap)으로, 부품 BOM 은
//     /app/bom/:id 로 보낸다. 폼을 복제하면 사진 첨부·수량 검증·확인 모달이 두 곳에서 갈린다.
//   · 트랙은 **탭으로 나눈다**(PCB / 부품 BOM). 같은 상태가 트랙마다 다른 말이라
//     (resolved = 처리 완료 / 해결 완료) 한 목록에 섞지 않는다 — '전체' 탭은 그래서 없다.
//     부품 탭은 그 회원에게 부품 축이 있을 때만 세운다(대부분의 고객은 PCB 만 쓴다).
//   · 데이터는 서버사이드 브리지(extend/sp_pcb_claim·sp_bom_claim → sp-node */mine).
//
// 어휘: 메뉴·제목은 "A/S 접수"(고객이 찾는 말). 결과가 재생산·환불·안내 중 무엇이 될지는
// 관리자 판정이라 "요청"이 아니라 "접수"다. 트랙 이름 외에 화면에 'EQ'·'클레임' 은 쓰지 않는다.

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $is_member, 테마 상수

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode(G5_URL . '/shop/as'));
}

$sp_as_scope = (isset($_GET['scope']) && $_GET['scope'] === 'all') ? 'all' : 'open';
$sp_as_has_bom = function_exists('sp_bom_claim_has_track') ? sp_bom_claim_has_track($member['mb_id']) : false;
$sp_as_track = (isset($_GET['track']) && $_GET['track'] === 'bom') ? 'bom' : 'pcb';

$sp_as_empty = array('claimable' => array(), 'claimableTruncated' => false, 'claims' => array(), 'openCount' => 0);
if ($sp_as_track === 'bom') {
    $sp_as_data = function_exists('sp_bom_claims_mine') ? sp_bom_claims_mine($sp_as_scope) : $sp_as_empty;
} else {
    $sp_as_data = function_exists('sp_pcb_claims_mine') ? sp_pcb_claims_mine($sp_as_scope) : $sp_as_empty;
}
// 탭 머리의 진행 중 수 — 두 트랙 다 세운다(현재 탭 데이터는 API, 다른 탭은 DB count).
$sp_as_open_pcb = ($sp_as_track === 'pcb') ? (int) $sp_as_data['openCount']
    : (function_exists('sp_pcb_claim_active_count') ? sp_pcb_claim_active_count($member['mb_id']) : 0);
$sp_as_open_bom = ($sp_as_track === 'bom') ? (int) $sp_as_data['openCount']
    : (function_exists('sp_bom_claim_active_count') ? sp_bom_claim_active_count($member['mb_id']) : 0);

$sp_as_url = function ($track, $scope = 'open') {
    $q = array();
    if ($track === 'bom') $q[] = 'track=bom';
    if ($scope === 'all') $q[] = 'scope=all';
    return G5_URL . '/shop/as' . (count($q) > 0 ? '?' . implode('&', $q) : '');
};

$g5['title'] = 'A/S 접수';
include_once(G5_THEME_PATH . '/head.php');
?>

<link rel="stylesheet" href="<?php echo G5_THEME_CSS_URL; ?>/default_shop.css?ver=<?php echo G5_CSS_VER; ?>">

<?php $sp_account_active = 'as'; ?>
<div class="account-layout">
    <?php include G5_THEME_SHOP_PATH . '/_account_nav.php'; ?>
    <div class="account-main">
        <div id="wrapper_title"><?php echo $g5['title']; ?></div>

        <div class="sp-eqm sp-asm">
            <p class="sp-eqm__intro">
                받으신 제품에 문제가 있으면 배송 완료된 주문에서 접수해 주세요. 담당자가 검토 후 처리 방안을 안내드립니다.
            </p>

            <?php if ($sp_as_has_bom || $sp_as_track === 'bom'): ?>
            <div class="sp-quotes-tabs" role="tablist" id="sp-as-tracks">
                <a class="sp-quotes-tab<?php echo $sp_as_track === 'pcb' ? ' is-active' : ''; ?>" href="<?php echo $sp_as_url('pcb', $sp_as_scope); ?>" data-track="pcb">PCB<?php if ($sp_as_open_pcb) { ?> <span class="sp-eqm__cnt is-quiet"><?php echo number_format($sp_as_open_pcb); ?></span><?php } ?></a>
                <a class="sp-quotes-tab<?php echo $sp_as_track === 'bom' ? ' is-active' : ''; ?>" href="<?php echo $sp_as_url('bom', $sp_as_scope); ?>" data-track="bom">부품 BOM<?php if ($sp_as_open_bom) { ?> <span class="sp-eqm__cnt is-quiet"><?php echo number_format($sp_as_open_bom); ?></span><?php } ?></a>
            </div>
            <?php endif; ?>

            <?php /* ── 접수할 주문 ────────────────────────────────────────────── */ ?>
            <h3 class="sp-eqm__sect">접수할 주문</h3>
            <?php if (empty($sp_as_data['claimable'])): ?>
                <p class="sp-eqm__empty is-compact">접수할 수 있는 배송 완료 주문이 없습니다.</p>
            <?php else: ?>
                <ul class="sp-eqm__list" id="sp-as-claimable">
                <?php foreach ($sp_as_data['claimable'] as $row):
                    if ($sp_as_track === 'bom') {
                        $name = $row['title'];
                        $link = G5_URL . '/app/bom/' . (int) $row['quoteId'];
                    } else {
                        $name = $row['projectName'];
                        $link = G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode($row['odId']) . '#sp_as_wrap';
                    }
                ?>
                    <li class="sp-eqm__item is-claimable">
                        <div class="sp-eqm__foot">
                            <div class="sp-eqm__meta">
                                <strong class="sp-eqm__proj"><?php echo get_text($name); ?></strong>
                                <span class="sp-eqm__sub">주문 <?php echo get_text($row['odId']); ?> · <?php echo date('Y-m-d', strtotime($row['orderedAt'])); ?><?php if ($sp_as_track === 'pcb') { ?> · 수량 <?php echo (int) $row['qty']; ?><?php } ?></span>
                            </div>
                            <a class="sp-eqm__go" href="<?php echo $link; ?>">접수하기</a>
                        </div>
                    </li>
                <?php endforeach; ?>
                </ul>
            <?php endif; ?>
            <?php if (!empty($sp_as_data['claimableTruncated'])): ?>
                <p class="sp-eqm__note">최근 주문만 보여 드립니다 — 더 오래된 주문은 <a href="<?php echo G5_SHOP_URL; ?>/orderinquiry.php">주문내역</a>에서 열어 접수해 주세요.</p>
            <?php endif; ?>

            <?php /* ── 접수 내역 ──────────────────────────────────────────────── */ ?>
            <div class="sp-eqm__secthead">
                <h3 class="sp-eqm__sect">접수 내역</h3>
                <div class="sp-eqm__scope" id="sp-as-scope">
                    <a class="sp-eqm__pill<?php echo $sp_as_scope === 'open' ? ' is-active' : ''; ?>" href="<?php echo $sp_as_url($sp_as_track, 'open'); ?>">진행 중<?php if ($sp_as_data['openCount']) { ?> <?php echo number_format((int) $sp_as_data['openCount']); ?><?php } ?></a>
                    <a class="sp-eqm__pill<?php echo $sp_as_scope === 'all' ? ' is-active' : ''; ?>" href="<?php echo $sp_as_url($sp_as_track, 'all'); ?>">전체</a>
                </div>
            </div>

            <?php if (empty($sp_as_data['claims'])): ?>
                <p class="sp-eqm__empty">
                    <?php echo $sp_as_scope === 'open' ? '진행 중인 접수가 없습니다.' : '아직 접수한 내역이 없습니다.'; ?>
                </p>
            <?php else: ?>
                <ul class="sp-eqm__list" id="sp-as-claims">
                <?php foreach ($sp_as_data['claims'] as $cl):
                    $active = ($cl['status'] === 'open' || $cl['status'] === 'reviewing');
                    if ($sp_as_track === 'bom') {
                        $st    = sp_bom_claim_status_label($cl['status']);
                        $kinds = sp_bom_claim_kinds();
                        $res   = sp_bom_claim_resolution_label(isset($cl['resolutionKind']) ? $cl['resolutionKind'] : '');
                        $name  = $cl['quoteTitle'];
                        $qtyTx = '부품 ' . count($cl['items']) . '종';
                        $link  = G5_URL . '/app/bom/' . (int) $cl['quoteId'];
                    } else {
                        $st    = sp_pcb_claim_status_label($cl['status']);
                        $kinds = sp_pcb_claim_kinds();
                        $res   = sp_pcb_claim_resolution_label(isset($cl['resolutionKind']) ? $cl['resolutionKind'] : '');
                        $name  = $cl['projectName'];
                        $qtyTx = '문제 수량 ' . (int) $cl['affectedQty'] . '/' . (int) $cl['orderedQty'];
                        // 주문이 지워진 건(여정 34호)은 갈 곳이 없다 — 링크 없이 안내만.
                        $link  = empty($cl['odId']) ? ''
                            : G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode($cl['odId']) . '#as-' . (int) $cl['id'];
                    }
                    $kindTx = isset($kinds[$cl['kind']]) ? $kinds[$cl['kind']] : get_text($cl['kind']);
                ?>
                    <li class="sp-eqm__item<?php echo $active ? ' is-open' : ''; ?>">
                        <div class="sp-eqm__head">
                            <span class="sp_eq_badge <?php echo $st['cls']; ?>"><?php echo $st['label']; ?></span>
                            <strong class="sp-eqm__proj"><?php echo get_text($name); ?></strong>
                            <span class="sp_eq_due"><?php echo $kindTx; ?> · <?php echo $qtyTx; ?></span>
                        </div>
                        <p class="sp-eqm__msg"><?php echo get_text($cl['description']); ?></p>
                        <div class="sp-eqm__foot">
                            <span class="sp-eqm__meta">
                                접수 <?php echo date('Y-m-d', strtotime($cl['submittedAt'])); ?>
                                <?php if (!empty($cl['odId'])): ?> · 주문 <?php echo get_text($cl['odId']); ?><?php endif; ?>
                                <?php if (!empty($cl['adminResponse'])): ?> · <b>답변 있음<?php if ($res !== '') { ?> (<?php echo $res; ?>)<?php } ?></b><?php endif; ?>
                            </span>
                            <?php if ($link !== ''): ?>
                                <a class="sp-eqm__go" href="<?php echo $link; ?>">내용 보기</a>
                            <?php else: ?>
                                <span class="sp-eqm__meta">주문 내역이 없어 열 수 없습니다 — 고객센터로 문의해 주세요.</span>
                            <?php endif; ?>
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
