// One-Stop Manufacturing: 서비스 탭·PCB 종류·사진·사양·안내 가격을 함께 전환한다.
// 견적 요청 링크는 기존 결정대로 미연결. 데이터는 PHP의 서비스 정의가 원본이다.
export function init() {
    var root = document.getElementById('sp-onestop');
    if (!root) return;
    var wrap = root.querySelector('.sp-onestop__tabs-wrap');
    var list = root.querySelector('.sp-onestop__tabs');
    var buttons = Array.prototype.slice.call(root.querySelectorAll('.sp-onestop__tab-btn'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('.sp-onestop__panel'));
    var pcbButton = root.querySelector('[data-service="pcbs"]');
    var menu = root.querySelector('.sp-onestop__menu');
    var items = Array.prototype.slice.call(menu.querySelectorAll('.sp-onestop__menu-item'));
    var pcbKeys = items.map(function (item) { return item.getAttribute('data-service'); });
    var selectedPcb = 'fr4';
    var closeTimer = 0;
    var hoverOpened = false;
    var canHover = window.matchMedia('(hover: hover)');

    function positionMenu() {
        if (menu.hidden) return;
        var anchor = pcbButton.getBoundingClientRect();
        var box = wrap.getBoundingClientRect();
        var left = anchor.left - box.left + (anchor.width - menu.offsetWidth) / 2;
        // 화면 바깥으로 나가거나 가로 스크롤 영역에 잘리지 않게 배치한다.
        left = Math.max(8 - box.left, Math.min(left, window.innerWidth - box.left - menu.offsetWidth - 8));
        menu.style.left = left + 'px';
        menu.style.top = (anchor.bottom - box.top + 21) + 'px';
    }
    function openMenu() {
        clearTimeout(closeTimer);
        menu.hidden = false;
        pcbButton.parentElement.classList.add('is-open');
        pcbButton.setAttribute('aria-expanded', 'true');
        positionMenu();
    }
    function closeMenu() {
        clearTimeout(closeTimer);
        menu.hidden = true;
        hoverOpened = false;
        pcbButton.parentElement.classList.remove('is-open');
        pcbButton.setAttribute('aria-expanded', 'false');
    }
    function closeSoon() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(function () {
            if (!menu.contains(document.activeElement) && document.activeElement !== pcbButton) closeMenu();
        }, 150);
    }
    function activate(key) {
        var panel = panels.find(function (entry) { return entry.getAttribute('data-service') === key; });
        if (!panel) return;
        var isPcb = pcbKeys.indexOf(key) !== -1;
        if (isPcb) selectedPcb = key;
        var owner = isPcb ? 'pcbs' : key;
        // 최초 선택 시에만 이미지 로드. 빠르게 다른 탭을 눌러도 이전 이미지가 내용을 덮어쓰지 않는다.
        var img = panel.querySelector('img[data-src]');
        if (img) {
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
        }
        panels.forEach(function (entry) { entry.hidden = entry !== panel; });
        buttons.forEach(function (button) {
            var on = button.getAttribute('data-service') === owner;
            button.parentElement.classList.toggle('is-active', on);
            button.setAttribute('aria-selected', on ? 'true' : 'false');
            button.tabIndex = on ? 0 : -1;
        });
        pcbButton.querySelector('span').textContent = isPcb && key !== 'fr4' ? panel.getAttribute('data-title') : 'PCBs';
        pcbButton.setAttribute('aria-controls', 'sp-onestop-panel-' + selectedPcb);
        items.forEach(function (item) {
            var on = item.getAttribute('data-service') === selectedPcb;
            item.classList.toggle('is-active', on);
            item.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        root.setAttribute('data-service', key);
        positionMenu();
    }
    buttons.forEach(function (button, index) {
        button.addEventListener('click', function () {
            var isPcb = button === pcbButton;
            activate(isPcb ? selectedPcb : button.getAttribute('data-service'));
            if (!isPcb) { closeMenu(); return; }
            if (menu.hidden) openMenu();
            else if (hoverOpened) hoverOpened = false;
            else closeMenu();
        });
        button.addEventListener('keydown', function (event) {
            if (button === pcbButton && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                openMenu();
                var checked = items.find(function (item) { return item.getAttribute('aria-checked') === 'true'; });
                (event.key === 'ArrowUp' ? items[items.length - 1] : checked || items[0]).focus();
                return;
            }
            var target = -1;
            if (event.key === 'ArrowRight') target = (index + 1) % buttons.length;
            if (event.key === 'ArrowLeft') target = (index + buttons.length - 1) % buttons.length;
            if (event.key === 'Home') target = 0;
            if (event.key === 'End') target = buttons.length - 1;
            if (target !== -1) {
                event.preventDefault();
                closeMenu();
                var next = buttons[target];
                activate(next === pcbButton ? selectedPcb : next.getAttribute('data-service'));
                next.focus();
                // 탭 목록 안에서만 스크롤하여 페이지 위치가 갑자기 바뀌지 않게 한다.
                var a = next.getBoundingClientRect(), b = list.getBoundingClientRect();
                if (a.left < b.left) list.scrollLeft -= b.left - a.left + 8;
                else if (a.right > b.right) list.scrollLeft += a.right - b.right + 8;
            }
            if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
        });
    });
    items.forEach(function (item, index) {
        item.addEventListener('click', function () {
            activate(item.getAttribute('data-service'));
            closeMenu();
            pcbButton.focus();
        });
        item.addEventListener('keydown', function (event) {
            var target = -1;
            if (event.key === 'ArrowDown') target = (index + 1) % items.length;
            if (event.key === 'ArrowUp') target = (index + items.length - 1) % items.length;
            if (event.key === 'Home') target = 0;
            if (event.key === 'End') target = items.length - 1;
            if (target !== -1) { event.preventDefault(); items[target].focus(); }
            if (event.key === 'Escape') { event.preventDefault(); closeMenu(); pcbButton.focus(); }
        });
    });
    pcbButton.parentElement.addEventListener('mouseenter', function () {
        if (canHover.matches) { openMenu(); hoverOpened = true; }
    });
    pcbButton.parentElement.addEventListener('mouseleave', closeSoon);
    menu.addEventListener('mouseenter', function () { clearTimeout(closeTimer); });
    menu.addEventListener('mouseleave', closeSoon);
    wrap.addEventListener('focusout', function (event) {
        if (!wrap.contains(event.relatedTarget)) closeMenu();
    });
    document.addEventListener('click', function (event) {
        if (!menu.contains(event.target) && !pcbButton.contains(event.target)) closeMenu();
    });
    list.addEventListener('scroll', positionMenu, { passive: true });
    window.addEventListener('resize', positionMenu);
    activate(selectedPcb);
}
