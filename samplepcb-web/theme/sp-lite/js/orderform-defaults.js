// 주문서 기본값·상태 동기화 — 코어(shop/orderform.sub.php)를 고치지 않고 마찰만 걷어낸다.
// 배경: sp-lite 는 장바구니·견적관리·주문내역을 전부 테마로 덮었지만 주문서만 영카트 원본이라,
// 고객이 매번 ① 배송지 ② 결제수단 ③ 입금 계좌를 손으로 고른 뒤에야 제출이 통과한다.
// 검증은 순차 alert 라 신규 고객은 제출을 세 번 반복하게 된다.
//
// 코어 핸들러(ad_sel_addr·od_settle_bank 의 click)를 그대로 태워야 값 채움·배송비 재계산이
// 함께 일어나므로, 여기서는 프로그램적 click 으로 "고객이 눌렀을 때와 같은 경로"를 밟는다.
(function () {
    'use strict';

    if (typeof window.jQuery === 'undefined') return;
    var $ = window.jQuery;

    // 코어의 ready 핸들러가 먼저 등록된 뒤 실행되도록 같은 큐에 넣는다(등록 순서대로 실행).
    $(function () {
        var form = document.forderform;
        if (!form) return;

        // ── 무통장 계좌 영역 표시 동기화 ─────────────────────────────────────
        // 코어는 #settle_bank 를 인라인 display:none 으로 두고 click 에서만 펼친다.
        // 그래서 뒤로가기·bfcache 로 돌아오면 라디오는 선택된 채인데 입력란은 숨어 있고,
        // 필수 검증(계좌·입금자명)에 걸려도 오류 표시가 배경색뿐이라 화면에 아무 변화가 없다
        // — 새로고침 말고는 빠져나올 방법이 없어진다. 그 상태를 매번 바로잡는다.
        function syncSettleBank() {
            var checked = $('input[name=od_settle_case]:checked');
            if (checked.length === 0) return;
            $('#settle_bank').toggle(checked.attr('id') === 'od_settle_bank');
        }

        // ── 입금 계좌 select 의 빈 옵션 제거 ─────────────────────────────────
        // 코어는 계좌가 2개 이상일 때만 select 를 만들고 맨 앞에 value="" 인 '선택하십시오.'를
        // 넣는다(빈 줄이 섞이면 보이지 않는 빈 옵션도 생긴다). 고르지 않으면 제출이 막히므로
        // 빈 옵션을 걷어내 첫 계좌가 선택된 상태로 시작한다.
        function normalizeBankAccount() {
            var sel = document.getElementById('od_bank_account');
            if (!sel || sel.tagName !== 'SELECT') return;
            for (var i = sel.options.length - 1; i >= 0; i -= 1) {
                if (sel.options[i].value.replace(/\s/g, '') === '') sel.remove(i);
            }
            if (sel.selectedIndex < 0 && sel.options.length > 0) sel.selectedIndex = 0;
        }

        // ── 배송지 기본 선택 ─────────────────────────────────────────────────
        // 주문자 정보는 서버가 채워 주는데 '받으시는 분'은 통째로 비어 있고 배송지 라디오도
        // 아무것도 선택돼 있지 않다. PCB 주문은 대개 주문자=수취인이므로 기본배송지가 있으면
        // 그것을, 없으면 [주문자와 동일]을 눌러 준다(코어 핸들러가 값 채움·배송비 재계산 수행).
        function pickDefaultAddress() {
            var radios = $('input[name=ad_sel_addr]');
            if (radios.length === 0 || radios.filter(':checked').length > 0) return;

            var pick = $('#ad_sel_addr_def');
            if (pick.length === 0) pick = $('#ad_sel_addr_same');
            if (pick.length === 0) return;

            // 비회원은 checkbox 라 click 이 토글이다 — 해제 상태에서 눌러야 선택으로 끝난다.
            pick.prop('checked', false);
            pick[0].click();
        }

        // ── 결제수단 기본 선택 ───────────────────────────────────────────────
        // 코어는 $checked 를 채우지 않아 어떤 수단도 선택되지 않는다. 무통장이 열려 있으면
        // 그것을(PCB 는 선입금 후 제조라 사실상 기본), 아니면 첫 수단을 누른다.
        function pickDefaultSettle() {
            var radios = $('input[name=od_settle_case]');
            if (radios.length === 0 || radios.filter(':checked').length > 0) return;

            var bank = $('#od_settle_bank');
            var pick = bank.length > 0 ? bank : radios.first();
            pick.prop('checked', false);
            pick[0].click(); // 코어 click 핸들러가 #settle_bank 표시·입금자명 프리필까지 처리
        }

        // ── '주문자와 동일'을 고른 동안은 계속 따라가게 ───────────────────────
        // 코어는 라디오를 누른 그 순간에만 값을 복사한다(gumae2baesong). 회원 정보에 주소가
        // 없으면 로드 시점 복사본은 빈 값이고, 고객이 그 뒤 주문자 주소를 채워도 받는분은
        // 빈 채로 남아 제출에서 막힌다 — 게다가 오류 표시가 배경색뿐이라 어디가 문제인지도
        // 잘 안 보인다. 선택이 유지되는 동안 주문자 변경을 그대로 반영한다.
        var ORDERER_FIELDS =
            'input[name=od_name], input[name=od_tel], input[name=od_hp], input[name=od_zip], ' +
            'input[name=od_addr1], input[name=od_addr2], input[name=od_addr3]';

        function sameSelected() {
            var picked = $('input[name=ad_sel_addr]:checked');
            return picked.length > 0 && picked.val() === 'same';
        }
        function resyncReceiver() {
            if (!sameSelected() || typeof window.gumae2baesong !== 'function') return;
            window.gumae2baesong(); // 배송비 재계산까지 코어가 함께 처리한다
        }
        // 타이핑마다 부르면 gumae2baesong 안의 배송비 AJAX 가 그만큼 나간다 — 짧게 묶는다.
        var resyncTimer = null;
        function resyncSoon() {
            if (resyncTimer !== null) window.clearTimeout(resyncTimer);
            resyncTimer = window.setTimeout(function () {
                resyncTimer = null;
                resyncReceiver();
            }, 300);
        }

        $(document).on('input change', ORDERER_FIELDS, resyncSoon);
        // 주소 검색(다음 우편번호)은 값을 코드로 넣어 input 이벤트가 안 뜬다 — 제출 직전에
        // 한 번 더 맞춘다. capture 단계라 코어의 필수값 검증(onsubmit)보다 먼저 돈다.
        if (typeof form.addEventListener === 'function') {
            form.addEventListener('submit', resyncReceiver, true);
        }

        syncSettleBank(); // 복원된 선택 먼저 반영하고
        pickDefaultAddress();
        pickDefaultSettle(); // 그다음에야 빈 자리를 채운다
        normalizeBankAccount();

        // bfcache 복원(뒤로가기·PG 실패 귀환)은 스크립트를 다시 돌리지 않는다 — 표시 상태만 맞춘다.
        window.addEventListener('pageshow', function () {
            syncSettleBank();
            normalizeBankAccount();
        });
    });
}());
