<?php
if (!defined('_GNUBOARD_')) exit;

// sp-vue 파트너 포탈 링크용 승인 소속 판정. sp-node requirePartner와 같은
// sp_partner_member + approved 조직 기준을 사용하며, 테이블이 아직 없는 초기
// 설치에서는 SQL 오류를 화면에 노출하지 않고 비파트너로 처리한다.
if (!function_exists('sp_is_approved_partner')) {
    function sp_is_approved_partner($mb_id = '')
    {
        global $member;

        $mb_id = trim((string)$mb_id);
        if ($mb_id === '' && isset($member['mb_id'])) {
            $mb_id = trim((string)$member['mb_id']);
        }
        if ($mb_id === '') {
            return false;
        }

        $mb_id = sql_real_escape_string($mb_id);
        $row = sql_fetch(
            " select 1 as is_partner
                from sp_partner_member as m
                inner join sp_partner as p on p.id = m.partnerId
               where m.mbId = '{$mb_id}'
                 and p.status = 'approved'
               limit 1 ",
            false
        );

        return !empty($row['is_partner']);
    }
}
