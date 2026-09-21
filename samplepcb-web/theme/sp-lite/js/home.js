// sp-lite 홈(/) 진입 모듈 — theme/sp-lite/index.php 가 <script type="module"> 로 로드.
// 섹션 모듈(js/home/<이름>.js)을 동적 import 해 export init() 을 호출한다.
// 모듈 하나가 없거나(404) 실패해도 다른 섹션에는 영향이 없다(각각 catch).
//   hero      — 히어로 슬라이더(크로스페이드·자동재생·점·스와이프) + 배경 애니메이션
//   onestop   — One-Stop Manufacturing 탭·드롭다운
//   (3 EYES 는 모션 노드가 숨김 그룹이라 JS 없음 · 도움말은 새 디자인에 아코디언·탭이 없어 JS 없음)
//   portfolio — Development Portfolio 무한 마퀴(korlinx 참고 사이트 방식)
//   stats     — 숫자로 보는 SamplePCB: 화면 진입 시 카운트업·순차 등장
var spHomeVer = new URL(import.meta.url).searchParams.get('ver') || '';
var spHomeModules = ['hero', 'onestop', 'portfolio', 'stats'];

spHomeModules.forEach(function (name) {
    var url = new URL('./home/' + name + '.js' + (spHomeVer ? '?ver=' + spHomeVer : ''), import.meta.url).href;
    import(url).then(function (mod) {
        if (mod && typeof mod.init === 'function') mod.init();
    }).catch(function (err) {
        // 아직 없는 모듈(404)은 조용히, 실행 오류는 알린다
        var msg = String(err && err.message || err);
        if (!/fetch|load|404/i.test(msg)) console.warn('[home] ' + name + ' 모듈 오류:', err);
    });
});
