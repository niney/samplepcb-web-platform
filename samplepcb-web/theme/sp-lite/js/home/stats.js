// 숫자로 보는 SamplePCB — megazone.com/about/company의 숫자 영역을 참고한다.
// 60% 진입 시 한 번, 2초 카운트업 + 20px/0.3초 등장 + 항목별 0.1초 간격.
// PHP가 출력한 최종 문자열이 원본이다. 별도 수치 정의나 외부 라이브러리는 없다.
export function init() {
    var root = document.getElementById('sp-stats');
    if (!root || root.hasAttribute('data-countup-ready') || !window.IntersectionObserver) return;
    var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;

    var title = root.querySelector('.sp-stats__title');
    var items = Array.prototype.slice.call(root.querySelectorAll('.sp-stats__item'));
    var states = [];
    var frame = 0;
    var duration = 2000;
    var formatter = new Intl.NumberFormat('en-US');

    items.forEach(function (item, index) {
        var number = item.querySelector('.sp-stats__num');
        var value = item.querySelector('.sp-stats__value');
        var match = value && /^(\d[\d,]*)([+%]?)$/.exec(value.textContent.trim());
        if (!number || !match) return;
        var end = Number(match[1].replace(/,/g, ''));
        if (!Number.isSafeInteger(end)) return;
        states.push({ item: item, number: number, end: end, suffix: match[2], delay: index * 100, start: null, done: false, previous: -1, counter: null });
    });
    if (!states.length) return;

    // 참고 페이지처럼 큰 수는 전반부에 빠르게 증가하고 마지막 333에서 감속한다.
    function eased(progress) {
        return (1 - Math.pow(2, -10 * progress)) / (1 - 1 / 1024);
    }
    function countAt(end, progress) {
        if (progress >= 1) return end;
        if (end > 999) {
            if (progress < .5) return (end - 333) * progress * 2;
            return end - 333 + 333 * eased((progress - .5) * 2);
        }
        return end * eased(progress);
    }
    function finish(state) {
        state.done = true;
        state.number.classList.remove('is-counting');
        if (state.counter) state.counter.remove();
    }
    function finishAll() {
        cancelAnimationFrame(frame);
        frame = 0;
        observer.disconnect();
        states.forEach(finish);
        [title].concat(items).forEach(function (element) {
            if (!element) return;
            element.classList.remove('is-reveal-ready', 'is-revealed');
            element.style.removeProperty('--sp-stat-delay');
        });
        motion.removeEventListener('change', onMotionChange);
    }
    function onMotionChange() {
        if (motion.matches) finishAll();
    }
    function tick(now) {
        frame = 0;
        states.forEach(function (state) {
            if (state.done || state.start === null) return;
            var progress = Math.max(0, Math.min(1, (now - state.start) / duration));
            if (progress >= 1) { finish(state); return; }
            var value = Math.round(countAt(state.end, progress));
            if (value !== state.previous) {
                state.counter.textContent = formatter.format(value) + state.suffix;
                state.previous = value;
            }
        });
        if (states.every(function (state) { return state.done; })) { finishAll(); return; }
        if (states.some(function (state) { return !state.done && state.start !== null; })) frame = requestAnimationFrame(tick);
    }
    var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting || entry.intersectionRatio < .6) return;
            observer.unobserve(entry.target);
            entry.target.classList.add('is-revealed');
            var state = states.find(function (candidate) { return candidate.item === entry.target; });
            if (!state) return;
            state.start = performance.now() + state.delay;
            if (!frame) frame = requestAnimationFrame(tick);
        });
    }, { threshold: .6 });

    root.setAttribute('data-countup-ready', 'true');
    states.forEach(function (state) {
        var counter = document.createElement('span');
        counter.className = 'sp-stats__count';
        counter.setAttribute('aria-hidden', 'true');
        counter.textContent = '0' + state.suffix;
        state.counter = counter;
        state.number.appendChild(counter);
        state.number.classList.add('is-counting');
        state.item.style.setProperty('--sp-stat-delay', state.delay + 'ms');
        state.item.classList.add('is-reveal-ready');
        observer.observe(state.item);
    });
    if (title) {
        title.classList.add('is-reveal-ready');
        observer.observe(title);
    }
    motion.addEventListener('change', onMotionChange);
}
