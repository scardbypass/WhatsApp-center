(() => {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  const contactCache = new Map();
  const deviceContacts = new Map();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isMessagesUrl = url => /\/api\/devices\/[^/]+\/messages(?:\?|$)/.test(url);
  const isContactsUrl = url => /\/api\/devices\/[^/]+\/contacts(?:\?|$)/.test(url);
  const getDeviceId = url => { const m = url.match(/\/api\/devices\/([^/]+)\/(?:messages|contacts)/); return m ? decodeURIComponent(m[1]) : ''; };
  const authHeaders = () => {
    const token = localStorage.getItem('waCenterToken') || '';
    return token ? { Authorization: 'Bearer ' + token } : {};
  };
  const normalizeContacts = contacts => {
    const out = {};
    for (const [jid, c] of Object.entries(contacts || {})) {
      if (!jid) continue;
      const name = String(c?.name || '').trim();
      const notify = String(c?.notify || '').trim();
      const verified = String(c?.verifiedName || '').trim();
      // A saved address-book name is authoritative. Do not use message pushName here.
      if (name || notify || verified) out[jid] = name || notify || verified;
    }
    return out;
  };
  const applyContacts = (messages, contacts) => messages.map(m => {
    const name = contacts[m?.remoteJid];
    if (!name) return m;
    return { ...m, pushName: name, contactName: name };
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
      deviceContacts.set(deviceId, contacts);
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
    return contactCache.get(jid) || (String(fallback || '').trim() && !/^tumbal$/i.test(String(fallback).trim()) ? fallback : '') || numberFromJid(jid) || fallback || 'Kontak';
  }
  function repairChatRows() {
    document.querySelectorAll('.chat-row[data-jid]').forEach(row => {
      const jid = row.dataset.jid;
      const nameEl = row.querySelector('.chat-name');
      if (!nameEl) return;
      const corrected = displayForJid(jid, nameEl.textContent);
      if (corrected && nameEl.textContent !== corrected) nameEl.textContent = corrected;
      const avatar = row.querySelector('.chat-avatar');
      if (avatar && corrected) avatar.textContent = corrected.trim().charAt(0).toUpperCase();
    });
  }
  function repairConversation() {
    const name = document.getElementById('convName');
    const number = document.getElementById('convNumber');
    const rows = document.querySelectorAll('.chat-row[data-jid]');
    if (!name || !number) return;
    const currentNumber = number.textContent.trim();
    for (const row of rows) {
      const jid = row.dataset.jid;
      if (numberFromJid(jid) === currentNumber || contactCache.get(jid) === name.textContent.trim()) {
        const corrected = displayForJid(jid, name.textContent);
        if (corrected) name.textContent = corrected;
        if (numberFromJid(jid)) number.textContent = numberFromJid(jid);
        return;
      }
    }
  }
  const observer = new MutationObserver(() => { repairChatRows(); repairConversation(); });
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(repairChatRows, 250);
    setTimeout(repairChatRows, 1200);
  });
})();
