/*!
 * sp-dialog — sp-lite 공용 커스텀 팝업 (네이티브 alert/confirm 대체)
 *
 * 왜 필요한가: 그누보드 코어 alert() 은 bbs/alert.php 로 **페이지를 통째로 이동**시킨 뒤
 * 네이티브 alert 을 띄우고 되돌아온다(빈 화면 → 시스템 팝업 → 뒤로가기). 브라우저마다
 * 모양이 다르고 사이트 톤과 따로 논다. 이 모듈은 같은 페이지 안에서 뜨는 모달을 제공한다.
 *
 * 사용:
 *   spDialog.alert('저장했습니다.')                       → Promise<void>
 *   spDialog.confirm('삭제할까요?')                        → Promise<boolean>
 *   spDialog.alert(msg, { title, tone: 'danger', okText })
 *   spDialog.confirm(msg, { title, tone, okText, cancelText })
 *
 * tone: 'default' | 'danger' | 'success'
 *
 * 원칙
 *  · 의존성 없음(jQuery 불필요) — 어느 페이지에서든 이 파일 하나로 동작한다.
 *  · Promise 기반이라 기존 confirm() 자리를 그대로 대체할 수 있다(await 또는 .then).
 *  · 접근성: role=alertdialog, ESC 취소, 포커스 이동·복귀, 배경 스크롤 잠금.
 *  · 메시지는 textContent 로만 넣는다 — 서버 문구를 그대로 받아도 XSS 가 되지 않는다.
 */
(function (global) {
  'use strict';

  if (global.spDialog) return; // 중복 로드 방지

  var activeEl = null;

  function build(opts) {
    var back = document.createElement('div');
    back.className = 'sp-dlg-back';

    var box = document.createElement('div');
    box.className = 'sp-dlg' + (opts.tone ? ' sp-dlg-' + opts.tone : '');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');

    if (opts.title) {
      var h = document.createElement('p');
      h.className = 'sp-dlg-title';
      h.textContent = opts.title;
      box.appendChild(h);
    }

    var msg = document.createElement('div');
    msg.className = 'sp-dlg-msg';
    // 서버 문구에 줄바꿈이 섞여 오므로 줄 단위로 넣는다(innerHTML 금지 — XSS).
    String(opts.message == null ? '' : opts.message)
      .split(/\r\n|\r|\n/)
      .forEach(function (line, i) {
        if (i > 0) msg.appendChild(document.createElement('br'));
        msg.appendChild(document.createTextNode(line));
      });
    box.appendChild(msg);

    var btns = document.createElement('div');
    btns.className = 'sp-dlg-btns';

    var cancelBtn = null;
    if (opts.mode === 'confirm') {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'sp-dlg-cancel';
      cancelBtn.textContent = opts.cancelText || '취소';
      btns.appendChild(cancelBtn);
    }

    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'sp-dlg-ok';
    okBtn.textContent = opts.okText || '확인';
    btns.appendChild(okBtn);

    box.appendChild(btns);
    back.appendChild(box);
    return { back: back, box: box, okBtn: okBtn, cancelBtn: cancelBtn };
  }

  function open(opts) {
    return new Promise(function (resolve) {
      var el = build(opts);
      activeEl = document.activeElement;

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        if (el.back.parentNode) el.back.parentNode.removeChild(el.back);
        document.documentElement.classList.remove('sp-dlg-lock');
        // 포커스를 원래 있던 곳으로 — 키보드 사용자가 흐름을 잃지 않게.
        if (activeEl && typeof activeEl.focus === 'function') activeEl.focus();
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          close(opts.mode === 'confirm' ? false : undefined);
        } else if (e.key === 'Tab' && opts.mode === 'confirm') {
          // 두 버튼 사이만 순환(포커스 트랩) — 뒤 페이지로 새지 않게.
          var focusables = [el.cancelBtn, el.okBtn];
          var idx = focusables.indexOf(document.activeElement);
          e.preventDefault();
          focusables[(idx + (e.shiftKey ? -1 : 1) + 2) % 2].focus();
        }
      }

      el.okBtn.addEventListener('click', function () {
        close(opts.mode === 'confirm' ? true : undefined);
      });
      if (el.cancelBtn) {
        el.cancelBtn.addEventListener('click', function () {
          close(false);
        });
      }
      // 배경 클릭 — alert 은 닫고, confirm 은 취소로 본다(실수로 확정되지 않게).
      el.back.addEventListener('click', function (e) {
        if (e.target === el.back) close(opts.mode === 'confirm' ? false : undefined);
      });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(el.back);
      document.documentElement.classList.add('sp-dlg-lock');
      // confirm 은 취소에 먼저 초점을 둔다 — 엔터 연타로 확정되는 사고를 막는다.
      (opts.mode === 'confirm' && el.cancelBtn ? el.cancelBtn : el.okBtn).focus();
    });
  }

  global.spDialog = {
    alert: function (message, opts) {
      opts = opts || {};
      return open({
        mode: 'alert',
        message: message,
        title: opts.title,
        tone: opts.tone,
        okText: opts.okText,
      });
    },
    confirm: function (message, opts) {
      opts = opts || {};
      return open({
        mode: 'confirm',
        message: message,
        title: opts.title,
        tone: opts.tone,
        okText: opts.okText,
        cancelText: opts.cancelText,
      });
    },
  };

  // 서버가 리다이렉트로 실어 보낸 결과 문구(?sp_msg=..&sp_tone=..)를 로드 직후 띄운다.
  // PHP alert() 은 페이지를 갈아치우므로 같은 화면에 모달을 띄울 수 없다 — 대신
  // 원래 화면으로 되돌린 뒤 여기서 보여준다(spcb/api/eq-decide.php 참조).
  document.addEventListener('DOMContentLoaded', function () {
    var q = new URLSearchParams(global.location.search);
    var msg = q.get('sp_msg');
    if (!msg) return;
    var tone = q.get('sp_tone') || 'default';
    global.spDialog.alert(msg, { tone: tone });
    // 새로고침·뒤로가기에서 다시 뜨지 않게 주소에서 지운다.
    q.delete('sp_msg');
    q.delete('sp_tone');
    var qs = q.toString();
    global.history.replaceState(
      null,
      '',
      global.location.pathname + (qs ? '?' + qs : '') + global.location.hash,
    );
  });
})(window);
