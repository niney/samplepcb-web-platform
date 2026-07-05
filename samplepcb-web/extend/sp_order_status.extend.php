<?php
if (!defined('_GNUBOARD_')) exit;

// 주문 상태 → 고객노출 라벨 + 배지 클래스 (레거시 lib/common.lib.php get_order_status_list 의
// korForCustomer/cssCls2 이식). 고객 화면의 목록(theme/sp-lite/shop/orderinquiry.sub.php)과
// 상세(orderinquiryview.php)가 이 함수를 공유해 표기를 일원화한다 — 각자 switch 를 두면
// '가격확인' 이 목록=상품준비중 / 상세=원문 처럼 어긋나므로, 매핑의 단일 원천(SSOT)로 둔다.
if (!function_exists('sp_order_status_customer')) {
    function sp_order_status_customer($status) {
        switch ($status) {
            case '주문':     return array('label' => '입금확인중', 'cls' => 'status_01');
            case '입금':     return array('label' => '입금완료',   'cls' => 'status_02');
            case '준비':     return array('label' => '상품준비중', 'cls' => 'status_03');
            // 제작 단계는 원문 노출(관리자 상태명과 고객 표기 일치, 진행 중 색 공용).
            case '가격확인': return array('label' => '가격확인',   'cls' => 'status_03');
            case '파일검사': return array('label' => '파일검사',   'cls' => 'status_03');
            case 'EQ':       return array('label' => 'EQ',         'cls' => 'status_03');
            case '생산시작': return array('label' => '생산시작',   'cls' => 'status_03');
            case '생산중':   return array('label' => '생산중',     'cls' => 'status_03');
            case '품질시험': return array('label' => '품질시험',   'cls' => 'status_03');
            case '생산완료': return array('label' => '생산완료',   'cls' => 'status_03');
            case 'A/S':      return array('label' => 'A/S',        'cls' => 'status_03');
            case '배송':     return array('label' => '상품배송',   'cls' => 'status_04');
            case '완료':     return array('label' => '배송완료',   'cls' => 'status_05');
            // 취소/반품/품절 및 기타 — 목록 기존 정책대로 '주문취소'(status_06)로 뭉뚱그린다.
            default:         return array('label' => '주문취소',   'cls' => 'status_06');
        }
    }
}
