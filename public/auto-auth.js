(() => {
  'use strict';
  const SESSION_TOKEN = '__env_session__';

  // Keep only a harmless marker in the browser. The real API_TOKEN remains in VPS .env.
  try { localStorage.setItem('waCenterToken', SESSION_TOKEN); } catch {}
  fetch('/api/session', { method: 'GET', credentials: 'same-origin', cache: 'no-store' }).catch(() => {});

  const hideLegacyAuth = () => {
    const nodes = [...document.querySelectorAll('body *')];
    for (const el of nodes) {
      if (!el || el.children.length > 6) continue;
      const text = (el.innerText || '').trim();
      if (!text || !/Hubungkan WA Center/i.test(text)) continue;
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        el.style.display = 'none';
        el.setAttribute('data-env-auth-hidden', '1');
      }
    }
  };

  const boot = () => {
    hideLegacyAuth();
    setTimeout(hideLegacyAuth, 250);
    setTimeout(hideLegacyAuth, 1000);
    const observer = new MutationObserver(hideLegacyAuth);
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
