<?php
if (!defined('_GNUBOARD_')) exit;

// ── 스마트 BOM 결제 후 부품 확인 요청(D43) — 고객 화면 브리지 ─────────────────────────────
// 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39. 판정·저장은 전부 sp-node(/api/bom/confirms*)가 하고
// 여기서는 부르고 그리기만 한다(PHP 는 sp_* 에 쓰지 않는다). 전송은 sp_pcb_eq.extend.php 의
// sp_pcb_node_call(2분 회원 JWT → 127.0.0.1:3333 직결)을 빌린다 — natsort 로드 순서상 이 파일이
// 먼저 읽히므로 **함수 안에서만** 부르고 function_exists 로 가드한다(sp_bom_claim 관례).
// 트랙 간 어휘 격리: PCB 제조 확인과 값이 닮아도 함수·라벨은 따로 둔다.

// 주문 상세 — 이 주문의 부품 확인 요청(최신 먼저). 실패하면 빈 배열(섹션을 감춘다).
function sp_bom_confirms($od_id)
{
    if (!function_exists('sp_pcb_node_call')) return array();
    $res = sp_pcb_node_call('GET', '/api/bom/confirms?odId=' . rawurlencode((string) $od_id));
    if ($res === null || $res['status'] !== 200 || !isset($res['json']['data']['requests'])) return array();
    return $res['json']['data']['requests'];
}

// 마이페이지 목록 — scope=open(고객 차례만) | all. 결정 UI 는 없다(주문 상세 한 곳).
function sp_bom_confirms_mine($scope = 'open')
{
    $empty = array('requests' => array(), 'openCount' => 0);
    if (!function_exists('sp_pcb_node_call')) return $empty;
    $scope = $scope === 'all' ? 'all' : 'open';
    $res = sp_pcb_node_call('GET', '/api/bom/confirms/mine?scope=' . $scope);
    if ($res === null || $res['status'] !== 200 || !isset($res['json']['data'])) return $empty;
    $data = $res['json']['data'];
    return array(
        'requests'  => isset($data['requests']) && is_array($data['requests']) ? $data['requests'] : array(),
        'openCount' => isset($data['openCount']) ? (int) $data['openCount'] : 0,
    );
}

