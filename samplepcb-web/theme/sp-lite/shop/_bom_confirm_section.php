<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가
/*
 * 주문 상세 — 부품 확인 요청(결제 후, D43). 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
 * orderinquiryview.php 가 제조 확인(EQ) 섹션 다음에 include 한다($od_id·$member 전제).
 *
 * 메일·마이페이지 목록(/shop/parts-confirm)의 링크가 모두 여기(#bomc-{요청 id})로 온다 — 결정 UI 는 이 한 곳.
 * 판정·저장은 전부 sp-node 가 하고 여기서는 그린다:
 *   · 회신 = POST+CSRF 브리지(spcb/api/bom-confirm-answer.php → POST /api/bom/confirms/:id/answer)
 *   · 추가결제 = 브라우저 JS(/spcb/api/me 토큰 → POST /api/bom/confirms/settlements/:id/checkout → 주문서)
 * 사용자 확정 형식(09-30): 부품마다 기술타입 / 문제설명 / 당사제안 / 참고자료(분석근거 팝업).
 * ⚠ 협력사명·원가는 없다 — 서버가 고객 DTO 에서 이미 뺐다(공급처는 '당사 협력 공급처').
 */

$sp_bomc_list   = function_exists('sp_bom_confirms') ? sp_bom_confirms($od_id) : array();
$sp_bomc_origin = function_exists('sp_bom_confirm_extra_origin') ? sp_bom_confirm_extra_origin($od_id, $member['mb_id']) : array();

// ── 추가결제 주문이면 원 주문으로 잇는다 ─────────────────────────────────────
if ($sp_bomc_origin):
?>
<section id="sp_bomc_origin">
    <?php foreach ($sp_bomc_origin as $sp_bomc_o): ?>
    <p>
        이 주문은 <b><?php echo get_text($sp_bomc_o['quoteTitle']); ?></b> 부품 확인 요청에 따른 <b>추가결제</b>입니다.
        <a href="<?php echo G5_SHOP_URL; ?>/orderinquiryview.php?od_id=<?php echo urlencode($sp_bomc_o['originOdId']); ?>#bomc-<?php echo (int) $sp_bomc_o['requestId']; ?>">원 주문 보기</a>
    </p>
    <?php endforeach; ?>
</section>
<?php
endif;

if (!$sp_bomc_list) return;

