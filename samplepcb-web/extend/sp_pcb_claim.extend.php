<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// ── PCB 고객 클레임(A/S 접수) 브리지 (sp-php → sp-node, P5) ───────────────────
// 설계 정본: docs/PCB_PARTNER_TRACK.md §9 A/S. EQ 확인(sp_pcb_eq.extend.php, D16)과
// 같은 구조 — 판정·저장은 전부 sp-node 가 하고 PHP 는 화면만 그린다. 접수(파일 동반
// POST)는 spcb/api/claim-create 브리지가 multipart 로 중계한다.
//
// sp_pcb_node_call()·sp_pcb_member_token() 은 sp_pcb_eq.extend.php 의 것을 재사용한다
// (extend 는 common.php 가 전부 로드하므로 호출 시점엔 항상 존재 — 방어로 존재 확인).

/** 이 주문의 PCB 스펙별 A/S 접수 가능 여부 + 이력. 실패·비로그인·없음은 빈 배열. */
function sp_pcb_claims($od_id)
{
    if (!function_exists('sp_pcb_node_call')) return array();
    $res = sp_pcb_node_call('GET', '/api/pcb-claims?odId=' . rawurlencode((string) $od_id));
    if ($res === null || $res['status'] !== 200) return array();
    if (!isset($res['json']['data']['specs']) || !is_array($res['json']['data']['specs'])) {
        return array();
    }
    return $res['json']['data']['specs'];
}

/** 주문을 가로지르는 **내 A/S**(마이페이지 /shop/as PCB 탭). $scope: open|all.
 *  돌려주는 값: claimable(접수할 주문)·claimableTruncated·claims·openCount — 실패는 빈 구조. */
function sp_pcb_claims_mine($scope = 'open')
{
    $empty = array('claimable' => array(), 'claimableTruncated' => false, 'claims' => array(), 'openCount' => 0);
    if (!function_exists('sp_pcb_node_call')) return $empty;
    $scope = ($scope === 'all') ? 'all' : 'open';
    $res = sp_pcb_node_call('GET', '/api/pcb-claims/mine?scope=' . $scope);
    if ($res === null || $res['status'] !== 200 || !isset($res['json']['data'])) return $empty;
    $d = $res['json']['data'];
    return array(
        'claimable'          => isset($d['claimable']) && is_array($d['claimable']) ? $d['claimable'] : array(),
        'claimableTruncated' => !empty($d['claimableTruncated']),
        'claims'             => isset($d['claims']) && is_array($d['claims']) ? $d['claims'] : array(),
        'openCount'          => isset($d['openCount']) ? (int) $d['openCount'] : 0,
    );
}

/** 사이드바 배지용 **진행 중 건수만** — API 가 아니라 DB 직접 count.
 *  사이드바는 모든 계정 페이지에서 렌더되므로 API 왕복을 붙이지 않는다(sp_pcb_eq_open_count
 *  와 같은 이유). ⚠ 판정이 아니라 세기다 — 목록·접수 판정은 전부 sp-node.
 *  '진행 중'은 open|reviewing — 관리자 차례이지 고객 차례가 아니라 화면은 회색 배지다. */
function sp_pcb_claim_active_count($mb_id)
{
    if ($mb_id === '') return 0;
    $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $row = sql_fetch(" select count(*) as cnt from sp_pcb_claim
                        where mbId = '{$esc}' and status in ('open', 'reviewing') ", false);
    return isset($row['cnt']) ? (int) $row['cnt'] : 0;
}

/** 상태 라벨 — 계약(PCB_CLAIM_STATUS_LABELS)과 같은 말을 쓴다. 배지 클래스는 EQ 공용. */
function sp_pcb_claim_status_label($status)
{
    switch ($status) {
        case 'reviewing': return array('label' => '검토 중',   'cls' => 'sp_eq_wait');
        case 'resolved':  return array('label' => '처리 완료', 'cls' => 'sp_eq_ok');
        case 'rejected':  return array('label' => '처리 불가', 'cls' => 'sp_eq_no');
        default:          return array('label' => '접수됨',   'cls' => 'sp_eq_wait');
    }
}

/** 유형 라벨(PCB_CLAIM_KIND_LABELS 동기) — 폼 select 와 이력 표기가 같이 쓴다. */
function sp_pcb_claim_kinds()
{
    return array(
        'quality'       => '품질·동작 이상',
        'damaged'       => '파손',
        'spec_mismatch' => '사양 상이',
        'shortage'      => '수량 부족',
        'other'         => '기타',
    );
}

/** 희망 처리 라벨(PCB_CLAIM_REMEDY_LABELS 동기). */
function sp_pcb_claim_remedies()
{
    return array(
        'reproduce' => '재제작 희망',
        'refund'    => '환불 희망',
        'consult'   => '상담 요청',
    );
}

/** 처리 방식 라벨(PCB_CLAIM_RESOLUTION_LABELS 동기) — 종결 이력 표기용. */
function sp_pcb_claim_resolution_label($kind)
{
    switch ($kind) {
        case 'reproduce':           return '재생산(A/S 재발주)';
        case 'refund_coordination': return '환불 협의';
        case 'guidance':            return '안내·상담 종결';
        default:                    return '';
    }
}
