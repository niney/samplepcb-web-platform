// 홈 히어로 슬라이더 — theme/sp-lite/inc/main_slider.php 와 한 벌. js/home.js 가 동적 import 해 init() 을 부른다.
//  1) 슬라이더: 크로스페이드(.7s, CSS) · 자동재생 6s · 점 내비 · 호버 정지 · 터치 스와이프 · reduced-motion 이면 자동재생 없음
//  2) banner 01 배경: Figma 윤곽 Vector(2286:60907) 연속 회전(center-swap) — 프로빙 채택안(spcb/previews/login-bg-claude,
//     프리셋 o-center-swap: period 16s · intensity 100 · density 1 · lag 50 · pivot 50% · flow out). 24fps, 화면 밖·탭 숨김·reduced-motion 이면 정지.
//  2') 저사양 라이트(.is-lite): 기기 신호(메모리·코어·데이터 절약)나 실측 프레임(회전 중 25fps 미만)으로 강등 — 회전·팬·backdrop-filter·영상 전부 정지 배경.
//  3) banner 02~04 배경 팬(CSS 애니메이션)은 비활성 슬라이드·화면 밖에서 CSS 로 멈춘다(.is-offscreen)
//  4) 1024~1319px: 1280 콘텐츠 박스를 (뷰포트 − 40)/1320 배율로 축소(--sp-hero-scale, 40 = 카드·사진 오버행) — CSS 기본값을 정확한 값으로 갱신
//  5) banner 05 영상: 활성·화면 내·보이는 탭에서만 지연 로드/음소거 반복재생. 실패·reduced-motion 은 사진.
var VER = new URL(import.meta.url).searchParams.get('ver') || '';