$sp_bomc_has_open = false;
foreach ($sp_bomc_list as $sp_bomc_rq) {
    if ($sp_bomc_rq['status'] === 'requested') { $sp_bomc_has_open = true; break; }
}
?>
<section id="sp_bomc_wrap">
    <h2><?php echo $sp_bomc_has_open ? '부품 확인 요청' : '부품 확인 이력'; ?></h2>
    <p class="sp_eq_intro">
        <?php if ($sp_bomc_has_open): ?>
            결제하신 부품 중 처리 방법을 정해 주셔야 하는 부품이 있습니다. 부품마다 제안을 하나씩 골라 회신해 주세요.
        <?php else: ?>
            지난 부품 확인 내역입니다 — 아래에 결제할 금액이 없다면 따로 하실 일은 없습니다.
        <?php endif; ?>
    </p>

    <?php foreach ($sp_bomc_list as $rq):
        $st   = sp_bom_confirm_status_label($rq['status']);
        $open = ($rq['status'] === 'requested');
        $rid  = (int) $rq['id'];
    ?>
    <div class="sp_bomc_item<?php echo $open ? ' is-open' : ''; ?>" id="bomc-<?php echo $rid; ?>">
        <div class="sp_eq_head">
            <span class="sp_eq_badge <?php echo $st['cls']; ?>"><?php echo $st['label']; ?></span>
            <strong class="sp_eq_proj"><?php echo get_text($rq['quoteTitle']); ?></strong>
            <?php if ($open && !empty($rq['overdue'])): ?>
                <span class="sp_eq_badge sp_eq_no">회신 기한 지남</span>
            <?php elseif ($open && !empty($rq['dueOn'])): ?>
                <span class="sp_eq_due">회신 기한 <?php echo get_text($rq['dueOn']); ?></span>
            <?php endif; ?>
        </div>

        <?php if (!empty($rq['message'])): ?>
        <div class="sp_eq_msg"><?php echo nl2br(get_text($rq['message'])); ?></div>
        <?php endif; ?>

        <?php if ($open): ?>
        <form method="post" action="<?php echo G5_URL; ?>/spcb/api/bom-confirm-answer" class="sp_bomc_form">
            <!-- get_token() 은 값만 반환한다(그냥 echo 하면 화면에 찍힌다 — EQ 폼 주석 참고). -->
            <input type="hidden" name="token" value="<?php echo get_token(); ?>">
            <input type="hidden" name="od_id" value="<?php echo get_text($od_id); ?>">
            <input type="hidden" name="request_id" value="<?php echo $rid; ?>">
            <input type="hidden" name="version" value="<?php echo (int) $rq['version']; ?>">
        <?php endif; ?>

        <?php foreach ($rq['issues'] as $n => $iss):
            $iid    = (int) $iss['id'];
            $part   = $iss['evidence']['part'];
            $obs    = $iss['evidence']['observation'];
            $chosen = null;
            foreach ($iss['options'] as $op) { if ($op['code'] === $iss['chosenCode']) { $chosen = $op; break; } }
        ?>
        <div class="sp_bomc_issue" data-issue="<?php echo $iid; ?>">
            <div class="sp_bomc_issue_h">
                <span class="sp_bomc_no">부품 <?php echo $n + 1; ?></span>
                <b><?php echo get_text($part['mpn']); ?></b>
                <?php if (!empty($part['manufacturerName'])): ?><span class="sp_bomc_mfr"><?php echo get_text($part['manufacturerName']); ?></span><?php endif; ?>
                <?php if (!empty($part['location'])): ?><span class="sp_bomc_loc">BOM <?php echo get_text($part['location']); ?></span><?php endif; ?>
            </div>

            <dl class="sp_bomc_grid">
                <dt>기술타입</dt>
                <dd><span class="sp_bomc_type sp_bomc_type--<?php echo $iss['issueType'] === 'moq_increase' ? 'moq' : 'stock'; ?>"><?php echo get_text($iss['issueTypeLabel']); ?></span></dd>

                <dt>문제설명</dt>
                <dd><?php echo nl2br(get_text($iss['description'])); ?></dd>

                <dt>당사제안</dt>
                <dd>
                    <ul class="sp_bomc_opts">
                        <?php foreach ($iss['options'] as $op):
                            $delta   = (int) $op['priceDelta'];
                            $dcls    = $delta > 0 ? 'is-plus' : ($delta < 0 ? 'is-minus' : 'is-zero');
                            $is_pick = ($chosen !== null && $op['code'] === $chosen['code']);
                            $summary = sp_bom_confirm_option_summary($op);
                            $restock = !empty($op['restock']) ? $op['restock'] : null;
                            $split_ok = $restock && !empty($restock['splitAllowed']);
                            $split_fee = $restock ? (int) $restock['splitShippingFee'] : 0;
                        ?>
                        <li class="sp_bomc_opt<?php echo $is_pick ? ' is-picked' : ''; ?><?php echo ($chosen !== null && !$is_pick) ? ' is-dim' : ''; ?>">
                            <label>
                                <?php if ($open): ?>
                                <input type="radio" name="choice[<?php echo $iid; ?>]" value="<?php echo $op['code']; ?>"
                                       data-delta="<?php echo $delta; ?>" data-kind="<?php echo get_text($op['kind']); ?>"
                                       data-split-fee="<?php echo $split_ok ? $split_fee : 0; ?>">
                                <?php endif; ?>
                                <span class="sp_bomc_code"><?php echo $op['code']; ?></span>
                                <span class="sp_bomc_otitle"><?php echo get_text($op['title']); ?></span>
                                <span class="sp_bomc_delta <?php echo $dcls; ?>"><?php echo sp_bom_confirm_delta_text($delta); ?></span>
                                <?php if ($is_pick && !$open): ?><span class="sp_bomc_pick">선택하신 처리</span><?php endif; ?>
                            </label>
                            <?php if ($summary !== ''): ?>
                            <p class="sp_bomc_osum"><?php echo $summary; ?></p>
                            <?php endif; ?>

                            <?php if ($open && $split_ok): ?>
                            <?php // 입고 대기 + 분할 허용 — 이 선택지를 골랐을 때만 켠다(꺼진 라디오는 전송되지 않는다). ?>
                            <fieldset class="sp_bomc_ship" data-for="<?php echo $op['code']; ?>" disabled hidden>
                                <legend>받는 방법</legend>
                                <label><input type="radio" name="ship[<?php echo $iid; ?>]" value="together" checked> 모두 모아서 한 번에 받기</label>
                                <label><input type="radio" name="ship[<?php echo $iid; ?>]" value="split">
                                    먼저 온 부품 먼저 받기
                                    <small><?php echo $split_fee > 0 ? '(두 번째 배송비 +' . number_format($split_fee) . '원)' : '(두 번째 배송비는 당사 부담)'; ?></small>
                                </label>
                            </fieldset>
                            <?php elseif (!$open && $is_pick && $op['kind'] === 'wait_restock' && !empty($iss['shipPreference'])): ?>
                            <p class="sp_bomc_osum">받는 방법: <?php echo $iss['shipPreference'] === 'split' ? '먼저 온 부품 먼저 받기' : '모두 모아서 한 번에 받기'; ?></p>
                            <?php endif; ?>
                        </li>
                        <?php endforeach; ?>
                    </ul>
                </dd>

                <dt>참고자료</dt>
                <dd>
                    <button type="button" class="sp_bomc_ev_btn" data-dialog="bomc-ev-<?php echo $iid; ?>">분석근거 보기</button>
                </dd>
            </dl>

            <?php if (!$open && $rq['status'] !== 'canceled'): ?>
            <p class="sp_bomc_state">
                <?php if ($iss['status'] === 'applied'): ?>
                    <span class="sp_bomc_state_ok">반영 완료</span>
                <?php elseif ($iss['status'] === 'closed'): ?>
                    <span class="sp_bomc_state_ok">담당자 상담으로 마무리</span>
                <?php elseif ($iss['status'] === 'decided'): ?>
                    <span class="sp_bomc_state_wait">담당자 반영 중</span>
                <?php endif; ?>
                <?php if (!empty($iss['followup'])): ?>
                    · 나머지 부품 발송 <?php echo get_text($iss['followup']['carrier']); ?> <?php echo get_text($iss['followup']['invoice']); ?>
                    (<?php echo date('Y-m-d', strtotime($iss['followup']['shippedAt'])); ?>)
                <?php endif; ?>
            </p>
            <?php endif; ?>

            <?php // ── 분석근거 팝업 — 요청 시점에 굳힌 값이라 지금 공급사 화면과 다를 수 있다. ?>
            <dialog class="sp_bomc_dialog" id="bomc-ev-<?php echo $iid; ?>" aria-labelledby="bomc-ev-h-<?php echo $iid; ?>">
                <div class="sp_bomc_dialog_h">
                    <h3 id="bomc-ev-h-<?php echo $iid; ?>">분석근거 · <?php echo get_text($part['mpn']); ?></h3>
                    <button type="button" class="sp_bomc_dialog_x" data-close aria-label="닫기">×</button>
                </div>
                <div class="sp_bomc_dialog_b">
                    <h4>주문하신 부품</h4>
                    <table class="sp_bomc_kv">
                        <tr><th>품번(MPN)</th><td><?php echo get_text($part['mpn']); ?></td></tr>
                        <tr><th>제조사</th><td><?php echo $part['manufacturerName'] ? get_text($part['manufacturerName']) : '—'; ?></td></tr>
                        <tr><th>설명</th><td><?php echo $part['description'] ? get_text($part['description']) : '—'; ?></td></tr>
                        <tr><th>패키지</th><td><?php echo $part['packageCode'] ? get_text($part['packageCode']) : '—'; ?></td></tr>
                        <tr><th>BOM 위치</th><td><?php echo $part['location'] ? get_text($part['location']) : '—'; ?></td></tr>
                        <tr><th>필요 수량 / 주문 수량</th><td><?php echo sp_bom_confirm_qty($part['neededQty']); ?> / <?php echo sp_bom_confirm_qty($part['orderQty']); ?></td></tr>
                        <tr><th>주문 당시 단가 / 금액</th><td><?php echo sp_bom_confirm_won($part['unitPriceKrw']); ?> / <?php echo sp_bom_confirm_won($part['lineTotalKrw']); ?> <small>(부가세 별도)</small></td></tr>
                        <tr><th>공급처</th><td><?php echo $part['supplierLabel'] ? get_text($part['supplierLabel']) : '—'; ?></td></tr>
                    </table>

                    <h4>확인한 문제 — <?php echo get_text($iss['issueTypeLabel']); ?></h4>
                    <table class="sp_bomc_kv">
                        <tr><th>확인 시각</th><td><?php echo sp_bom_confirm_datetime($obs['checkedAt']); ?></td></tr>
                        <tr><th>확인한 곳</th><td><?php echo $obs['sourceLabel'] ? get_text($obs['sourceLabel']) : '—'; ?></td></tr>
                        <tr><th>현재 재고</th><td><?php echo sp_bom_confirm_qty($obs['stock']); ?></td></tr>
                        <tr><th>최소 주문 수량(MOQ)</th><td><?php echo sp_bom_confirm_qty($obs['moq']); ?></td></tr>
                        <tr><th>리드타임</th><td><?php echo $obs['leadTime'] ? get_text($obs['leadTime']) : '—'; ?></td></tr>
                        <?php if (!empty($obs['note'])): ?>
                        <tr><th>메모</th><td><?php echo nl2br(get_text($obs['note'])); ?></td></tr>
                        <?php endif; ?>
                    </table>

                    <?php foreach ($iss['options'] as $op):
                        if (empty($op['replacement']) && empty($op['moq']) && empty($op['restock'])) continue;
                    ?>
                    <h4><?php echo $op['code']; ?>. <?php echo get_text($op['title']); ?></h4>

                    <?php if (!empty($op['replacement'])): $rp = $op['replacement']; ?>
                    <table class="sp_bomc_kv">
                        <tr><th>품번(MPN)</th><td><?php echo get_text($rp['mpn']); ?></td></tr>
                        <tr><th>제조사</th><td><?php echo $rp['manufacturerName'] ? get_text($rp['manufacturerName']) : '—'; ?></td></tr>
                        <tr><th>설명</th><td><?php echo $rp['description'] ? get_text($rp['description']) : '—'; ?></td></tr>
                        <tr><th>패키지</th><td><?php echo $rp['packageCode'] ? get_text($rp['packageCode']) : '—'; ?></td></tr>
                        <?php if (!empty($rp['lifecycleCode'])): ?>
                        <tr><th>생산 상태</th><td><?php echo get_text($rp['lifecycleCode']); ?></td></tr>
                        <?php endif; ?>
                        <tr><th>공급처</th><td><?php echo get_text($rp['supplierLabel']); ?></td></tr>
                        <tr><th>단가 / 주문 수량 / 금액</th><td><?php echo sp_bom_confirm_won($rp['unitPriceKrw']); ?> / <?php echo sp_bom_confirm_qty($rp['orderQty']); ?> / <?php echo sp_bom_confirm_won($rp['lineTotalKrw']); ?> <small>(부가세 별도)</small></td></tr>
                        <tr><th>재고 / MOQ</th><td><?php echo sp_bom_confirm_qty($rp['stock']); ?> / <?php echo sp_bom_confirm_qty($rp['moq']); ?></td></tr>
                        <tr><th>리드타임</th><td><?php echo $rp['leadTime'] ? get_text($rp['leadTime']) : '—'; ?></td></tr>
                        <?php if (!empty($rp['datasheetUrl']) && preg_match('#^https?://#i', $rp['datasheetUrl'])): ?>
                        <tr><th>데이터시트</th><td><a href="<?php echo htmlspecialchars($rp['datasheetUrl'], ENT_QUOTES); ?>" target="_blank" rel="noopener noreferrer">열기</a></td></tr>
                        <?php endif; ?>
                    </table>

                    <?php if (!empty($rp['engine'])): $eng = sp_bom_confirm_engine_labels($rp['engine']); ?>
                    <p class="sp_bomc_verdict <?php echo $eng['cls']; ?>">
                        호환 판정 <b><?php echo $eng['safety']; ?></b> · <?php echo $eng['mode']; ?>
                    </p>
                    <?php if (!empty($rp['engine']['requirements'])): ?>
                    <table class="sp_bomc_req">
                        <thead><tr><th>항목</th><th>주문 부품</th><th>제안 부품</th><th>비교</th></tr></thead>
                        <tbody>
                        <?php foreach ($rp['engine']['requirements'] as $req): $rs = sp_bom_confirm_requirement_state($req['state']); ?>
                            <tr>
                                <th><?php echo get_text($req['label']); ?></th>
                                <td><?php echo $req['expected'] !== null ? get_text($req['expected']) : '—'; ?></td>
                                <td><?php echo $req['actual'] !== null ? get_text($req['actual']) : '—'; ?></td>
                                <td><span class="sp_bomc_rs <?php echo $rs['cls']; ?>"><?php echo $rs['label']; ?></span></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                    <?php endif; ?>
                    <?php if (!empty($rp['engine']['conflicts'])): ?>
                    <ul class="sp_bomc_conflicts">
                        <?php foreach ($rp['engine']['conflicts'] as $cf): ?><li><?php echo get_text($cf); ?></li><?php endforeach; ?>
                    </ul>
                    <?php endif; ?>
                    <?php elseif ($op['kind'] === 'substitute'): ?>
                    <p class="sp_bomc_note">자동 사양 비교 없이 담당자가 직접 고른 부품입니다 — 사양은 데이터시트로 확인해 주세요.</p>
                    <?php endif; ?>
                    <?php endif; ?>

                    <?php if (!empty($op['moq'])): $mq = $op['moq']; ?>
                    <table class="sp_bomc_kv">
                        <tr><th>필요 수량</th><td><?php echo sp_bom_confirm_qty($mq['neededQty']); ?></td></tr>
                        <tr><th>구매 수량(MOQ)</th><td><?php echo sp_bom_confirm_qty($mq['orderQty']); ?></td></tr>
                        <tr><th>여유 수량</th><td><?php echo sp_bom_confirm_qty($mq['surplusQty']); ?></td></tr>
                        <tr><th>단가 / 금액</th><td><?php echo sp_bom_confirm_won($mq['unitPriceKrw']); ?> / <?php echo sp_bom_confirm_won($mq['lineTotalKrw']); ?> <small>(부가세 별도)</small></td></tr>
                    </table>
                    <?php endif; ?>

                    <?php if (!empty($op['restock'])): $rs2 = $op['restock']; ?>
                    <table class="sp_bomc_kv">
                        <tr><th>예상 입고일</th><td><?php echo get_text($rs2['expectedOn']); ?></td></tr>
                        <tr><th>근거</th><td><?php echo nl2br(get_text($rs2['basis'])); ?></td></tr>
                        <tr><th>최대 대기</th><td><?php echo $rs2['maxWaitOn'] ? get_text($rs2['maxWaitOn']) . '까지' : '—'; ?></td></tr>
                        <tr><th>나눠 받기</th><td>
                            <?php if (!empty($rs2['splitAllowed'])): ?>
                                가능 — <?php echo (int) $rs2['splitShippingFee'] > 0 ? '두 번째 배송비 ' . number_format((int) $rs2['splitShippingFee']) . '원' : '두 번째 배송비 당사 부담'; ?>
                            <?php else: ?>
                                불가 — 입고 뒤 한 번에 보내 드립니다
                            <?php endif; ?>
                        </td></tr>
                    </table>
                    <?php endif; ?>
                    <?php endforeach; ?>

                    <p class="sp_bomc_note">위 값은 요청 시점(<?php echo sp_bom_confirm_datetime($obs['checkedAt']); ?>)에 확인한 내용입니다. 공급사 재고·가격은 계속 바뀝니다.</p>
                </div>
            </dialog>
        </div>
        <?php endforeach; ?>

        <?php if ($open): ?>
            <label class="sp_eq_note_label">
                요청 사항 <span>(선택)</span>
                <textarea name="note" rows="2" maxlength="2000" placeholder="예) 대체품이면 같은 제조사를 우선해 주세요."></textarea>
            </label>
            <p class="sp_bomc_total" aria-live="polite">
                고르신 처리의 금액 변동: <b data-bomc-total>부품마다 제안을 골라 주세요</b>
            </p>
            <div class="sp_eq_btns">
                <button type="submit" class="sp_eq_approve">회신 보내기</button>
            </div>
        </form>
        <?php else: ?>
            <p class="sp_eq_done">
                <?php if ($rq['status'] === 'canceled'): ?>
                    담당자가 요청을 취소했습니다 — 따로 하실 일은 없습니다.
                <?php else: ?>
                    <?php if (!empty($rq['answeredAt'])): ?>회신 <?php echo date('Y-m-d', strtotime($rq['answeredAt'])); ?><?php endif; ?>
                    <?php if (!empty($rq['answeredByAdmin'])): ?>
                        <span class="sp_eq_note">전화·메일로 주신 회신을 담당자가 대신 입력했습니다.</span>
                    <?php endif; ?>
                <?php endif; ?>
                <?php if (!empty($rq['customerNote'])): ?>
                    <span class="sp_eq_note">요청 사항: <?php echo get_text($rq['customerNote']); ?></span>
                <?php endif; ?>
            </p>

            <?php $stl = $rq['settlement']; if ($stl && $stl['status'] !== 'canceled'): ?>
            <div class="sp_bomc_settle sp_bomc_settle--<?php echo $stl['kind']; ?>">
                <?php if ($stl['kind'] === 'charge'): ?>
                    <?php if (!empty($stl['canCheckout'])): ?>
                        <span>추가결제 <b><?php echo number_format((int) $stl['amount']); ?>원</b>(부가세 포함)이 남아 있습니다. 결제가 확인되면 바로 진행합니다.</span>
                        <button type="button" class="sp_bomc_pay" data-settlement="<?php echo (int) $stl['id']; ?>">추가결제 하기</button>
                    <?php elseif (!empty($stl['orderPending'])): ?>
                        <span>추가결제 <b><?php echo number_format((int) $stl['amount']); ?>원</b> — 주문서를 내셨습니다. 입금이 확인되면 진행합니다.</span>
                    <?php else: ?>
                        <span><?php echo get_text($stl['statusLabel']); ?> <b><?php echo number_format((int) $stl['amount']); ?>원</b><?php if (!empty($stl['paidAt'])): ?> · <?php echo date('Y-m-d', strtotime($stl['paidAt'])); ?><?php endif; ?></span>
                    <?php endif; ?>
                <?php else: ?>
                    <span><?php echo get_text($stl['statusLabel']); ?> <b><?php echo number_format((int) $stl['amount']); ?>원</b>(부가세 포함)
                        <?php if ($stl['status'] === 'refunded' && !empty($stl['refundedAt'])): ?>
                            · <?php echo date('Y-m-d', strtotime($stl['refundedAt'])); ?>
                        <?php else: ?>
                            — 반영 뒤 결제하신 수단(카드 취소 또는 계좌 송금)으로 돌려드립니다.
                        <?php endif; ?>
                    </span>
                <?php endif; ?>
            </div>
            <?php endif; ?>
        <?php endif; ?>
    </div>
    <?php endforeach; ?>
