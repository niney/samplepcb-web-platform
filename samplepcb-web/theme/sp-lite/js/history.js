// 회사 연혁: 실제 가로 스크롤 위치와 시안의 이동 막대를 동기화한다.
(function () {
    'use strict';
    function init() {
        var viewport = document.getElementById('sp-history-viewport');
        var control = document.querySelector('.sp-hist__scroll');
        if (!viewport || !control) return;
        function maximum() { return Math.max(0, viewport.scrollWidth - viewport.clientWidth); }
        function sync() {
            var max = maximum();
            control.disabled = max === 0;
            control.value = max ? String(100 * viewport.scrollLeft / max) : '0';
        }
        control.addEventListener('input', function () {
            viewport.scrollLeft = maximum() * Number(control.value) / 100;
        });
        viewport.addEventListener('scroll', sync, { passive: true });
        viewport.addEventListener('keydown', function (event) {
            if (event.key !== 'Home' && event.key !== 'End') return;
            event.preventDefault();
            viewport.scrollLeft = event.key === 'Home' ? 0 : maximum();
        });
        var drag = null;
        viewport.addEventListener('pointerdown', function (event) {
            if (event.pointerType !== 'mouse' || event.button !== 0 || !maximum()) return;
            event.preventDefault();
            viewport.focus({ preventScroll: true });
            drag = { x: event.clientX, left: viewport.scrollLeft };
            viewport.setPointerCapture(event.pointerId);
            viewport.classList.add('is-dragging');
        });
        viewport.addEventListener('pointermove', function (event) {
            if (drag) viewport.scrollLeft = drag.left + drag.x - event.clientX;
        });
        function endDrag() { drag = null; viewport.classList.remove('is-dragging'); }
        viewport.addEventListener('pointerup', endDrag);
        viewport.addEventListener('pointercancel', endDrag);
        viewport.addEventListener('lostpointercapture', endDrag);
        window.addEventListener('resize', sync);
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
        sync();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
}());
