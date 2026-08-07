(function () {
    'use strict';

    var config = window.spQuoteVatBreakdown;
    var form = document.getElementById('forderform');
    var summary = document.getElementById('sod_bsk_tot');

    if (!config || !Array.isArray(config.itemIds) || !form || !summary) {
        return;
    }

    var allowedItemIds = {};
    config.itemIds.forEach(function (itemId) {
        allowedItemIds[String(itemId)] = true;
    });

    var itemInputs = form.querySelectorAll('input[name^="it_id["]');
    if (itemInputs.length === 0) {
        return;
    }

    for (var i = 0; i < itemInputs.length; i++) {
        if (!allowedItemIds[itemInputs[i].value]) {
            return;
        }
    }

    var section = document.createElement('section');
    section.id = 'sp-order-vat-breakdown';
    section.className = 'sp-order-vat';
    section.innerHTML =
        '<h2>부가세 명세</h2>' +
        '<dl class="sp-order-vat__list">' +
            '<div class="sp-order-vat__row">' +
                '<dt>공급가액</dt>' +
                '<dd><strong data-vat-amount="supply">0</strong>원</dd>' +
            '</div>' +
            '<div class="sp-order-vat__row">' +
                '<dt>부가세 <span class="sp-order-vat__rate">10%</span></dt>' +
                '<dd><strong data-vat-amount="vat">0</strong>원</dd>' +
            '</div>' +
            '<div class="sp-order-vat__row sp-order-vat__row--total">' +
                '<dt>최종 결제예정액 <span class="sp-order-vat__badge">VAT 포함</span></dt>' +
                '<dd><strong data-vat-amount="total">0</strong>원</dd>' +
            '</div>' +
        '</dl>' +
        '<p class="sp-order-vat__note">배송비·쿠폰·포인트를 반영하며 실제 결제 단계에서 최종 확인됩니다.</p>';

    summary.parentNode.insertBefore(section, summary.nextSibling);

    var amountEls = {
        supply: section.querySelector('[data-vat-amount="supply"]'),
        vat: section.querySelector('[data-vat-amount="vat"]'),
        total: section.querySelector('[data-vat-amount="total"]')
    };
    var numberFormatter = new Intl.NumberFormat('ko-KR');

    function fieldMoney(name) {
        var field = form.elements.namedItem(name);
        if (!field || typeof field.value === 'undefined') {
            return 0;
        }

        var value = Number(String(field.value).replace(/,/g, ''));
        return Number.isFinite(value) ? Math.round(value) : 0;
    }

    function update() {
        // shop/orderformupdate.php의 최종 결제금액 계산과 같은 항목을 사용한다.
        var total = fieldMoney('od_price')
            + fieldMoney('od_send_cost')
            + fieldMoney('od_send_cost2')
            - fieldMoney('od_send_coupon')
            - fieldMoney('od_temp_point');
        total = Math.max(0, total);

        // 영카트 저장 로직과 동일: 공급가 = round(부가세포함액 / 1.1).
        var supply = Math.round(total / 1.1);
        var vat = total - supply;

        amountEls.supply.textContent = numberFormatter.format(supply);
        amountEls.vat.textContent = numberFormatter.format(vat);
        amountEls.total.textContent = numberFormatter.format(total);
    }

    var updateQueued = false;
    function scheduleUpdate() {
        if (updateQueued) {
            return;
        }
        updateQueued = true;
        window.requestAnimationFrame(function () {
            updateQueued = false;
            update();
        });
    }

    form.addEventListener('input', scheduleUpdate);
    form.addEventListener('change', scheduleUpdate);

    // 쿠폰·추가배송비는 코어 스크립트가 hidden 값을 직접 바꾼 뒤 총액 문구를 갱신한다.
    // 해당 문구 변화를 감시해 별도 코어 수정 없이 명세를 같은 시점에 다시 계산한다.
    var displayedTotal = document.getElementById('od_tot_price');
    if (displayedTotal && typeof MutationObserver !== 'undefined') {
        new MutationObserver(scheduleUpdate).observe(displayedTotal, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    update();
}());
