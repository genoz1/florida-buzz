(function () {
  var STORAGE_KEY = 'fb_nl_popup_v1';
  var COOKIE_NAME = 'fb_newsletter';
  var DELAY_MS = 14000;
  var SNOOZE_DAYS = 14;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function readCookie(name) {
    var parts = (';cookie || '').split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var p = parts[i].trim();
      if (p.indexOf(name + '=') === 0) return decodeURIComponent(p.slice(name.length + 1));
    }
    return '';
  }

  function alreadySubscribed() {
    return readCookie(COOKIE_NAME) === '1';
  }

  function dismissedRecently() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.until) return false;
      return Date.now() < Number(data.until);
    } catch (e) {
      return false;
    }
  }

  function snooze() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ until: Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000 })
      );
    } catch (e) { /* private mode */ }
  }

  function showToast(message, isError) {
    var toast = document.createElement('div');
    toast.className = 'nl-toast' + (isError ? ' nl-toast--error' : '');
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.classList.add('nl-toast--show');
    });
    setTimeout(function () {
      toast.classList.remove('nl-toast--show');
      setTimeout(function () {
        toast.remove();
      }, 300);
    }, 4200);
  }

  function handleSubscribedQuery() {
    var params = new URLSearchParams(window.location.search);
    var status = params.get('subscribed');
    if (!status) return;
    if (status === '1') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ until: Date.now() + 365 * 24 * 60 * 60 * 1000 }));
      } catch (e) { /* ignore */ }
      showToast('You’re on the list — watch for the daily Buzz.');
    } else if (status === 'error') {
      showToast('Something went wrong. Please try again.', true);
    }
    params.delete('subscribed');
    var next = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', next);
  }

  function openPopup(popup) {
    popup.hidden = false;
    document.documentElement.classList.add('nl-popup-open');
    var input = $('.nl-popup-form input[type="email"]', popup);
    if (input) setTimeout(function () { input.focus(); }, 50);
  }

  function closePopup(popup) {
    popup.hidden = true;
    document.documentElement.classList.remove('nl-popup-open');
    snooze();
  }

  function init() {
    handleSubscribedQuery();

    var popup = $('#nl-popup');
    if (!popup) return;
    if (alreadySubscribed() || dismissedRecently()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Still show, just without fancy transitions via CSS.
    }

    var opened = false;
    function tryOpen() {
      if (opened || alreadySubscribed() || dismissedRecently()) return;
      opened = true;
      openPopup(popup);
    }

    setTimeout(tryOpen, DELAY_MS);

    // Soft exit-intent on desktop after a short presence on the page.
    var armedAt = Date.now() + 8000;
    document.addEventListener('mouseout', function (event) {
      if (Date.now() < armedAt) return;
      if (event.clientY > 0 || event.relatedTarget || event.toElement) return;
      tryOpen();
    });

    popup.addEventListener('click', function (event) {
      if (event.target && event.target.hasAttribute('data-nl-close')) {
        closePopup(popup);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !popup.hidden) closePopup(popup);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
