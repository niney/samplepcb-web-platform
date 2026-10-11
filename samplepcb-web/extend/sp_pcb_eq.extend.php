<?php
if (!defined('_GNUBOARD_')) exit; // 개별 페이지 접근 불가

// ── PCB EQ 고객 확인 브리지 (sp-php → sp-node) ────────────────────────────────
// 설계 정본: docs/PCB_PARTNER_TRACK.md D16 (P4.1).
//
// 협력사 EQ(제조 확인 사항)를 고객에게 물어보는 축. 판정·저장은 전부 sp-node 가 하고
// PHP 는 **화면만 그린다** — sp_ 테이블에 직접 쓰지 않는다(권한·상태·회차 판정을 두 곳에
// 복제하면 반드시 어긋난다). 조회도 API 를 쓴다.
//
// 인증: 그누보드 세션 → spcb_jwt_encode() 로 단기 회원 JWT 를 만들어 Bearer 로 보낸다
// (spcb/api/me.php 와 같은 브리지 방식, 클레임 shape 도 동일).
//
// ⚠ 메일 링크는 이 함수를 부르지 않는다. 링크는 주문내역 화면을 열 뿐이고 결정은
//   화면 안 POST(spcb/api/eq-decide · 문항형은 spcb/api/eq-answer)로만 일어난다 — 메일 보안
//   스캐너의 링크 프리페치(GET)로 승인이 자동 처리되는 사고를 막는 규칙이다.

if (!defined('SPCB_NODE_BASE')) {
    // 같은 호스트의 sp-node. nginx 를 거치지 않고 내부로 직접 부른다(빠르고 외부 노출 없음).
    define('SPCB_NODE_BASE', 'http://127.0.0.1:3333');
}

/** 현재 로그인 회원의 단기 JWT. 비로그인이면 빈 문자열. */
function sp_pcb_member_token()
{
    global $member, $is_member, $config;

    if (empty($is_member) || empty($member['mb_id'])) return '';

    $jwt_lib     = G5_PATH . '/spcb/lib/jwt.php';
    $secret_file = G5_PATH . '/spcb/lib/secret.php';
    // secret.php 는 gitignore 대상 — 미배치 환경에서 Fatal 로 주문내역이 통째로 죽지 않게
    // 존재 확인 후에만 로드한다(sp_quote_thumb_url 과 같은 방어).
    if (!defined('SPCB_JWT_SECRET')) {
        if (!is_file($jwt_lib) || !is_file($secret_file)) return '';
        require_once $jwt_lib;
    }
    if (!defined('SPCB_JWT_SECRET') || !function_exists('spcb_jwt_encode')) return '';

    $is_admin = (isset($config['cf_admin']) && $member['mb_id'] === $config['cf_admin']);
    $now = time();
    return spcb_jwt_encode(array(
        'mbId'    => (string) $member['mb_id'],
        'mbNick'  => (string) $member['mb_nick'],
        'level'   => (int) $member['mb_level'],
        'isAdmin' => (bool) $is_admin,
        'iat'     => $now,
        'exp'     => $now + 120,   // 2분 — 요청 1회용
    ), SPCB_JWT_SECRET);
}

/** sp-node 호출 공통. 실패는 null(화면은 섹션을 감추고 계속 뜬다 — 주문내역이 죽으면 안 된다). */
function sp_pcb_node_call($method, $path, $body = null)
{
    $token = sp_pcb_member_token();
    if ($token === '') return null;

    $ch = curl_init(SPCB_NODE_BASE . $path);
    $headers = array('Authorization: Bearer ' . $token);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $raw    = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) return null;
    $json = json_decode($raw, true);
    return array('status' => $status, 'json' => is_array($json) ? $json : null);
}

/** 이 주문의 EQ 확인 요청 목록. 실패·비로그인·없음은 모두 빈 배열. */
function sp_pcb_eq_reviews($od_id)
{
    $res = sp_pcb_node_call('GET', '/api/pcb-eq-reviews?odId=' . rawurlencode((string) $od_id));
    if ($res === null || $res['status'] !== 200) return array();
    if (!isset($res['json']['data']['reviews']) || !is_array($res['json']['data']['reviews'])) {
        return array();
    }
    return $res['json']['data']['reviews'];
}

