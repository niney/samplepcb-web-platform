<?php
if (!defined("_GNUBOARD_")) exit; // 개별 페이지 접근 불가

$g5['title'] = '주문상세내역';
include_once('./_head.php');

// LG 현금영수증 JS
if($od['od_pg'] == 'lg') {
    if($default['de_card_test']) {
    echo '<script language="JavaScript" src="'.SHOP_TOSSPAYMENTS_CASHRECEIPT_TEST_JS.'"></script>'.PHP_EOL;
    } else {
        echo '<script language="JavaScript" src="'.SHOP_TOSSPAYMENTS_CASHRECEIPT_REAL_JS.'"></script>'.PHP_EOL;
    }
}
?>

<!-- 주문상세내역 시작 { -->
<div id="sod_fin">
    <div id="sod_fin_no">주문번호 <strong><?php echo $od_id; ?></strong></div>

    <?php
    // 무통장 입금 안내 — 주문 직후 고객이 도착하는 화면이 여기다(orderformupdate.php 가 전용
    // 완료 페이지 없이 이리로 보낸다). 그런데 정작 "얼마를 어디로" 는 페이지 한참 아래 결제정보
    // 안에 흩어져 있고, 결제금액 칸은 미입금이면 '아직 입금되지 않았거나…' 로 뜬다. 선입금 후
    // 제조인 PCB 에서 가장 비싼 마찰이라 상단에 못박는다. 계산식은 아래 결제정보 블록과 동일.
    $sp_notice_misu = ($od['od_cart_price'] + $od['od_send_cost'] + $od['od_send_cost2']
                        - $od['od_cart_coupon'] - $od['od_coupon'] - $od['od_send_coupon']
                        - $od['od_cancel_price'])
                    - ($od['od_receipt_price'] + $od['od_receipt_point']);
    $sp_show_deposit_notice = ($od['od_settle_case'] === '무통장')
                            && $sp_notice_misu > 0
                            && !in_array($od['od_status'], array('취소', '반품', '품절'), true);
    if ($sp_show_deposit_notice):
    ?>
    <div class="sp-deposit-notice">
        <div class="sp-deposit-notice__head">
            <b>입금 안내</b>
            <span>아직 입금이 확인되지 않았습니다 — 아래 계좌로 입금해 주시면 제작이 시작됩니다.</span>
        </div>
        <dl class="sp-deposit-notice__list">
            <div>
                <dt>입금하실 금액</dt>
                <dd class="sp-deposit-notice__amount"><?php echo display_price($sp_notice_misu); ?></dd>
            </div>
            <?php if ($od['od_bank_account']): ?>
            <div>
                <dt>입금 계좌</dt>
                <dd>
                    <span id="sp-deposit-account"><?php echo get_text($od['od_bank_account']); ?></span>
                    <button type="button" class="sp-deposit-notice__copy" onclick="spCopyDepositAccount(this)">복사</button>
                </dd>
            </div>
            <?php endif; ?>
            <?php if ($od['od_deposit_name']): ?>
            <div>
                <dt>입금자명</dt>
                <dd><?php echo get_text($od['od_deposit_name']); ?></dd>
            </div>
            <?php endif; ?>
        </dl>
        <p class="sp-deposit-notice__note">입금자명이 다르면 확인이 늦어질 수 있습니다. 입금이 확인되면 메일로 알려드립니다.</p>
    </div>
    <script>
    function spCopyDepositAccount(btn) {
        var el = document.getElementById('sp-deposit-account');
        if (!el) return;
        var text = el.textContent.trim();
        var done = function () {
            var prev = btn.textContent;
            btn.textContent = '복사됨';
            setTimeout(function () { btn.textContent = prev; }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () {});
            return;
        }
        // 구형 브라우저·비 HTTPS 폴백
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {}
        document.body.removeChild(ta);
    }
    </script>
    <?php endif; ?>
    <section id="sod_fin_list">
        <h2>주문하신 상품</h2>

        <?php
        $st_count1 = $st_count2 = 0;
        $custom_cancel = false;

        $sql = " select it_id, it_name, ct_send_cost, it_sc_type
                    from {$g5['g5_shop_cart_table']}
                    where od_id = '$od_id'
                    group by it_id
                    order by ct_id ";
        $result = sql_query($sql);
        ?>
        
        <div class="tbl_head03 tbl_wrap">
			<table>
	            <thead>
	            <tr class="th_line">
	            	<th scope="col" id="th_itname">상품명</th>
	                <th scope="col" id="th_itqty">총수량</th>
	                <th scope="col" id="th_itprice">판매가</th>
	                <th scope="col" id="th_itpt">포인트</th>
	                <th scope="col" id="th_itsd">배송비</th>
	                <th scope="col" id="th_itsum">소계</th>
	                <th scope="col" id="th_itst">상태</th>
	            </tr>
	            </thead>
	            <tbody>
	            <?php
	            for($i=0; $row=sql_fetch_array($result); $i++) {
	                $image = get_it_image($row['it_id'], 55, 55);
	
	                $sql = " select ct_id, it_name, ct_option, ct_qty, ct_price, ct_point, ct_status, io_type, io_price
	                            from {$g5['g5_shop_cart_table']}
	                            where od_id = '$od_id'
	                              and it_id = '{$row['it_id']}'
	                            order by io_type asc, ct_id asc ";
	                $res = sql_query($sql);
	                $rowspan = sql_num_rows($res) + 1;
	
	                // 합계금액 계산
	                $sql = " select SUM(IF(io_type = 1, (io_price * ct_qty), ((ct_price + io_price) * ct_qty))) as price,
	                                SUM(ct_qty) as qty
	                            from {$g5['g5_shop_cart_table']}
	                            where it_id = '{$row['it_id']}'
	                              and od_id = '$od_id' ";
	                $sum = sql_fetch($sql);
	
	                // 배송비
	                switch($row['ct_send_cost'])
	                {
	                    case 1:
	                        $ct_send_cost = '착불';
	                        break;
	                    case 2:
	                        $ct_send_cost = '무료';
	                        break;
	                    default:
	                        $ct_send_cost = '선불';
	                        break;
	                }
	
	                // 조건부무료
	                if($row['it_sc_type'] == 2) {
	                    $sendcost = get_item_sendcost($row['it_id'], $sum['price'], $sum['qty'], $od_id);
	
	                    if($sendcost == 0)
	                        $ct_send_cost = '무료';
	                }
	
	                for($k=0; $opt=sql_fetch_array($res); $k++) {
	                    if($opt['io_type'])
	                        $opt_price = $opt['io_price'];
	                    else
	                        $opt_price = $opt['ct_price'] + $opt['io_price'];
	
	                    $sell_price = $opt_price * $opt['ct_qty'];
	                    $point = $opt['ct_point'] * $opt['ct_qty'];

                    // 견적 행: 거버 썸네일 우선(서버 서명 URL), 없으면 위 템플릿 이미지 폴백.
                    // extend/sp_quote_cart.extend.php sp_quote_thumb_url() ④ 참조. 주문완료 후에도
                    // 카트 행(ct_id)이 od_id=주문번호로 살아있어 그대로 해석된다.
                    // 이름은 **줄(ct_id)별**로 찍는다 — 위 그룹 SELECT 는 it_id 로 묶여 있어
                    // $row['it_name'] 은 그룹 대표 하나뿐이다. PCB 견적은 전부 같은 템플릿
                    // 상품이라 한 주문서의 여러 줄이 통째로 같은 이름으로 보였다(여정 10호 X7):
                    // 어느 줄이 취소됐는지 고객이 화면에서 구별할 수 없었다. 줄별 이름은 이미
                    // 안쪽 SELECT 가 가져와 있다(it_name → $opt['it_name']).
                    $opt_it_name = isset($opt['it_name']) ? $opt['it_name'] : $row['it_name'];
                    $thumb = function_exists('sp_quote_thumb_url') ? sp_quote_thumb_url($opt['ct_id']) : '';
                    $row_image = $thumb !== ''
                        ? '<img src="'.$thumb.'" alt="'.get_text($opt_it_name).'" width="55" height="55">'
                        : $image;
	
	                    if($k == 0) {
	            ?>
	            <?php } ?>
	            <tr>
	                <td headers="th_itopt" class="td_prd">
	                	<div class="sod_img"><?php echo $row_image; ?></div>
	                	<div class="sod_name">
		                	<a href="<?php echo shop_item_url($row['it_id']); ?>"><?php echo get_text($opt_it_name); ?></a><br>
		                	<div class="sod_opt"><?php echo get_text($opt['ct_option']); ?></div>
	                	</div>
	                </td>
	                <td headers="th_itqty" class="td_mngsmall"><?php echo number_format($opt['ct_qty']); ?></td>
	                <td headers="th_itprice" class="td_numbig text_right"><?php echo number_format($opt_price); ?></td>
	                <td headers="th_itpt" class="td_numbig text_right"><?php echo number_format($point); ?></td>
	                <td headers="th_itsd" class="td_dvr"><?php echo $ct_send_cost; ?></td>
	                <td headers="th_itsum" class="td_numbig text_right"><?php echo number_format($sell_price); ?></td>
	                <td headers="th_itst" class="td_mngsmall"><?php echo function_exists('sp_order_status_customer') ? sp_order_status_customer($opt['ct_status'])['label'] : $opt['ct_status']; ?></td>
	            </tr>
	            <?php
	                    $tot_point       += $point;
	
	                    $st_count1++;
	                    if($opt['ct_status'] == '주문')
	                        $st_count2++;
	                }
	            }
	
	            // 주문 상품의 상태가 모두 주문이면 고객 취소 가능
	            if($st_count1 > 0 && $st_count1 == $st_count2)
	                $custom_cancel = true;
	            ?>
	            </tbody>
            </table>
        </div>

        <?php
        // ── PCB 제작 진행 단계(P4.13) — od 상태('입금' 등)와 별개로 실제 제작이
        // 어디까지 왔는지 보여준다(sp 축 파생, od 무접촉 — D6 수동 유지). 발주 전이면
        // 항목이 없어 섹션 자체가 나오지 않는다.
        $sp_progress = function_exists('sp_pcb_progress') ? sp_pcb_progress($od_id) : array();
        if ($sp_progress):
        ?>
        <section id="sp_progress_wrap">
            <h2>제작 진행 상황</h2>
            <ul class="sp_progress_list">
                <?php foreach ($sp_progress as $pg): ?>
                <li class="sp_progress_item">
                    <span class="sp_eq_badge <?php echo $pg['stage'] === 'received' ? 'sp_eq_ok' : 'sp_eq_wait'; ?>">
                        <?php echo get_text($pg['label']); ?>
                    </span>
                    <strong class="sp_progress_proj"><?php echo get_text($pg['projectName']); ?></strong>
                    <?php
                    // 좌표파일(메탈마스크) — **통보 없는 열람**. 요청도 결정도 없이 그냥 놓아 둔다
                    // (요청하는 고객이 있어서다 — 사용자 결정 2026-08-16). 공개 여부·파일명 중립화는
                    // 전부 sp-node 판정이라 여기서는 있으면 링크만 건다.
                    if (!empty($pg['coordFile'])):
                    ?>
                    <a class="sp_progress_file" href="<?php echo sp_pcb_coord_file_url($pg['coordFile']['fileId']); ?>">
                        ⬇ <?php echo get_text($pg['coordFile']['name']); ?>
                    </a>
                    <?php endif; ?>
                </li>
                <?php endforeach; ?>
            </ul>
        </section>
        <?php endif; ?>

        <?php
        // ── PCB 제조 확인 요청(P4.1, docs/PCB_PARTNER_TRACK.md D16) ──────────────
        // 협력사 EQ 를 관리자가 고객에게 물어본 건. 판정·저장은 sp-node 가 하고 여기서는
        // 화면만 그린다. 메일의 [주문내역에서 확인하기] 는 이 섹션(#eq-{id})으로 온다.
        // ⚠ 협력사명·발주서 정보는 노출하지 않는다 — 고객에게 공급망을 드러내지 않는다.
        $sp_eq_reviews = function_exists('sp_pcb_eq_reviews') ? sp_pcb_eq_reviews($od_id) : array();
        // 열린(회신 대기) 요청이 하나라도 있는지 — 안내문을 무조건 "승인 또는 반려해
        // 주세요"로 띄우면, 이미 끝났거나 취소된 이력만 남은 화면에서 없는 버튼을
        // 찾게 된다(2026-08-10 실측: 관리자 EQ 승인이 열린 요청을 자동 취소한 뒤
        // 완료된 주문에서도 이 문장이 그대로 떴다).
        $sp_eq_has_open = false;
        foreach ($sp_eq_reviews as $sp_eq_rv) {
            if ($sp_eq_rv['status'] === 'requested') { $sp_eq_has_open = true; break; }
        }
        if ($sp_eq_reviews):
        ?>
        <section id="sp_eq_wrap">
            <h2><?php echo $sp_eq_has_open ? '제조 확인 요청' : '제조 확인 이력'; ?></h2>
            <p class="sp_eq_intro">
                <?php if ($sp_eq_has_open): ?>
                    제조 전 확인이 필요한 사항입니다. 내용을 보시고 승인 또는 반려해 주세요.
                <?php else: ?>
                    지난 제조 확인 내역입니다 — 지금 회신하실 것은 없습니다.
                <?php endif; ?>
            </p>

            <?php foreach ($sp_eq_reviews as $rv):
                $st  = sp_pcb_eq_status_label($rv['status']);
                $open = ($rv['status'] === 'requested');
            ?>
            <div class="sp_eq_item <?php echo $open ? 'sp_eq_open' : ''; ?>" id="eq-<?php echo (int) $rv['id']; ?>">
                <div class="sp_eq_head">
                    <span class="sp_eq_badge <?php echo $st['cls']; ?>"><?php echo $st['label']; ?></span>
                    <strong class="sp_eq_proj"><?php echo get_text($rv['projectName']); ?></strong>
                    <?php if ($open && !empty($rv['overdue'])): ?>
                        <span class="sp_eq_badge sp_eq_no">회신 기한 지남</span>
                    <?php elseif ($open && !empty($rv['dueOn'])): ?>
                        <span class="sp_eq_due">회신 기한 <?php echo date('Y-m-d', strtotime($rv['dueOn'])); ?></span>
                    <?php endif; ?>
                </div>

                <div class="sp_eq_msg"><?php echo nl2br(get_text($rv['message'])); ?></div>

                <?php if (!empty($rv['files'])): ?>
                <ul class="sp_eq_files">
                    <?php foreach ($rv['files'] as $f): ?>
                    <li>
                        <a href="<?php echo sp_pcb_eq_file_url($rv['id'], $f['fileId']); ?>">
                            ⬇ <?php echo get_text($f['name']); ?>
                        </a>
                    </li>
                    <?php endforeach; ?>
                </ul>
                <?php endif; ?>

                <?php if ($open): ?>
                <form method="post" action="<?php echo G5_URL; ?>/spcb/api/eq-decide" class="sp_eq_form">
                    <!-- get_token() 은 hidden 을 출력하지 않고 **값만 반환**한다 —
                         그냥 echo 하면 토큰이 화면에 그대로 찍힌다(2026-08-07 실측). -->
                    <input type="hidden" name="token" value="<?php echo get_token(); ?>">
                    <input type="hidden" name="od_id" value="<?php echo get_text($od_id); ?>">
                    <input type="hidden" name="review_id" value="<?php echo (int) $rv['id']; ?>">
                    <input type="hidden" name="decision" value="approve" class="sp_eq_decision">
                    <label class="sp_eq_note_label">
                        의견 <span>(반려할 때는 사유를 꼭 적어 주세요)</span>
                        <textarea name="note" rows="2" maxlength="2000" placeholder="예) 0.35mm 로 변경해 주세요."></textarea>
                    </label>
                    <div class="sp_eq_btns">
                        <button type="submit" class="sp_eq_approve" data-decision="approve">승인</button>
                        <button type="submit" class="sp_eq_reject" data-decision="reject">반려</button>
                    </div>
                </form>
                <?php else: ?>
                <p class="sp_eq_done">
                    <?php echo $st['label']; ?>
                    <?php if (!empty($rv['decidedAt'])): ?>
                        · <?php echo date('Y-m-d', strtotime($rv['decidedAt'])); ?>
                    <?php endif; ?>
                    <?php if ($rv['status'] === 'canceled'): ?>
                        <?php // 사유 없이 '요청 취소'만 뜨면 고객은 무슨 일이 있었는지 알 수 없다. ?>
                        <span class="sp_eq_note">담당자가 확인을 마쳐 회신 요청이 취소되었습니다 — 따로 하실 일은 없습니다.</span>
                    <?php endif; ?>
                    <?php if (!empty($rv['decisionNote'])): ?>
                        <span class="sp_eq_note">의견: <?php echo get_text($rv['decisionNote']); ?></span>
                    <?php endif; ?>
                </p>
                <?php endif; ?>
            </div>
            <?php endforeach; ?>
        </section>
        <script>
        // 되돌릴 수 없는 결정이라 한 번 더 묻는다. 네이티브 confirm 대신 공용 커스텀 팝업
        // (theme/sp-lite/js/sp-dialog.js) — 브라우저마다 모양이 다르고 사이트 톤과 따로 논다.
        // spDialog 가 Promise 라 submit 을 일단 막고, 승낙을 받은 뒤 프로그램적으로 제출한다.
        document.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('.sp_eq_btns button') : null;
            if (!btn || !btn.form) return;
            btn.form.querySelector('.sp_eq_decision').value = btn.getAttribute('data-decision');
        });
        document.addEventListener('submit', function (e) {
            var form = e.target;
            if (!form.classList || !form.classList.contains('sp_eq_form')) return;
            if (form.dataset.spConfirmed === '1') return; // 승낙 후 재제출 — 그대로 통과
            e.preventDefault();

            var approve = form.querySelector('.sp_eq_decision').value === 'approve';
            var note = form.querySelector('textarea[name=note]').value.trim();
            if (!approve && note.length < 2) {
                window.spDialog.alert('반려 사유를 입력해 주세요.', { tone: 'danger' });
                return;
            }
            window.spDialog
                .confirm(
                    approve
                        ? '이 내용으로 승인하시겠습니까?\n승인 후에는 그대로 제조가 진행됩니다.'
                        : '반려하시겠습니까?\n담당자가 사유를 확인해 다시 연락드립니다.',
                    {
                        title: approve ? '제조 확인 승인' : '제조 확인 반려',
                        tone: approve ? 'success' : 'danger',
                        okText: approve ? '승인' : '반려',
                    },
                )
                .then(function (ok) {
                    if (!ok) return;
                    form.dataset.spConfirmed = '1';
                    form.submit();
                });
        });
        </script>
        <?php endif; ?>

        <?php
        // ── PCB A/S 접수(P5, docs/PCB_PARTNER_TRACK.md §9 A/S) ──────────────────
        // 배송·완료 후 제품 문제 접수. 판정·저장은 sp-node 가 하고 여기서는 화면만
        // 그린다 — 접수 가능 여부(eligibility)도 서버 판정을 그대로 표시한다.
        // 접수 폼은 spcb/api/claim-create 브리지로 multipart POST(사진 동반 1회 제출).
        // ⚠ 협력사명·발주 정보는 노출하지 않는다(EQ 와 같은 규칙).
        $sp_claim_specs = function_exists('sp_pcb_claims') ? sp_pcb_claims($od_id) : array();
        // 접수 가능한 스펙도, 이력도 없으면 섹션 자체를 내지 않는다(빈 제목 방지).
        $sp_claim_visible = false;
        foreach ($sp_claim_specs as $sp_cs) {
            if (!empty($sp_cs['eligibility']['canSubmit']) || !empty($sp_cs['claims'])) {
                $sp_claim_visible = true;
                break;
            }
        }
        if ($sp_claim_visible):
            $sp_claim_kinds    = sp_pcb_claim_kinds();
            $sp_claim_remedies = sp_pcb_claim_remedies();
        ?>
        <section id="sp_as_wrap">
            <h2>PCB A/S</h2>
            <p class="sp_eq_intro">받으신 제품에 문제가 있으면 접수해 주세요. 담당자가 검토 후 처리 방안을 안내드립니다.</p>

            <?php foreach ($sp_claim_specs as $cs):
                if (empty($cs['eligibility']['canSubmit']) && empty($cs['claims'])) continue;
            ?>
            <div class="sp_eq_item">
                <div class="sp_eq_head">
                    <strong class="sp_eq_proj"><?php echo get_text($cs['projectName']); ?></strong>
                    <span class="sp_eq_due">주문 수량 <?php echo (int) $cs['qty']; ?></span>
                </div>

                <?php foreach ($cs['claims'] as $cl):
                    $st = sp_pcb_claim_status_label($cl['status']);
                ?>
                <div class="sp_as_claim">
                    <div class="sp_eq_head">
                        <span class="sp_eq_badge <?php echo $st['cls']; ?>"><?php echo $st['label']; ?></span>
                        <span class="sp_as_meta">
                            <?php echo isset($sp_claim_kinds[$cl['kind']]) ? $sp_claim_kinds[$cl['kind']] : get_text($cl['kind']); ?>
                            · 문제 수량 <?php echo (int) $cl['affectedQty']; ?>/<?php echo (int) $cl['orderedQty']; ?>
                            · <?php echo date('Y-m-d', strtotime($cl['submittedAt'])); ?>
                        </span>
                    </div>
                    <div class="sp_eq_msg"><?php echo nl2br(get_text($cl['description'])); ?></div>
                    <?php if (!empty($cl['adminResponse'])): ?>
                    <p class="sp_as_reply">
                        <b>답변<?php
                            $sp_res_label = sp_pcb_claim_resolution_label(isset($cl['resolutionKind']) ? $cl['resolutionKind'] : '');
                            if ($sp_res_label !== '') echo ' · ' . $sp_res_label;
                        ?></b> — <?php echo nl2br(get_text($cl['adminResponse'])); ?>
                    </p>
                    <?php elseif ($cl['status'] === 'open' || $cl['status'] === 'reviewing'): ?>
                    <p class="sp_eq_done">담당자가 확인하고 있습니다 — 결과는 이메일과 이 화면에서 안내됩니다.</p>
                    <?php endif; ?>
                </div>
                <?php endforeach; ?>

                <?php if (!empty($cs['eligibility']['canSubmit'])): ?>
                <details class="sp_as_form_wrap">
                    <summary>A/S 접수하기</summary>
                    <form method="post" action="<?php echo G5_URL; ?>/spcb/api/claim-create" enctype="multipart/form-data" class="sp_as_form">
                        <!-- get_token() 은 값만 반환한다(hidden 미출력 — EQ 폼과 같은 함정 주의). -->
                        <input type="hidden" name="token" value="<?php echo get_token(); ?>">
                        <input type="hidden" name="od_id" value="<?php echo get_text($od_id); ?>">
                        <input type="hidden" name="spec_id" value="<?php echo (int) $cs['specId']; ?>">
                        <div class="sp_as_grid">
                            <label>문제 유형
                                <select name="kind" required>
                                    <?php foreach ($sp_claim_kinds as $k => $lb): ?>
                                    <option value="<?php echo $k; ?>"><?php echo $lb; ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </label>
                            <label>문제 수량
                                <input type="number" name="affected_qty" min="1" max="<?php echo (int) $cs['qty']; ?>" value="<?php echo (int) $cs['qty']; ?>" required>
                            </label>
                            <label>희망 처리
                                <select name="requested_remedy" required>
                                    <?php foreach ($sp_claim_remedies as $k => $lb): ?>
                                    <option value="<?php echo $k; ?>"><?php echo $lb; ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </label>
                        </div>
                        <label class="sp_eq_note_label">증상 설명 <span>(어떤 문제인지 구체적으로 적어 주세요)</span>
                            <textarea name="description" rows="3" maxlength="2000" required placeholder="예) 10장 중 3장이 전원 인가 시 동작하지 않습니다."></textarea>
                        </label>
                        <label class="sp_eq_note_label">사진·자료 <span>(불량 부위 사진이 있으면 처리가 빨라집니다)</span>
                            <input type="file" name="photos[]" multiple accept="image/*,.pdf,.zip">
                        </label>
                        <label class="sp_as_ack">
                            <input type="checkbox" name="acknowledge" value="1" required>
                            접수만으로 주문 취소·환불이 자동 진행되지 않음을 확인했습니다.
                        </label>
                        <div class="sp_eq_btns">
                            <button type="submit" class="sp_eq_approve">A/S 접수</button>
                        </div>
                    </form>
                </details>
                <?php elseif (!empty($cs['eligibility']['reason']) && $cs['eligibility']['reason'] === 'ACTIVE_CLAIM'): ?>
                <p class="sp_eq_done">처리 중인 접수가 있어 새 접수는 잠시 닫혀 있습니다.</p>
                <?php endif; ?>
            </div>
            <?php endforeach; ?>
        </section>
        <?php endif; ?>

        <div id="sod_sts_wrap">
            <span class="sound_only">상품 상태 설명</span>
            <button type="button" id="sod_sts_explan_open" class="btn_frmline">상태설명보기</button>
            <div id="sod_sts_explan">
                <dl id="sod_fin_legend">
                    <dt>주문</dt>
                    <dd>주문이 접수되었습니다.
                    <dt>입금</dt>
                    <dd>입금(결제)이 완료 되었습니다.
                    <dt>준비</dt>
                    <dd>상품 준비 중입니다.
                    <dt>배송</dt>
                    <dd>상품 배송 중입니다.
                    <dt>완료</dt>
                    <dd>상품 배송이 완료 되었습니다.
                </dl>
                <button type="button" id="sod_sts_explan_close" class="btn_frmline">상태설명닫기</button>
            </div>
        </div>
    </section>
    <div class="sod_left">
        <h2>결제/배송 정보</h2>
        <?php
        // 총계 = 주문상품금액합계 + 배송비 - 상품할인 - 결제할인 - 배송비할인
        $tot_price = $od['od_cart_price'] + $od['od_send_cost'] + $od['od_send_cost2']
                        - $od['od_cart_coupon'] - $od['od_coupon'] - $od['od_send_coupon']
                        - $od['od_cancel_price'];

        $receipt_price  = $od['od_receipt_price']
                        + $od['od_receipt_point'];
        $cancel_price   = $od['od_cancel_price'];

        $misu = true;
        // 결제·부분취소·환불 이후의 정본은 주문 상태 변경 경로가 재계산해 저장한 od_misu다.
        // 화면에서 총액-수납액만 다시 계산하면 od_refund_price가 빠져, 환불 완료 주문도
        // 음수 미수로 남고 완불·현금영수증 판정이 DB와 어긋난다.
        $misu_price = (int) $od['od_misu'];

        if ($misu_price == 0 && ($od['od_cart_price'] > $od['od_cancel_price'])) {
            $wanbul = " (완불)";
            $misu = false; // 미수금 없음
        }
        else
        {
            $wanbul = display_price($receipt_price);
        }

        // 결제정보처리
        if($od['od_receipt_price'] > 0)
            $od_receipt_price = display_price($od['od_receipt_price']);
        else
            $od_receipt_price = '아직 입금되지 않았거나 입금정보를 입력하지 못하였습니다.';

        $app_no_subj = '';
        $disp_bank = true;
        $disp_receipt = false;
        if($od['od_settle_case'] == '신용카드' || $od['od_settle_case'] == 'KAKAOPAY' || is_inicis_order_pay($od['od_settle_case']) ) {
            $app_no_subj = '승인번호';
            $app_no = $od['od_app_no'];
            $disp_bank = false;
            $disp_receipt = true;
        } else if($od['od_settle_case'] == '간편결제') {
            $app_no_subj = '승인번호';
            $app_no = $od['od_app_no'];
            $disp_bank = false;
            $disp_receipt = true;
        } else if($od['od_settle_case'] == '휴대폰') {
            $app_no_subj = '휴대폰번호';
            $app_no = $od['od_bank_account'];
            $disp_bank = false;
            $disp_receipt = true;
        } else if($od['od_settle_case'] == '가상계좌' || $od['od_settle_case'] == '계좌이체') {
            $app_no_subj = '거래번호';
            $app_no = $od['od_tno'];

			if( function_exists('shop_is_taxsave') && $misu_price == 0 && shop_is_taxsave($od, true) === 2 ){
				$disp_receipt = true;
			}
        }
        ?>

        <section id="sod_fin_orderer">
            <h3>주문하신 분</h3>

            <div class="tbl_head01 tbl_wrap">
                <table>

                <tbody>
                <tr>
                    <th scope="row">이 름</th>
                    <td><?php echo get_text($od['od_name']); ?></td>
                </tr>
                <tr>
                    <th scope="row">전화번호</th>
                    <td><?php echo get_text($od['od_tel']); ?></td>
                </tr>
                <tr>
                    <th scope="row">핸드폰</th>
                    <td><?php echo get_text($od['od_hp']); ?></td>
                </tr>
                <tr>
                    <th scope="row">주 소</th>
                    <td><?php echo get_text(sprintf("(%s%s)", $od['od_zip1'], $od['od_zip2']).' '.print_address($od['od_addr1'], $od['od_addr2'], $od['od_addr3'], $od['od_addr_jibeon'])); ?></td>
                </tr>
                <tr>
                    <th scope="row">E-mail</th>
                    <td><?php echo get_text($od['od_email']); ?></td>
                </tr>
                </tbody>
                </table>
            </div>
        </section>

        <section id="sod_fin_receiver">
            <h3>받으시는 분</h3>

            <div class="tbl_head01 tbl_wrap">
                <table>
          
                <tbody>
                <tr>
                    <th scope="row">이 름</th>
                    <td><?php echo get_text($od['od_b_name']); ?></td>
                </tr>
                <tr>
                    <th scope="row">전화번호</th>
                    <td><?php echo get_text($od['od_b_tel']); ?></td>
                </tr>
                <tr>
                    <th scope="row">핸드폰</th>
                    <td><?php echo get_text($od['od_b_hp']); ?></td>
                </tr>
                <tr>
                    <th scope="row">주 소</th>
                    <td><?php echo get_text(sprintf("(%s%s)", $od['od_b_zip1'], $od['od_b_zip2']).' '.print_address($od['od_b_addr1'], $od['od_b_addr2'], $od['od_b_addr3'], $od['od_b_addr_jibeon'])); ?></td>
                </tr>
                <?php
                // 희망배송일을 사용한다면
                if ($default['de_hope_date_use'])
                {
                ?>
                <tr>
                    <th scope="row">희망배송일</th>
                    <td><?php echo substr($od['od_hope_date'],0,10).' ('.get_yoil($od['od_hope_date']).')' ;?></td>
                </tr>
                <?php }
                if ($od['od_memo'])
                {
                ?>
                <tr>
                    <th scope="row">전하실 말씀</th>
                    <td><?php echo conv_content($od['od_memo'], 0); ?></td>
                </tr>
                <?php } ?>
                </tbody>
                </table>
            </div>
        </section>

        <section id="sod_fin_dvr">
            <h3>배송정보</h3>

            <div class="tbl_head01 tbl_wrap">
                <table>
	                <tbody>
	                <?php if ($od['od_invoice'] && $od['od_delivery_company']) { ?>
	                <tr>
	                    <th scope="row">배송회사</th>
	                    <td><?php echo $od['od_delivery_company']; ?> <?php echo get_delivery_inquiry($od['od_delivery_company'], $od['od_invoice'], 'dvr_link'); ?></td>
	                </tr>
	                <tr>
	                    <th scope="row">운송장번호</th>
	                    <td><?php echo $od['od_invoice']; ?></td>
	                </tr>
	                <tr>
	                    <th scope="row">배송일시</th>
	                    <td><?php echo $od['od_invoice_time']; ?></td>
	                </tr>
	                <?php } else { ?>
	                <tr>
	                    <td class="empty_table">아직 배송하지 않았거나 배송정보를 입력하지 못하였습니다.</td>
	                </tr>
	                <?php } ?>
	                </tbody>
                </table>
            </div>
        </section>
    </div>

    <div class="sod_right">
        <ul id="sod_bsk_tot2">
            <li class="sod_bsk_dvr">
                <span>주문총액</span>
                <strong><?php echo number_format($od['od_cart_price']); ?> 원</strong>
            </li>
            <?php if($od['od_cart_coupon'] > 0) { ?>
            <li class="sod_bsk_dvr">
                <span>개별상품 쿠폰할인</span>
                <strong><?php echo number_format($od['od_cart_coupon']); ?> 원</strong>
            </li>
            <?php } ?>
            <?php if($od['od_coupon'] > 0) { ?>
            <li class="sod_bsk_dvr">
                <span>주문금액 쿠폰할인</span>
                <strong><?php echo number_format($od['od_coupon']); ?> 원</strong>
            </li>
            <?php } ?>
            <?php if ($od['od_send_cost'] > 0) { ?>
            <li class="sod_bsk_dvr">
                <span>배송비</span>
                <strong><?php echo number_format($od['od_send_cost']); ?> 원</strong>
            </li>
            <?php } ?>
            <?php if($od['od_send_coupon'] > 0) { ?>
            <li class="sod_bsk_dvr">
                <span>배송비 쿠폰할인</span>
                <strong><?php echo number_format($od['od_send_coupon']); ?> 원</strong>
            </li>
            <?php } ?>
            <?php if ($od['od_send_cost2'] > 0) { ?>
            <li class="sod_bsk_dvr">
                <span>추가배송비</span>
                <strong><?php echo number_format($od['od_send_cost2']); ?> 원</strong>
            </li>
            <?php } ?>
            <?php if ($od['od_cancel_price'] > 0) { ?>
            <li class="sod_bsk_dvr">
                <span>취소금액</span>
                <strong><?php echo number_format($od['od_cancel_price']); ?> 원</strong> 
            </li>
            <?php } ?>
            <li class="sod_bsk_cnt">
                <span>총계</span>
                <strong><?php echo number_format($tot_price); ?> 원</strong>
            </li>
            <li class="sod_bsk_point">
                <span>적립포인트</span>
                <strong><?php echo number_format($tot_point); ?> 점</strong>
            </li>
            
            <li class="sod_fin_tot"><span>총 구매액</span><strong><?php echo display_price($tot_price); ?></strong></li>
            <?php
            if ($misu_price > 0) {
            echo '<li class="sod_fin_tot">';
            echo '<span>미결제액</span>'.PHP_EOL;
            echo '<strong>'.display_price($misu_price).'</strong>';
            echo '</li>';
            }
            ?>
            <li id="alrdy" class="sod_fin_tot">
            	<span>결제액</span>
                <strong><?php echo $wanbul; ?></strong>
                <?php if( $od['od_receipt_point'] ){    //포인트로 결제한 내용이 있으면 ?>
                <div>
                    <p><span class="title">포인트 결제</span><?php echo number_format($od['od_receipt_point']); ?>점</p>
                    <p><span class="title">실결제</span><?php echo number_format($od['od_receipt_price']); ?>원</p>
                </div>
                <?php } ?>
            </li>
        </ul>
        
        <section id="sod_fin_pay">
            <h3>결제정보</h3>
            <ul>
	            <li>
	                <strong>주문번호</strong>
	                <span><?php echo $od_id; ?></span>
	            </li>
	            <li>
	                <strong>주문일시</strong>
	                <span><?php echo $od['od_time']; ?></span>
	            </li>
	            <li>
	                <strong>결제방식</strong>
	                <span><?php echo check_pay_name_replace($od['od_settle_case'], $od, 1); ?></span>
	            </li>
	            <li>
	                <strong>결제금액</strong>
	                <span><?php echo $od_receipt_price; ?></span>
	            </li>
	            <?php
	            if($od['od_receipt_price'] > 0)
	            {
	            ?>
	            <li>
	                <strong>결제일시</strong>
	                <span><?php echo $od['od_receipt_time']; ?></span>
	            </li>
	            <?php
	            }
	
	            // 승인번호, 휴대폰번호, 거래번호
	            if($app_no_subj && $app_no)
	            {
	            ?>
	            <li>
	                <strong><?php echo $app_no_subj; ?></strong>
	                <span><?php echo $app_no; ?></span>
	            </li>
	            <?php
	            }
	
	            // 계좌정보
	            if($disp_bank)
	            {
	            ?>
	            <li>
	                <strong>입금자명</strong>
	                <span><?php echo get_text($od['od_deposit_name']); ?></span>
	            </li>
	            <li>
	                <strong>입금계좌</strong>
	                <span><?php echo get_text($od['od_bank_account']); ?></span>
	            </li>
	            <?php
	            }
	
	            if($disp_receipt) {
	            ?>
	            <li>
	                <strong>영수증</strong>
	                <span>
	                    <?php
	                    if($od['od_settle_case'] == '휴대폰')
	                    {
	                        if($od['od_pg'] == 'lg') {
	                            require_once G5_SHOP_PATH.'/settle_lg.inc.php';
	                            $LGD_TID      = $od['od_tno'];
	                            $LGD_MERTKEY  = $config['cf_lg_mert_key'];
	                            $LGD_HASHDATA = md5($LGD_MID.$LGD_TID.$LGD_MERTKEY);
	
	                            $hp_receipt_script = 'showReceiptByTID(\''.$LGD_MID.'\', \''.$LGD_TID.'\', \''.$LGD_HASHDATA.'\');';
	                        } else if($od['od_pg'] == 'toss') {
	                            $hp_receipt_script = 'window.open(\'https://dashboard.tosspayments.com/receipt/phone?transactionId='.$od['od_tno'].'&ref=PX\',\'receipt\',\'width=430,height=700\');';
                            } else if($od['od_pg'] == 'inicis') {
	                            $hp_receipt_script = 'window.open(\'https://iniweb.inicis.com/DefaultWebApp/mall/cr/cm/mCmReceipt_head.jsp?noTid='.$od['od_tno'].'&noMethod=1\',\'receipt\',\'width=430,height=700\');';
	                        } else if($od['od_pg'] == 'nicepay') {
                                $hp_receipt_script = 'window.open(\'https://npg.nicepay.co.kr/issue/IssueLoader.do?type=0&TID='.$od['od_tno'].'&noMethod=1\',\'receipt\',\'width=430,height=700\');';
                            } else {
	                            $hp_receipt_script = 'window.open(\''.G5_BILL_RECEIPT_URL.'mcash_bill&tno='.$od['od_tno'].'&order_no='.$od['od_id'].'&trade_mony='.$od['od_receipt_price'].'\', \'winreceipt\', \'width=500,height=690,scrollbars=yes,resizable=yes\');';
	                        }
	                    ?>
	                    <a href="javascript:;" onclick="<?php echo $hp_receipt_script; ?>">영수증 출력</a>
	                    <?php
	                    }
	
	                    if($od['od_settle_case'] == '신용카드' || $od['od_settle_case'] == '간편결제' || is_inicis_order_pay($od['od_settle_case']) || (shop_is_taxsave($od, true) && $misu_price == 0) )
	                    {
	                        if($od['od_pg'] == 'lg') {
	                            require_once G5_SHOP_PATH.'/settle_lg.inc.php';
	                            $LGD_TID      = $od['od_tno'];
	                            $LGD_MERTKEY  = $config['cf_lg_mert_key'];
	                            $LGD_HASHDATA = md5($LGD_MID.$LGD_TID.$LGD_MERTKEY);
	
	                            $card_receipt_script = 'showReceiptByTID(\''.$LGD_MID.'\', \''.$LGD_TID.'\', \''.$LGD_HASHDATA.'\');';
	                        } else if($od['od_pg'] == 'toss') {
	                            $card_receipt_script = 'window.open(\'https://dashboard.tosspayments.com/receipt/redirection?transactionId='.$od['od_tno'].'&ref=PX\',\'receipt\',\'width=430,height=700\');';
                            } else if($od['od_pg'] == 'inicis') {
	                            $card_receipt_script = 'window.open(\'https://iniweb.inicis.com/DefaultWebApp/mall/cr/cm/mCmReceipt_head.jsp?noTid='.$od['od_tno'].'&noMethod=1\',\'receipt\',\'width=430,height=700\');';
	                        } else if($od['od_pg'] == 'nicepay') {
                                $card_receipt_script = 'window.open(\'https://npg.nicepay.co.kr/issue/IssueLoader.do?type=0&TID='.$od['od_tno'].'&noMethod=1\',\'receipt\',\'width=430,height=700\');';
                            } else {
	                            $card_receipt_script = 'window.open(\''.G5_BILL_RECEIPT_URL.'card_bill&tno='.$od['od_tno'].'&order_no='.$od['od_id'].'&trade_mony='.$od['od_receipt_price'].'\', \'winreceipt\', \'width=470,height=815,scrollbars=yes,resizable=yes\');';
	                        }
	                    ?>
	                    <a href="javascript:;" onclick="<?php echo $card_receipt_script; ?>">영수증 출력</a>
	                    <?php
	                    }
	
	                    if($od['od_settle_case'] == 'KAKAOPAY')
	                    {
	                        //$card_receipt_script = 'window.open(\'https://mms.cnspay.co.kr/trans/retrieveIssueLoader.do?TID='.$od['od_tno'].'&type=0\', \'popupIssue\', \'toolbar=no,location=no,directories=no,status=yes,menubar=no,scrollbars=yes,resizable=yes,width=420,height=540\');';
                            $card_receipt_script = 'window.open(\'https://iniweb.inicis.com/DefaultWebApp/mall/cr/cm/mCmReceipt_head.jsp?noTid='.$od['od_tno'].'&noMethod=1\',\'receipt\',\'width=430,height=700\');';
	                    ?>
	                    <a href="javascript:;" onclick="<?php echo $card_receipt_script; ?>">영수증 출력</a>
	                    <?php
	                    }
	                    ?>
	                </span>
	            </li>
	            <?php
	            }
	
	            if ($od['od_receipt_point'] > 0)
	            {
	            ?>
	            <li>
	                <strong>포인트사용</strong>
	                <span><?php echo display_point($od['od_receipt_point']); ?></span>
	            </li>
	
	            <?php
	            }
	
	            if ($od['od_refund_price'] > 0)
	            {
	            ?>
	            <li>
	                <strong>환불 금액</strong>
	                <span><?php echo display_price($od['od_refund_price']); ?></span>
	            </li>
	            <?php
	            }
	
                // 현금영수증 발급을 사용하는 경우 또는 현금영수증 발급을 한 주문건이면
	            if ((function_exists('shop_is_taxsave') && shop_is_taxsave($od)) || (function_exists('is_order_cashreceipt') && is_order_cashreceipt($od))) {
	                // 미수금이 없고 현금일 경우에만 현금영수증을 발급 할 수 있습니다.
	                if ($misu_price == 0) {
	            ?>
	            <li>
	                <strong class="letter-2px">현금영수증</strong>
	                <span>
	                <?php
	                if ($od['od_cash'] && is_order_cashreceipt($od))
	                {
	                    if($od['od_pg'] == 'lg') {
	                        require_once G5_SHOP_PATH.'/settle_lg.inc.php';
	
	                        switch($od['od_settle_case']) {
	                            case '계좌이체':
	                                $trade_type = 'BANK';
	                                break;
	                            case '가상계좌':
	                                $trade_type = 'CAS';
	                                break;
	                            default:
	                                $trade_type = 'CR';
	                                break;
	                        }
	                        $cash_receipt_script = 'javascript:showCashReceipts(\''.$LGD_MID.'\',\''.$od['od_id'].'\',\''.$od['od_casseqno'].'\',\''.$trade_type.'\',\''.$CST_PLATFORM.'\');';
	                    } else if($od['od_pg'] == 'toss') {
                            $cash_receipt_script = 'window.open(\'https://dashboard.tosspayments.com/receipt/mids/si_'.$config['cf_lg_mid'].'/orders/'.$od['od_id'].'/cash-receipt?ref=dashboard\',\'receipt\',\'width=430,height=700\');';
                        } else if($od['od_pg'] == 'inicis') {
	                        $cash = unserialize($od['od_cash_info']);
	                        $cash_receipt_script = 'window.open(\'https://iniweb.inicis.com/DefaultWebApp/mall/cr/cm/Cash_mCmReceipt.jsp?noTid='.$cash['TID'].'&clpaymethod=22\',\'showreceipt\',\'width=380,height=540,scrollbars=no,resizable=no\');';
	                    } else if($od['od_pg'] == 'nicepay') {
                            $cash_receipt_script = 'window.open(\'https://npg.nicepay.co.kr/issue/IssueLoader.do?type=1&TID='.$od['od_tno'].'&noMethod=1\',\'receipt\',\'width=430,height=700\');';
                        } else {
	                        require_once G5_SHOP_PATH.'/settle_kcp.inc.php';
	
	                        $cash = unserialize($od['od_cash_info']);
	                        $cash_receipt_script = 'window.open(\''.G5_CASH_RECEIPT_URL.$default['de_kcp_mid'].'&orderid='.$od_id.'&bill_yn=Y&authno='.$cash['receipt_no'].'\', \'taxsave_receipt\', \'width=360,height=647,scrollbars=0,menus=0\');';
	                    }
	                ?>
	                    <a href="javascript:;" onclick="<?php echo $cash_receipt_script; ?>" class="btn_frmline">현금영수증 확인하기</a>
	                <?php
	                }
	                else if (shop_is_taxsave($od))
	                {
	                ?>
	                    <a href="javascript:;" onclick="window.open('<?php echo G5_SHOP_URL; ?>/taxsave.php?od_id=<?php echo $od_id; ?>', 'taxsave', 'width=550,height=400,scrollbars=1,menus=0');" class="btn_frmline is-long-text">현금영수증을 발급하시려면 클릭하십시오.</a>
	                <?php } ?>
	                </span>
	            </li>
            <?php
                }
            }
            ?>
            </ul>
        </section>

        <section id="sod_fin_cancel">
            <?php
            // 취소한 내역이 없다면
            if ($cancel_price == 0) {
                if ($custom_cancel) {
            ?>
            <button type="button" class="sod_fin_c_btn">주문 취소하기</button>
			<div id="sod_cancel_pop">	
	            <div id="sod_fin_cancelfrm">
	            	<h2>주문취소</h2>
	                <form method="post" action="./orderinquirycancel.php" onsubmit="return fcancel_check(this);">
	                <input type="hidden" name="od_id" value="<?php echo $od['od_id']; ?>">
	                <input type="hidden" name="token" value="<?php echo $token; ?>">
	
	                <label for="cancel_memo" class="sound_only">취소사유</label>
	                <input type="text" name="cancel_memo" id="cancel_memo" required class="frm_input required" size="40" maxlength="100" placeholder="취소사유">
	                <input type="submit" value="확인" class="btn_frmline">
	                </form>
	                <button class="sod_cls_btn"><span class="sound_only">닫기</span><i class="fa fa-times" aria-hidden="true"></i></button>
		        </div>
		        <div class="sod_fin_bg"></div>
			</div>
			<script>
			$(function (){
				// sticky 주문 요약의 stacking context를 벗어나 모달이 페이지 전체를 덮도록 한다.
				var $cancel_pop = $("#sod_cancel_pop").appendTo(document.body);

				$(".sod_fin_c_btn").on("click", function() {
					$cancel_pop.show();
				});
				$(".sod_cls_btn").on("click", function() {
					$cancel_pop.hide();
				});
			});
			</script>

            <?php
                }
            } else {
            ?>
            <p>주문 취소, 반품, 품절된 내역이 있습니다.</p>
            <?php } ?>
        </section>
    </div>

    <?php if ($od['od_settle_case'] == '가상계좌' && $od['od_misu'] > 0 && $default['de_card_test'] && $is_admin && $od['od_pg'] == 'kcp') {
    preg_match("/\s{1}([^\s]+)\s?/", $od['od_bank_account'], $matchs);
    $deposit_no = trim($matchs[1]);
    ?>
    <p>관리자가 가상계좌 테스트를 한 경우에만 보입니다.</p>
    <div class="tbl_frm01 tbl_wrap">
        <form method="post" action="https://testadmin.kcp.co.kr/Modules/Noti/TEST_Vcnt_Noti.jsp" target="_blank">
        <table>
        <caption>모의입금처리</caption>
        <colgroup>
            <col class="grid_3">
            <col>
        </colgroup>
        <tbody>
        <tr>
            <th scope="col"><label for="e_trade_no">KCP 거래번호</label></th>
            <td><input type="text" name="e_trade_no" value="<?php echo $od['od_tno']; ?>"></td>
        </tr>
        <tr>
            <th scope="col"><label for="deposit_no">입금계좌</label></th>
            <td><input type="text" name="deposit_no" value="<?php echo $deposit_no; ?>"></td>
        </tr>
        <tr>
            <th scope="col"><label for="req_name">입금자명</label></th>
            <td><input type="text" name="req_name" value="<?php echo get_text($od['od_deposit_name']); ?>"></td>
        </tr>
        <tr>
            <th scope="col"><label for="noti_url">입금통보 URL</label></th>
            <td><input type="text" name="noti_url" value="<?php echo G5_SHOP_URL; ?>/settle_kcp_common.php"></td>
        </tr>
        </tbody>
        </table>
        <div id="sod_fin_test" class="btn_confirm">
            <input type="submit" value="입금통보 테스트" class="btn_submit">
        </div>
        </form>
    </div>
    <?php } ?>

</div>
<!-- } 주문상세내역 끝 -->

<script>
$(function() {
    $("#sod_sts_explan_open").on("click", function() {
        var $explan = $("#sod_sts_explan");
        if($explan.is(":animated"))
            return false;

        if($explan.is(":visible")) {
            $explan.slideUp(200);
            $("#sod_sts_explan_open").text("상태설명보기");
        } else {
            $explan.slideDown(200);
            $("#sod_sts_explan_open").text("상태설명닫기");
        }
    });

    $("#sod_sts_explan_close").on("click", function() {
        var $explan = $("#sod_sts_explan");
        if($explan.is(":animated"))
            return false;

        $explan.slideUp(200);
        $("#sod_sts_explan_open").text("상태설명보기");
    });
});

function fcancel_check(f)
{
    if(!confirm("주문을 정말 취소하시겠습니까?"))
        return false;

    var memo = f.cancel_memo.value;
    if(memo == "") {
        alert("취소사유를 입력해 주십시오.");
        return false;
    }

    return true;
}		
</script>

<?php
include_once('./_tail.php');
