// 홈 — Development Portfolio 무한 마퀴(디자이너 메모: korlinx 참고 사이트 .home-case-stories 방식)
//  · 원본 카드 세트 뒤에 세트를 복제(aria-hidden)해 붙이고, CSS 애니메이션(sp-pf-loop)으로 세트 폭만큼 왼쪽으로 흘려 이음새 없이 돈다.
//  · 세트 폭·복제 수는 뷰포트 폭에 맞춰 계산(리사이즈 시 다시). 속도 55px/s. 호버 정지는 CSS, reduced-motion 이면 복제도 애니메이션도 없음.
export function init() {
    var viewport = document.getElementById('sp-portfolio');
    if (!viewport) return;
    var track = viewport.querySelector('.sp-idea__pf-track');
    if (!track) return;
    var cards = Array.prototype.slice.call(track.children);
    if (cards.length === 0) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; // 정지: 원본 카드만

    var SPEED = 55; // px/s

    function build() {
        Array.prototype.slice.call(track.querySelectorAll('[data-clone]')).forEach(function (n) { n.remove(); });
        var cs = getComputedStyle(track);
        var gap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
        var setWidth = cards.reduce(function (w, c) { return w + c.getBoundingClientRect().width; }, 0) + gap * cards.length;
        if (!setWidth) return;
        // 뷰포트를 덮고도 한 세트가 더 남도록(최소 2세트)
        var sets = Math.max(2, Math.ceil((viewport.clientWidth + setWidth) / setWidth) + 1);
        for (var s = 1; s < sets; s++) {
            cards.forEach(function (c) {
                var k = c.cloneNode(true);
                k.setAttribute('aria-hidden', 'true');
                k.setAttribute('data-clone', '1');
                track.appendChild(k);
            });
        }
        track.style.setProperty('--sp-pf-shift', (-setWidth) + 'px');
        track.style.setProperty('--sp-pf-duration', (setWidth / SPEED).toFixed(1) + 's');
        track.classList.add('is-animated');
    }

    build();
    var timer = 0;
    window.addEventListener('resize', function () {
        clearTimeout(timer);
        timer = setTimeout(build, 200);
    });
}
