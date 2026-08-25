<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가

// 계정 사이드바는 레이아웃(theme/sp-lite/shop/shop.head.php)이 #aside 로 공용 제공.
// 이 파일은 우측 콘텐츠(요약 밴드 → 내정보(접힘) → 최근 주문)만 담당한다.
// 디자인 정본: Figma 103:2361(마이페이지). 색은 계정 셸 스코프 토큰(.smb_dash)으로 피그마 값.

$g5['title'] = '마이페이지';
include_once('./_head.php');

// ── 요약 밴드 집계 (마이페이지 전용 — 사이드바와 별개로 독립 조회) ─────────────
$my_esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($member['mb_id']) : addslashes($member['mb_id']);

$tmp = sql_fetch(" select count(*) as cnt from {$g5['g5_shop_order_table']} where mb_id = '{$my_esc}' ");
$my_od_cnt = (int) $tmp['cnt'];

// 견적 — PCB(sp_order_spec) + 부품 BOM(sp_bom_quote) 합산(사용자 결정).
//  · 견적대기 = PCB rfq + BOM requested|reviewing
//  · 견적확정(주문 가능·미주문) = PCB quoted·ctId 없음 + BOM answered·확정가 있음·미주문
$my_q_wait = 0; $my_q_conf = 0;
$row = sql_fetch(" select
    (select count(*) from sp_order_spec where mbId = '{$my_esc}' and status = 'active' and quoteStatus = 'rfq') as pcb_wait,
    (select count(*) from sp_order_spec where mbId = '{$my_esc}' and status = 'active' and quoteStatus = 'quoted' and ctId is null) as pcb_conf ", false);
if ($row !== false && $row !== null) { $my_q_wait += (int) $row['pcb_wait']; $my_q_conf += (int) $row['pcb_conf']; }
$row = sql_fetch(" select
    (select count(*) from sp_bom_quote where mbId = '{$my_esc}' and status in ('requested','reviewing')) as bom_wait,
    (select count(*) from sp_bom_quote where mbId = '{$my_esc}' and status = 'answered' and confirmedTotal is not null and (ctId is null or ctId = 0)) as bom_conf ", false);
if ($row !== false && $row !== null) { $my_q_wait += (int) $row['bom_wait']; $my_q_conf += (int) $row['bom_conf']; }

// 확인 요청 = 제조 확인 대기(사이드바와 같은 헬퍼 — 워킹 파일은 고객 확인 단계가 없어 제외).
$my_eq_cnt = function_exists('sp_pcb_eq_open_count') ? sp_pcb_eq_open_count($member['mb_id']) : 0;
$my_point  = (int) $member['mb_point'];
?>

<!-- 마이페이지 콘텐츠 시작 { -->
<div id="smb_my_list">

    <!-- 요약 밴드 시작 { -->
    <div class="smb_dash">
        <a class="smb_dash_cell" href="<?php echo G5_SHOP_URL ?>/orderinquiry.php">
            <span class="smb_dash_k">주문내역</span>
            <span class="smb_dash_v"><b><?php echo number_format($my_od_cnt); ?></b>건</span>
        </a>
        <a class="smb_dash_cell" href="<?php echo G5_URL ?>/shop/quotes">
            <span class="smb_dash_k">견적관리</span>
            <span class="smb_dash_v smb_dash_pair">
                <span class="smb_dash_sub"><em>견적대기</em><span><b><?php echo number_format($my_q_wait); ?></b>건</span></span>
                <span class="smb_dash_sub"><em>견적확정</em><span><b><?php echo number_format($my_q_conf); ?></b>건</span></span>
            </span>
        </a>
        <a class="smb_dash_cell" href="<?php echo G5_URL ?>/shop/eq">
            <span class="smb_dash_k">확인요청</span>
            <span class="smb_dash_v smb_dash_pair">
                <span class="smb_dash_sub"><em>제조 확인</em><span><b><?php echo number_format($my_eq_cnt); ?></b>건</span></span>
            </span>
        </a>
        <a class="smb_dash_cell smb_dash_last" href="<?php echo G5_BBS_URL ?>/point.php">
            <span class="smb_dash_k">포인트</span>
            <span class="smb_dash_v"><b><?php echo number_format($my_point); ?></b>P</span>
        </a>
    </div>
    <!-- } 요약 밴드 끝 -->

    <!-- 내정보 시작 { (기본 접힘 · 토글) -->
    <section id="smb_my_ov" class="smb_collapsible">
        <div class="smb_panel_h">
            <h2>내 정보</h2>
            <button type="button" class="smb_toggle" id="smb_my_ov_toggle" aria-expanded="false" aria-controls="smb_my_ov_body">
                <span class="smb_toggle_txt">내 정보 보기</span>
                <span class="smb_toggle_ico" aria-hidden="true"></span>
            </button>
        </div>
        <div class="smb_collapse_body" id="smb_my_ov_body" hidden>
            <dl class="op_area">
                <dt>연락처</dt>
                <dd><?php echo ($member['mb_tel'] ? $member['mb_tel'] : '미등록'); ?></dd>
                <dt>E-Mail</dt>
                <dd><?php echo ($member['mb_email'] ? $member['mb_email'] : '미등록'); ?></dd>
                <dt>최종접속일시</dt>
                <dd><?php echo $member['mb_today_login']; ?></dd>
                <dt>회원가입일시</dt>
                <dd><?php echo $member['mb_datetime']; ?></dd>
                <dt id="smb_my_ovaddt">주소</dt>
                <dd id="smb_my_ovaddd"><?php echo sprintf("(%s%s)", $member['mb_zip1'], $member['mb_zip2']).' '.print_address($member['mb_addr1'], $member['mb_addr2'], $member['mb_addr3'], $member['mb_addr_jibeon']); ?></dd>
            </dl>
        </div>
    </section>
    <!-- } 내정보 끝 -->

    <!-- 최근 주문 시작 { -->
    <section id="smb_my_od">
        <div class="smb_panel_h">
            <h2>최근 주문</h2>
            <a class="smb_panel_more" href="./orderinquiry.php">더보기</a>
        </div>
        <?php
        // 최근 주문 8건(Figma) — 목록·상세와 같은 공용 서브(orderinquiry.sub.php, 상품명 열 포함).
        define("_ORDERINQUIRY_", true);
        $limit = " limit 0, 8 ";
        include G5_SHOP_PATH.'/orderinquiry.sub.php';
        ?>
    </section>
    <!-- } 최근 주문 끝 -->

</div>
<!-- } 마이페이지 콘텐츠 끝 -->

<script>
(function () {
    var KEY = 'sp_my_ov_open';
    var btn = document.getElementById('smb_my_ov_toggle');
    var body = document.getElementById('smb_my_ov_body');
    var txt = btn ? btn.querySelector('.smb_toggle_txt') : null;
    if (!btn || !body) return;
    function apply(open) {
        body.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.classList.toggle('is-open', open);
        if (txt) txt.textContent = open ? '내 정보 접기' : '내 정보 보기';
    }
    var saved = false;
    try { saved = localStorage.getItem(KEY) === '1'; } catch (e) { /* private mode */ }
    apply(saved);
    btn.addEventListener('click', function () {
        var open = body.hidden; // 현재 숨김이면 펼친다
        apply(open);
        try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) { /* noop */ }
    });
})();
</script>

<?php
include_once("./_tail.php");