// 사이드바·요약 밴드 배지 — 고객 차례 수 = 확인 대기(requested) + 결제할 추가결제. 모든 계정
// 페이지에서 그려지므로 API 대신 DB 직접 count(sp_pcb_eq_open_count 관례). sp-node 의 openCount 와
// 같은 모수다: 추가결제는 주문서를 이미 냈으면(주문·입금 이후 줄) 세지 않는다 — 입금 확인 대기는
// 고객이 더 누를 것이 없고, 결제 완료 승격(paid)은 sp-node 가 조회 때 lazy 로 한다.
function sp_bom_confirm_open_count($mb_id)
{
    global $g5;
    if ($mb_id === '' || $mb_id === null) return 0;
    $esc  = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $cart = isset($g5['g5_shop_cart_table']) ? $g5['g5_shop_cart_table'] : 'g5_shop_cart';
    $row = sql_fetch(" select count(*) as cnt from sp_bom_confirm_request r
                        where r.mbId = '{$esc}'
                          and ( r.status = 'requested'
                                or ( r.status <> 'canceled'
                                     and exists ( select 1 from sp_bom_settlement s
                                                   where s.requestId = r.id and s.kind = 'charge' and s.status = 'pending'
                                                     and not exists ( select 1 from {$cart} c
                                                                       where c.ct_id = s.ctId
                                                                         and c.ct_status not in ('쇼핑','취소','반품','품절','삭제') ) ) ) ) ", false);
    return ($row === false || $row === null) ? 0 : (int) $row['cnt'];
}

// '부품 확인' 메뉴를 보일 회원인가 — 부품 BOM 주문이 있었거나 확인 요청을 받은 적이 있다.
function sp_bom_confirm_has_track($mb_id)
{
    if ($mb_id === '' || $mb_id === null) return false;
    $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $row = sql_fetch(" select
        (select count(*) from sp_bom_quote where mbId = '{$esc}' and ctId is not null) as q,
        (select count(*) from sp_bom_confirm_request where mbId = '{$esc}') as r ", false);
    if ($row === false || $row === null) return false;
    return ((int) $row['q']) > 0 || ((int) $row['r']) > 0;
}

// 추가결제 주문 → 원 주문 역추적 — 이 주문의 sp-bom-extra 카트행(io_id=bomx-{정산 id})이 어느 확인 요청의
// 차액인지. 추가결제 주문 상세에서 "원 주문 보기"를 걸어, 고객이 두 주문을 따로 논다고 느끼지 않게 한다.
// 읽기 전용(sp_* 에 쓰지 않는다). 본인 주문 상세에서만 부르므로 mbId 까지 맞춰 본다.
function sp_bom_confirm_extra_origin($od_id, $mb_id)
{
    global $g5;
    if ($od_id === '' || $mb_id === '' || $mb_id === null) return array();
    $cart = isset($g5['g5_shop_cart_table']) ? $g5['g5_shop_cart_table'] : 'g5_shop_cart';
    $od   = function_exists('sql_real_escape_string') ? sql_real_escape_string($od_id) : addslashes($od_id);
    $mb   = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $res = sql_query(" select distinct r.id as request_id, r.odId as origin_od_id, q.title as quote_title
                         from {$cart} c
                         join sp_bom_settlement s on s.chargeKey = c.io_id and s.kind = 'charge'
                         join sp_bom_confirm_request r on r.id = s.requestId
                         join sp_bom_quote q on q.id = r.quoteId
                        where c.od_id = '{$od}' and c.it_id = 'sp-bom-extra' and r.mbId = '{$mb}' ", false);
    $out = array();
    if (!$res) return $out;
    while ($row = sql_fetch_array($res)) {
        $out[] = array(
            'requestId'  => (int) $row['request_id'],
            'originOdId' => (string) $row['origin_od_id'],
            'quoteTitle' => (string) $row['quote_title'],
        );
    }
    return $out;
}

// 상태 라벨 — 계약 BOM_CONFIRM_REQUEST_CUSTOMER_LABELS 와 수동 동기(배지 클래스는 제조 확인 문법 재사용).
// 알림(가격 인하·단종, D44)은 고객이 할 일이 없어 상태 대신 '안내'로 보인다(취소만 예외).
function sp_bom_confirm_status_label($status, $notice = false)
{
    if ($notice && (string) $status !== 'canceled') return array('label' => '안내', 'cls' => 'sp_eq_ok');
    switch ((string) $status) {
        case 'answered': return array('label' => '처리 중', 'cls' => 'sp_eq_wait');
        case 'resolved': return array('label' => '처리 완료', 'cls' => 'sp_eq_ok');
        case 'canceled': return array('label' => '요청 취소', 'cls' => 'sp_eq_off');
        default:         return array('label' => '확인 대기', 'cls' => 'sp_eq_no');
    }
}

// 금액 효과 문구(VAT 포함 원) — +추가결제 · −환불 · 0 변동 없음.
function sp_bom_confirm_delta_text($delta)
{
    $delta = (int) $delta;
    if ($delta === 0) return '금액 변동 없음';
    if ($delta > 0) return '+' . number_format($delta) . '원 추가결제';
    return number_format(-$delta) . '원 환불';
}

// 원 표기 — 부품 단가는 1원 미만 소수가 흔해(저항·콘덴서) 1,000원 미만 소수는 둘째 자리까지 둔다.
function sp_bom_confirm_won($value)
{
    if ($value === null || $value === '') return '—';
    $v = (float) $value;
    $decimals = (abs($v) < 1000 && floor($v) != $v) ? 2 : 0;
    return number_format($v, $decimals) . '원';
}

function sp_bom_confirm_qty($value, $unit = '개')
{
    if ($value === null || $value === '') return '—';
    return number_format((int) $value) . $unit;
}

// ISO 시각(UTC) → 화면 시각(서버 기본 시간대 = KST).
function sp_bom_confirm_datetime($iso)
{
    if ($iso === null || $iso === '') return '—';
    $t = strtotime((string) $iso);
    return $t ? date('Y-m-d H:i', $t) : '—';
}

// 엔진 호환 판정 고객 어휘 — 선택 방식·안전도(계약 BomConfirmEngineVerdict 와 수동 동기).
function sp_bom_confirm_engine_labels($verdict)
{
    $modes = array(
        'exact'           => '같은 부품',
        'variant'         => '같은 계열의 변형 품번',
        'spec-compatible' => '사양이 맞는 다른 부품',
        'review'          => '담당자 검토 필요',
    );
    $safety = array(
        'safe'    => array('label' => '호환', 'cls' => 'is-safe'),
        'caution' => array('label' => '확인 필요', 'cls' => 'is-caution'),
        'blocked' => array('label' => '비호환', 'cls' => 'is-blocked'),
    );
    $m = isset($verdict['selectionMode'], $modes[$verdict['selectionMode']]) ? $modes[$verdict['selectionMode']] : '—';
    $s = isset($verdict['safety'], $safety[$verdict['safety']]) ? $safety[$verdict['safety']] : array('label' => '—', 'cls' => '');
    return array('mode' => $m, 'safety' => $s['label'], 'cls' => $s['cls']);
}

// 엔진 필수조건 판정 표기 — 일치/불일치/미확인(계약 state 사전과 수동 동기).
function sp_bom_confirm_requirement_state($state)
{
    switch ((string) $state) {
        case 'match':    return array('label' => '같음', 'cls' => 'is-match');
        case 'mismatch': return array('label' => '다름', 'cls' => 'is-mismatch');
        case 'missing':  return array('label' => '정보 없음', 'cls' => 'is-missing');
        case 'not_applicable': return array('label' => '해당 없음', 'cls' => 'is-na');
        default:         return array('label' => '미확인', 'cls' => 'is-unverified');
    }
}

// 선택지 한 줄 요약 — 목록·메일과 같은 어휘.
function sp_bom_confirm_option_summary($option)
{
    $parts = array();
    if (!empty($option['price'])) {
        $p = $option['price'];
        $parts[] = '개당 ' . sp_bom_confirm_won($p['beforeUnitKrw']) . ' → ' . sp_bom_confirm_won($p['afterUnitKrw'])
                 . ' · ' . number_format((int) $p['orderQty']) . '개';
    }
    if (!empty($option['replacement'])) {
        $r = $option['replacement'];
        $parts[] = get_text($r['mpn']) . ($r['manufacturerName'] ? ' (' . get_text($r['manufacturerName']) . ')' : '');
        $parts[] = get_text($r['supplierLabel']);
        if ($r['leadTime']) $parts[] = get_text($r['leadTime']);
    }
    if (!empty($option['moq'])) {
        $m = $option['moq'];
        $parts[] = '필요 ' . number_format((int) $m['neededQty']) . '개 → ' . number_format((int) $m['orderQty'])
                 . '개 구매(여유 ' . number_format((int) $m['surplusQty']) . '개)';
    }
    if (!empty($option['restock'])) {
        $s = $option['restock'];
        $parts[] = '예상 입고 ' . get_text($s['expectedOn']);
        if (!empty($s['maxWaitOn'])) $parts[] = '최대 ' . get_text($s['maxWaitOn']) . '까지 대기';
    }
    if (!empty($option['detail'])) $parts[] = get_text($option['detail']);
    return implode(' · ', $parts);
}