/** 주문을 가로지르는 **내 확인 요청** 목록(마이페이지 /shop/eq).
 *  $scope: 'open'=확인 대기만(기본) · 'all'=이력 포함.
 *  돌려주는 값: array('reviews' => array, 'openCount' => int) — 실패는 빈 목록·0. */
function sp_pcb_eq_reviews_mine($scope = 'open')
{
    $scope = ($scope === 'all') ? 'all' : 'open';
    $empty = array('reviews' => array(), 'openCount' => 0);
    $res = sp_pcb_node_call('GET', '/api/pcb-eq-reviews/mine?scope=' . $scope);
    if ($res === null || $res['status'] !== 200) return $empty;
    if (!isset($res['json']['data']['reviews']) || !is_array($res['json']['data']['reviews'])) {
        return $empty;
    }
    return array(
        'reviews'   => $res['json']['data']['reviews'],
        'openCount' => isset($res['json']['data']['openCount']) ? (int) $res['json']['data']['openCount'] : 0,
    );
}

/** 사이드바 배지용 **대기 건수만** — 여기서는 API 를 부르지 않고 DB 를 직접 센다.
 *
 *  이 함수는 계정 사이드바(_account_nav.php)가 부르고, 사이드바는 마이페이지·장바구니·
 *  포인트·쪽지 등 **모든 계정 페이지**에서 렌더된다. API 를 태우면 그 전부에 HTTP 왕복이
 *  하나씩 붙는다(주문내역 배지도 같은 이유로 직접 count 다). sp_* 는 그누보드와 같은 DB 에
 *  동거하므로 조인 한 방이면 된다.
 *
 *  ⚠ 이건 **판정이 아니라 세기**다 — 목록·결정의 판정은 전부 sp-node 다(브리지 규약).
 *  'requested' 가 곧 유효한 대기인 근거: EQ 전이가 열린 요청을 닫는다(closeOpenEqReviews). */