</section>

<script>
(function () {
    'use strict';
    var wrap = document.getElementById('sp_bomc_wrap');
    if (!wrap) return;

    function won(n) { return Math.abs(n).toLocaleString('ko-KR') + '원'; }

    // 부품마다 고른 선택지의 금액 효과 합(계약 bomConfirmChosenDelta 와 같은 식 — 분할 배송비는 입고 대기 + 나눠 받기일 때만).
    function refreshForm(form) {
        var issues = form.querySelectorAll('.sp_bomc_issue');
        var total = 0;
        var missing = 0;
        issues.forEach(function (issue) {
            var picked = issue.querySelector('input[name^="choice["]:checked');
            issue.querySelectorAll('.sp_bomc_ship').forEach(function (fs) {
                var on = !!picked && fs.getAttribute('data-for') === picked.value;
                fs.disabled = !on;
                fs.hidden = !on;
            });
            if (!picked) { missing += 1; return; }
            var delta = parseInt(picked.getAttribute('data-delta'), 10) || 0;
            if (picked.getAttribute('data-kind') === 'wait_restock') {
                var split = issue.querySelector('input[name^="ship["][value="split"]:checked');
                if (split) delta += parseInt(picked.getAttribute('data-split-fee'), 10) || 0;
            }
            total += delta;
        });
        var out = form.querySelector('[data-bomc-total]');
        if (!out) return { total: total, missing: missing };
        if (missing > 0) {
            out.textContent = '부품마다 제안을 골라 주세요 (' + missing + '개 남음)';
            out.className = '';
        } else {
            out.textContent = total > 0 ? '추가결제 ' + won(total) : (total < 0 ? '환불 ' + won(total) : '변동 없음');
            out.className = total > 0 ? 'is-plus' : (total < 0 ? 'is-minus' : 'is-zero');
        }
        return { total: total, missing: missing };
    }

    wrap.querySelectorAll('.sp_bomc_form').forEach(function (form) {
        refreshForm(form);
        form.addEventListener('change', function () { refreshForm(form); });
        form.addEventListener('submit', function (e) {
            if (form.dataset.spConfirmed === '1') return; // 승낙 후 재제출 — 그대로 통과
            e.preventDefault();
            var state = refreshForm(form);
            if (state.missing > 0) {
                window.spDialog.alert('부품마다 처리 방법을 하나씩 골라 주세요.', { tone: 'danger' });
                return;
            }
            var money = state.total > 0
                ? '추가결제 ' + won(state.total) + '이 생깁니다(회신 뒤 이 화면에서 결제).'
                : (state.total < 0 ? won(state.total) + '을 반영 뒤 환불해 드립니다.' : '금액 변동은 없습니다.');
            window.spDialog
                .confirm('이대로 회신하시겠습니까?\n' + money + '\n회신 뒤 바꾸시려면 담당자에게 연락해 주세요.', {
                    title: '부품 확인 회신',
                    tone: 'success',
                    okText: '회신 보내기',
                })
                .then(function (ok) {
                    if (!ok) return;
                    form.dataset.spConfirmed = '1';
                    form.submit();
                });
        });
    });

    // 분석근거 팝업 — <dialog> 네이티브 모달(폼 안이라 method="dialog" 폼을 둘 수 없어 JS 로 닫는다).
    wrap.addEventListener('click', function (e) {
        var opener = e.target.closest ? e.target.closest('.sp_bomc_ev_btn') : null;
        if (opener) {
            var dlg = document.getElementById(opener.getAttribute('data-dialog'));
            if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
            return;
        }
        var closer = e.target.closest ? e.target.closest('[data-close]') : null;
        if (closer) {
            var owner = closer.closest('dialog');
            if (owner) owner.close();
            return;
        }
        // 배경(다이얼로그 바깥) 클릭으로 닫기
        if (e.target.tagName === 'DIALOG' && e.target.classList.contains('sp_bomc_dialog')) e.target.close();
    });

    // 추가결제 — 회원 토큰(/spcb/api/me)으로 주문서를 만들고(sp-node) 그리로 보낸다.
    wrap.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.sp_bomc_pay') : null;
        if (!btn || btn.disabled) return;
        btn.disabled = true;
        var id = btn.getAttribute('data-settlement');
        fetch('/spcb/api/me', { credentials: 'include' })
            .then(function (res) {
                if (!res.ok) throw new Error('로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.');
                return res.json();
            })
            .then(function (me) {
                return fetch('/api/bom/confirms/settlements/' + encodeURIComponent(id) + '/checkout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + me.token },
                });
            })
            .then(function (res) {
                return res.json().then(function (json) { return { ok: res.ok, json: json }; });
            })
            .then(function (r) {
                if (r.ok && r.json && r.json.data && r.json.data.redirectUrl) {
                    location.href = r.json.data.redirectUrl;
                    return;
                }
                throw new Error((r.json && r.json.message) || '주문서를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
            })
            .catch(function (err) {
                btn.disabled = false;
                window.spDialog.alert(err && err.message ? err.message : '요청에 실패했습니다.', { tone: 'danger' });
            });
    });
})();
</script>
