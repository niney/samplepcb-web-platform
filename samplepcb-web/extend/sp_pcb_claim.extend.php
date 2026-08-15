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
