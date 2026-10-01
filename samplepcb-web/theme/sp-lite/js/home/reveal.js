// 스크롤 진입 등장 — megazone.com 메인(framer-motion whileInView)을 참고한다.
// 아래 20px·투명 → 제자리, .3초 ease-in-out, 한 번만. 같은 순간 들어온 요소끼리는 0.1초 간격(최대 0.4초).
// 숨김은 JS 가 거는 클래스(.sp-reveal)라 JS 가 없거나 reduced-motion 이면 처음부터 보인다.
// 첫 화면에 이미 보이는 요소는 건드리지 않는다(보였다가 숨는 깜빡임 방지).
// 제외: 히어로(hero.js)·숫자 섹션(stats.js 가 자체 등장+카운트업). 탭 패널·마퀴는 컨테이너 단위로만 건다
// (onestop.js 의 hidden 토글, portfolio·network 트랙의 transform 애니메이션과 겹치지 않게).
var TARGETS = [
    '.sp-onestop__intro > *', '.sp-onestop__title', '.sp-onestop__desc', '.sp-onestop__tabs-wrap', '.sp-onestop__panels', '.sp-onestop__note',
    '.sp-eyes__head > *', '.sp-eyes__media', '.sp-eyes__card',
    '.sp-idea__head > *', '.sp-idea__step', '.sp-idea__pf-title', '.sp-idea__pf-desc', '.sp-idea__pf-viewport',
    '.sp-network__title', '.sp-network__sub', '.sp-network__row',
    '.sp-help__title', '.sp-help__card'
];
var DURATION = 300;
var STAGGER = 100;
var MAX_STEPS = 4;

export function init() {
    var root = document.querySelector('.sp-home');
    if (!root || root.hasAttribute('data-reveal-ready') || !window.IntersectionObserver) return;
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;

    // querySelectorAll 은 문서 순서 — 같은 배치 안의 간격도 이 순서를 따른다
    var fold = window.innerHeight || document.documentElement.clientHeight;
    var items = Array.prototype.slice.call(root.querySelectorAll(TARGETS.join(','))).filter(function (el) {
        return el.getBoundingClientRect().top >= fold;
    });
    if (!items.length) return;
    var order = new Map(items.map(function (el, i) { return [el, i]; }));

    function settle(el) {
        el.classList.remove('sp-reveal', 'is-in');
        el.style.removeProperty('--sp-reveal-delay');
    }
    function reveal(el, delay) {
        if (delay) el.style.setProperty('--sp-reveal-delay', delay + 'ms');
        el.classList.add('is-in');
        // 끝나면 클래스를 걷어 transform·쌓임 맥락을 남기지 않는다
        setTimeout(function () { settle(el); }, delay + DURATION + 50);
    }
    // 화면 아래 12% 선을 넘으면 등장 — 비율 임계값이 아니라 위치 기준이라 화면보다 큰 요소도 걸린다
    var observer = new IntersectionObserver(function (entries) {
        var step = 0;
        entries.filter(function (entry) { return entry.isIntersecting; })
            .sort(function (a, b) { return order.get(a.target) - order.get(b.target); })
            .forEach(function (entry) {
                observer.unobserve(entry.target);
                reveal(entry.target, Math.min(step++, MAX_STEPS) * STAGGER);
            });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0 });

    function onMotionChange() {
        if (!motion.matches) return;
        observer.disconnect();
        items.forEach(settle);
        motion.removeEventListener('change', onMotionChange);
    }

    root.setAttribute('data-reveal-ready', 'true');
    items.forEach(function (el) {
        el.classList.add('sp-reveal');
        observer.observe(el);
    });
    motion.addEventListener('change', onMotionChange);
}
