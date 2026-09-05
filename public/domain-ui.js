(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = async (url, options = {}) => {
    const token = localStorage.getItem('waCenterToken') || localStorage.getItem('token') || '';
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(url, { ...options, cache: 'no-store', headers });
    const text = await r.text(); let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || r.statusText }; }
    if (!r.ok) throw new Error(data.error || 'Request gagal');
    return data;
  };
  const toast = msg => { const el = document.getElementById('toast'); if (!el) return; el.textContent = msg; el.classList.add('show'); clearTimeout(window.__domainToast); window.__domainToast = setTimeout(() => el.classList.remove('show'), 2600); };

  function openDomain() {
    let modal = document.getElementById('domainModal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'domainModal'; modal.className = 'modal domain-modal';
      modal.innerHTML = `<div class="modalbox"><div class="sheet-head"><div><div class="modal-title">Custom Domain</div><div class="modal-desc">Hubungkan WA Center ke subdomain Cloudflare tanpa mengetik port lagi.</div></div><button class="closebtn" id="domainClose">×</button></div><div id="domainState" class="domain-state">Memeriksa konfigurasi…</div><div class="domain-form"><label class="domain-label">Hostname<input id="domainHost" class="field" placeholder="wa.scard-project.id" autocomplete="url"></label><div class="domain-two"><label class="domain-label">Origin IP<input id="domainIp" class="field" placeholder="141.11.160.162" inputmode="decimal"></label><label class="domain-label">Origin Port<input id="domainPort" class="field" placeholder="31109" inputmode="numeric"></label></div><label class="domain-check"><input id="domainProxy" type="checkbox" checked><span><b>Cloudflare Proxy</b><small>Wajib untuk meneruskan port non-standar seperti 31109.</small></span></label><button class="btn primary full" id="domainSave">Simpan & Hubungkan Otomatis</button></div><div id="domainResult" class="domain-result"></div><div class="domain-note">API Token Cloudflare tetap di server .env. Jangan masukkan token Cloudflare ke browser.</div></div>`;
      document.body.appendChild(modal);
      document.getElementById('domainClose').onclick = () => modal.classList.remove('show');
      modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
      document.getElementById('domainSave').onclick = saveDomain;
    }
    modal.classList.add('show'); loadDomain();
  }
  async function loadDomain() {
    const state = document.getElementById('domainState'); if (!state) return;
    try {
      const d = await api('/api/settings/domain');
      if (d.hostname) document.getElementById('domainHost').value = d.hostname;
      document.getElementById('domainIp').value = d.originIp || '141.11.160.162';
      document.getElementById('domainPort').value = d.originPort || '31109';
      document.getElementById('domainProxy').checked = d.proxied !== false;
      const ok = d.status === 'dns_ready';
      state.className = 'domain-state ' + (ok ? 'ok' : 'warn');
      state.innerHTML = `<span class="domain-dot"></span><div><b>${esc(ok ? 'Domain aktif' : (d.message || 'Belum terhubung'))}</b><small>${esc(d.hostname ? d.httpsUrl || ('https://' + d.hostname) : 'Belum ada hostname')}</small></div>`;
      if (d.error) state.innerHTML += `<small class="danger-text">${esc(d.error)}</small>`;
      if (d.hostname) renderDomainResult(d);
    } catch (e) { state.className = 'domain-state warn'; state.textContent = e.message; }
  }
  async function saveDomain() {
    const btn = document.getElementById('domainSave'); const hostname = document.getElementById('domainHost').value.trim(); const originIp = document.getElementById('domainIp').value.trim(); const originPort = Number(document.getElementById('domainPort').value || 31109); const proxied = document.getElementById('domainProxy').checked;
    if (!hostname) return toast('Hostname wajib diisi');
    btn.disabled = true; btn.innerHTML = '<span class="loading"><i class="spinner"></i>Menghubungkan…</span>';
    try {
      const d = await api('/api/settings/domain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname, originIp, originPort, proxied }) });
      renderDomainResult(d); document.getElementById('domainState').className = 'domain-state ok'; document.getElementById('domainState').innerHTML = `<span class="domain-dot"></span><div><b>DNS berhasil dikonfigurasi</b><small>${esc(d.httpsUrl)}</small></div>`; toast('Custom domain berhasil diset');
    } catch (e) { document.getElementById('domainResult').innerHTML = `<div class="danger-text"><b>Gagal</b><small>${esc(e.message)}</small></div>`; toast(e.message); }
    finally { btn.disabled = false; btn.textContent = 'Simpan & Hubungkan Otomatis'; }
  }
  function renderDomainResult(d) {
    const box = document.getElementById('domainResult'); if (!box) return;
    const command = `sudo caddy reverse-proxy --from ${d.hostname || 'wa.example.com'} --to 127.0.0.1:${d.originPort || 31109}`;
    box.innerHTML = `<div class="domain-result-head"><b>Konfigurasi selesai</b><span>${esc(d.proxied === false ? 'DNS Only' : 'Cloudflare Proxy')}</span></div><div class="domain-url">https://${esc(d.hostname || 'wa.example.com')}</div><div class="domain-info"><div><span>DNS</span><b>${esc(d.dnsContent || d.originIp || '')}</b></div><div><span>PORT</span><b>${esc(d.originPort || 31109)}</b></div><div><span>RULE</span><b>${d.originRuleId ? 'Origin Port ✓' : 'Belum dibuat'}</b></div></div><div class="domain-command"><small>Jika tidak memakai Cloudflare Origin Rules, gunakan reverse proxy di VPS:</small><code>${esc(command)}</code><button class="btn" id="copyDomainCmd">Salin</button></div>`;
    document.getElementById('copyDomainCmd').onclick = async () => { try { await navigator.clipboard.writeText(command); toast('Command disalin'); } catch { toast(command); } };
  }

  function injectMenu() {
    if (document.getElementById('domainMenuItem')) return true;
    const lists = [...document.querySelectorAll('.menu-list')];
    let list = lists.find(el => /Mode Tampilan|Penyimpanan VPS|Kelola Device/i.test(el.innerText || '')) || lists[0];
    if (!list) return false;
    const item = document.createElement('button'); item.className = 'menu-item'; item.id = 'domainMenuItem'; item.type = 'button';
    item.innerHTML = '<div class="menu-ico">🌐</div><div class="menu-info"><b>Custom Domain</b><span>Cloudflare DNS + HTTPS + Port 31109</span></div><div class="arrow">›</div>';
    item.onclick = openDomain;
    const anchor = [...list.querySelectorAll('.menu-item')].find(el => /Mode Tampilan/i.test(el.innerText || ''));
    if (anchor) anchor.insertAdjacentElement('afterend', item); else list.appendChild(item);
    return true;
  }

  function boot() {
    injectMenu();
    let tries = 0;
    const timer = setInterval(() => { if (injectMenu() || ++tries > 30) clearInterval(timer); }, 250);
    const observer = new MutationObserver(() => injectMenu());
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