export function init() {
    var root = document.getElementById('sp-hero');
    if (!root) return;

    var slides = Array.prototype.slice.call(root.querySelectorAll('.sp-hero__slide'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('.sp-hero__dot'));
    var count = slides.length;
    var cur = 0, timer = 0, INTERVAL = 6000;
    var motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var reduced = motionQuery && motionQuery.matches;
    var heroVideo = root.querySelector('.sp-s5__video');

    function shouldPlayVideo() {
        return heroVideo && slides[cur].contains(heroVideo) && !reduced && !lite && !document.hidden && !root.classList.contains('is-offscreen');
    }
    function syncVideo() {
        if (!heroVideo) return;
        if (!shouldPlayVideo()) {
            heroVideo.pause();
            if (reduced) heroVideo.classList.remove('is-playing');
            return;
        }
        if (heroVideo.error) return;
        // src 를 활성 시점에만 붙여 초기 홈 진입 시 영상을 요청하지 않는다.
        if (!heroVideo.getAttribute('src')) heroVideo.src = heroVideo.getAttribute('data-src');
        heroVideo.muted = true;
        if (!heroVideo.paused) return;
        var request = heroVideo.play();
        if (request && request.catch) request.catch(function (error) {
            // 슬라이드 전환/스크롤 중 pause가 취소한 play는 정상. 재생 거부 시 사진을 유지한다.
            if (error.name !== 'AbortError') heroVideo.classList.remove('is-playing');
        });
    }
    if (heroVideo) {
        heroVideo.addEventListener('playing', function () {
            if (shouldPlayVideo()) heroVideo.classList.add('is-playing');
            else heroVideo.pause();
        });
        heroVideo.addEventListener('error', function () { heroVideo.classList.remove('is-playing'); });
    }

    /* ───────── 슬라이더 ───────── */
    function show(i) {
        cur = (i + count) % count;
        slides.forEach(function (s, k) { s.classList.toggle('is-active', k === cur); });
        dots.forEach(function (d, k) { d.classList.toggle('is-active', k === cur); d.setAttribute('aria-selected', k === cur ? 'true' : 'false'); });
        var anim = slides[cur].getAttribute('data-anim') === '1';
        root.classList.toggle('is-anim', anim);
        if (anim) startOrganic(); else stopOrganic();
        syncVideo();
    }
    function next() { show(cur + 1); }
    function play() { stop(); if (count > 1 && !reduced && !document.hidden && !root.classList.contains('is-offscreen')) timer = setInterval(next, INTERVAL); }
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
        syncVideo();
    });
    // 히어로가 화면 밖이면 자동재생·배경 애니메이션을 쉰다(스크롤 성능)
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            var inView = entries[0].isIntersecting;
            root.classList.toggle('is-offscreen', !inView);
            if (!inView) { stop(); stopOrganic(); }
            else { play(); if (root.classList.contains('is-anim')) startOrganic(); }
            syncVideo();
        }, { threshold: 0.05 }).observe(root);
    }
    if (motionQuery && motionQuery.addEventListener) {
        motionQuery.addEventListener('change', function (event) {
            reduced = event.matches;
            if (reduced) { stop(); stopOrganic(); }
            else { play(); if (root.classList.contains('is-anim')) startOrganic(); }
            syncVideo();
        });
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

    /* ───────── 저사양 라이트 모드(.is-lite) ─────────
       배경 장식(윤곽 회전·팬·backdrop-filter·영상)은 꾸밈이라, 감당 못 하는 기기에선 정지 배경으로 강등한다(CSS 가 .is-lite 로 끔).
       판정 ① 기기 신호: 메모리 ≤4GB(deviceMemory 는 2의 거듭제곱으로 내림 — 6GB 도 4)·코어 ≤2·데이터 절약
            ② 실측: 윤곽 회전이 도는 동안 1.5초 창마다 프레임 간격 평균 40ms 초과(25fps 미만)거나 50ms 초과 프레임이 20% 이상이면 강등.
               24fps 페인트 프레임과 그 사이 빈 프레임이 섞이므로 "페인트 한 번 ≈ 60ms" 인 기기가 걸린다. 회전이 처음 돈 뒤 1초는 첫 렌더·디코드 잡음이라 안 센다.
               ⚠ 창은 시간 기준이어야 한다 — 배너 01 은 6초만 머물러(자동재생) 프레임 60개를 세는 방식은 저사양일수록 판정 전에 슬라이드가 넘어간다(실측).
               간격은 250ms 로 잘라 센다 — 창 가림·절전의 몇 초 공백 하나가 평균을 못 넘기게(버리면 프레임마다 250ms 넘는 극저사양이 빠져나간다).
               팬·backdrop 은 컴포지터 몫이라 여기 안 잡힌다(기기 신호 ①과 reduced-motion 이 그 몫).
            ③ 한 번 강등되면 같은 탭의 다음 페이지는 처음부터 라이트(sessionStorage) — 모듈·회전 준비를 건너뛴다(윤곽 SVG 는 정지 <img> 가 어차피 받는다).
       reduced-motion 은 기존 분기 그대로(여기 안 섞는다). */
    var LITE_KEY = 'sp-hero-lite';
    var lite = false;
    var wd = { n: 0, sum: 0, slow: 0, armAt: 0, WINDOW: 1500 };
    function liteHint() {
        try { if (sessionStorage.getItem(LITE_KEY) === '1') return 'session'; } catch (e) { /* 접근 불가면 무시 */ }
        if (navigator.deviceMemory && navigator.deviceMemory <= 4) return 'memory';
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return 'cores';
        if (navigator.connection && navigator.connection.saveData) return 'save-data';
        return '';
    }
    function enterLite(why) {
        if (lite) return;
        lite = true;
        root.classList.add('is-lite');
        root.classList.remove('is-organic');
        stopOrganic();
        syncVideo();
        try { sessionStorage.setItem(LITE_KEY, '1'); } catch (e) { /* 무시 */ }
        if (why !== 'session' && window.console) console.info('sp-hero: 배경 애니메이션 정지(라이트 모드: ' + why + ')');
    }
    // 실측 감시 — tick 이 프레임마다 부른다(now = rAF 시각, dt = 직전 프레임과의 간격). 강등했으면 true
    function watchFrame(now, dt) {
        if (lite) return false;
        if (!wd.armAt) { wd.armAt = now + 1000; return false; }
        if (now < wd.armAt) return false;
        if (dt > 250) dt = 250;
        wd.n++; wd.sum += dt; if (dt > 50) wd.slow++;
        if (wd.sum < wd.WINDOW || wd.n < 8) return false;
        var bad = wd.sum / wd.n > 40 || wd.slow / wd.n >= 0.2;
        wd.n = 0; wd.sum = 0; wd.slow = 0;
        if (bad) enterLite('slow-frames');
        return bad;
    }

    /* ───────── banner 01 배경 연속 회전(24fps) ───────── */
    var organicPath = document.getElementById('sp-organic-path');
    var org = { render: null, raf: 0, phase: 0, last: null, lastPaint: -Infinity, ready: false };
    // pivot = 윤곽 SVG(viewBox 1680×613) 가로 중앙
    var SETTINGS = { effect: 'center-swap', intensity: 100, density: 1, lag: 50, pivot: 840, flow: 'out' };
    var PERIOD_MS = 16000;
    var FPS = 24; // 30 → 24: 메인스레드 −20%, 16초 주기 회전에선 차이가 안 보인다
    var liteWhy = liteHint();
    if (liteWhy) enterLite(liteWhy);
    if (organicPath && !reduced && !lite && window.fetch) {
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
        if (org.last !== null) {
            var dt = now - org.last;
            org.phase = (org.phase + dt / PERIOD_MS * 2 * Math.PI) % (2 * Math.PI);
            if (watchFrame(now, dt)) return; // 강등 — enterLite 가 stopOrganic 했으니 이 루프는 여기서 끝
        }
        org.last = now;
        if (now - org.lastPaint >= 1000 / FPS) { organicPath.setAttribute('d', org.render(org.phase, SETTINGS)); org.lastPaint = now; }
        org.raf = requestAnimationFrame(tick);
    }
    function startOrganic() { if (org.ready && !org.raf && !reduced && !document.hidden && !root.classList.contains('is-offscreen')) { org.last = null; org.raf = requestAnimationFrame(tick); } }
    function stopOrganic() { if (org.raf) { cancelAnimationFrame(org.raf); org.raf = 0; } org.last = null; }

    show(0);
    play();
}
