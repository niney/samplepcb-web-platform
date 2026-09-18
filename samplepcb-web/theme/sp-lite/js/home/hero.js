// 홈 히어로 슬라이더 — theme/sp-lite/inc/main_slider.php 와 한 벌. js/home.js 가 동적 import 해 init() 을 부른다.
//  1) 슬라이더: 크로스페이드(.7s, CSS) · 자동재생 6s · 점 내비 · 호버 정지 · 터치 스와이프 · reduced-motion 이면 자동재생 없음
//  2) banner 01 배경: Figma 윤곽 Vector(2286:60907) 연속 회전(center-swap) — 프로빙 채택안(spcb/previews/login-bg-claude,
//     프리셋 o-center-swap: period 16s · intensity 100 · density 1 · lag 50 · pivot 50% · flow out). 30fps, 화면 밖·탭 숨김·reduced-motion 이면 정지.
//  3) banner 02~04 배경 팬(CSS 애니메이션)은 비활성 슬라이드·화면 밖에서 CSS 로 멈춘다(.is-offscreen)
//  4) 1024~1319px: 1280 콘텐츠 박스를 (뷰포트 − 40)/1320 배율로 축소(--sp-hero-scale, 40 = 카드·사진 오버행) — CSS 기본값을 정확한 값으로 갱신
var VER = new URL(import.meta.url).searchParams.get('ver') || '';

export function init() {
    var root = document.getElementById('sp-hero');
    if (!root) return;

    var slides = Array.prototype.slice.call(root.querySelectorAll('.sp-hero__slide'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('.sp-hero__dot'));
    var count = slides.length;
    var cur = 0, timer = 0, INTERVAL = 6000;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ───────── 슬라이더 ───────── */
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
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop();
        else { play(); if (root.classList.contains('is-anim')) startOrganic(); }
    });
    // 히어로가 화면 밖이면 자동재생·배경 애니메이션을 쉰다(스크롤 성능)
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            var inView = entries[0].isIntersecting;
            root.classList.toggle('is-offscreen', !inView);
            if (!inView) { stop(); stopOrganic(); }
            else { play(); if (root.classList.contains('is-anim')) startOrganic(); }
        }, { threshold: 0.05 }).observe(root);
    }

    /* ───────── 1024~1319 축소 배율 ───────── */
    var fitRaf = 0;
    function fit() {
        fitRaf = 0;
        var w = window.innerWidth;
        // 1320 기준: banner 02 카드·03 사진이 컨테이너(1280) 오른쪽으로 40px 나가는 디자인
        if (w >= 1024 && w < 1320) root.style.setProperty('--sp-hero-scale', ((w - 40) / 1320).toFixed(4));
        else root.style.removeProperty('--sp-hero-scale');
    }
    window.addEventListener('resize', function () { if (!fitRaf) fitRaf = requestAnimationFrame(fit); });
    fit();

    /* ───────── banner 01 배경 연속 회전(30fps) ───────── */
    var organicPath = document.getElementById('sp-organic-path');
    var org = { render: null, raf: 0, phase: 0, last: null, lastPaint: -Infinity, ready: false };
    // pivot = 윤곽 SVG(viewBox 1680×613) 가로 중앙
    var SETTINGS = { effect: 'center-swap', intensity: 100, density: 1, lag: 50, pivot: 840, flow: 'out' };
    var PERIOD_MS = 16000;
    if (organicPath && !reduced && window.fetch) {
        var motionUrl = new URL('../motion-path.js' + (VER ? '?ver=' + VER : ''), import.meta.url).href;
        Promise.all([
            import(motionUrl),
            fetch(root.getAttribute('data-outline')).then(function (r) { return r.text(); })
        ]).then(function (res) {
            var preparePath = res[0].preparePath;
            var doc = new DOMParser().parseFromString(res[1], 'image/svg+xml');
            var path = doc.querySelector('[id="Vector"]') || doc.querySelector('path');
            org.render = preparePath(path.getAttribute('d'));
            organicPath.setAttribute('d', org.render(0, SETTINGS));
            org.ready = true;
            root.classList.add('is-organic');
            if (root.classList.contains('is-anim') && !root.classList.contains('is-offscreen')) startOrganic();
        }).catch(function (e) { if (window.console) console.warn('sp-hero: 윤곽 애니메이션 준비 실패 — 정지 배경 유지', e); });
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
