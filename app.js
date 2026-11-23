/* global INITIAL_CATALOG */
(() => {
  const KEY = 'amf-store-v1';
  const companies = [
    { id: 'arabian', name: 'Arabian Perfumery', note: 'Made in Spain', color: '#cfad66' },
    { id: 'company-2', name: 'Company 2', note: 'Add supplier details', color: '#91b5aa' },
    { id: 'company-3', name: 'Company 3', note: 'Add supplier details', color: '#c98c83' },
    { id: 'company-4', name: 'Company 4', note: 'Add supplier details', color: '#9e9ac7' }
  ];
  const STATE_VERSION = 2;
  // '14A' -> 'AR-014A', '7' -> 'AR-007'
  const seedSerial = (p, i) => { const m = /^(\d+)(.*)$/.exec(String(p.no || i + 1).trim()); return `AR-${m ? m[1].padStart(3, '0') + m[2] : p.no}`; };
  const seedProducts = (window.INITIAL_CATALOG || []).map((p, i) => ({
    ...p, id: `arabian-${p.id || i + 1}`, companyId: 'arabian', serial: seedSerial(p, i),
    size: p.size || '', stock: p.stock ?? null, notes: p.notes || ''
  }));
  const DAY = 86400000;
  const DEFAULT_REMINDER_TEXT = 'Assalam o Alaikum {name},\nThis is a friendly reminder from {shop} about invoice {invoice} dated {date}. {amount} is still pending (total {total}, received {paid}).\nKindly arrange the payment at your earliest convenience. Thank you!';
  const defaultState = {
    version: STATE_VERSION,
    settings: {
      name: 'Al Madina Fragrances', brand: 'Al Madina Fragrances (AMF)', phone: '', address: '', logo: 'logo.jpg', theme: 'light',
      countryCode: '92',
      reminders: { schedule: '1, 2, 7', repeatEvery: 7, template: DEFAULT_REMINDER_TEXT },
      shareFields: ['code', 'priceKg', 'perGram', 'price25g', 'price100g'], shareTitle: 'Fragrance price list'
    },
    products: seedProducts, customers: [], orders: [],
    companyMeta: Object.fromEntries(companies.map(c => [c.id, { name: c.name, note: c.note }]))
  };
  let state = load();
  document.documentElement.dataset.theme = state.settings.theme || 'light';
  let route = location.hash.slice(1) || '/dashboard';

  function normalize(saved) {
    saved = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    return migrate({
      ...structuredClone(defaultState),
      ...saved,
      settings: { ...defaultState.settings, ...(saved.settings || {}) },
      companyMeta: { ...defaultState.companyMeta, ...(saved.companyMeta || {}) },
      products: Array.isArray(saved.products) ? saved.products : structuredClone(defaultState.products),
      customers: Array.isArray(saved.customers) ? saved.customers : [],
      orders: Array.isArray(saved.orders) ? saved.orders : []
    }, Number(saved.version) || 1);
  }
  // Brings data saved by older versions of the app up to date (runs once per saved copy).
  function migrate(st, from) {
    if (from < 2) {
      // v2: stock 0 used to mean "not set". Blank/null now means not set and 0 means out of stock.
      st.products.forEach(p => { if (!p.stock) p.stock = null; });
      // v2: two catalog rows shared serial AR-14/15; give them the labels their catalog ids already use.
      const fixes = { 'arabian-14A': 'AR-014A', 'arabian-14B': 'AR-014B' };
      st.products.forEach(p => { const next = fixes[p.id]; if (next && p.serial === 'AR-14/15' && !st.products.some(x => x.serial === next)) p.serial = next; });
    }
    st.version = STATE_VERSION;
    return st;
  }
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return structuredClone(defaultState); }
  }
  let saveFailed = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; return true; }
    catch (err) { saveFailed = true; console.error('AMF: could not save to browser storage', err); return false; }
  }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(n) { return `${Number(n || 0).toLocaleString()} PKR`; }
  function round(n, d = 2) { n = Number(n); if (!Number.isFinite(n)) return 0; const t = String(n); if (/e/i.test(t)) return Math.round(n * 10 ** d) / 10 ** d; return Number(Math.round(Number(`${t}e${d}`)) + `e-${d}`); }
  function supplierName(id) { const n = String(state.companyMeta[id]?.name || '').trim(); return n || company(id).name; }
  function supplierInitial(id) { return [...supplierName(id)][0] || '?'; }
  function nextSerial(cid) {
    const prefix = supplierName(cid).slice(0, 2).toUpperCase(), used = new Set(state.products.map(p => String(p.serial || '').toLowerCase()));
    let n = state.products.filter(p => p.companyId === cid).length + 1, serial;
    do { serial = `${prefix}-${String(n).padStart(3, '0')}`; n++; } while (used.has(serial.toLowerCase()));
    return serial;
  }
  function nextInvoiceNumber() {
    const used = new Set(state.orders.map(o => o.number)), highest = state.orders.reduce((max, o) => { const m = /-(\d+)$/.exec(String(o.number || '')); return m ? Math.max(max, +m[1]) : max; }, 0);
    let n = Math.max(highest, state.orders.length) + 1, number;
    do { number = `AMF-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`; n++; } while (used.has(number));
    return number;
  }
  // ── Price maths: 1 kg = 1000 g, so per gram = kg / 1000, per 25 g = kg / 40, per 100 g = kg / 10 ──
  function metricsFromKg(kg) {
    kg = Number(kg);
    if (!(kg > 0)) return { perGram: 0, price25g: 0, price100g: 0 };
    return { perGram: round(kg / 1000, 4), price25g: round(kg / 40), price100g: round(kg / 10) };
  }

  // ── WhatsApp helpers ─────────────────────────────────────────────────────────────────────────────
  // "0300-1234567" -> "923001234567" (digits only, with country code, as wa.me expects). '' when unusable.
  function waNumber(raw) {
    const first = String(raw || '').split(/[,;/|]/)[0].trim(), international = first.startsWith('+');
    let digits = first.replace(/\D/g, '');
    if (!digits) return '';
    const cc = String(state.settings.countryCode || '92').replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (!international) {
      if (digits.startsWith('0')) digits = cc + digits.slice(1);
      else if (digits.length <= 10) digits = cc + digits;
    }
    return digits.length >= 8 && digits.length <= 15 ? digits : '';
  }
  function waLink(phone, text) { return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`; }
  function openExternal(url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove(); }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
    const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(area); area.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } area.remove(); return ok;
  }

  // ── Payment reminders ────────────────────────────────────────────────────────────────────────────
  // Calendar days are counted in local time so "after 1 day" means "the next day", whatever the hour.
  function dayNumber(date) { const d = new Date(date); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); }
  function dayLabel(day) { return new Date(day * DAY).toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' }); }
  function reminderSettings() { return { ...defaultState.settings.reminders, ...(state.settings.reminders || {}) }; }
  function parseSchedule(text) {
    const days = [...new Set(String(text || '').split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n >= 1 && n <= 365))].sort((a, b) => a - b);
    return days.length ? days : [1, 2, 7];
  }
  function reminderInfo(o) {
    const balance = round(o.total - o.paid);
    if (balance <= 0) return { state: 'paid', balance: 0 };
    const cfg = reminderSettings(), schedule = parseSchedule(cfg.schedule), sent = Array.isArray(o.reminders) ? o.reminders : [];
    const now = dayNumber(new Date()), start = dayNumber(o.date), last = sent.length ? dayNumber(sent[sent.length - 1].at) : null, repeat = Number(cfg.repeatEvery) || 0;
    let dueDay = null;
    if (sent.length < schedule.length) dueDay = start + schedule[sent.length];
    else if (repeat > 0 && last !== null) dueDay = last + repeat;
    if (dueDay !== null && last !== null) dueDay = Math.max(dueDay, last + 1);           // never twice on the same day
    if (dueDay !== null && o.snoozeUntil) dueDay = Math.max(dueDay, dayNumber(o.snoozeUntil));
    const base = { balance, sentCount: sent.length, lastDay: last, dueDay, age: now - start };
    if (o.noReminders) return { ...base, state: 'stopped' };
    if (dueDay === null) return { ...base, state: 'finished' };
    return { ...base, state: now >= dueDay ? 'due' : 'upcoming', late: now - dueDay };
  }
  function dueReminders() { return state.orders.filter(o => reminderInfo(o).state === 'due'); }
  function reminderText(o) {
    const c = customer(o.customerId), values = { name: c?.name || o.customerName, invoice: o.number, amount: money(round(o.total - o.paid)), total: money(o.total), paid: money(o.paid), date: new Date(o.date).toLocaleDateString(), days: dayNumber(new Date()) - dayNumber(o.date), shop: state.settings.name || 'Al Madina Fragrances' };
    return reminderSettings().template.replace(/\{(\w+)\}/g, (match, key) => key in values ? values[key] : match);
  }
  function sendReminder(id) {
    const o = state.orders.find(x => x.id === id); if (!o) return;
    if (reminderInfo(o).state === 'paid') return toast('This invoice is already paid');
    const c = customer(o.customerId), phone = waNumber(c?.phone);
    if (!phone) { toast(`Add a valid WhatsApp number for ${o.customerName} first`); if (c) customerForm(c.id); return; }
    openExternal(waLink(phone, reminderText(o)));
    (o.reminders ||= []).push({ at: new Date().toISOString() }); delete o.snoozeUntil; save(); render(); toast('WhatsApp opened and the reminder was logged');
  }
  function reminderChip(info) {
    if (info.state === 'due') return info.late > 0 ? `<span class="chip due">Overdue by ${info.late} day${info.late === 1 ? '' : 's'}</span>` : '<span class="chip due">Due today</span>';
    if (info.state === 'upcoming') return `<span class="chip">Next: ${dayLabel(info.dueDay)}</span>`;
    return `<span class="chip muted">${info.state === 'stopped' ? 'Reminders stopped' : 'All reminders sent'}</span>`;
  }
  function reminderRow(o) {
    const info = reminderInfo(o), c = customer(o.customerId), hasPhone = !!waNumber(c?.phone), plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    return `<div class="reminder-row"><span class="receipt">✉</span><div class="order-info"><b>${esc(o.customerName)} · ${esc(o.number)}</b><small>${money(info.balance)} due · invoiced ${info.age === 0 ? 'today' : `${plural(info.age, 'day')} ago`} · ${info.sentCount ? `${plural(info.sentCount, 'reminder')} sent, last ${dayLabel(info.lastDay)}` : 'no reminder sent yet'}${hasPhone ? '' : ' · <span class="warn">no WhatsApp number</span>'}</small></div>${reminderChip(info)}<span class="invoice-actions"><button class="button small primary" data-action="send-reminder" data-id="${esc(o.id)}">Send on WhatsApp</button>${info.state === 'due' ? `<button class="button small ghost" data-action="snooze-reminder" data-id="${esc(o.id)}">Tomorrow</button>` : ''}<button class="button small ghost" data-action="toggle-reminders" data-id="${esc(o.id)}">${o.noReminders ? 'Resume' : 'Stop'}</button></span></div>`;
  }
  function reminderBanner() {
    const n = dueReminders().length;
    return n ? `<section class="reminder-banner"><div><b>${n} payment reminder${n === 1 ? ' is' : 's are'} due</b><small>Customers with unpaid invoices are waiting for a WhatsApp message.</small></div><a class="button small primary" href="#/reminders">Review & send</a></section>` : '';
  }
  function remindersPage() {
    const unpaid = state.orders.filter(o => reminderInfo(o).state !== 'paid'), cfg = reminderSettings(), byAge = (a, b) => dayNumber(a.date) - dayNumber(b.date);
    const due = unpaid.filter(o => reminderInfo(o).state === 'due').sort(byAge), rest = unpaid.filter(o => reminderInfo(o).state !== 'due').sort(byAge);
    return `<section class="page-intro"><div><p>A reminder opens WhatsApp with the message ready to send. Nothing is sent automatically. Schedule: day ${esc(parseSchedule(cfg.schedule).join(', '))} after the invoice${Number(cfg.repeatEvery) > 0 ? `, then every ${Number(cfg.repeatEvery)} days` : ''}. <a href="#/settings">Change schedule and message</a></p></div></section>
      <div class="panel detail-panel"><span class="eyebrow">DUE NOW (${due.length})</span>${due.length ? due.map(reminderRow).join('') : `<div class="empty-mini">${icon('✓')}<p>No reminders are due today.</p></div>`}</div>
      ${rest.length ? `<div class="panel detail-panel"><span class="eyebrow">OTHER UNPAID INVOICES (${rest.length})</span>${rest.map(reminderRow).join('')}</div>` : ''}`;
  }

  // ── Customised fragrance lists ───────────────────────────────────────────────────────────────────
  const SHARE_FIELDS = [
    ['code', 'Code', p => p.code],
    ['serial', 'Serial number', p => p.serial],
    ['priceKg', 'Price / kg', p => p.priceKg > 0 ? money(p.priceKg) : ''],
    ['perGram', 'Price / gram', p => p.perGram > 0 ? money(p.perGram) : ''],
    ['price25g', 'Price / 25g', p => p.price25g > 0 ? money(p.price25g) : ''],
    ['price100g', 'Price / 100g', p => p.price100g > 0 ? money(p.price100g) : ''],
    ['size', 'Size / weight', p => p.size],
    ['stock', 'Stock', p => p.stock == null || p.stock === '' ? '' : p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'],
    ['notes', 'Notes', p => p.notes]
  ];
  // WhatsApp formatting: *bold*. Names are used exactly as they are stored in the catalog.
  function shareText(ids, keys, title, customerName) {
    const picked = state.products.filter(p => ids.includes(p.id)), fields = SHARE_FIELDS.filter(f => keys.includes(f[0])), many = picked.length > 1, lines = [];
    if (customerName) lines.push(`Assalam o Alaikum ${customerName},`, '');
    lines.push(`*${state.settings.name || 'Al Madina Fragrances'}*`);
    if (title) lines.push(title);
    lines.push('');
    picked.forEach((p, i) => {
      lines.push(many ? `${i + 1}. *${p.name}*` : `*${p.name}*`);
      fields.forEach(f => { const v = f[2](p); if (v !== '' && v != null) lines.push(`${many ? '   ' : ''}${f[1]}: ${v}`); });
      lines.push('');
    });
    return lines.join('\n').trim();
  }
  function sharePickedIds(form) { return [...form.querySelectorAll('input[name="pick"]:checked')].map(i => i.value); }
  function shareFieldKeys(form) { return [...form.querySelectorAll('input[name="field"]:checked')].map(i => i.value); }
  function shareFilter(form) {
    const q = form.querySelector('#share-search').value.trim().toLowerCase(), supplier = form.querySelector('#share-supplier').value;
    form.querySelectorAll('.share-item').forEach(row => { row.hidden = !(row.dataset.search.includes(q) && (!supplier || row.dataset.company === supplier)); });
  }
  // Rebuilds the message from the selection, unless the user has edited the text by hand (force = true resets it).
  function shareRefresh(form, force = false) {
    const text = form.querySelector('#share-text'), ids = sharePickedIds(form);
    form.querySelector('#share-count').textContent = `${ids.length} selected`;
    if (!force && text.dataset.edited) return;
    delete text.dataset.edited;
    text.value = ids.length ? shareText(ids, shareFieldKeys(form), form.elements.title.value.trim(), customer(form.elements.customerId.value)?.name) : '';
  }
  function shareForm({ ids = [], customerId = '', supplier = '' } = {}) {
    const keys = Array.isArray(state.settings.shareFields) ? state.settings.shareFields : defaultState.settings.shareFields;
    const rows = state.products.map(p => `<label class="share-item" data-company="${esc(p.companyId)}" data-search="${esc([p.name, p.code, p.serial].join(' ').toLowerCase())}"><input type="checkbox" name="pick" value="${esc(p.id)}"${ids.includes(p.id) ? ' checked' : ''}><span><b>${esc(p.name)}</b><small>${esc(p.serial)} · ${esc(p.code || 'no code')} · ${p.priceKg > 0 ? money(p.priceKg) + ' / kg' : 'no price'}</small></span></label>`).join('');
    const customers = state.customers.map(c => `<option value="${esc(c.id)}"${c.id === customerId ? ' selected' : ''}>${esc(c.key)} · ${esc(c.name)}${waNumber(c.phone) ? '' : ' — no WhatsApp number'}</option>`).join('');
    openModal(`<span class="eyebrow">SEND TO A CUSTOMER</span><h2>Share fragrance list</h2><form id="share-form" class="form">
      <div class="form-cols"><label>Customer<select name="customerId"><option value="">Choose the contact in WhatsApp</option>${customers}</select></label><label>Heading<input name="title" value="${esc(state.settings.shareTitle ?? '')}" placeholder="Fragrance price list"></label></div>
      <div class="share-pick"><div class="share-pick-head"><input id="share-search" type="search" placeholder="Search by name, code or serial…" autocomplete="off" aria-label="Search fragrances"><select id="share-supplier" aria-label="Supplier"><option value="">All suppliers</option>${companies.map(c => `<option value="${c.id}"${c.id === supplier ? ' selected' : ''}>${esc(supplierName(c.id))}</option>`).join('')}</select></div><div class="share-list" id="share-list">${rows}</div><div class="share-count"><span id="share-count">0 selected</span><span><button type="button" class="button small ghost" data-action="share-select-shown">Select shown</button> <button type="button" class="button small ghost" data-action="share-clear">Clear</button></span></div></div>
      <fieldset class="share-fields"><legend>Details to include</legend>${SHARE_FIELDS.map(f => `<label><input type="checkbox" name="field" value="${f[0]}"${keys.includes(f[0]) ? ' checked' : ''}>${f[1]}</label>`).join('')}</fieldset>
      <label>Message (you can edit it before sending)<textarea id="share-text" rows="9" placeholder="Tick the fragrances above and the message appears here."></textarea></label>
      <div class="modal-actions"><button type="button" class="button ghost" data-action="share-reset">Reset text</button><button type="button" class="button ghost" data-action="share-print">Print / Save PDF</button><button type="button" class="button ghost" data-action="share-copy">Copy text</button><button type="button" class="button primary" data-action="share-whatsapp">Send on WhatsApp</button></div></form>`, 'wide');
    const form = document.querySelector('#share-form'); shareFilter(form); shareRefresh(form, true);
  }
  function printShareList(ctx) {
    const picked = state.products.filter(p => ctx.ids.includes(p.id)), fields = SHARE_FIELDS.filter(f => ctx.keys.includes(f[0]));
    const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print or save the list'); return; }
    const title = esc(ctx.title || 'Fragrance list'), head = fields.map(f => `<th>${esc(f[1])}</th>`).join(''), body = picked.map(p => `<tr><td class="name">${esc(p.name)}</td>${fields.map(f => `<td>${esc(f[2](p) ?? '')}</td>`).join('')}</tr>`).join('');
    w.document.write(`<html><head><title>${title}</title><style>@page{size:A4 ${fields.length > 5 ? 'landscape' : 'portrait'};margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#243238;margin:0}.doc{max-width:900px;margin:auto}.header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c5a45c;padding-bottom:16px;margin-bottom:18px}.brand{display:flex;align-items:center;gap:12px}.brand img{width:52px;height:52px;object-fit:contain}.brand strong{display:block;font:600 21px Georgia,serif}.brand small{display:block;color:#92713a;margin-top:4px}.meta{text-align:right}.meta h1{font:600 22px Georgia,serif;margin:0}.meta p{color:#7a8788;margin:6px 0 0}table{width:100%;border-collapse:collapse}th{background:#24363d;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.6px;padding:9px 7px;text-align:left}td{border-bottom:1px solid #e3e5e2;padding:10px 7px;vertical-align:top}td.name{font-weight:700}tbody tr:nth-child(even){background:#faf9f6}.count{margin-top:12px;color:#7a8788;text-align:right;font-size:10px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="doc"><div class="header"><div class="brand"><img src="${esc(state.settings.logo || 'logo.jpg')}" alt=""><div><strong>${esc(trademarkName(state.settings.name))}</strong><small>${esc(state.settings.phone)}</small></div></div><div class="meta"><h1>${title}</h1><p>${ctx.customer ? `Prepared for ${esc(ctx.customer.name)} · ` : ''}${new Date().toLocaleDateString()}</p></div></div><table><thead><tr><th>Fragrance</th>${head}</tr></thead><tbody>${body}</tbody></table><div class="count">${picked.length} fragrance${picked.length === 1 ? '' : 's'}</div></div></body></html>`);
    w.document.close(); printWhenReady(w);
  }
  function shareAction(kind) {
    const form = document.querySelector('#share-form'); if (!form) return;
    const ids = sharePickedIds(form), keys = shareFieldKeys(form), title = form.elements.title.value.trim(), selected = customer(form.elements.customerId.value), text = form.querySelector('#share-text').value.trim();
    if (!ids.length) return toast('Choose at least one fragrance');
    const remember = () => { state.settings.shareFields = keys; state.settings.shareTitle = title; if (!save()) saveFailed = false; };
    if (kind === 'print') { remember(); return printShareList({ ids, keys, title, customer: selected }); }
    if (!text) return toast('The message is empty');
    if (kind === 'copy') { copyText(text).then(ok => toast(ok ? 'Message copied' : 'Could not copy automatically. Select the text and copy it.')); return; }
    let phone = '';
    if (selected) { phone = waNumber(selected.phone); if (!phone) return toast(`Add a valid WhatsApp number for ${selected.name} first`); }
    const url = waLink(phone, text);
    if (url.length > 7000) return toast('This list is too long for one WhatsApp message. Choose fewer fragrances, or use Copy text or Print / Save PDF.');
    remember(); openExternal(url);
  }

  function stockLabel(p) { return p.stock == null || p.stock === '' ? 'Stock not set' : p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'; }
  function shrinkImage(dataUrl, type, max = 320) {
    return new Promise(resolve => {
      if (type === 'image/svg+xml') return resolve(dataUrl);
      const img = new Image(), done = value => { clearTimeout(timer); resolve(value); }, timer = setTimeout(() => resolve(dataUrl), 4000);
      img.onload = () => {
        if (!img.width || !img.height) return done(dataUrl);
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && dataUrl.length < 150000) return done(dataUrl);
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          let out = canvas.toDataURL(type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
          if (out.length > 200000) { // still big (e.g. a photo saved as PNG): flatten onto white and use JPEG
            const flat = document.createElement('canvas'); flat.width = canvas.width; flat.height = canvas.height;
            const ctx = flat.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, flat.width, flat.height); ctx.drawImage(canvas, 0, 0);
            out = flat.toDataURL('image/jpeg', 0.85);
          }
          done(out);
        } catch { done(dataUrl); }
      };
      img.onerror = () => done(dataUrl);
      img.src = dataUrl;
    });
  }
  function deleteCustomer(id) {
    const c = customer(id); if (!c) return;
    if (state.orders.some(o => o.customerId === id)) return toast('This customer has invoices. Delete those invoices first.');
    if (!confirm(`Delete ${c.name}? This cannot be undone.`)) return;
    state.customers = state.customers.filter(x => x.id !== id); save();
    history.replaceState(null, '', '#/customers'); render(); toast('Customer deleted');
  }
  function removeLine(button) {
    if (document.querySelectorAll('#invoice-lines .invoice-line').length < 2) return toast('An invoice needs at least one item');
    button.closest('.invoice-line').remove();
  }
  function importBackup(input) {
    const file = input.files[0]; input.value = ''; if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read that file');
    reader.onload = () => {
      let parsed; try { parsed = JSON.parse(reader.result); } catch { return toast('That file is not valid JSON'); }
      const valid = parsed && typeof parsed === 'object' && Array.isArray(parsed.products) && Array.isArray(parsed.customers) && Array.isArray(parsed.orders)
        && parsed.products.every(p => p && typeof p.id === 'string' && typeof p.companyId === 'string')
        && parsed.customers.every(c => c && typeof c.id === 'string' && typeof c.name === 'string')
        && parsed.orders.every(o => o && typeof o.id === 'string' && Array.isArray(o.items));
      if (!valid) return toast('That file is not an AMF backup');
      if (!confirm(`Replace ALL current data with this backup?\n\n${parsed.products.length} fragrances · ${parsed.customers.length} customers · ${parsed.orders.length} invoices\n\nThis cannot be undone. Export a backup of your current data first if you are unsure.`)) return;
      const previous = state; state = normalize(parsed);
      if (!save()) { state = previous; saveFailed = false; return toast('That backup is too large to store in this browser'); }
      document.documentElement.dataset.theme = state.settings.theme || 'light'; render(); toast('Backup restored');
    };
    reader.readAsText(file);
  }
  function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function printWhenReady(w) {
    let done = false; const go = () => { if (done) return; done = true; try { w.focus(); w.print(); } catch (err) { console.error(err); } };
    const pending = [...w.document.images].filter(img => !img.complete);
    if (!pending.length) { setTimeout(go, 150); return; }
    let left = pending.length; const finish = () => { if (--left === 0) setTimeout(go, 100); };
    pending.forEach(img => { img.addEventListener('load', finish, { once: true }); img.addEventListener('error', finish, { once: true }); });
    setTimeout(go, 4000);
  }
  function company(id) { return companies.find(c => c.id === id) || companies[0]; }
  function product(id) { return state.products.find(p => p.id === id); }
  function customer(id) { return state.customers.find(c => c.id === id); }
  function navigate(path) { location.hash = path; }
  let toastTimer;
  function toast(message) {
    const failed = saveFailed;
    if (failed) { message = 'Could not save to browser storage (it may be full or blocked). Export a backup now so nothing is lost.'; saveFailed = false; }
    const el = document.querySelector('#toast');
    if (el) { el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), failed ? 6000 : 2200); }
  }
  function icon(symbol) { return `<span class="icon">${symbol}</span>`; }
  function trademarkName(value) { const name = String(value || 'Al Madina Fragrances'); return /[®]$/.test(name) ? name : `${name}®`; }
  function supplierOptions(selected = 'arabian') { return companies.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(state.companyMeta[c.id]?.name || c.name)}</option>`).join(''); }
  function productOptions(companyId = 'arabian', selected = '', query = '') { const needle = query.trim().toLowerCase(); return state.products.filter(p => p.companyId === companyId && (!needle || `${p.name} ${p.code} ${p.serial}`.toLowerCase().includes(needle))).map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${esc(p.serial)} · ${money(p.price25g)}/25g</option>`).join(''); }

  function layout(content, active = 'dashboard') {
    const logo = `<img src="${esc(state.settings.logo || 'logo.jpg')}" alt="${esc(trademarkName(state.settings.name))} logo">`;
    return `<div class="app"><button class="menu-toggle" data-action="toggle-sidebar" aria-label="Open navigation" aria-expanded="false">☰</button><div class="sidebar-backdrop" data-action="close-sidebar"></div><aside class="sidebar"><div class="sidebar-header"><a class="brand" href="#/dashboard">${logo}<span><b>${esc(trademarkName(state.settings.name))}</b><small>FRAGRANCES</small></span></a><button class="sidebar-close" data-action="close-sidebar" aria-label="Close navigation">×</button></div>
      <nav><small class="nav-label">Workspace</small>
        ${nav('dashboard', '⌂', 'Overview', active)}${nav('catalog/arabian', '◈', 'Catalogs', active)}${nav('customers', '♙', 'Customers', active)}${nav('billing', '▤', 'Billing & invoices', active)}${nav('reminders', '✉', 'Reminders', active, dueReminders().length)}
        <small class="nav-label">Manage</small>${nav('settings', '⚙', 'Settings', active)}
      </nav><div class="sidebar-foot"><span class="status-dot"></span> Local & private<br><small>Data stays on this device</small></div></aside>
      <main class="main"><header class="topbar"><div><span class="eyebrow">PERSONAL BUSINESS DESK</span><h1>${pageTitle()}</h1></div><div class="top-actions"><button class="button ghost theme-toggle" data-action="toggle-theme" aria-label="Switch to ${state.settings.theme === 'dark' ? 'light' : 'dark'} mode">${state.settings.theme === 'dark' ? '☼' : '◐'} <span>${state.settings.theme === 'dark' ? 'Light' : 'Dark'} mode</span></button><button class="button ghost" data-action="export-backup">Export backup</button><button class="button ghost" data-action="import-backup">Import backup</button><input type="file" id="backup-file" accept="application/json,.json" hidden><button class="button primary" data-action="quick-order">＋ New invoice</button></div></header>${content}</main><div id="toast" class="toast"></div></div>`;
  }
  function nav(path, sym, label, active, badge = 0) { return `<a class="${active === path.split('/')[0] ? 'active' : ''}" href="#/${path}">${icon(sym)}${label}${badge ? `<em class="nav-badge" aria-label="${badge} due">${badge}</em>` : ''}</a>`; }
  function pageTitle() { if (route.startsWith('/catalog')) return 'Supplier catalogs'; if (route.startsWith('/customers')) return 'Customers'; if (route.startsWith('/billing')) return 'Billing & invoices'; if (route.startsWith('/reminders')) return 'Payment reminders'; if (route.startsWith('/settings')) return 'Settings'; const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'; }
  function render() {
    document.body.classList.remove('sidebar-open');
    route = location.hash.slice(1) || '/dashboard';
    let html, active = route.split('/')[1] || 'dashboard';
    if (route === '/dashboard') html = dashboard();
    else if (route === '/catalog' || route.startsWith('/catalog/')) html = catalogPage(route.split('/')[2]);
    else if (route === '/customers') html = customersPage();
    else if (route.startsWith('/customers/')) html = customerPage(route.split('/')[2]);
    else if (route === '/billing') html = billingPage();
    else if (route === '/reminders') html = remindersPage();
    else if (route === '/settings') html = settingsPage();
    else html = dashboard();
    document.querySelector('#app').innerHTML = layout(html, active);
  }
  function dashboard() {
    const sold = state.orders.length, outstanding = state.orders.reduce((s, o) => s + (o.total - o.paid), 0);
    const recent = [...state.orders].reverse().slice(0, 5);
    return `<section class="hero"><div><span class="eyebrow">YOUR FRAGRANCE LEDGER</span><h2>Every scent,<br><em>beautifully accounted for.</em></h2><p>Manage your private collection, suppliers, customers and invoices in one calm workspace.</p><button class="button primary" data-action="quick-order">Create an invoice ${icon('→')}</button></div><div class="hero-art"><div class="bottle"><i></i><strong>AMF</strong><small>PERFUME</small></div></div></section>
      ${reminderBanner()}<section class="stats"><article><span class="stat-icon gold">◈</span><small>Total fragrances</small><strong>${state.products.length}</strong><em>across ${companies.length} suppliers</em></article><article><span class="stat-icon sage">♙</span><small>Customers</small><strong>${state.customers.length}</strong><em>records saved locally</em></article><article><span class="stat-icon rose">▤</span><small>Invoices</small><strong>${sold}</strong><em>${money(outstanding)} outstanding</em></article></section>
      <section class="split"><div class="panel"><div class="panel-head"><div><span class="eyebrow">SUPPLIERS</span><h3>Browse catalogs</h3></div><a href="#/catalog/arabian">View all →</a></div><div class="company-list">${companies.map(c => `<a class="company-row" href="#/catalog/${c.id}"><span class="company-avatar" style="--accent:${c.color}">${esc(supplierInitial(c.id))}</span><span><b>${esc(state.companyMeta[c.id]?.name || c.name)}</b><small>${state.products.filter(p => p.companyId === c.id).length} fragrances · ${esc(state.companyMeta[c.id]?.note || '')}</small></span>${icon('→')}</a>`).join('')}</div></div><div class="panel"><div class="panel-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>Latest invoices</h3></div><a href="#/billing">See all →</a></div>${recent.length ? recent.map(o => `<a class="activity-row" href="#/billing"><span class="receipt">▤</span><span><b>${esc(o.number)}</b><small>${esc(o.customerName)}</small></span><strong>${money(o.total)}</strong></a>`).join('') : `<div class="empty-mini">${icon('◌')}<p>No invoices yet.<br>Create your first one above.</p></div>`}</div></section>`;
  }
  function catalogPage(cid) {
    cid = company(cid).id; const c = company(cid), items = state.products.filter(p => p.companyId === cid);
    return `<section class="catalog-toolbar"><div class="company-switcher">${companies.map(x => `<a class="${x.id === cid ? 'selected' : ''}" href="#/catalog/${x.id}"><span style="--accent:${x.color}">${esc(supplierInitial(x.id))}</span>${esc(state.companyMeta[x.id]?.name || x.name)} <b>${state.products.filter(p => p.companyId === x.id).length}</b></a>`).join('')}</div><button class="button primary" data-action="add-product" data-company="${cid}">＋ Add fragrance</button></section>
      <section class="catalog-head"><div><span class="eyebrow">${esc(state.companyMeta[cid]?.note || c.note)}</span><h2>${esc(state.companyMeta[cid]?.name || c.name)}</h2><p>Prices and metrics are shown only inside this supplier catalog.</p></div><div class="catalog-tools"><label class="search">${icon('⌕')}<input id="product-search" placeholder="Search name, code or serial…"></label><button class="button ghost" data-action="share-list" data-company="${cid}">Share list</button><button class="button ghost" data-action="export-catalog" data-company="${cid}">Export Excel</button><button class="button primary" data-action="export-catalog-pdf" data-company="${cid}">Download PDF</button></div></section>
      <div id="product-grid" class="product-grid">${items.map(productCard).join('')}</div><div id="catalog-empty" class="empty-state" hidden>${icon('⌕')}<h3>No matching fragrances</h3><p>Try a different search or add a new fragrance.</p></div>`;
  }
  function productCard(p) { return `<article class="product-card" data-search="${esc(`${p.name} ${p.code} ${p.serial}`.toLowerCase())}" data-id="${p.id}"><button class="card-open" data-action="product-detail" data-id="${p.id}"><span class="product-no">${esc(p.serial)}</span><h3>${esc(p.name)}</h3><p>${esc(p.code)} · ${p.size ? esc(p.size) : 'Size not supplied'}</p><strong>${money(p.priceKg)} <small>/ kg</small></strong><div class="card-foot"><span>${money(p.price25g)} / 25g</span><span>${stockLabel(p)}</span></div></button></article>`; }
  function customersPage() {
    return `<section class="page-intro"><div><p>Every customer has a searchable key and a complete account history.</p></div><button class="button primary" data-action="add-customer">＋ Add customer</button></section><label class="search wide">${icon('⌕')}<input id="customer-search" placeholder="Search key, name, phone or address…"></label><div id="customer-grid" class="customer-grid">${state.customers.map(customerCard).join('')}</div><div class="empty-state" id="customer-empty" ${state.customers.length ? 'hidden' : ''}>${icon('♙')}<h3>No customers yet</h3><p>Add a customer to start recording orders.</p></div>`;
  }
  function customerCard(c) { const orders = state.orders.filter(o => o.customerId === c.id), balance = orders.reduce((s, o) => s + o.total - o.paid, 0); return `<a class="customer-card" href="#/customers/${c.id}" data-search="${esc(`${c.key} ${c.name} ${c.phone} ${c.address}`.toLowerCase())}"><span class="customer-avatar">${esc(c.name[0] || '?')}</span><div><span class="eyebrow">${esc(c.key)}</span><h3>${esc(c.name)}</h3><p>${esc(c.phone || 'No phone')} · ${esc(c.address || 'No address')}</p></div><div class="customer-total"><small>${orders.length} invoice${orders.length === 1 ? '' : 's'}</small><strong>${money(balance)}</strong><span>remaining</span></div></a>`; }
  function customerPage(id) {
    const c = customer(id); if (!c) return `<section class="empty-state">${icon('!')}<h3>Customer not found</h3></section>`;
    const orders = state.orders.filter(o => o.customerId === id), total = orders.reduce((s, o) => s + o.total, 0), paid = orders.reduce((s, o) => s + o.paid, 0);
    return `<a class="back-link" href="#/customers">← All customers</a><section class="profile-head"><span class="customer-avatar large">${esc(c.name[0])}</span><div><span class="eyebrow">${esc(c.key)}</span><h2>${esc(c.name)}</h2><p>${esc(c.phone || 'No phone')} · ${esc(c.address || 'No address')}</p></div><div class="profile-actions"><button class="button ghost" data-action="share-customer" data-id="${esc(c.id)}">Send price list</button><button class="button ghost" data-action="edit-customer" data-id="${esc(c.id)}">Edit</button><button class="button danger" data-action="delete-customer" data-id="${esc(c.id)}">Delete</button><button class="button primary" data-action="quick-order" data-customer="${c.id}">＋ New invoice</button></div></section><section class="stats compact"><article><small>Total billed</small><strong>${money(total)}</strong></article><article><small>Paid</small><strong>${money(paid)}</strong></article><article><small>Remaining</small><strong>${money(total - paid)}</strong></article></section><section class="panel detail-panel"><div class="panel-head"><div><span class="eyebrow">ACCOUNT HISTORY</span><h3>Invoices & ordered products</h3></div><button class="button ghost" data-action="export-customer" data-id="${id}">Download record</button></div>${orders.length ? orders.map(orderRow).join('') : '<div class="empty-mini">No orders recorded for this customer.</div>'}</section>`;
  }
  function orderRow(o) { const canDelete = o.paid >= o.total; return `<div class="order-row"><span class="receipt">▤</span><div class="order-info"><b>${esc(o.number)}</b><small>${new Date(o.date).toLocaleDateString()} · ${o.items.length} item${o.items.length === 1 ? '' : 's'}</small></div><strong>${money(o.total)}</strong><span class="balance ${o.total - o.paid > 0 ? 'due' : ''}">${o.total - o.paid ? `${money(o.total - o.paid)} due` : 'Paid'}</span><span class="invoice-actions"><button class="button small ghost" data-action="edit-invoice" data-id="${o.id}">Edit</button><button class="button small ghost" data-action="invoice" data-id="${o.id}">Invoice</button>${o.total - o.paid > 0 ? `<button class="button small ghost" data-action="send-reminder" data-id="${o.id}">Remind</button>` : ''}${canDelete ? '<button class="button small delete-icon" data-action="delete-invoice" data-id="' + o.id + '" aria-label="Delete paid invoice" title="Delete paid invoice">⌫</button>' : ''}</span></div>`; }
  function billingPage() { return `<section class="page-intro"><div><p>One invoice can combine products from all four suppliers.</p></div><button class="button primary" data-action="quick-order">＋ New invoice</button></section><div class="panel detail-panel">${state.orders.length ? [...state.orders].reverse().map(orderRow).join('') : `<div class="empty-state">${icon('▤')}<h3>No billing records yet</h3><p>Create an invoice with products from any company.</p></div>`}</div>`; }
  function settingsPage() { return `<section class="settings-grid"><div class="panel"><span class="eyebrow">BRAND & BUSINESS</span><h3>Customize your workspace</h3><form id="settings-form" class="form"><label>Shop name<input name="name" value="${esc(state.settings.name)}"></label><label>Invoice name<input name="brand" value="${esc(state.settings.brand)}"></label><label>Phone<input name="phone" value="${esc(state.settings.phone)}"></label><label>Address<textarea name="address">${esc(state.settings.address)}</textarea></label><label>Logo<input name="logo" type="file" accept="image/*"><small>Upload your shop logo. It updates the workspace and every invoice.</small></label><button class="button primary" type="submit">Save settings</button></form></div><div class="panel"><span class="eyebrow">APPEARANCE & DATA</span><h3>Keep your desk comfortable</h3><p class="muted">Switch between calm light and dark modes without changing your brand colors.</p><button class="button ghost" data-action="toggle-theme">${state.settings.theme === 'dark' ? '☼ Use light mode' : '◐ Use dark mode'}</button><hr><h3>Your records are local</h3><p class="muted">Everything is stored in this browser. Export a backup regularly so you can move your records to another device.</p><button class="button ghost" data-action="export-backup">Download JSON backup</button><hr><h3>Supplier names</h3><form id="companies-form" class="form">${companies.map(c => `<label>${c.id === 'arabian' ? 'Supplier 1' : c.id.replace('company-', 'Supplier ')}<input name="${c.id}" value="${esc(state.companyMeta[c.id]?.name || c.name)}"></label>`).join('')}<button class="button ghost" type="submit">Save supplier names</button></form></div><div class="panel wide-panel"><span class="eyebrow">PAYMENT REMINDERS</span><h3>WhatsApp reminders for unpaid invoices</h3><form id="reminder-form" class="form"><div class="form-cols"><label>Remind after (days since the invoice)<input name="schedule" value="${esc(reminderSettings().schedule)}" placeholder="1, 2, 7"><small>1, 2, 7 means a first reminder the day after the invoice, a second on day 2 and a third on day 7.</small></label><label>Then repeat every (days)<input name="repeatEvery" type="number" min="0" max="365" step="1" value="${esc(reminderSettings().repeatEvery)}"><small>Use 0 to stop after the last reminder.</small></label></div><label>Country code for numbers saved without one<input name="countryCode" value="${esc(state.settings.countryCode || '92')}" inputmode="numeric"><small>With 92, the number 0300-1234567 becomes +92 300 1234567.</small></label><label>Message<textarea name="template" rows="6">${esc(reminderSettings().template)}</textarea><small>Available fields: {name} {invoice} {amount} {total} {paid} {date} {days} {shop}</small></label><div class="modal-actions"><button class="button ghost" type="button" data-action="reset-reminder-text">Reset message</button><button class="button primary" type="submit">Save reminder settings</button></div></form></div></section>`; }

  function openModal(html, cls = '') { document.querySelector('.modal-backdrop')?.remove(); const el = document.createElement('div'); el.className = `modal-backdrop ${cls}`; el.innerHTML = `<div class="modal">${html}<button class="modal-close" data-close>×</button></div>`; document.body.appendChild(el); el.querySelector('input:not([type="hidden"]), textarea, select')?.focus(); return el; }
  function productModal(id) { const p = product(id); if (!p) { toast('This fragrance is no longer available'); return; } const c = state.companyMeta[p.companyId]?.name || company(p.companyId).name; openModal(`<span class="eyebrow">${esc(c)} · ${esc(p.serial)}</span><h2>${esc(p.name)}</h2><div class="detail-grid">${[['Supplier', c], ['Serial number', p.serial], ['Code', p.code], ['Price / kg', money(p.priceKg)], ['Price / gram', money(p.perGram)], ['Price / 25g', money(p.price25g)], ['Price / 100g', money(p.price100g)], ['Size / weight', p.size || 'Not supplied'], ['Stock', p.stock == null || p.stock === '' ? 'Not set' : p.stock > 0 ? p.stock : 'Out of stock'], ['Notes', p.notes || '—']].map(x => `<div><small>${esc(x[0])}</small><strong>${esc(x[1])}</strong></div>`).join('')}</div><div class="modal-actions"><button class="button ghost" data-action="share-product" data-id="${id}">Share</button><button class="button ghost" data-action="edit-product" data-id="${id}">Edit</button><button class="button danger" data-action="delete-product" data-id="${id}">Remove</button></div>`); }
  function productForm(cid, id = '') { const p = id ? product(id) : {}; const defaultSerial = nextSerial(cid); openModal(`<span class="eyebrow">${id ? 'EDIT FRAGRANCE' : 'NEW FRAGRANCE'}</span><h2>${id ? 'Update fragrance' : 'Add fragrance'}</h2><form id="product-form" class="form"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="companyId" value="${esc(cid)}"><label>Name / bilingual name<input name="name" value="${esc(p.name)}" placeholder="Optional name"></label><label>Code<input name="code" value="${esc(p.code)}" placeholder="Generated automatically"></label><label>Serial number<input name="serial" value="${esc(p.serial)}" placeholder="${esc(defaultSerial)}"></label><div class="form-cols"><label>Price / kg<input name="priceKg" type="number" min="0" step="any" value="${p.priceKg || ''}"></label><label>Price / gram<input name="perGram" type="number" min="0" step="any" value="${p.perGram || ''}"></label></div><div class="form-cols"><label>Price / 25g<input name="price25g" type="number" min="0" step="any" value="${p.price25g || ''}"></label><label>Price / 100g<input name="price100g" type="number" min="0" step="any" value="${p.price100g || ''}"></label></div><p class="form-hint">Type the price per kg and the other prices fill in by themselves (÷ 1000 per gram, ÷ 40 per 25g, ÷ 10 per 100g). You can still adjust any of them.</p><div class="form-cols"><label>Size / weight<input name="size" value="${esc(p.size)}"></label><label>Stock<input name="stock" type="number" min="0" step="1" value="${p.stock ?? ''}" placeholder="Not set"></label></div><label>Notes / supplied metrics<textarea name="notes">${esc(p.notes)}</textarea></label><button class="button primary" type="submit">${id ? 'Save changes' : 'Add fragrance'}</button></form>`); }
  function customerForm(id = '') {
    const c = id ? customer(id) : null;
    openModal(`<span class="eyebrow">${c ? 'EDIT CUSTOMER' : 'NEW CUSTOMER'}</span><h2>${c ? 'Update customer record' : 'Add customer record'}</h2><form id="customer-form" class="form"><input type="hidden" name="id" value="${esc(id)}"><label>Customer key<input name="key" required placeholder="001-abbas" value="${esc(c?.key)}"></label><label>Full name<input name="name" required value="${esc(c?.name)}"></label><div class="form-cols"><label>Phone (WhatsApp)<input name="phone" placeholder="0300-1234567" value="${esc(c?.phone)}"></label><label>Account number<input name="account" value="${esc(c?.account)}"></label></div><label>Address<textarea name="address">${esc(c?.address)}</textarea></label><button class="button primary" type="submit">${c ? 'Save changes' : 'Save customer'}</button></form>`);
  }
  function invoiceCustomer(data) { if (data.customerId !== '__new__') return customer(data.customerId); const key = data.newKey?.trim(), name = data.newName?.trim(); if (!key || !name) { toast('Enter a customer key and name'); return null; } if (state.customers.some(c => c.key.toLowerCase() === key.toLowerCase())) { toast('That customer key already exists'); return null; } const newCustomer = { id: `customer-${Date.now()}`, key, name, phone: data.newPhone?.trim() || '', account: data.newAccount?.trim() || '', address: data.newAddress?.trim() || '' }; state.customers.push(newCustomer); return newCustomer; }
  function invoiceLineHtml(companyId = 'arabian', productId = '', qty = 1, price = '', snap = null) { return `<div class="invoice-line"><select name="companyId" aria-label="Supplier">${supplierOptions(companyId)}</select><input class="invoice-search" type="search" placeholder="Search fragrance…" aria-label="Search fragrance"><select name="productId" required aria-label="Fragrance"><option value="">Select fragrance…</option>${productOptions(companyId, productId)}${productId && snap && !product(productId) ? `<option value="${esc(productId)}" selected>${esc(snap.name)} · ${esc(snap.serial)} · no longer in catalog</option>` : ''}</select><input name="qty" type="number" min="1" step="1" value="${qty}" aria-label="Quantity"><input name="price" type="number" min="0" step="0.01" value="${price}" placeholder="${esc(product(productId)?.price25g ?? 'Price')}" aria-label="Price"><button class="line-remove" type="button" data-action="remove-line" aria-label="Remove item" title="Remove item">×</button></div>`; }
  function invoiceForm(customerId = '', orderId = '') { const order = orderId ? state.orders.find(o => o.id === orderId) : null, selectedCustomer = order?.customerId || customerId, hasSelectedCustomer = state.customers.some(c => c.id === selectedCustomer), customerOptions = state.customers.length ? `<optgroup label="Existing customers">${state.customers.map(c => `<option value="${c.id}" ${c.id === selectedCustomer ? 'selected' : ''}>${esc(c.key)} · ${esc(c.name)}</option>`).join('')}</optgroup>` : '', lines = order ? order.items.map(i => invoiceLineHtml(product(i.productId)?.companyId || companies.find(c => supplierName(c.id) === i.company)?.id || 'arabian', i.productId, i.qty, i.price, i)).join('') : invoiceLineHtml(); openModal(`<span class="eyebrow">MIXED-COMPANY ORDER</span><h2>${order ? 'Edit invoice' : 'Create invoice'}</h2><form id="invoice-form" class="form"><input type="hidden" name="orderId" value="${esc(orderId)}"><label>Customer<select name="customerId" required><option value="__new__" ${hasSelectedCustomer ? '' : 'selected'}>＋ Create new customer</option>${customerOptions}</select></label><div class="invoice-new-customer" ${hasSelectedCustomer ? 'hidden' : ''}><span class="invoice-help">Create the customer while preparing this invoice.</span><div class="form-cols"><label>Customer key<input name="newKey" placeholder="001-abbas"></label><label>Full name<input name="newName" placeholder="Customer name"></label></div><div class="form-cols"><label>Phone<input name="newPhone"></label><label>Account number<input name="newAccount"></label></div><label>Address<textarea name="newAddress"></textarea></label></div><p class="invoice-help">Choose an existing customer or create a new one, then choose the supplier and fragrance.</p><div id="invoice-lines">${lines}</div><button class="button ghost" type="button" data-action="add-line">＋ Add another item</button><label>Payment received<input name="paid" type="number" min="0" step="0.01" value="${order?.paid || 0}"></label><label>Notes<textarea name="notes">${esc(order?.notes || '')}</textarea></label><button class="button primary" type="submit">${order ? 'Save invoice changes' : 'Save invoice & print'}</button></form>`, 'wide'); }
  function lineHtml() { return invoiceLineHtml(); }
  function exportRows(rows, filename) { const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); download(new Blob(['\uFEFF' + csv], { type: 'application/vnd.ms-excel;charset=utf-8' }), `${filename}.xls`); }
  function exportCatalog(cid) { const ps = state.products.filter(p => p.companyId === cid), supplierName = state.companyMeta[cid]?.name || company(cid).name; exportRows([['Serial', 'Supplier', 'Name', 'Code', 'Price/kg', 'Price/gram', 'Price/25g', 'Price/100g', 'Size/weight', 'Stock', 'Notes'], ...ps.map(p => [p.serial, supplierName, p.name, p.code, p.priceKg, p.perGram, p.price25g, p.price100g, p.size, p.stock, p.notes])], `${supplierName}-catalog`); }
  function exportCatalogPdf(cid) {
    const ps = state.products.filter(p => p.companyId === cid);
    const supplierName = state.companyMeta[cid]?.name || company(cid).name;
    if (!ps.length) { toast('No fragrances to include in this catalog'); return; }
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to download the catalog PDF'); return; }
    const rows = ps.map(p => `<tr><td>${esc(p.serial || '—')}</td><td>${esc(p.name)}</td><td>${esc(p.code || '—')}</td><td>${money(p.price25g)}<small> / 25g</small></td><td>${money(p.price100g)}<small> / 100g</small></td><td>${p.stock == null || p.stock === '' ? '—' : esc(p.stock)}</td></tr>`).join('');
    w.document.write(`<html><head><title>${esc(supplierName)} Fragrance Catalog</title><style>@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#243238;margin:0}.catalog{max-width:850px;margin:auto}.header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c5a45c;padding-bottom:16px;margin-bottom:18px}.brand{display:flex;align-items:center;gap:12px}.brand img{width:52px;height:52px;object-fit:contain}.brand strong{display:block;font:600 21px Georgia,serif}.brand small{display:block;color:#92713a;margin-top:4px}.header>div:last-child{text-align:right}.header h1{font:600 22px Georgia,serif;margin:0}.header p{color:#7a8788;margin:6px 0 0}table{width:100%;border-collapse:collapse}th{background:#24363d;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.6px;padding:9px 7px;text-align:left}td{border-bottom:1px solid #e3e5e2;padding:10px 7px;vertical-align:top}td small{display:block;color:#7a8788}tbody tr:nth-child(even){background:#faf9f6}.count{margin-top:12px;color:#7a8788;text-align:right;font-size:10px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><div class="catalog"><div class="header"><div class="brand"><img src="${esc(state.settings.logo || 'logo.jpg')}"><div><strong>${esc(trademarkName(state.settings.name))}</strong><small>${esc(state.settings.phone || 'FRAGRANCE CATALOG')}</small></div></div><div><h1>${esc(supplierName)}</h1><p>${new Date().toLocaleDateString()} · ${ps.length} fragrances</p></div></div><table><thead><tr><th>Serial</th><th>Fragrance</th><th>Code</th><th>25g price</th><th>100g price</th><th>Stock</th></tr></thead><tbody>${rows}</tbody></table><div class="count">${esc(state.settings.address || '')}</div></div></body></html>`);
    w.document.close();
    w.focus();
    printWhenReady(w);
  }
  function exportCustomer(id) { const c = customer(id), os = state.orders.filter(o => o.customerId === id); exportRows([['Customer key', c.key], ['Name', c.name], ['Phone', c.phone], ['Account', c.account], ['Address', c.address], [], ['Invoice', 'Date', 'Items', 'Total', 'Paid', 'Remaining'], ...os.map(o => [o.number, o.date, o.items.length, o.total, o.paid, o.total - o.paid])], `${c.key}-record`); }
  function invoicePrint(id) { const o = state.orders.find(x => x.id === id); if (!o) return toast('Invoice not found'); const c = customer(o.customerId); if (!c) return toast('Customer record not found'); const html =  `<div class="print-invoice"><header><div class="print-brand"><img src="${esc(state.settings.logo || 'logo.jpg')}" alt="${esc(trademarkName(state.settings.name))} logo"><div><strong>${esc(trademarkName(state.settings.brand))}</strong><small>${esc(trademarkName(state.settings.name))}</small></div></div><div class="print-meta"><b>INVOICE</b><span>${esc(o.number)}</span><span>${new Date(o.date).toLocaleDateString()}</span></div></header><section class="print-customer"><span>PREPARED FOR</span><strong>${esc(c.name)} · ${esc(c.key)}</strong><p>${esc(c.phone || '')}${c.phone && c.address ? ' · ' : ''}${esc(c.address || '')}<br>Account: ${esc(c.account || '—')}</p></section><table><thead><tr><th>Product</th><th>Supplier</th><th>Serial</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${o.items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.company)}</td><td>${esc(i.serial)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.total)}</td></tr>`).join('')}</tbody></table><div class="print-summary"><div><span>Notes</span><p>${esc(o.notes || 'Thank you for choosing us.')}</p></div><p><span>Subtotal</span><b>${money(o.total)}</b><span>Paid</span><b>${money(o.paid)}</b><span class="due-label">Balance due</span><b class="due-value">${money(o.total - o.paid)}</b></p></div><footer>${esc(state.settings.address)}${state.settings.address && state.settings.phone ? ' · ' : ''}${esc(state.settings.phone)}<br>Thank you for choosing ${esc(trademarkName(state.settings.name))}.</footer></div>`;   const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print the invoice'); return; } w.document.write(`<title>${esc(o.number)} · ${esc(trademarkName(state.settings.brand))}</title><style>@page{size:auto;margin:14mm}*{box-sizing:border-box}body{background:#fff;color:#243238;padding:0;margin:0;font:13px Arial,sans-serif}.print-invoice{max-width:850px;margin:auto}.print-invoice header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #d5bd85;padding-bottom:22px}.print-brand{display:flex;align-items:center;gap:13px;font-size:21px;color:#1f3036}.print-brand img,.print-mark{width:52px;height:52px;object-fit:contain}.print-mark{display:grid;place-items:center;background:#1f3036;color:#e5c986;border-radius:14px;font-weight:bold;letter-spacing:1px}.print-brand strong,.print-brand small,.print-meta span,.print-customer span,.print-summary span{display:block}.print-brand small{color:#8a7650;font-size:10px;letter-spacing:1.5px;margin-top:4px}.print-meta{text-align:right;display:grid;gap:5px;color:#68757a}.print-meta b{color:#a17835;letter-spacing:2px;font-size:12px}.print-meta span:first-of-type{color:#243238;font-weight:bold}.print-customer{margin:28px 0}.print-customer span,.print-summary span{color:#a17835;letter-spacing:1.5px;font-size:9px;font-weight:bold}.print-customer strong{display:block;font-size:16px;margin:7px 0}.print-customer p{color:#68757a;line-height:1.6;margin:0}.print-invoice table{width:100%;border-collapse:collapse;margin:28px 0}.print-invoice th{background:#f4f0e7;color:#756447;font-size:10px;letter-spacing:.5px;text-transform:uppercase}.print-invoice th,.print-invoice td{padding:12px 10px;border-bottom:1px solid #e6e1d7;text-align:left}.print-invoice td:nth-last-child(-n+2),.print-invoice th:nth-last-child(-n+2){text-align:right}.print-summary{display:flex;justify-content:space-between;gap:30px;border-top:1px solid #d5bd85;padding-top:18px}.print-summary>div{max-width:55%}.print-summary p{margin:0;color:#68757a;line-height:1.7}.print-summary>p{display:grid;grid-template-columns:auto auto;gap:5px 25px;text-align:right}.print-summary>p b{color:#243238}.print-summary .due-label,.print-summary .due-value{color:#a17835}.print-invoice footer{text-align:center;color:#8a9698;border-top:1px solid #e6e1d7;margin-top:35px;padding-top:16px;line-height:1.6}@media print{body{padding:0}.print-invoice{max-width:none}}</style>${html}`); w.document.close(); printWhenReady(w); }

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]'); if (!a) return; const action = a.dataset.action;
    if (action === 'toggle-sidebar' || action === 'close-sidebar') { document.body.classList.toggle('sidebar-open', action === 'toggle-sidebar'); const toggle = document.querySelector('.menu-toggle'); if (toggle) toggle.setAttribute('aria-expanded', String(document.body.classList.contains('sidebar-open'))); } if (action === 'quick-order') invoiceForm(a.dataset.customer || ''); if (action === 'toggle-theme') { state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = state.settings.theme; save(); render(); } if (action === 'edit-invoice') invoiceForm('', a.dataset.id); if (action === 'delete-invoice') { const order = state.orders.find(o => o.id === a.dataset.id); if (order && order.paid >= order.total && confirm('Delete this paid invoice permanently?')) { state.orders = state.orders.filter(o => o.id !== order.id); save(); render(); toast('Invoice deleted'); } } if (action === 'add-customer') customerForm(); if (action === 'edit-customer') customerForm(a.dataset.id); if (action === 'delete-customer') deleteCustomer(a.dataset.id); if (action === 'import-backup') document.querySelector('#backup-file')?.click(); if (action === 'remove-line') removeLine(a);
    if (action === 'share-list') shareForm({ supplier: a.dataset.company });
    if (action === 'share-product') { document.querySelector('.modal-backdrop')?.remove(); shareForm({ ids: [a.dataset.id], supplier: product(a.dataset.id)?.companyId }); }
    if (action === 'share-customer') shareForm({ customerId: a.dataset.id });
    if (action === 'share-whatsapp') shareAction('whatsapp');
    if (action === 'share-copy') shareAction('copy');
    if (action === 'share-print') shareAction('print');
    if (action === 'share-reset') { const f = document.querySelector('#share-form'); if (f) shareRefresh(f, true); }
    if (action === 'share-clear') { const f = document.querySelector('#share-form'); if (f) { f.querySelectorAll('input[name="pick"]').forEach(i => { i.checked = false; }); shareRefresh(f); } }
    if (action === 'share-select-shown') { const f = document.querySelector('#share-form'); if (f) { f.querySelectorAll('.share-item:not([hidden]) input[name="pick"]').forEach(i => { i.checked = true; }); shareRefresh(f); } }
    if (action === 'send-reminder') sendReminder(a.dataset.id);
    if (action === 'snooze-reminder') { const o = state.orders.find(x => x.id === a.dataset.id); if (o) { o.snoozeUntil = new Date(Date.now() + DAY).toISOString(); save(); render(); toast('Reminder moved to tomorrow'); } }
    if (action === 'toggle-reminders') { const o = state.orders.find(x => x.id === a.dataset.id); if (o) { o.noReminders = !o.noReminders; if (!o.noReminders) delete o.noReminders; save(); render(); toast(o.noReminders ? 'Reminders stopped for this invoice' : 'Reminders resumed'); } }
    if (action === 'reset-reminder-text') { const t = document.querySelector('#reminder-form [name="template"]'); if (t) t.value = DEFAULT_REMINDER_TEXT; } if (action === 'product-detail') productModal(a.dataset.id); if (action === 'add-product') productForm(a.dataset.company); if (action === 'edit-product') { document.querySelector('.modal-backdrop')?.remove(); const p = product(a.dataset.id); if (p) productForm(p.companyId, p.id); } if (action === 'delete-product' && confirm('Remove this fragrance from the catalog?')) { state.products = state.products.filter(p => p.id !== a.dataset.id); save(); document.querySelector('.modal-backdrop')?.remove(); render(); toast('Fragrance removed'); } if (action === 'close') document.querySelector('.modal-backdrop')?.remove(); if (action === 'add-line') document.querySelector('#invoice-lines').insertAdjacentHTML('beforeend', lineHtml()); if (action === 'export-catalog') exportCatalog(a.dataset.company); if (action === 'export-catalog-pdf') exportCatalogPdf(a.dataset.company); if (action === 'export-customer') exportCustomer(a.dataset.id); if (action === 'invoice') invoicePrint(a.dataset.id); if (action === 'export-backup') { download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'amf-backup.json'); }
  });
  document.addEventListener('submit', e => {
    e.preventDefault(); const f = e.target, data = Object.fromEntries(new FormData(f)), formId = f.getAttribute('id');
    if (formId === 'product-form') {
      const stamp = `${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const name = (data.name || '').trim() || 'New fragrance';
      const code = (data.code || '').trim() || `CODE-${stamp}`;
      const original = data.id ? product(data.id) : null, typedSerial = (data.serial || '').trim();
      if (typedSerial && typedSerial.toLowerCase() !== String(original?.serial || '').toLowerCase() && state.products.some(p => String(p.serial || '').toLowerCase() === typedSerial.toLowerCase())) return toast('That serial number is already used by another fragrance');
      const serial = typedSerial || original?.serial || nextSerial(data.companyId);
      const priceKg = round(Math.max(0, +data.priceKg || 0));
      const kgChanged = !!original && priceKg > 0 && priceKg !== (Number(original.priceKg) || 0);
      const typed = k => (kgChanged && (+data[k] || 0) === (Number(original[k]) || 0)) ? 0 : (+data[k] || 0);
      const auto = metricsFromKg(priceKg || (+data.perGram || 0) * 1000), perGram = round(Math.max(0, typed('perGram') || auto.perGram), 4);
      const item = { ...data, name, code, serial, priceKg, perGram, price25g: round(Math.max(0, typed('price25g') || auto.price25g)), price100g: round(Math.max(0, typed('price100g') || auto.price100g)), stock: String(data.stock ?? '').trim() === '' ? null : Math.max(0, Math.floor(+data.stock) || 0), size: data.size.trim(), notes: data.notes.trim() };
      if (data.id) state.products = state.products.map(p => p.id === data.id ? { ...p, ...item } : p);
      else state.products.push({ ...item, id: `${data.companyId}-${stamp}-${Math.random().toString(36).slice(2, 7)}` });
      save(); f.closest('.modal-backdrop')?.remove(); render(); toast(data.id ? 'Fragrance updated' : 'Fragrance added');
    }
    if (formId === 'customer-form') {
      const customerRecord = { ...data, key: data.key.trim(), name: data.name.trim(), phone: data.phone.trim(), account: data.account.trim(), address: data.address.trim() };
      if (!customerRecord.key || !customerRecord.name) return toast('Customer key and name are required');
      if (state.customers.some(c => c.id !== data.id && c.key.toLowerCase() === customerRecord.key.toLowerCase())) return toast('That customer key already exists');
      const editingCustomer = data.id ? customer(data.id) : null;
      if (editingCustomer) {
        Object.assign(editingCustomer, { key: customerRecord.key, name: customerRecord.name, phone: customerRecord.phone, account: customerRecord.account, address: customerRecord.address });
        state.orders.forEach(o => { if (o.customerId === editingCustomer.id) o.customerName = editingCustomer.name; });
      } else state.customers.push({ ...customerRecord, id: `customer-${Date.now()}` });
      save(); f.closest('.modal-backdrop')?.remove(); render(); toast(editingCustomer ? 'Customer updated' : 'Customer saved');
    }
    if (formId === 'invoice-form') {
      const selects = [...f.querySelectorAll('select[name="productId"]')], qtyInputs = [...f.querySelectorAll('input[name="qty"]')], priceInputs = [...f.querySelectorAll('input[name="price"]')];
      if (!selects.length || selects.some(s => !s.value)) return toast('Select a fragrance for every invoice line');
      const editing = data.orderId ? state.orders.find(o => o.id === data.orderId) : null;
      const items = selects.map((s, i) => {
        const p = product(s.value);
        if (!p) {
          const snap = editing?.items.find(x => x.productId === s.value);
          if (!snap) return null;
          const qty = Math.max(1, Math.floor(+qtyInputs[i].value || 1)), price = Math.max(0, priceInputs[i].value !== '' ? +priceInputs[i].value : snap.price);
          return { ...snap, qty, price, total: round(qty * price) };
        }
        const qty = Math.max(1, Math.floor(+qtyInputs[i].value || 1));
        const price = Math.max(0, priceInputs[i].value !== '' ? +priceInputs[i].value : p.price25g);
        return { productId: p.id, name: p.name, company: state.companyMeta[p.companyId]?.name || company(p.companyId).name, serial: p.serial, qty, price, total: round(qty * price) };
      });
      if (items.some(i => !i)) return toast('One of the selected fragrances is no longer available');
      const total = round(items.reduce((s, i) => s + i.total, 0)), paid = round(Math.max(0, +data.paid || 0));
      if (paid > total) return toast(`Payment (${money(paid)}) cannot be more than the invoice total (${money(total)})`);
      const c = invoiceCustomer(data), existing = data.orderId ? state.orders.find(o => o.id === data.orderId) : null;
      if (!c) return;
      if (existing) Object.assign(existing, { customerId: c.id, customerName: c.name, items, total, paid, notes: data.notes });
      else {
        const o = { id: `order-${Date.now()}`, number: nextInvoiceNumber(), date: new Date().toISOString(), customerId: c.id, customerName: c.name, items, total, paid, notes: data.notes };
        state.orders.push(o);
      }
      save(); f.closest('.modal-backdrop')?.remove(); render();
      if (!existing) invoicePrint(state.orders[state.orders.length - 1].id); else toast('Invoice updated');
    }
    if (formId === 'settings-form') {
      state.settings = { ...state.settings, name: data.name.trim(), brand: data.brand.trim(), phone: data.phone.trim(), address: data.address.trim() };
      const file = f.elements.logo.files[0];
      if (file && !/^image\//.test(file.type)) { toast('Please choose an image file for the logo'); return; }
      if (file) {
        const reader = new FileReader();
        reader.onload = async () => {
          const previousLogo = state.settings.logo; state.settings.logo = await shrinkImage(reader.result, file.type);
          if (save()) { render(); toast('Settings saved'); }
          else { state.settings.logo = previousLogo; saveFailed = false; save(); render(); toast('That logo is too large to store in the browser. Other settings were saved; please choose a smaller image.'); }
        };
        reader.onerror = () => { save(); render(); toast('Could not read that image file'); };
        reader.readAsDataURL(file);
      } else { save(); render(); toast('Settings saved'); }
    }
    if (formId === 'reminder-form') {
      if (!/\d/.test(String(data.schedule || ''))) return toast('Enter at least one day, for example 1, 2, 7');
      const countryCode = String(data.countryCode || '').replace(/\D/g, '');
      if (!countryCode || countryCode.length > 4) return toast('Enter the country code as digits only, for example 92');
      if (!String(data.template || '').trim()) return toast('The reminder message cannot be empty');
      state.settings.countryCode = countryCode;
      state.settings.reminders = { schedule: parseSchedule(data.schedule).join(', '), repeatEvery: Math.max(0, Math.min(365, Math.floor(+data.repeatEvery || 0))), template: String(data.template).trim() };
      save(); render(); toast('Reminder settings saved');
    }
    if (formId === 'companies-form') { companies.forEach(c => state.companyMeta[c.id] = { ...state.companyMeta[c.id], name: String(data[c.id] ?? '').trim() }); save(); render(); toast('Suppliers updated'); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'product-search') {
      const q = e.target.value.toLowerCase();
      let visible = 0;
      document.querySelectorAll('.product-card').forEach(x => { const matches = x.dataset.search.includes(q); x.hidden = !matches; if (matches) visible++; });
      const empty = document.querySelector('#catalog-empty');
      if (empty) empty.hidden = visible !== 0;
    }
    if (e.target.id === 'customer-search') {
      const q = e.target.value.toLowerCase();
      let visible = 0;
      document.querySelectorAll('.customer-card').forEach(x => { const matches = x.dataset.search.includes(q); x.hidden = !matches; if (matches) visible++; });
      const empty = document.querySelector('#customer-empty');
      if (empty) empty.hidden = visible !== 0;
    }
  });
  document.addEventListener('input', e => { if (e.target.matches('#invoice-lines .invoice-search')) { const row = e.target.closest('.invoice-line'), supplier = row.querySelector('select[name="companyId"]').value, productSelect = row.querySelector('select[name="productId"]'), keepValue = productSelect.value, keepOption = keepValue ? productSelect.selectedOptions[0]?.cloneNode(true) : null; productSelect.innerHTML = `<option value="">Select fragrance…</option>${productOptions(supplier, keepValue, e.target.value)}`; if (keepOption && ![...productSelect.options].some(o => o.value === keepValue)) { productSelect.add(keepOption, 1); productSelect.value = keepValue; } } });
  document.addEventListener('change', e => { if (e.target.matches('#invoice-lines select[name="companyId"]')) { const row = e.target.closest('.invoice-line'), productSelect = row.querySelector('select[name="productId"]'); row.querySelector('.invoice-search').value = ''; productSelect.innerHTML = `<option value="">Select fragrance…</option>${productOptions(e.target.value)}`; } if (e.target.matches('#invoice-form select[name="customerId"]')) { const form = e.target.form, isNew = e.target.value === '__new__', fields = form.querySelector('.invoice-new-customer'); fields.hidden = !isNew; fields.querySelector('[name="newKey"]').required = isNew; fields.querySelector('[name="newName"]').required = isNew; } });
  document.addEventListener('click', e => { if (e.target.matches('[data-close]') || e.target.classList.contains('modal-backdrop')) e.target.closest('.modal-backdrop')?.remove(); });
  window.addEventListener('hashchange', render);
  document.addEventListener('change', e => {
    if (e.target.matches('#invoice-lines select[name="productId"]')) { const hint = product(e.target.value); e.target.closest('.invoice-line').querySelector('input[name="price"]').placeholder = hint ? String(hint.price25g) : 'Price'; }
    if (e.target.id === 'backup-file') importBackup(e.target);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { document.querySelector('.modal-backdrop')?.remove(); document.body.classList.remove('sidebar-open'); } });
  document.addEventListener('input', e => {
    if (e.target.matches('#product-form [name="priceKg"]')) {   // fill the other prices as the price per kg is typed
      const kg = Number(e.target.value), f = e.target.form;
      if (kg > 0) { const m = metricsFromKg(kg); f.elements.perGram.value = m.perGram; f.elements.price25g.value = m.price25g; f.elements.price100g.value = m.price100g; }
    }
    const share = e.target.closest('#share-form');
    if (share) {
      if (e.target.id === 'share-search') shareFilter(share);
      else if (e.target.id === 'share-text') e.target.dataset.edited = '1';
      else if (e.target.name === 'title') shareRefresh(share);
    }
  });
  document.addEventListener('change', e => {
    const share = e.target.closest('#share-form');
    if (!share) return;
    if (e.target.id === 'share-supplier') shareFilter(share);
    else if (['pick', 'field', 'customerId'].includes(e.target.name)) shareRefresh(share);
  });
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) { state = load(); document.documentElement.dataset.theme = state.settings.theme || 'light'; render(); } });
  render();
})();
