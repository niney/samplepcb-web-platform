<?php
if (!defined('_GNUBOARD_')) exit;

// 주문 상태 → 고객노출 라벨 + 배지 클래스 (레거시 lib/common.lib.php get_order_status_list 의
// korForCustomer/cssCls2 이식). 고객 화면의 목록(theme/sp-lite/shop/orderinquiry.sub.php)과
// 상세(orderinquiryview.php)가 이 함수를 공유해 표기를 일원화한다 — 각자 switch 를 두면
// '가격확인' 이 목록=상품준비중 / 상세=원문 처럼 어긋나므로, 매핑의 단일 원천(SSOT)로 둔다.
//
// 2026-08-25 실측 교정(e2e/specs/status-matrix):
//  ① 협력 트랙 진행(sp_pcb_po 파생, P4.13)이 카드에만 실리고 배지는 od 만 읽어, 제작이 입고까지
//     가도 고객 목록·줄 배지는 '입금완료'였다 → 결제 뒤·배송 전 구간이면 **진행이 곧 배지**다.
//     (od 는 여전히 안 바꾼다 — D6. 사전은 sp-node lib/pcb-customer-progress.ts 하나.)
//  ② 제작 8단계가 내부 용어 원문+단색(status_03)이었다 → 고객 어휘·단계별 색(status_03_1~5).
//  ③ 반품·품절이 '주문취소'로 뭉개졌다 → 줄은 제 이름으로, 헤더는 줄 집계로.
//  ④ 부분 취소가 목록에 흔적이 없었다 → 보조 배지 '일부 취소'.
if (!function_exists('sp_order_status_customer')) {
    /** 결제 뒤·배송 전 — 이 구간에서만 협력 트랙 진행이 배지를 덮는다('주문'은 돈이 먼저다). */
    function sp_order_status_progress_applies($status)
    {
        return in_array($status, array('입금', '준비', '가격확인', '파일검사', 'EQ', '생산시작', '생산중', '품질시험', '생산완료'), true);
    }

    function sp_order_status_is_cancel($status)
    {
        return in_array($status, array('취소', '반품', '품절'), true);
    }

    /** 진행 단계(stage) → 배지 색. 확인 구간=파일검사·EQ 색, 생산·조달=생산 색, 발송·운송=완료 색, 입고=상품준비 색.
     *  BOM 단계(procure_*·packing·inbound)는 sp-node lib/bom-customer-progress 사전(08-25 §6.35). */
    function sp_order_progress_cls($stage)
    {
        switch ($stage) {
            case 'eq_pending':
            case 'eq':
            case 'eq_done':          return 'status_03_1';
            case 'producing':
            case 'procuring':
            case 'procure_confirmed': return 'status_03_2';
            case 'produced':
            case 'shipping':
            case 'packing':
            case 'inbound':          return 'status_03_4';
            case 'received':
            case 'procure_pending':  return 'status_03';
            default:                 return 'status_03';
        }
    }

    /** 주문의 트랙 — 카트 it_id 로 판정(PCB 4종 · sp-bom-parts · 그 밖은 일반). 혼합 주문은 없다(D17). */
    function sp_order_track($od_id)
    {
        global $g5;
        $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($od_id) : addslashes($od_id);
        $res = sql_query(" select distinct it_id from {$g5['g5_shop_cart_table']} where od_id = '{$esc}' ", false);
        $track = 'generic';
        if (!$res) return $track;
        $pcb = array('sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex');
        while ($r = sql_fetch_array($res)) {
            if (in_array($r['it_id'], $pcb, true)) return 'pcb';
            if ($r['it_id'] === 'sp-bom-parts') $track = 'bom';
        }
        return $track;
    }

    /** 진행 항목들 중 **가장 느린** 것 — 트랙별 순서표(sp-node 계약 배열 순서 사본). */
    function sp_order_slowest_progress($items)
    {
        $rank = array(
            'eq_pending' => 0, 'eq' => 1, 'eq_done' => 2, 'producing' => 3, 'produced' => 4, 'shipping' => 5, 'received' => 6,
            'procure_pending' => 0, 'procuring' => 1, 'procure_confirmed' => 2, 'packing' => 3, 'inbound' => 4,
        );
        $out = null;
        foreach ((array) $items as $it) {
            if (!is_array($it) || empty($it['stage'])) continue;
            $r = isset($rank[$it['stage']]) ? $rank[$it['stage']] : 0;
            if ($out === null || $r < $out['_rank']) { $out = $it; $out['_rank'] = $r; }
        }
        return $out;
    }

    /**
     * 고객 주문 진행 스텝퍼(Figma 103:4561 골격) — od 축 + 협력·조달 파생을 한 줄로.
     * 반환 array('mode' => 'steps'|'cancel', 'steps' => [...], 'current' => int, 'note' => '', 'label' => '')
     *  · 취소류: 스텝 대신 취소 라벨 하나(시안의 숨은 '주문취소' 노드)
     *  · '주문'(미입금)=0 · 배송/완료=od 가 정본 · 그 사이는 진행 파생이 있으면 그것이, 없으면 od 제작 상태가 칸을 정한다
     */
    function sp_order_customer_steps($od_status, $track, $stage = null)
    {
        if (sp_order_status_is_cancel($od_status)) {
            $sc = sp_order_status_customer($od_status);
            return array('mode' => 'cancel', 'steps' => array(), 'current' => -1, 'note' => '', 'label' => $sc['label']);
        }
        if ($track === 'bom') {
            $steps = array('입금확인', '입금완료', '부품 조달', '발송·운송', '입고 완료', '상품배송', '배송완료');
            $byStage = array('procure_pending' => 2, 'procuring' => 2, 'procure_confirmed' => 2, 'packing' => 3, 'inbound' => 3, 'received' => 4);
            // BOM A/S 는 배송 뒤 교환·재발송이라 '상품배송' 칸에 세우고 안내문을 붙인다.
            $byOd = array('입금' => 1, '준비' => 2, '가격확인' => 2, '파일검사' => 2, 'EQ' => 2, '생산시작' => 2, '생산중' => 2, '품질시험' => 2, '생산완료' => 3, 'A/S' => 5);
        } else if ($track === 'pcb') {
            $steps = array('입금확인', '입금완료', '제조 확인', '생산', '생산완료', '입고 완료', '상품배송', '배송완료');
            $byStage = array('eq_pending' => 2, 'eq' => 2, 'eq_done' => 2, 'producing' => 3, 'produced' => 4, 'shipping' => 4, 'received' => 5);
            $byOd = array('입금' => 1, '준비' => 1, '가격확인' => 1, '파일검사' => 2, 'EQ' => 2, '생산시작' => 3, '생산중' => 3, '품질시험' => 3, '생산완료' => 4, 'A/S' => 4);
        } else {
            $steps = array('입금확인', '입금완료', '상품준비', '상품배송', '배송완료');
            $byStage = array();
            $byOd = array('입금' => 1, '준비' => 2, '가격확인' => 2, '파일검사' => 2, 'EQ' => 2, '생산시작' => 2, '생산중' => 2, '품질시험' => 2, '생산완료' => 2, 'A/S' => 2);
        }
        $last = count($steps) - 1;
        $note = '';
        if ($od_status === '주문') {
            $current = 0;
        } else if ($od_status === '배송') {
            $current = $last - 1;
        } else if ($od_status === '완료') {
            $current = $last;
        } else if ($stage !== null && isset($byStage[$stage]) && sp_order_status_progress_applies($od_status)) {
            $current = $byStage[$stage];
        } else if (isset($byOd[$od_status])) {
            $current = $byOd[$od_status];
            if ($od_status === 'A/S') $note = 'A/S 진행 중 — 재생산·재배송 뒤 배송 단계로 이어집니다.';
        } else {
            $current = 1;
        }
        return array('mode' => 'steps', 'steps' => $steps, 'current' => $current, 'note' => $note, 'label' => '');
    }

    /**
     * @param string     $status   od_status 또는 ct_status 원문
     * @param array|null $progress sp-node 진행 항목(stage/label/shortLabel) — 있으면 결제 뒤·배송 전 구간에서 우선
     */
    function sp_order_status_customer($status, $progress = null)
    {
        if (is_array($progress) && !empty($progress['stage']) && sp_order_status_progress_applies($status)) {
            $label = !empty($progress['shortLabel']) ? $progress['shortLabel'] : (isset($progress['label']) ? $progress['label'] : '');
            if ($label !== '') {
                return array('label' => $label, 'cls' => sp_order_progress_cls($progress['stage']));
            }
        }
        switch ($status) {
            case '주문':     return array('label' => '입금확인중', 'cls' => 'status_01');
            case '입금':     return array('label' => '입금완료',   'cls' => 'status_02');
            case '준비':     return array('label' => '상품준비중', 'cls' => 'status_03');
            // 제작 단계 — 고객 어휘 + 단계별 색. 가격확인은 레거시대로 상품준비중(내부 절차다).
            case '가격확인': return array('label' => '상품준비중',   'cls' => 'status_03');
            case '파일검사': return array('label' => '파일검사',     'cls' => 'status_03_1');
            case 'EQ':       return array('label' => '제조 확인(EQ)', 'cls' => 'status_03_1');
            case '생산시작': return array('label' => '생산시작',     'cls' => 'status_03_2');
            case '생산중':   return array('label' => '생산중',       'cls' => 'status_03_2');
            case '품질시험': return array('label' => '품질시험',     'cls' => 'status_03_3');
            case '생산완료': return array('label' => '생산완료',     'cls' => 'status_03_4');
            case 'A/S':      return array('label' => 'A/S 진행 중',  'cls' => 'status_03_5');
            case '배송':     return array('label' => '상품배송',   'cls' => 'status_04');
            case '완료':     return array('label' => '배송완료',   'cls' => 'status_05');
            // 취소류는 제 이름으로 — 배송 뒤 반품이 '주문취소'로 읽히면 뜻이 틀린다.
            case '취소':     return array('label' => '주문취소',   'cls' => 'status_06');
            case '반품':     return array('label' => '반품',       'cls' => 'status_06');
            case '품절':     return array('label' => '품절',       'cls' => 'status_06');
            // 그 밖의 값은 원문을 진행 중 색으로 노출한다 — 예전엔 여기도 '주문취소'였는데,
            // 상태가 하나라도 늘면(코어 force-status 는 임의 문자열을 받는다) 정상 진행 중인
            // 주문이 고객에게 '주문취소'로 보이는 사고가 된다. 모르는 값은 숨기지 말고 그대로.
            default:         return array('label' => $status,      'cls' => 'status_03');
        }
    }

    /** 주문의 줄 상태 집계 — 한 번의 GROUP BY. array(total, canceled, cancelKinds[]) */
    function sp_order_line_status_summary($od_id)
    {
        global $g5;
        $out = array('total' => 0, 'canceled' => 0, 'cancelKinds' => array());
        $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($od_id) : addslashes($od_id);
        $res = sql_query(" select ct_status, count(*) as cnt from {$g5['g5_shop_cart_table']}
                            where od_id = '{$esc}' group by ct_status ", false);
        if (!$res) return $out;
        while ($r = sql_fetch_array($res)) {
            $cnt = (int) $r['cnt'];
            $out['total'] += $cnt;
            if (sp_order_status_is_cancel($r['ct_status'])) {
                $out['canceled'] += $cnt;
                $out['cancelKinds'][] = $r['ct_status'];
            }
        }
        return $out;
    }

    /**
     * 주문 **헤더**용(목록) — od_status 에 줄 집계를 겹친다.
     *  · 전량 취소류: 줄이 모두 반품이면 '반품', 모두 품절이면 '품절', 그 밖은 '주문취소'
     *    (코어는 전량 취소류를 od_status='취소' 하나로 저장하므로 헤더만 보면 갈 수 없다).
     *  · 일부 취소: 본 배지 옆에 '일부 취소 n/m' 보조 배지.
     * 반환: label/cls + sub(보조 배지 문구, 없으면 '').
     */
    function sp_order_status_customer_order($row, $progress = null)
    {
        $status = isset($row['od_status']) ? $row['od_status'] : '';
        $sum = sp_order_line_status_summary(isset($row['od_id']) ? $row['od_id'] : '');
        if (sp_order_status_is_cancel($status)) {
            $kinds = array_values(array_unique($sum['cancelKinds']));
            if (count($kinds) === 1 && ($kinds[0] === '반품' || $kinds[0] === '품절')) {
                $sc = sp_order_status_customer($kinds[0]);
            } else {
                $sc = sp_order_status_customer('취소');
            }
            $sc['sub'] = '';
            return $sc;
        }
        $sc = sp_order_status_customer($status, $progress);
        $sub = '';
        if ($sum['canceled'] > 0 && $sum['canceled'] < $sum['total']) {
            $sub = '일부 취소 ' . $sum['canceled'] . '/' . $sum['total'];
        } else if (isset($row['od_cancel_price']) && (int) $row['od_cancel_price'] > 0) {
            $sub = '일부 취소';
        }
        $sc['sub'] = $sub;
        return $sc;
    }

    /** 배지 HTML — 본 배지 + (있으면) 보조 배지. */
    function sp_order_status_badge_html($sc)
    {
        $html = '<span class="' . $sc['cls'] . '">' . $sc['label'] . '</span>';
        if (!empty($sc['sub'])) {
            $html .= ' <span class="status_06 status_sub">' . $sc['sub'] . '</span>';
        }
        return $html;
    }
}
