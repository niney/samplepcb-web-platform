<?php
// samplepcb 제조 확인 — 내 주문을 가로지르는 확인 요청 목록 (docs/PCB_PARTNER_TRACK.md D16)
// URL: /shop/eq (루트 .htaccess 3번 규칙) · /eq (2번 규칙 별칭)
//
// 왜 이 페이지가 있나: 확인 요청의 유일한 진입점이 **메일 딥링크**였다. 메일을 놓친 고객은
// 주문을 하나씩 열어보기 전까지 자기 차례인 줄 모르고, 그동안 발주는 멈춰 선다.
//
// 구조 — 목록은 목록만 한다:
//   · 데이터는 서버사이드 브리지(extend/sp_pcb_eq.extend.php → sp-node /api/pcb-eq-reviews/mine).
//     견적관리(quotes.php)처럼 브라우저 JS 로 부르지 않는 이유는 EQ 축이 이미 서버사이드
//     브리지 관례를 쓰고(orderinquiryview.php) 화면이 한 벌이면 되기 때문이다.
//   · **승인·반려 폼은 여기 없다.** 행은 주문 상세(#eq-{id})로 보낸다 — 메일이 쓰는 바로 그
//     링크다. 결정 UI 를 복제하면 첨부·기한·확인 모달·경고가 두 곳에서 갈린다.
//
// 어휘: 트랙 중립어("제조 확인")를 쓴다. 메탈마스크(스텐실) 발주도 같은 축을 쓰지만 그쪽엔
// 'EQ' 라는 말이 없다(계약 pcbEqEventLabel — 화면 하드코딩은 2026-08-17 확정 결함).

include_once __DIR__ . '/../../common.php'; // 그누보드 부트스트랩 → $is_member, 테마 상수

if (empty($is_member)) {
    goto_url(G5_BBS_URL . '/login.php?url=' . urlencode(G5_URL . '/shop/eq'));
}

// 모수: 기본은 열린 요청만(내가 지금 해야 할 것), all 이면 이력까지.
$sp_eq_scope = (isset($_GET['scope']) && $_GET['scope'] === 'all') ? 'all' : 'open';
$sp_eq_data  = function_exists('sp_pcb_eq_reviews_mine')
    ? sp_pcb_eq_reviews_mine($sp_eq_scope)
    : array('reviews' => array(), 'openCount' => 0);
$sp_eq_rows  = $sp_eq_data['reviews'];
$sp_eq_open  = (int) $sp_eq_data['openCount'];

$g5['title'] = '제조 확인';
include_once(G5_THEME_PATH . '/head.php');
?>

<link rel="stylesheet" href="<?php echo G5_THEME_CSS_URL; ?>/default_shop.css?ver=<?php echo G5_CSS_VER; ?>">

<?php $sp_account_active = 'eq'; ?>
<div class="account-layout">
    <?php include G5_THEME_SHOP_PATH . '/_account_nav.php'; ?>
    <div class="account-main">
        <div id="wrapper_title"><?php echo $g5['title']; ?></div>

        <div class="sp-eqm">
            <p class="sp-eqm__intro">
                제조 전에 확인이 필요한 사항입니다. 회신하지 않으면 생산이 시작되지 않습니다.
            </p>

            <div class="sp-quotes-tabs" role="tablist">
                <a class="sp-quotes-tab<?php echo $sp_eq_scope === 'open' ? ' is-active' : ''; ?>"
                   href="<?php echo G5_URL; ?>/shop/eq">확인 대기<?php if ($sp_eq_open) { ?> <span class="sp-eqm__cnt"><?php echo number_format($sp_eq_open); ?></span><?php } ?></a>
                <a class="sp-quotes-tab<?php echo $sp_eq_scope === 'all' ? ' is-active' : ''; ?>"
                   href="<?php echo G5_URL; ?>/shop/eq?scope=all">전체</a>
            </div>

            <?php if (empty($sp_eq_rows)): ?>
                <p class="sp-eqm__empty">
                    <?php if ($sp_eq_scope === 'open'): ?>
                        회신하실 확인 요청이 없습니다.
                    <?php else: ?>
                        아직 제조 확인 요청을 받은 적이 없습니다.
                    <?php endif; ?>
                </p>
            <?php else: ?>
                <ul class="sp-eqm__list">
                <?php foreach ($sp_eq_rows as $rv):
                    $st   = sp_pcb_eq_status_label($rv['status']);
                    $open = ($rv['status'] === 'requested');
                    // 주문이 지워진 건(여정 34호)은 갈 곳이 없다 — 링크 없이 안내만 남긴다.
                    $link = empty($rv['odId'])
                        ? ''
                        : G5_SHOP_URL . '/orderinquiryview.php?od_id=' . urlencode($rv['odId']) . '#eq-' . (int) $rv['id'];
                ?>
                    <li class="sp-eqm__item<?php echo $open ? ' is-open' : ''; ?>">
                        <div class="sp-eqm__head">
                            <span class="sp_eq_badge <?php echo $st['cls']; ?>"><?php echo $st['label']; ?></span>
                            <strong class="sp-eqm__proj"><?php echo get_text($rv['projectName']); ?></strong>
                            <?php if ($open && !empty($rv['overdue'])): ?>
                                <span class="sp_eq_badge sp_eq_no">회신 기한 지남</span>
                            <?php elseif ($open && !empty($rv['dueOn'])): ?>
                                <span class="sp_eq_due">회신 기한 <?php echo date('Y-m-d', strtotime($rv['dueOn'])); ?></span>
                            <?php endif; ?>
                        </div>

                        <p class="sp-eqm__msg"><?php echo get_text($rv['message']); ?></p>

                        <div class="sp-eqm__foot">
                            <span class="sp-eqm__meta">
                                요청 <?php echo date('Y-m-d', strtotime($rv['requestedAt'])); ?>
                                <?php if (!empty($rv['odId'])): ?>
                                    · 주문 <?php echo get_text($rv['odId']); ?>
                                <?php endif; ?>
                                <?php if (!empty($rv['files'])): ?>
                                    · 첨부 <?php echo count($rv['files']); ?>건
                                <?php endif; ?>
                            </span>
                            <?php if ($link !== ''): ?>
                                <a class="sp-eqm__go" href="<?php echo $link; ?>">
                                    <?php echo $open ? '확인하고 회신하기' : '내용 보기'; ?>
                                </a>
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