function sp_pcb_eq_open_count($mb_id)
{
    if ($mb_id === '') return 0;
    $esc = function_exists('sql_real_escape_string') ? sql_real_escape_string($mb_id) : addslashes($mb_id);
    $row = sql_fetch(" select count(*) as cnt
                         from sp_pcb_eq_review r
                         join sp_order_spec s on s.id = r.specId
                        where s.mbId = '{$esc}' and r.status = 'requested' ", false);
    return isset($row['cnt']) ? (int) $row['cnt'] : 0;
}

/** PCB 제작 진행 단계(P4.13) — od 상태와 별개의 협력 트랙 파생. 라벨은 sp-node 가
 *  완성해 내려주고 여기서는 그대로 출력한다(협력사·발주 정보 비노출). */
function sp_pcb_progress($od_id)
{
    $res = sp_pcb_node_call('GET', '/api/order-progress?odId=' . rawurlencode((string) $od_id));
    if ($res === null || $res['status'] !== 200) return array();
    if (!isset($res['json']['data']['items']) || !is_array($res['json']['data']['items'])) {
        return array();
    }
    return $res['json']['data']['items'];
}

/** 주문내역 **목록**용 진행 일괄 요약(주문마다 가장 느린 줄) — od_id ⇒ 항목(stage/label/shortLabel).
 *  행마다 API 를 부르면 목록 한 페이지에 HTTP 왕복이 20개 붙으므로 한 번에 묻는다(최대 50건).
 *  실패·비로그인·없음은 빈 배열(배지는 od 매핑으로 폴백). */
function sp_pcb_progress_batch($od_ids)
{
    $ids = array();
    foreach ((array) $od_ids as $id) {
        $id = (string) $id;
        if ($id !== '') $ids[] = $id;
    }
    if (count($ids) === 0) return array();
    $out = array();
    foreach (array_chunk(array_values(array_unique($ids)), 50) as $chunk) {
        $res = sp_pcb_node_call('POST', '/api/order-progress/batch', array('odIds' => $chunk));
        if ($res === null || $res['status'] !== 200) continue;
        if (!isset($res['json']['data']['orders']) || !is_array($res['json']['data']['orders'])) continue;
        foreach ($res['json']['data']['orders'] as $o) {
            if (isset($o['odId'])) $out[(string) $o['odId']] = $o;
        }
    }
    return $out;
}

/** 확인 요청 첨부 다운로드 URL — nginx 가 /api 를 sp-node 로 넘긴다(브라우저는 세션 쿠키가
 *  아니라 이 URL 을 그대로 열 수 없으므로, 다운로드는 eq-file.php 브리지를 거친다). */
function sp_pcb_eq_file_url($review_id, $file_id)
{
    return G5_URL . '/spcb/api/eq-file?review=' . (int) $review_id . '&file=' . (int) $file_id;
}

/** 좌표파일(메탈마스크) 다운로드 URL — 확인 요청과 **다른 축**이다: 요청도 결정도 없고
 *  통보도 없다. 고객이 주문내역을 열면 그냥 거기 있다(사용자 결정 2026-08-16).
 *  소유권·단계·종류 판정은 전부 sp-node 가 다시 한다. */
function sp_pcb_coord_file_url($file_id)
{
    return G5_URL . '/spcb/api/coord-file?file=' . (int) $file_id;
}

/** 상태 라벨 — 계약(PCB_EQ_REVIEW_STATUS_LABELS)과 같은 상태 축이되 **고객 시점의 말**을 쓴다
 *  (계약은 관리자 화면 말 '고객 승인'·'고객 회신'). 상태가 늘면 계약과 함께 고친다.
 *  answered = 문항형(D20) 회차에 고객(또는 담당자 대리)이 답한 상태. */
function sp_pcb_eq_status_label($status)
{
    switch ($status) {
        case 'approved': return array('label' => '승인함',   'cls' => 'sp_eq_ok');
        case 'rejected': return array('label' => '반려함',   'cls' => 'sp_eq_no');
        case 'answered': return array('label' => '회신 완료', 'cls' => 'sp_eq_ok');
        case 'canceled': return array('label' => '요청 취소', 'cls' => 'sp_eq_off');
        // draft(관리자 작성 중)는 sp-node 가 고객 응답에서 빼므로 오지 않는다 — 혹시 새어 들어와도
        // '확인 대기'로 보여 고객이 없는 폼을 찾지 않게 막아 둔다(화면은 이 상태의 행을 아예 건너뛴다).
        case 'draft':    return array('label' => '준비 중',   'cls' => 'sp_eq_off');
        default:         return array('label' => '확인 대기', 'cls' => 'sp_eq_wait');
    }
}

// ── D20 문항형 회차(format=items) — 고객 화면용 사전·도우미 ─────────────────────
// 정본 docs/PCB_PARTNER_TRACK.md 「D20 설계」. 판정(전 문항·의견 필수·소유권·판본)은 sp-node 가 하고
// 여기 있는 것은 **표시용 말**뿐이다.

/** 문항 유형 라벨 — 계약 PCB_EQ_ITEM_CATEGORY_LABELS 미러
 *  (packages/api-contract/src/schemas/pcb-eq-review.ts — 그쪽을 고치면 여기도 같이). 모르는 값은 '기타'. */
function sp_pcb_eq_item_category_label($category)
{
    static $map = array(
        'impedance'      => '임피던스',
        'marking'        => '마킹(UL·주기)',
        'pad'            => '패드',
        'soldermask_dam' => '솔더마스크 댐',
        'circuit'        => '회로 패턴',
        'via'            => '비아 처리',
        'soldermask'     => '솔더마스크',
        'legend'         => '실크(문자)',
        'drill'          => '드릴(홀)',
        'outline'        => '외형',
        'panel'          => '패널(배열)',
        'stackup'        => '적층 구조',
        'material'       => '원자재',
        'surface_finish' => '표면처리',
        'indication'     => '표기·도면',
        'other'          => '기타',
    );
    return isset($map[$category]) ? $map[$category] : '기타';
}

/** 문항 변화 라벨 — 계약 PCB_EQ_ITEM_CHANGE_LABELS 미러(같은 파일). 첫 회차(null)는 빈 문자열. */
function sp_pcb_eq_item_change_label($change)
{
    static $map = array('new' => '신규', 'changed' => '변경', 'same' => '동일');
    return isset($map[$change]) ? $map[$change] : '';
}

/** 화면 출력 이스케이프 — 질문·선택지·의견은 사람이(또는 AI 번역이) 쓴 자유 문장이라
 *  따옴표까지 막는 htmlspecialchars 로 낸다(get_text 는 홑따옴표를 그대로 둔다). */
function sp_pcb_eq_h($str)
{
    return htmlspecialchars((string) $str, ENT_QUOTES, 'UTF-8');
}

/** 문항 그림 URL — `<img>` 로 쓰는 인라인 열람. view=1 이면 브리지가 실패를 리다이렉트가 아니라
 *  404 로 끝낸다(이미지 요청이 주문 상세 HTML 을 통째로 다시 불러오지 않게). */
function sp_pcb_eq_figure_url($review_id, $file_id)
{
    return sp_pcb_eq_file_url($review_id, $file_id) . '&view=1';
}

/** 회신이 거절돼 되돌아올 때 고객이 고른 값을 **한 번** 되살린다(세션 플래시).
 *  오류 안내 뒤 문항 N개를 처음부터 다시 고르게 하지 않으려는 것 — 판정과는 무관하다. */
function sp_pcb_eq_answer_draft_save($review_id, $draft)
{
    $all = get_session('sp_eqi_draft');
    if (!is_array($all)) $all = array();
    $draft['at'] = time();
    $all[(int) $review_id] = $draft;
    set_session('sp_eqi_draft', $all);
}

/** 위에서 남긴 값을 꺼내고 지운다(새로고침에서 다시 살아나지 않게). 30분 지난 것은 버린다. */
function sp_pcb_eq_answer_draft_take($review_id)
{
    $all = get_session('sp_eqi_draft');
    $review_id = (int) $review_id;
    if (!is_array($all) || !isset($all[$review_id])) return null;
    $draft = $all[$review_id];
    unset($all[$review_id]);
    set_session('sp_eqi_draft', $all);
    if (!is_array($draft) || !isset($draft['at']) || time() - (int) $draft['at'] > 1800) return null;
    return $draft;
}

/** 그누보드 CSRF 토큰 검증 — **alert 없이 참/거짓만** 돌려준다.
 *
 *  코어 check_token() 은 실패하면 자체적으로 alert() 을 띄우고 끝난다(bbs/alert.php 로
 *  페이지 이동 + 네이티브 팝업). 그러면 커스텀 팝업으로 감쌀 수 없어서, 검증 로직만
 *  같게 복제하고 결과 안내는 호출부가 하도록 분리했다.
 *  ⚠ 코어(lib/common.lib.php check_token)가 바뀌면 여기도 맞춰야 한다. */
function sp_pcb_check_token($expire = 7200)
{
    $token = isset($_POST['token']) ? $_POST['token'] : '';
    $dot = strpos($token, '.');
    if (!$token || $dot === false) return false;

    $time = (int) substr($token, 0, $dot);
    $hmac = substr($token, $dot + 1);
    if (abs(time() - $time) > $expire) return false;

    if (!function_exists('_get_token_key') || !function_exists('_get_token_secret')) return false;
    $expected = hash_hmac('sha256', _get_token_secret() . '|csrf_token|' . $time, _get_token_key());

    return hash_equals($expected, $hmac);
}

// ── 브리지 폼의 자유 입력 읽기 — 고객이 친 글자 그대로 ──────────────────────────
// 그누보드 common.php(119행)는 $_POST·$_GET 의 **모든 값**에 G5_ESCAPE_FUNCTION 을 건다.
// 지금 설정(config.php)은 sql_escape_string = addslashes 다: `'`·`"`·`\` 앞에 `\` 를 붙이고
// NUL 을 `\0` 두 글자로 바꾼다(줄바꿈·유니코드는 건드리지 않는다). g5 SQL 을 문자열로 조립하는
// 코어를 위한 방어다. sp-node 는 Prisma 바인딩이라 그 방어가 필요 없고, 그 값을 그대로 넘기면
// 고객이 쓴 `it's "A" \ 끝` 이 `it\'s \"A\" \\ 끝` 으로 sp_ 원장에 저장된다(실측 2026-10-11 —
// eq-decide·bom-confirm-answer·claim-create, e2e/specs/php-bridge-escape). 원장을 읽는 관리자
// 화면·알림 메일도 그 값을 그대로 쓰고, 길이 검사는 군더더기 `\` 를 글자로 센다.
//
// 그래서 sp-node 로 넘길 **자유 입력 문장**은 $_POST 를 직접 읽지 않고 아래 함수로 읽는다.
//   · 되돌리는 것이 아니라 PHP 가 받은 **원문**을 다시 읽는다(filter 확장 — 코어가 $_POST 를
//     덮어써도 원문은 따로 남는다. urlencoded·multipart 모두). 칸 이름으로 읽으므로 한 값에
//     되돌림이 두 번 걸릴 일이 없고, 코어의 이스케이프 설정이 바뀌어도 따라 바꿀 것이 없다.
//   · 원문을 읽지 못하는 환경이면 $_POST 값에 stripslashes(addslashes 의 정확한 역)를 한 번 건다.
// ⚠ 여기서 읽은 값은 **이스케이프 전**이다 — g5 SQL(sql_query 문자열)에 넣지 않는다. sp-node 전용.
// ※ (int)·화이트리스트·정규식으로 거르는 칸(id·decision·choice 등)은 $_POST 그대로 써도 된다
//   (따옴표가 낄 자리가 없다).

/** 폼 한 칸의 원문 — 문자열 또는 (name="x[..]" 이면) 배열. 칸이 없으면 null. */
function sp_bridge_raw($key)
{
    if (!isset($_POST[$key])) return null;

    if (function_exists('filter_input')) {
        $flag = is_array($_POST[$key]) ? FILTER_REQUIRE_ARRAY : FILTER_REQUIRE_SCALAR;
        $raw  = filter_input(INPUT_POST, $key, FILTER_UNSAFE_RAW, $flag);
        if ($raw !== null && $raw !== false) return $raw;
    }
    return array_map_deep('stripslashes', $_POST[$key]);
}

/** 원문 한 값을 다듬는다 — 앞뒤 공백을 떼고(계약의 .trim() 과 같다) $max 글자에서 자른다(0 = 안 자름).
 *  NUL 은 버린다: 코어의 addslashes 가 `\0` 글자로 무력화하던 것이라, 원문을 읽는 이상 여기서 막는다. */
function sp_bridge_clean($value, $max = 0)
{
    if (!is_string($value)) return '';
    $value = trim(str_replace("\0", '', $value));
    return $max > 0 ? mb_substr($value, 0, $max) : $value;
}

/** 자유 입력 한 칸(name="note") — 고객이 친 그대로. 칸이 없거나 배열로 오면 빈 문자열. */
function sp_bridge_text($key, $max = 0)
{
    return sp_bridge_clean(sp_bridge_raw($key), $max);
}

/** 자유 입력 배열 칸(name="comment[12]") — 키는 그대로, 값마다 sp_bridge_text 와 같이. 배열이 아니면 빈 배열. */
function sp_bridge_text_map($key, $max = 0)
{
    $raw = sp_bridge_raw($key);
    $out = array();
    if (is_array($raw)) {
        foreach ($raw as $k => $value) $out[$k] = sp_bridge_clean($value, $max);
    }
    return $out;
}
