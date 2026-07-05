<?php
// samplepcb 주문 알림 브리지 (sp-node → sp-php)
// URL: POST /spcb/api/order-notify   (spcb/.htaccess 가 무확장 → .php 라우팅)
// sp-node 가 관리자 주문 상태 전이(입금/배송)에 성공한 뒤, 메일/SMS 를 Node 에서 재구현하지 않고
// 그누보드/영카트의 **커스텀된 주문 메일 템플릿**(adm/shop_admin/ordermail.inc.php →
// shop/mail/ordermail.mail.php, 견적 건별 표시 커스텀)을 그대로 재사용하기 위한 브리지다.
// 인증: Authorization: Bearer <HS256 JWT>(svc==='sp-node', exp 필수) — spcb/lib/jwt.php 로 검증.
// 시맨틱 원본: adm/shop_admin/orderlistupdate.php(입금:52-76 SMS de_sms_cont4·메일 / 배송:83-118
//   SMS de_sms_cont5·메일). 준비·완료 전이는 코어가 알림을 보내지 않으므로 여기서도 skipped.
// dryRun=true 면 실발송 대신 무엇을 보낼지(preview: 수신자·제목·SMS 문구)를 반환. 이때 mail/sms 의
//   'sent' 는 "발송 대상"을 뜻한다(실발송 아님). 실발송 실패는 'failed'(전이는 이미 성공).
// ※ spcb/ 밖 PHP 는 include(재사용)만 하고 수정하지 않는다.

include_once __DIR__ . '/../../common.php';       // 그누보드+영카트 부트스트랩 → $g5,$config,$default
include_once __DIR__ . '/../lib/jwt.php';          // spcb_jwt_decode(), SPCB_JWT_SECRET
include_once G5_LIB_PATH . '/shop.lib.php';        // display_price·display_point·get_delivery_inquiry
include_once G5_LIB_PATH . '/mailer.lib.php';      // mailer()

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function spcb_notify_fail($code, $msg) {
    http_response_code($code);
    echo json_encode(array('ok' => false, 'message' => $msg), JSON_UNESCAPED_UNICODE);
    exit;
}

// Authorization 헤더 획득 — 일부 Apache/mod_php 조합에서 CGI 로 안 넘어오므로 다중 경로로 읽는다
// (.htaccess 의 E=HTTP_AUTHORIZATION 패스스루 + getallheaders 폴백).
function spcb_bearer_token() {
    $auth = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) $auth = $_SERVER['HTTP_AUTHORIZATION'];
    else if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    else if (function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $auth = $v; break; }
        }
    }
    if (preg_match('/^Bearer\s+(.+)$/i', trim($auth), $m)) return $m[1];
    return '';
}

// 1) 메서드
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') spcb_notify_fail(405, 'method not allowed');

// 2) 서비스 JWT 검증(svc==='sp-node')
$token  = spcb_bearer_token();
$claims = $token !== '' ? spcb_jwt_decode($token, SPCB_JWT_SECRET) : false;
if ($claims === false || !isset($claims['svc']) || $claims['svc'] !== 'sp-node') {
    spcb_notify_fail(401, 'invalid service token');
}

// 3) 요청 body
$req = json_decode(file_get_contents('php://input'), true);
if (!is_array($req)) spcb_notify_fail(400, 'invalid json');

$od_id     = isset($req['odId']) ? preg_replace('/[^0-9a-zA-Z_-]/', '', (string) $req['odId']) : '';
$event     = isset($req['event']) ? (string) $req['event'] : '';
$want_mail = !empty($req['mail']);
$want_sms  = !empty($req['sms']);
$dry_run   = !empty($req['dryRun']);

if ($od_id === '') spcb_notify_fail(400, 'missing odId');
if (!in_array($event, array('입금', '준비', '배송', '완료'), true)) spcb_notify_fail(400, 'invalid event');

// 4) 주문 조회
$od = sql_fetch(" select * from {$g5['g5_shop_order_table']} where od_id = '" . sql_real_escape_string($od_id) . "' ");
if (!$od || !$od['od_id']) spcb_notify_fail(404, 'order not found');

$notify_events = array('입금', '배송'); // 코어가 알림을 보내는 전이만(orderlistupdate.php)
$mail_status = 'skipped';
$sms_status  = 'skipped';
$preview = array();

