(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const contactCache = new Map();
  const isMessagesUrl = url => /\/api\/devices\/[^/]+\/messages(?:\?|$)/.test(url);
  const getDeviceId = url => { const m = url.match(/\/api\/devices\/([^/]+)\/messages(?:\?|$)/); return m ? decodeURIComponent(m[1]) : ''; };
  const authHeaders = () => {
    const token = localStorage.getItem('waCenterToken') || '';
    return token ? { Authorization: 'Bearer ' + token } : {};
  };
  const normalizeContacts = contacts => {
    const out = {};
    for (const [jid, c] of Object.entries(contacts || {})) {
      const name = String(c?.name || c?.notify || c?.verifiedName || '').trim();
      if (jid && name) out[jid] = name;
    }
    return out;
  };
  const applyContacts = (messages, contacts) => messages.map(m => {
    const name = contacts[m?.remoteJid];
    return name ? { ...m, pushName: name, contactName: name } : m;
  });
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!response.ok || !isMessagesUrl(url)) return response;
    try {
      const deviceId = getDeviceId(url);
      const data = await response.clone().json();
      const contactsResponse = await nativeFetch(`/api/devices/${encodeURIComponent(deviceId)}/contacts`, { headers: authHeaders(), cache: 'no-store' });
      const contacts = contactsResponse.ok ? normalizeContacts(await contactsResponse.json()) : {};
      for (const [jid, name] of Object.entries(contacts)) contactCache.set(jid, name);
      const fixed = applyContacts(Array.isArray(data) ? data : [], contacts);
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(fixed), { status: response.status, statusText: response.statusText, headers });
    } catch {
      return response;
    }
  };
  function numberFromJid(jid) {
    const s = String(jid || '');
    return s.endsWith('@g.us') ? '' : s.split('@')[0].split(':')[0];
  }
  function displayForJid(jid, fallback) {
    return contactCache.get(jid) || numberFromJid(jid) || (String(fallback || '').trim() || 'Kontak');
  }
  function repairChatRows() {
    document.querySelectorAll('.chat-row[data-jid]').forEach(row => {
      const jid = row.dataset.jid;
      const nameEl = row.querySelector('.chat-name');
      if (!nameEl) return;
      const corrected = displayForJid(jid, nameEl.textContent);
      if (nameEl.textContent !== corrected) nameEl.textContent = corrected;
      const avatar = row.querySelector('.chat-avatar');
      if (avatar) avatar.textContent = corrected.trim().charAt(0).toUpperCase();
    });
  }
  const observer = new MutationObserver(repairChatRows);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(repairChatRows, 250);
    setTimeout(repairChatRows, 1200);
  });
})();
