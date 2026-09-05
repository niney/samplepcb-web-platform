// sp-lite 홈(/) 스크립트 — ES 모듈. theme/sp-lite/index.php 가 <script type="module"> 로 로드.
//  1) 히어로 슬라이더(크로스페이드·자동재생·점·스와이프)
//  2) Gerber Eyes 슬라이드 배경 애니메이션: Figma 원본 윤곽(Vector) 연속 회전(center-swap) — 프로빙 채택안
//     (spcb/previews/login-bg-claude, 프리셋 o-center-swap: period 16s · intensity 100 · density 1 · lag 50 · pivot 50% · flow out)
//  3) FAQ 카테고리 탭 + 아코디언
import { preparePath } from './motion-path.js?ver=26090601';

(function () {
    var hero = document.getElementById('sp-hero');
    if (hero) initHero(hero);
    var faq = document.getElementById('sp-faq');
    if (faq) initFaq(faq);

    /* ───────────────────────── 1+2. 히어로 ───────────────────────── */
    function initHero(root) {
        var slides = Array.prototype.slice.call(root.querySelectorAll('.sp-hero__slide'));
        var dots = Array.prototype.slice.call(root.querySelectorAll('.sp-hero__dot'));
        var count = slides.length;
        var cur = 0, timer = 0, INTERVAL = 6000;
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function show(i) {
            cur = (i + count) % count;
            slides.forEach(function (s, k) { s.classList.toggle('is-active', k === cur); });
            dots.forEach(function (d, k) { d.classList.toggle('is-active', k === cur); d.setAttribute('aria-selected', k === cur ? 'true' : 'false'); });
            var anim = slides[cur].getAttribute('data-anim') === '1';
            root.classList.toggle('is-anim', anim);
            if (anim) startOrganic(); else stopOrganic();
        }
        function next() { show(cur + 1); }
        function play() { stop(); if (count > 1 && !reduced) timer = setInterval(next, INTERVAL); }
        function stop() { if (timer) { clearInterval(timer); timer = 0; } }

        dots.forEach(function (d, k) { d.addEventListener('click', function () { show(k); play(); }); });
        root.addEventListener('mouseenter', stop);
        root.addEventListener('mouseleave', play);
        // 터치 스와이프
        var sx = null;
        root.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
        root.addEventListener('touchend', function (e) {
            if (sx === null) return;
            var dx = e.changedTouches[0].clientX - sx; sx = null;
            if (Math.abs(dx) > 40) { show(dx < 0 ? cur + 1 : cur - 1); play(); }
        });
        document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else { play(); if (root.classList.contains('is-anim')) startOrganic(); } });
        // 히어로가 화면 밖이면 자동재생·배경 애니메이션을 쉰다(스크롤 성능)
        var inView = true;
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (entries) {
                inView = entries[0].isIntersecting;
                if (!inView) { stop(); stopOrganic(); }
                else { play(); if (root.classList.contains('is-anim')) startOrganic(); }
            }, { threshold: 0.05 }).observe(root);
        }

        /* — 배경 애니메이션(30fps, 보이는 슬라이드가 Gerber Eyes 일 때만) */
        var organicPath = document.getElementById('sp-organic-path');
        var org = { render: null, raf: 0, phase: 0, last: null, lastPaint: -Infinity, ready: false };
        var SETTINGS = { effect: 'center-swap', intensity: 100, density: 1, lag: 50, pivot: 189 + 2382.014 * 0.5, flow: 'out' };
        var PERIOD_MS = 16000;
        if (organicPath && !reduced) {
            fetch(root.getAttribute('data-outline')).then(function (r) { return r.text(); }).then(function (xml) {
                var doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
                var d = doc.querySelector('[id="Vector"]').getAttribute('d');
                org.render = preparePath(d);
                organicPath.setAttribute('d', org.render(0, SETTINGS));
                org.ready = true;
                root.classList.add('is-organic');
                if (root.classList.contains('is-anim')) startOrganic();
            }).catch(function (e) { if (window.console) console.warn('sp-hero: 윤곽 SVG 로드 실패 — 정지 배경 유지', e); });
        }
        function tick(now) {
            if (document.hidden) { org.raf = 0; org.last = null; return; }
            if (org.last !== null) org.phase = (org.phase + (now - org.last) / PERIOD_MS * 2 * Math.PI) % (2 * Math.PI);
            org.last = now;
            if (now - org.lastPaint >= 1000 / 30) { organicPath.setAttribute('d', org.render(org.phase, SETTINGS)); org.lastPaint = now; }
            org.raf = requestAnimationFrame(tick);
        }
        function startOrganic() { if (org.ready && !org.raf) { org.last = null; org.raf = requestAnimationFrame(tick); } }
        function stopOrganic() { if (org.raf) { cancelAnimationFrame(org.raf); org.raf = 0; } org.last = null; }

        show(0);
        play();
    }

    /* ───────────────────────── 3. FAQ ───────────────────────── */
    function initFaq(root) {
        var tabs = Array.prototype.slice.call(root.querySelectorAll('.sp-faq-tabs button'));
        var items = Array.prototype.slice.call(root.querySelectorAll('.sp-faq__item'));
        var PER = 4; // 피그마: 카테고리당 4건(첫 건 펼침)

        function open(item, on) {
            item.classList.toggle('is-open', on);
            var head = item.querySelector('.sp-faq__head');
            if (head) head.setAttribute('aria-expanded', on ? 'true' : 'false');
        }
        function select(ca) {
            tabs.forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-ca') === ca); });
            var shown = 0, lastShown = null;
            items.forEach(function (it) {
                var hit = (ca === '' || it.getAttribute('data-ca') === ca) && shown < PER;
                it.hidden = !hit;
                it.classList.remove('is-last');
                if (hit) { shown++; lastShown = it; open(it, shown === 1); }
                else open(it, false);
            });
            if (lastShown) lastShown.classList.add('is-last');
            var empty = root.querySelector('.sp-faq__empty');
            if (empty) empty.hidden = shown > 0;
        }
        tabs.forEach(function (t) { t.addEventListener('click', function () { select(t.getAttribute('data-ca')); }); });
        items.forEach(function (it) {
            var head = it.querySelector('.sp-faq__head');
            if (!head) return;
            head.addEventListener('click', function () {
                var on = !it.classList.contains('is-open');
                items.forEach(function (o) { if (o !== it) open(o, false); });
                open(it, on);
            });
        });
        var first = tabs.length ? tabs[0].getAttribute('data-ca') : '';
        select(first);
    }
})();
