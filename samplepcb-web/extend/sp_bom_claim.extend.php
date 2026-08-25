<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// ── 부품 BOM 고객 클레임(문제 접수) 브리지 (sp-php → sp-node, D37) ───────────────
// 설계 정본: docs/SMARTBOM_PARTNER_RFQ.md §6.29 D37. 접수·상세는 Vue(/app/bom/:id)가
// 정본이고, sp-php 는 **마이페이지 "A/S 접수" 부품 탭의 목록**만 그린다 — 여기서 폼을
// 만들지 않는다(접수는 /app/bom/:id 한 곳).
//
// PCB 클레임(sp_pcb_claim.extend.php)과 모양이 같지만 함수를 나눈다 — 트랙 간 어휘 격리
// 관례(값이 같아도 사전을 공유하지 않는다). 전송(sp_pcb_node_call)만 인프라라 재사용.

/** 견적을 가로지르는 **내 문제 접수**(마이페이지 /shop/as 부품 탭). $scope: open|all. */
function sp_bom_claims_mine($scope = 'open')
{
    $empty = array('claimable' => array(), 'claimableTruncated' => false, 'claims' => array(), 'openCount' => 0);
    if (!function_exists('sp_pcb_node_call')) return $empty;
    $scope = ($scope === 'all') ? 'all' : 'open';
    $res = sp_pcb_node_call('GET', '/api/bom/claims/mine?scope=' . $scope);
    if ($res === null || $res['status'] !== 200 || !isset($res['json']['data'])) return $empty;
    $d = $res['json']['data'];
    return array(
        'claimable'          => isset($d['claimable']) && is_array($d['claimable']) ? $d['claimable'] : array(),
        'claimableTruncated' => !empty($d['claimableTruncated']),
        'claims'             => isset($d['claims']) && is_array($d['claims']) ? $d['claims'] : array(),
        'openCount'          => isset($d['openCount']) ? (int) $d['openCount'] : 0,
    );
}

/** 사이드바 배지용 진행 중 건수 — DB 직접 count(sp_pcb_claim_active_count 와 같은 규약). */
function sp_bom_claim_active_count($mb_id)
{
    if ($mb_id === '') return 0;
    $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $row = sql_fetch(" select count(*) as cnt from sp_bom_claim
                        where mbId = '{$esc}' and status in ('open', 'reviewing') ", false);
    return isset($row['cnt']) ? (int) $row['cnt'] : 0;
}

/** 이 회원에게 부품 BOM 축이 있는가 — 마이페이지 A/S 탭 노출 판정(세기일 뿐 판정 아님).
 *  주문으로 넘어간 견적(ctId 있음)이나 접수 이력이 하나라도 있으면 탭을 세운다. */
function sp_bom_claim_has_track($mb_id)
{
    if ($mb_id === '') return false;
    $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $row = sql_fetch(" select
        (select count(*) from sp_bom_quote where mbId = '{$esc}' and ctId is not null) as q,
        (select count(*) from sp_bom_claim where mbId = '{$esc}') as c ", false);
    return (isset($row['q']) && (int) $row['q'] > 0) || (isset($row['c']) && (int) $row['c'] > 0);
}

/** 상태 라벨 — 계약(BOM_CLAIM_STATUS_LABELS)과 같은 말. 배지 클래스는 EQ 공용. */
function sp_bom_claim_status_label($status)
{
    switch ($status) {
        case 'reviewing': return array('label' => '검토 중',   'cls' => 'sp_eq_wait');
        case 'resolved':  return array('label' => '해결 완료', 'cls' => 'sp_eq_ok');
        case 'rejected':  return array('label' => '처리 불가', 'cls' => 'sp_eq_no');
        default:          return array('label' => '접수됨',   'cls' => 'sp_eq_wait');
    }
}

/** 유형 라벨(BOM_CLAIM_KIND_LABELS 동기). */
function sp_bom_claim_kinds()
{
    return array(
        'missing'    => '수량 누락',
        'damaged'    => '파손',
        'wrong_part' => '다른 부품 도착',
        'quality'    => '품질·동작 이상',
        'other'      => '기타',
    );
}

/** 처리 방식 라벨(BOM_CLAIM_RESOLUTION_LABELS 동기) — 종결 이력 표기용. */
function sp_bom_claim_resolution_label($kind)
{
    switch ($kind) {
        case 'replacement':         return '대체품 발송';
        case 'refund_coordination': return '환불 별도 협의';
        case 'credit':              return '차감·보상 협의';
        case 'guidance':            return '사용·기술 안내';
        default:                    return '';
    }
}
