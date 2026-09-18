// 홈 One-Stop Manufacturing 탭(inc/home/10-onestop.php) — js/home.js 가 import 해 init() 호출.
//  · 탭 클릭: 활성 표시(is-active, aria-selected)만 바뀐다. 피그마엔 PCBS(FR-4) 패널만 있어 내용은 그대로(다른 탭 콘텐츠 미제공 — 미결).
//  · PCBS 탭: 호버·클릭·키보드로 드롭다운(FR-4 / Flexible / Rigid-Flex) 열고 닫음. 항목 선택은 활성 표시만.
//  · 순수 DOM, 링크 없음(사용자 결정).
export function init() {
    var root = document.getElementById('sp-onestop');
    if (!root) return;

    var tabs = Array.prototype.slice.call(root.querySelectorAll('.sp-onestop__tab'));
    var menuTab = root.querySelector('.sp-onestop__tab.has-menu');
    var menuBtn = menuTab ? menuTab.querySelector('.sp-onestop__tab-btn') : null;
    var menu = menuTab ? menuTab.querySelector('.sp-onestop__menu') : null;
    var items = menu ? Array.prototype.slice.call(menu.querySelectorAll('.sp-onestop__menu-item')) : [];
    var closeTimer = 0;
    var hoverOpened = false; // 호버로 열린 직후의 클릭은 닫지 않는다(호버→클릭이 토글로 닫히는 것 방지)

    function activate(tab) {
        tabs.forEach(function (t) {
            var on = t === tab;
            t.classList.toggle('is-active', on);
            var b = t.querySelector('.sp-onestop__tab-btn');
            if (b) b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
    }
    function openMenu() {
        if (!menu) return;
        clearTimeout(closeTimer);
        menu.hidden = false;
        menuTab.classList.add('is-open');
        menuBtn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
        if (!menu || menu.hidden) return;
        menu.hidden = true;
        menuTab.classList.remove('is-open');
        menuBtn.setAttribute('aria-expanded', 'false');
    }
    function closeSoon() { clearTimeout(closeTimer); closeTimer = setTimeout(closeMenu, 150); }

    tabs.forEach(function (tab) {
        var btn = tab.querySelector('.sp-onestop__tab-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            activate(tab);
            if (tab !== menuTab) { closeMenu(); return; }
            if (menu.hidden) openMenu();
            else if (hoverOpened) hoverOpened = false; // 호버로 이미 열려 있음 — 유지, 다음 클릭에 닫힌다
            else closeMenu();
        });
    });

    if (menuTab) {
        // 호버로 열고, 벗어나면 잠깐 뒤 닫는다(항목으로 이동할 틈)
        menuTab.addEventListener('mouseenter', function () { openMenu(); hoverOpened = true; });
        menuTab.addEventListener('mouseleave', function () { hoverOpened = false; closeSoon(); });
        menuTab.addEventListener('focusout', function (e) {
            if (!menuTab.contains(e.relatedTarget)) closeMenu();
        });
        menuTab.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeMenu(); menuBtn.focus(); }
            if (e.key === 'ArrowDown' && menu.hidden) { e.preventDefault(); openMenu(); if (items[0]) items[0].focus(); }
        });
        items.forEach(function (item) {
            item.addEventListener('click', function () {
                items.forEach(function (i) {
                    var on = i === item;
                    i.classList.toggle('is-active', on);
                    i.setAttribute('aria-checked', on ? 'true' : 'false');
                });
                activate(menuTab);
                closeMenu();
                menuBtn.focus();
            });
        });
        document.addEventListener('click', function (e) {
            if (!menuTab.contains(e.target)) closeMenu();
        });
    }
}