// ── 메일 (ordermail.inc.php 재사용) ──────────────────────────────────────────
if ($want_mail) {
    // is_receipt / is_delivery — ordermail.inc.php(:45-81)의 발송 여부 판정 미러.
    $is_receipt = false;
    if ($od['od_receipt_price'] > 0 && ($od['od_settle_case'] == '신용카드' || $od['od_settle_case'] == '무통장')) $is_receipt = true;
    if ($od['od_receipt_point'] > 0) $is_receipt = true;
    $is_delivery = ($od['od_delivery_company'] && $od['od_invoice']) ? true : false;

    $email_use = !empty($config['cf_email_use']);
    $would_send = in_array($event, $notify_events, true) && $email_use && ($is_receipt || $is_delivery);

    if ($dry_run) {
        $mail_status = $would_send ? 'sent' : 'skipped';
        $preview['mail'] = array(
            'to'         => $od['od_email'],
            'subject'    => $config['cf_title'] . ' - ' . $od['od_name'] . '님 주문 처리 내역 안내',
            'emailUse'   => $email_use,
            'isReceipt'  => $is_receipt,
            'isDelivery' => $is_delivery,
            'wouldSend'  => $would_send,
        );
    } else if ($would_send) {
        // 실발송 — 코어 ordermail.inc.php 를 include(커스텀 메일 템플릿 재사용, 드리프트 방지).
        // ordermail.inc.php 가 $od_send_mail·$od_id 를 읽고 $od 를 재조회한다.
        if (!defined('_ORDERMAIL_')) define('_ORDERMAIL_', true);
        $od_send_mail = true;
        try {
            include __DIR__ . '/../../adm/shop_admin/ordermail.inc.php';
            $mail_status = 'sent'; // mailer() 반환을 코어도 검사하지 않음 → "발송 시도" 성공으로 간주
        } catch (\Throwable $e) {
            $mail_status = 'failed';
        }
    } else {
        $mail_status = 'skipped';
    }
}

// ── SMS (conv_sms_contents 미러 + icode 송신) ────────────────────────────────
if ($want_sms) {
    $tmpl_key = ($event === '입금') ? 'de_sms_cont4' : (($event === '배송') ? 'de_sms_cont5' : '');
    $use_key  = ($event === '입금') ? 'de_sms_use4'  : (($event === '배송') ? 'de_sms_use5'  : '');
    $recv = preg_replace('/[^0-9]/', '', $od['od_hp']);       // 수신자(주문자 휴대폰)
    $send_number = preg_replace('/[^0-9]/', '', $default['de_admin_company_tel']); // 발신자

    $sms_on = ($config['cf_sms_use'] == 'icode' && $tmpl_key !== '' && !empty($default[$use_key]) && $recv !== '');

    if (!$sms_on) {
        $sms_status = 'skipped';
        if ($dry_run) {
            $preview['sms'] = array('wouldSend' => false, 'smsUse' => $config['cf_sms_use'], 'to' => $recv);
        }
    } else {
        // conv_sms_contents(admin.shop.lib.php:138-160) 치환 미러.
        $content = $default[$tmpl_key];
        $content = str_replace('{이름}', $od['od_name'], $content);
        $content = str_replace('{입금액}', number_format((int) $od['od_receipt_price']), $content);
        $content = str_replace('{택배회사}', $od['od_delivery_company'], $content);
        $content = str_replace('{운송장번호}', $od['od_invoice'], $content);
        $content = str_replace('{주문번호}', $od['od_id'], $content);
        $content = str_replace('{회사명}', $default['de_admin_company_name'], $content);
        $content = stripslashes($content);

        if ($dry_run) {
            $sms_status = 'sent';
            $preview['sms'] = array('wouldSend' => true, 'to' => $recv, 'from' => $send_number, 'content' => $content);
        } else {
            try {
                // orderlistupdate.php:164-208 의 icode 송신을 단건으로 미러.
                if ($config['cf_sms_type'] == 'LMS') {
                    include_once(G5_LIB_PATH . '/icode.lms.lib.php');
                    $port_setting = get_icode_port_type($config['cf_icode_id'], $config['cf_icode_pw']);
                    if ($port_setting !== false) {
                        $SMS = new LMS;
                        $SMS->SMS_con($config['cf_icode_server_ip'], $config['cf_icode_id'], $config['cf_icode_pw'], $port_setting);
                        $strDest = array($recv);
                        $SMS->Add($strDest, $send_number, iconv_euckr(trim($default['de_admin_company_name'])), '', '', iconv_euckr($content), '', count($strDest));
                        $SMS->Send();
                        $SMS->Init();
                        $sms_status = 'sent';
                    } else {
                        $sms_status = 'failed';
                    }
                } else {
                    include_once(G5_LIB_PATH . '/icode.sms.lib.php');
                    $SMS = new SMS;
                    $SMS->SMS_con($config['cf_icode_server_ip'], $config['cf_icode_id'], $config['cf_icode_pw'], $config['cf_icode_server_port']);
                    $SMS->Add($recv, $send_number, $config['cf_icode_id'], iconv_euckr($content), '');
                    $SMS->Send();
                    $SMS->Init();
                    $sms_status = 'sent';
                }
            } catch (\Throwable $e) {
                $sms_status = 'failed';
            }
        }
    }
}

$out = array('ok' => true, 'mail' => $mail_status, 'sms' => $sms_status);
if ($dry_run) $out['preview'] = $preview;
echo json_encode($out, JSON_UNESCAPED_UNICODE);
