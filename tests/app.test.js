// Run with: npm test
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { boot, STORAGE_KEY } = require('./harness');

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const stored = w => JSON.parse(w.localStorage.getItem(STORAGE_KEY) || '{}');
const go = async (w, hash) => { w.location.hash = hash; await tick(); };
const open = async (w, selector) => { w.document.querySelector(selector).click(); await tick(5); };
async function submit(w, selector, values = {}) {
  const form = w.document.querySelector(selector);
  for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
  form.requestSubmit(); await tick();
  return form;
}
// Creates an invoice for a new customer through the UI (arabian-1 costs 1,600 per unit).
async function makeInvoice(w, { paid = 0, qty = 1, key } = {}) {
  const d = w.document, n = (stored(w).customers || []).length + 1;
  await open(w, '[data-action="quick-order"]');
  const f = d.querySelector('#invoice-form');
  f.elements.customerId.value = '__new__'; f.elements.newKey.value = key || `00${n}-t`; f.elements.newName.value = `Customer ${n}`;
  f.querySelector('select[name=productId]').value = 'arabian-1';
  f.elements.qty.value = String(qty); f.elements.paid.value = String(paid);
  f.requestSubmit(); await tick();
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ───────────────────────────── Catalog / fragrances ─────────────────────────────
test('Forms are identified with getAttribute("id"), never form.id', async () => {
  // In browsers a control named "id" (the hidden field in the product/customer forms) shadows form.id, which
  // once made Add/Edit fragrance silently do nothing. jsdom does not reproduce that, so guard the source.
  const source = require('node:fs').readFileSync(require('node:path').join(require('./harness').ROOT, 'app.js'), 'utf8');
  assert.doesNotMatch(source, /\b(f|form)\.id\b/, 'use form.getAttribute("id") instead of form.id');
  assert.match(source, /getAttribute\('id'\)/);
});

test('Add fragrance saves, closes the form and uses the serial shown in the form', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian');
  const before = d.querySelectorAll('.product-card').length;
  await open(w, '[data-action="add-product"]');
  const placeholder = d.querySelector('#product-form [name=serial]').placeholder;
  await submit(w, '#product-form', { name: 'Test Oud', priceKg: '36363' });
  assert.equal(d.querySelectorAll('.product-card').length, before + 1);
  assert.equal(d.querySelector('.modal-backdrop'), null);
  const added = stored(w).products.at(-1);
  assert.equal(added.serial, placeholder);
  assert.deepEqual([added.perGram, added.price25g, added.price100g], [36.363, 909.08, 3636.3]);
  assert.equal(added.stock, null);
});

test('Edit fragrance saves; derived prices follow price/kg unless typed explicitly', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian');
  const edit = async values => { await open(w, '.card-open'); await open(w, '[data-action="edit-product"]'); await submit(w, '#product-form', values); return stored(w).products.find(p => p.id === 'arabian-1'); };
  assert.equal((await edit({ notes: 'edited' })).notes, 'edited');
  let p = await edit({ priceKg: '70000' });
  assert.deepEqual([p.perGram, p.price25g, p.price100g], [70, 1750, 7000]);
  p = await edit({ priceKg: '80000', price25g: '1999' });
  assert.deepEqual([p.perGram, p.price25g, p.price100g], [80, 1999, 8000]);
  p = await edit({ priceKg: '' });
  assert.deepEqual([p.perGram, p.price25g], [80, 1999], 'clearing price/kg must not wipe other prices');
});

test('A serial number already used by another fragrance is rejected', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian');
  await open(w, '[data-action="add-product"]');
  await submit(w, '#product-form', { name: 'Duplicate serial', serial: 'ar-002' });
  assert.equal(stored(w).products, undefined, 'nothing should have been saved');
  assert.ok(d.querySelector('.modal-backdrop'));
});

test('Every bundled fragrance has a unique serial (rows 14A/14B are AR-014A/AR-014B)', async () => {
  const w = boot(); await go(w, '#/catalog/arabian');
  const serials = [...w.document.querySelectorAll('.product-card .product-no')].map(n => n.textContent);
  assert.equal(new Set(serials).size, serials.length);
  assert.ok(serials.includes('AR-014A') && serials.includes('AR-014B'));
});

test('Stock: blank = not set, 0 = out of stock, N = in stock', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian');
  assert.match(d.querySelector('.product-card').textContent, /Stock not set/);
  const setStock = async value => { await open(w, '.card-open'); await open(w, '[data-action="edit-product"]'); await submit(w, '#product-form', { stock: value }); return d.querySelector('.product-card').textContent; };
  assert.match(await setStock('0'), /Out of stock/);
  assert.match(await setStock('12'), /12 in stock/);
  assert.match(await setStock(''), /Stock not set/);
});

test('Data saved by an older version is migrated (stock 0 -> not set, duplicate serials fixed)', async () => {
  const legacy = { settings: { theme: 'dark' }, customers: [], orders: [{ id: 'o1', number: 'AMF-2026-0001', items: [{ productId: 'arabian-14A', serial: 'AR-14/15', name: 'x', qty: 1, price: 1, total: 1 }], total: 1, paid: 0, customerId: 'c', date: '2026-01-01' }],
    products: [{ id: 'arabian-14A', companyId: 'arabian', name: 'a', serial: 'AR-14/15', stock: 0 }, { id: 'arabian-14B', companyId: 'arabian', name: 'b', serial: 'AR-14/15', stock: 0 }, { id: 'arabian-1', companyId: 'arabian', name: 'c', serial: 'AR-001', stock: 5 }] };
  const w = boot(legacy); await go(w, '#/catalog/arabian'); w.document.querySelector('[data-action="toggle-theme"]').click(); await tick();
  const s = stored(w);
  assert.equal(s.version, 2);
  assert.deepEqual(s.products.map(p => [p.serial, p.stock]), [['AR-014A', null], ['AR-014B', null], ['AR-001', 5]]);
  assert.equal(s.orders[0].items[0].serial, 'AR-14/15', 'issued invoices must never be rewritten');
});

// ───────────────────────────── Invoices ─────────────────────────────
test('Invoice numbers stay unique after deleting an older invoice', async () => {
  const w = boot(), d = w.document; await go(w, '#/billing');
  await makeInvoice(w, { paid: 1600 }); await makeInvoice(w, { paid: 1600 });
  await go(w, '#/billing');
  [...d.querySelectorAll('[data-action="delete-invoice"]')].pop().click(); await tick();
  await makeInvoice(w);
  const numbers = stored(w).orders.map(o => o.number);
  assert.equal(new Set(numbers).size, numbers.length, numbers.join(', '));
});

test('A payment larger than the invoice total is rejected and creates nothing', async () => {
  const w = boot(); await go(w, '#/billing');
  await makeInvoice(w, { paid: 99999 });
  assert.equal(stored(w).orders, undefined);
  assert.equal(stored(w).customers, undefined, 'no stray customer either');
  assert.match(w.document.querySelector('#toast').textContent, /cannot be more than/);
});

test('New invoice opens a print window that waits for the logo to load', async () => {
  const w = boot(), d = w.document; await go(w, '#/billing');
  let printed = 0; const img = new w.EventTarget(); img.complete = false;
  w.open = () => { const win = new JSDOM('<html><body></body></html>').window; win.print = () => { printed++; }; win.focus = () => {}; Object.defineProperty(win.document, 'images', { get: () => [img] }); return win; };
  await makeInvoice(w); await tick(400);
  assert.equal(printed, 0, 'must not print before the image loaded');
  img.dispatchEvent(new w.Event('load')); await tick(400);
  assert.equal(printed, 1);
});

test('An invoice stays editable after one of its fragrances was removed from the catalog', async () => {
  const w = boot(), d = w.document; await go(w, '#/billing'); await makeInvoice(w);
  await go(w, '#/catalog/arabian'); await open(w, '.card-open'); await open(w, '[data-action="delete-product"]');
  await go(w, '#/billing'); await open(w, '[data-action="edit-invoice"]');
  await submit(w, '#invoice-form', { notes: 'still editable' });
  assert.equal(stored(w).orders[0].notes, 'still editable');
});

test('Invoice lines: search keeps the choice, price hint follows the fragrance, lines can be removed', async () => {
  const w = boot(), d = w.document; await go(w, '#/billing'); await open(w, '[data-action="quick-order"]');
  const row = d.querySelector('.invoice-line'), select = row.querySelector('select[name=productId]');
  select.value = 'arabian-5'; select.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(row.querySelector('input[name=price]').placeholder, '2225');
  const search = row.querySelector('.invoice-search'); search.value = 'gucci'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(select.value, 'arabian-5');
  await open(w, '[data-action="add-line"]');
  assert.equal(d.querySelectorAll('.invoice-line').length, 2);
  d.querySelectorAll('.line-remove')[1].click();
  assert.equal(d.querySelectorAll('.invoice-line').length, 1);
  d.querySelector('.line-remove').click();
  assert.equal(d.querySelectorAll('.invoice-line').length, 1, 'the last line cannot be removed');
});

// ───────────────────────────── Customers ─────────────────────────────
test('Customers can be edited (invoices follow the new name) and deleted when they have no invoices', async () => {
  const w = boot(), d = w.document; await go(w, '#/billing'); await makeInvoice(w, { key: '001-abbas' });
  const id = stored(w).customers[0].id;
  await go(w, `#/customers/${id}`); await open(w, '[data-action="edit-customer"]');
  await submit(w, '#customer-form', { name: 'Abbas Renamed', phone: '0300' });
  assert.equal(stored(w).customers[0].name, 'Abbas Renamed');
  assert.equal(stored(w).orders[0].customerName, 'Abbas Renamed');
  await open(w, '[data-action="delete-customer"]');
  assert.equal(stored(w).customers.length, 1, 'customer with invoices must be kept');
  assert.match(d.querySelector('#toast').textContent, /has invoices/);
  await go(w, '#/customers'); await open(w, '[data-action="add-customer"]');
  await submit(w, '#customer-form', { key: '002-new', name: 'No Invoices' });
  const second = stored(w).customers.find(c => c.key === '002-new');
  await go(w, `#/customers/${second.id}`); await open(w, '[data-action="delete-customer"]');
  assert.equal(stored(w).customers.some(c => c.key === '002-new'), false);
  assert.equal(w.location.hash, '#/customers');
});

test('Customer keys must stay unique when editing', async () => {
  const w = boot(); await go(w, '#/billing'); await makeInvoice(w, { key: 'a-1' }); await makeInvoice(w, { key: 'b-2' });
  const second = stored(w).customers[1].id;
  await go(w, `#/customers/${second}`); await open(w, '[data-action="edit-customer"]');
  await submit(w, '#customer-form', { key: 'A-1' });
  assert.equal(stored(w).customers[1].key, 'b-2');
});

// ───────────────────────────── Backup / settings / misc ─────────────────────────────
test('Backups can be restored; invalid files are rejected', async () => {
  const src = boot(); await go(src, '#/billing'); await makeInvoice(src, { paid: 1600, key: 'k-1' });
  const backup = JSON.stringify(stored(src));
  const w = boot(), d = w.document; await go(w, '#/dashboard');
  const choose = async (text) => { const input = d.querySelector('#backup-file'); Object.defineProperty(input, 'files', { value: [new w.File([text], 'b.json')], configurable: true }); input.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(80); };
  await choose('not json'); assert.match(d.querySelector('#toast').textContent, /not valid JSON/);
  await choose('{"products":[]}'); assert.match(d.querySelector('#toast').textContent, /not an AMF data file/);
  assert.equal(stored(w).orders, undefined, 'a rejected file must not touch the data');
  await choose(backup);
  assert.match(d.querySelector('#toast').textContent, /Data file loaded/);
  assert.equal(stored(w).orders.length, 1); assert.equal(stored(w).customers[0].key, 'k-1');
});

test('A failed save is reported instead of crashing or claiming success', async () => {
  const w = boot(), d = w.document; await go(w, '#/customers');
  w.Storage.prototype.setItem = () => { throw new w.DOMException('full', 'QuotaExceededError'); };
  await open(w, '[data-action="add-customer"]'); await submit(w, '#customer-form', { key: 'k1', name: 'Quota' });
  const text = d.querySelector('#toast').textContent;
  assert.ok(text && !/Customer saved/.test(text), text); assert.equal(w.__errors.length, 0);
});

test('Unknown supplier ids fall back to the first supplier; "#/catalog" opens the catalog', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/nope');
  assert.equal(d.querySelector('[data-action="add-product"]').dataset.company, 'arabian');
  await go(w, '#/catalog'); assert.ok(d.querySelector('#product-grid'));
});

test('Supplier names are trimmed and the avatar uses the renamed initial', async () => {
  const w = boot(), d = w.document; await go(w, '#/settings');
  await submit(w, '#companies-form', { 'company-2': '  Zaki Perfumes  ' }); await go(w, '#/catalog/arabian');
  assert.equal([...d.querySelectorAll('.company-switcher a')][1].querySelector('span').textContent, 'Z');
  assert.equal(stored(w).companyMeta['company-2'].name, 'Zaki Perfumes');
});

test('Logo: non-images are rejected; a logo too big for storage keeps the old logo but saves other settings', async () => {
  const w = boot(), d = w.document; await go(w, '#/settings');
  w.Image = class { set src(v) { setTimeout(() => this.onerror && this.onerror(), 0); } };   // jsdom cannot decode images
  const form = d.querySelector('#settings-form'); form.elements.name.value = '  New Shop  ';
  const pick = (type) => Object.defineProperty(form.elements.logo, 'files', { value: [{ type, name: 'f' }], configurable: true });
  pick('text/plain'); form.requestSubmit(); await tick();
  assert.match(d.querySelector('#toast').textContent, /image file/);
  w.FileReader = class { readAsDataURL() { setTimeout(() => this.onload(), 5); } get result() { return 'data:image/png;base64,' + 'A'.repeat(50); } };
  const realSet = w.Storage.prototype.setItem; w.Storage.prototype.setItem = function (k, v) { if (v.includes('data:image/png')) throw new w.DOMException('full', 'QuotaExceededError'); return realSet.call(this, k, v); };
  pick('image/png'); form.requestSubmit(); await tick(80);
  assert.equal(stored(w).settings.logo, 'logo.jpg'); assert.equal(stored(w).settings.name, 'New Shop');
  assert.match(d.querySelector('#toast').textContent, /too large/);
});

test('Excel export starts with a UTF-8 BOM so Urdu names open correctly', async () => {
  const w = boot(), d = w.document; let first = null; const RealBlob = w.Blob; w.Blob = function (parts, o) { first = parts[0]; return new RealBlob(parts, o); };
  await go(w, '#/catalog/arabian'); await open(w, '[data-action="export-catalog"]');
  assert.equal(typeof first, 'string'); assert.equal(first.charCodeAt(0), 0xFEFF);
});

test('Greeting follows the time of day', async () => {
  const w = boot(), h = new Date().getHours();
  assert.equal(w.document.querySelector('.topbar h1').textContent, h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
});

test('Changes saved in another tab are picked up; Escape closes dialogs', async () => {
  const w = boot(), d = w.document; await go(w, '#/customers');
  const other = stored(w); other.customers = [{ id: 'c-x', key: 'x-1', name: 'From other tab', phone: '', account: '', address: '' }];
  w.localStorage.setItem(STORAGE_KEY, JSON.stringify(other)); w.dispatchEvent(new w.StorageEvent('storage', { key: STORAGE_KEY })); await tick();
  assert.match(d.querySelector('#customer-grid').textContent, /From other tab/);
  await open(w, '[data-action="add-customer"]'); assert.ok(d.querySelector('.modal-backdrop'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(d.querySelector('.modal-backdrop'), null);
});


// ───────────────────────────── Price auto-fill ─────────────────────────────
const typeInto = async (w, form, name, value) => { const input = form.elements[name]; input.value = value; input.dispatchEvent(new w.Event('input', { bubbles: true })); await tick(5); };

test('Typing the price per kg fills per gram, per 25g and per 100g (1 kg = 100,000 -> 100 / 2,500 / 10,000)', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian'); await open(w, '[data-action="add-product"]');
  const f = d.querySelector('#product-form');
  await typeInto(w, f, 'priceKg', '100000');
  assert.deepEqual(['perGram', 'price25g', 'price100g'].map(n => f.elements[n].value), ['100', '2500', '10000']);
  await typeInto(w, f, 'priceKg', '36363');
  assert.deepEqual(['perGram', 'price25g', 'price100g'].map(n => f.elements[n].value), ['36.363', '909.08', '3636.3']);
  f.elements.name.value = 'Auto filled'; f.requestSubmit(); await tick();
  const saved = stored(w).products.at(-1);
  assert.deepEqual([saved.priceKg, saved.perGram, saved.price25g, saved.price100g], [36363, 36.363, 909.08, 3636.3]);
});

test('Auto-filled prices can still be adjusted by hand, and clearing the kg price leaves them alone', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian'); await open(w, '[data-action="add-product"]');
  const f = d.querySelector('#product-form');
  await typeInto(w, f, 'priceKg', '50000'); f.elements.price25g.value = '1300';
  await typeInto(w, f, 'priceKg', ''); assert.equal(f.elements.price25g.value, '1300');
  f.elements.name.value = 'Adjusted'; f.requestSubmit(); await tick();
  assert.equal(stored(w).products.at(-1).price25g, 1300);
});

test('The price fields accept fractional prices (step is not 0.01)', async () => {
  const w = boot(); await go(w, '#/catalog/arabian'); await open(w, '[data-action="add-product"]');
  for (const n of ['priceKg', 'perGram', 'price25g', 'price100g']) assert.equal(w.document.querySelector(`#product-form [name=${n}]`).step, 'any');
});

// ───────────────────────────── Share a customised list ─────────────────────────────
const JANAN = 'Janan sports جانان اسپورٹس';
const shareOpen = async (w, selector = '[data-action="share-list"]') => { await open(w, selector); return w.document.querySelector('#share-form'); };
const pick = async (w, form, id, on = true) => { const box = form.querySelector(`input[name=pick][value="${id}"]`); box.checked = on; box.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(5); };
const withCustomer = (phone, extra = {}) => ({ customers: [{ id: 'c1', key: '001-abbas', name: 'Abbas', phone, account: '', address: '' }], orders: [], ...extra });

test('Share list: searching "janan" and ticking one fragrance writes it exactly as in the catalog', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian'); const f = await shareOpen(w);
  const search = f.querySelector('#share-search'); search.value = 'janan'; search.dispatchEvent(new w.Event('input', { bubbles: true }));
  const visible = [...f.querySelectorAll('.share-item')].filter(r => !r.hidden); assert.equal(visible.length, 3);
  await pick(w, f, 'arabian-29');
  const text = f.querySelector('#share-text').value;
  assert.match(text, /^\*Al Madina Fragrances\*\nFragrance price list\n\n\*Janan sports جانان اسپورٹس\*\nCode: 271062\nPrice \/ kg: 60,000 PKR\nPrice \/ gram: 60 PKR\nPrice \/ 25g: 1,500 PKR\nPrice \/ 100g: 6,000 PKR$/);
  assert.equal(f.querySelector('#share-count').textContent, '1 selected');
});

test('Share list: several fragrances are numbered; unticking a detail removes it; the heading is editable', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian'); const f = await shareOpen(w);
  await pick(w, f, 'arabian-29'); await pick(w, f, 'arabian-177');
  let text = f.querySelector('#share-text').value; assert.match(text, /1\. \*Janan sports[^\n]*\*\n {3}Code: 271062/); assert.match(text, /2\. \*janan gold جانان\*/);
  const box = f.querySelector('input[name=field][value=perGram]'); box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.doesNotMatch(f.querySelector('#share-text').value, /Price \/ gram/);
  f.elements.title.value = 'November offers'; f.elements.title.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.match(f.querySelector('#share-text').value, /\nNovember offers\n/);
  f.querySelector('input[name=field][value=serial]').checked = true; f.querySelector('input[name=field][value=serial]').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(f.querySelector('#share-text').value, /Serial number: AR-029/);
});

test('Share list: a hand-edited message is kept until "Reset text"', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian'); const f = await shareOpen(w);
  await pick(w, f, 'arabian-29');
  const area = f.querySelector('#share-text'); area.value = 'My own words'; area.dispatchEvent(new w.Event('input', { bubbles: true }));
  await pick(w, f, 'arabian-177'); assert.equal(area.value, 'My own words'); assert.equal(f.querySelector('#share-count').textContent, '2 selected');
  await open(w, '[data-action="share-reset"]'); assert.match(area.value, /2\. \*janan gold/);
});

test('Share list: sends to the chosen customer\'s WhatsApp with a greeting, or opens the chooser without one', async () => {
  const w = boot(withCustomer('0300-1234567')), d = w.document; await go(w, '#/catalog/arabian'); const f = await shareOpen(w);
  await pick(w, f, 'arabian-29'); f.elements.customerId.value = 'c1'; f.elements.customerId.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match(f.querySelector('#share-text').value, /^Assalam o Alaikum Abbas,\n\n\*Al Madina Fragrances\*/);
  await open(w, '[data-action="share-whatsapp"]');
  assert.ok(w.__lastLink.startsWith('https://wa.me/923001234567?text='), w.__lastLink);
  assert.match(decodeURIComponent(w.__lastLink), /\*Janan sports جانان اسپورٹس\*/);
  f.elements.customerId.value = ''; w.__lastLink = ''; await open(w, '[data-action="share-whatsapp"]');
  assert.ok(w.__lastLink.startsWith('https://wa.me/?text='), w.__lastLink);
  assert.deepEqual(stored(w).settings.shareFields, ['code', 'priceKg', 'perGram', 'price25g', 'price100g'], 'the chosen details are remembered');
});

test('Share list: nothing selected, a customer without a number, and a list that is too long are all refused', async () => {
  const w = boot(withCustomer('')), d = w.document; await go(w, '#/catalog/arabian'); const f = await shareOpen(w);
  await open(w, '[data-action="share-whatsapp"]'); assert.match(d.querySelector('#toast').textContent, /Choose at least one/);
  await pick(w, f, 'arabian-29'); f.elements.customerId.value = 'c1';
  await open(w, '[data-action="share-whatsapp"]'); assert.match(d.querySelector('#toast').textContent, /valid WhatsApp number for Abbas/); assert.equal(w.__lastLink, undefined);
  f.elements.customerId.value = ''; await open(w, '[data-action="share-select-shown"]'); assert.equal(f.querySelector('#share-count').textContent, '206 selected');
  await open(w, '[data-action="share-whatsapp"]'); assert.match(d.querySelector('#toast').textContent, /too long/); assert.equal(w.__lastLink, undefined);
  await open(w, '[data-action="share-clear"]'); assert.equal(f.querySelector('#share-count').textContent, '0 selected'); assert.equal(f.querySelector('#share-text').value, '');
});

test('Share list: copy text and print / save as PDF', async () => {
  const w = boot(), d = w.document; await go(w, '#/catalog/arabian'); const f = await shareOpen(w); await pick(w, f, 'arabian-29');
  let copied = ''; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { copied = t; } }, configurable: true });
  await open(w, '[data-action="share-copy"]'); await tick(20); assert.match(copied, /Janan sports/); assert.match(d.querySelector('#toast').textContent, /copied/);
  await open(w, '[data-action="share-print"]'); const doc = w.__opened.at(-1).document.body.innerHTML;
  assert.match(doc, /Janan sports جانان اسپورٹس/); assert.match(doc, /271062/); assert.match(doc, /60,000 PKR/);
});

test('Share list: can be started from a fragrance and from a customer page', async () => {
  const w = boot(withCustomer('0300-1234567')), d = w.document; await go(w, '#/catalog/arabian');
  await open(w, '.card-open'); await open(w, '[data-action="share-product"]');
  assert.equal(d.querySelectorAll('.modal-backdrop').length, 1); assert.equal(d.querySelector('#share-count').textContent, '1 selected');
  assert.match(d.querySelector('#share-text').value, /\*Gucci flora/);
  await go(w, '#/customers/c1'); const f = await shareOpen(w, '[data-action="share-customer"]'); assert.equal(f.elements.customerId.value, 'c1');
});

// ───────────────────────────── WhatsApp payment reminders ─────────────────────────────
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();
const order = (id, ageDays, extra = {}) => ({ id, number: `AMF-2026-${id}`, date: daysAgo(ageDays), customerId: 'c1', customerName: 'Abbas', items: [], total: 5000, paid: 1000, notes: '', ...extra });
const withOrders = (orders, phone = '0300-1234567') => ({ customers: [{ id: 'c1', key: '001-abbas', name: 'Abbas', phone, account: '', address: '' }], orders });
const rowFor = (d, number) => [...d.querySelectorAll('.reminder-row')].find(r => r.textContent.includes(number));

test('Reminders follow the schedule: due on day 1, 2 and 7; paid and stopped invoices are left out', async () => {
  const w = boot(withOrders([order('0', 0), order('1', 1), order('2', 10), order('3', 3, { paid: 5000 }), order('4', 10, { noReminders: true })])), d = w.document;
  await go(w, '#/reminders');
  const due = [...d.querySelectorAll('.panel')][0].textContent;
  assert.match(due, /AMF-2026-1/); assert.match(due, /AMF-2026-2/); assert.doesNotMatch(due, /AMF-2026-0/); assert.doesNotMatch(due, /AMF-2026-4/);
  assert.match(rowFor(d, 'AMF-2026-1').textContent, /Due today/); assert.match(rowFor(d, 'AMF-2026-2').textContent, /Overdue by 9 days/);
  assert.match(rowFor(d, 'AMF-2026-0').textContent, /Next:/); assert.match(rowFor(d, 'AMF-2026-4').textContent, /Reminders stopped/);
  assert.equal(rowFor(d, 'AMF-2026-3'), undefined, 'paid invoices never appear');
  assert.equal(d.querySelector('.nav-badge').textContent, '2');
  await go(w, '#/dashboard'); assert.match(d.querySelector('.reminder-banner').textContent, /2 payment reminders are due/);
});

test('Sending a reminder opens WhatsApp with the message, logs it, and schedules the next one', async () => {
  const w = boot(withOrders([order('1', 1)])), d = w.document; await go(w, '#/reminders');
  d.querySelector('[data-action="send-reminder"]').click(); await tick();
  assert.ok(w.__lastLink.startsWith('https://wa.me/923001234567?text='), w.__lastLink);
  const text = decodeURIComponent(w.__lastLink.split('?text=')[1]);
  assert.match(text, /Assalam o Alaikum Abbas/); assert.match(text, /AMF-2026-1/); assert.match(text, /4,000 PKR is still pending \(total 5,000 PKR, received 1,000 PKR\)/);
  assert.equal(stored(w).orders[0].reminders.length, 1);
  assert.match(rowFor(d, 'AMF-2026-1').textContent, /1 reminder sent/); assert.match(rowFor(d, 'AMF-2026-1').textContent, /Next:/, 'day 2 comes tomorrow, not today');
  assert.equal(d.querySelector('.nav-badge'), null);
});

test('Reminder schedule continues: the repeat interval applies after the last scheduled reminder', async () => {
  const sent = n => Array.from({ length: n }, (_, i) => ({ at: daysAgo(i === n - 1 ? 8 : 20) }));   // last one went out 8 days ago
  const w = boot(withOrders([order('1', 30, { reminders: sent(3) })])), d = w.document; await go(w, '#/reminders');
  assert.match(rowFor(d, 'AMF-2026-1').textContent, /Overdue by 1 day/);
  const w2 = boot(withOrders([order('1', 30, { reminders: [{ at: daysAgo(1) }, { at: daysAgo(1) }, { at: daysAgo(1) }] })])); await go(w2, '#/reminders');
  assert.match(rowFor(w2.document, 'AMF-2026-1').textContent, /Next:/);
});

test('Phone numbers are normalised for WhatsApp (0300…, +92…, 0092…, no leading zero, first of several)', async () => {
  const cases = { '0300-1234567': '923001234567', '+92 300 1234567': '923001234567', '0092 300 1234567': '923001234567', '3001234567': '923001234567', '923001234567': '923001234567', '03001234567 / 0321 7654321': '923001234567', '+44 7700 900123': '447700900123' };
  for (const [raw, expected] of Object.entries(cases)) {
    const w = boot(withOrders([order('1', 5)], raw)); await go(w, '#/reminders'); w.document.querySelector('[data-action="send-reminder"]').click(); await tick();
    assert.ok(w.__lastLink?.startsWith(`https://wa.me/${expected}?text=`), `${raw} -> ${w.__lastLink}`);
  }
});

test('A customer without a usable number gets a prompt to add one, and nothing is logged', async () => {
  for (const phone of ['', 'call me', '12']) {
    const w = boot(withOrders([order('1', 5)], phone)), d = w.document; await go(w, '#/reminders'); d.querySelector('[data-action="send-reminder"]').click(); await tick();
    assert.match(d.querySelector('#toast').textContent, /valid WhatsApp number for Abbas/); assert.ok(d.querySelector('#customer-form'), 'customer form opens'); assert.equal(w.__lastLink, undefined);
    assert.equal(stored(w).orders?.[0]?.reminders, undefined);
  }
});

test('Reminders can be snoozed until tomorrow, stopped and resumed', async () => {
  const w = boot(withOrders([order('1', 5)])), d = w.document; await go(w, '#/reminders');
  d.querySelector('[data-action="snooze-reminder"]').click(); await tick(); assert.match(rowFor(d, 'AMF-2026-1').textContent, /Next:/); assert.equal(d.querySelector('.nav-badge'), null);
  d.querySelector('[data-action="toggle-reminders"]').click(); await tick(); assert.match(rowFor(d, 'AMF-2026-1').textContent, /Reminders stopped/); assert.match(rowFor(d, 'AMF-2026-1').textContent, /Resume/);
  d.querySelector('[data-action="toggle-reminders"]').click(); await tick(); assert.doesNotMatch(rowFor(d, 'AMF-2026-1').textContent, /Reminders stopped/);
});

test('The Remind button on invoices sends right away (even before the schedule says so) and is absent on paid invoices', async () => {
  const w = boot(withOrders([order('1', 0), order('2', 0, { paid: 5000 })])), d = w.document; await go(w, '#/billing');
  assert.equal(d.querySelectorAll('[data-action="send-reminder"]').length, 1);
  d.querySelector('[data-action="send-reminder"]').click(); await tick(); assert.ok(w.__lastLink.startsWith('https://wa.me/923001234567'));
});

test('Reminder settings: schedule, repeat, country code and message are validated and used', async () => {
  const w = boot(withOrders([order('1', 5)], '0300-1234567')), d = w.document; await go(w, '#/settings');
  await submit(w, '#reminder-form', { schedule: 'soon' }); assert.match(d.querySelector('#toast').textContent, /at least one day/);
  await submit(w, '#reminder-form', { schedule: '2, 5, 5, 14', countryCode: '', repeatEvery: '3' }); assert.match(d.querySelector('#toast').textContent, /country code/);
  await submit(w, '#reminder-form', { schedule: '2, 5, 5, 14', countryCode: '1', repeatEvery: '3', template: 'Hi {name}: {amount} left on {invoice} after {days} days. {unknown}' });
  assert.deepEqual([stored(w).settings.reminders.schedule, stored(w).settings.reminders.repeatEvery, stored(w).settings.countryCode], ['2, 5, 14', 3, '1']);
  await go(w, '#/reminders'); d.querySelector('[data-action="send-reminder"]').click(); await tick();
  assert.ok(w.__lastLink.startsWith('https://wa.me/13001234567?text='), w.__lastLink);
  assert.equal(decodeURIComponent(w.__lastLink.split('?text=')[1]), 'Hi Abbas: 4,000 PKR left on AMF-2026-1 after 5 days. {unknown}');
  await go(w, '#/settings'); d.querySelector('[data-action="reset-reminder-text"]').click();
  assert.match(d.querySelector('#reminder-form [name=template]').value, /friendly reminder from \{shop\}/);
});

test('Older saved data without reminder settings still works', async () => {
  const w = boot({ settings: { theme: 'light', name: 'Old shop' }, customers: [{ id: 'c1', key: 'k', name: 'Abbas', phone: '03001234567' }], orders: [order('1', 5)], products: [] });
  await go(w, '#/reminders'); assert.match(w.document.querySelector('.reminder-row').textContent, /Due today|Overdue/);
  w.document.querySelector('[data-action="send-reminder"]').click(); await tick(); assert.match(decodeURIComponent(w.__lastLink), /from Old shop/);
});


// ───────────────────────────── One JSON data file, grouped by supplier ─────────────────────────────
const JANAN_NAME = 'Janan sports جانان اسپورٹس';
async function addFragrance(w, supplierId, values) {
  await go(w, `#/catalog/${supplierId}`); await open(w, '[data-action="add-product"]'); await submit(w, '#product-form', values);
}
// Clicks an export button and returns the parsed JSON that would have been downloaded (plus the file name).
async function exportJson(w, action = 'export-backup') {
  let text = null; const RealBlob = w.Blob; w.Blob = function (parts, options) { text = parts[0]; return new RealBlob(parts, options); };
  await go(w, '#/settings'); w.document.querySelector(`[data-action="${action}"]`).click(); w.Blob = RealBlob;
  return { json: JSON.parse(text.replace(/^\uFEFF/, '')), fileName: w.__lastDownload, raw: text };
}
async function importText(w, text) {
  const input = w.document.querySelector('#backup-file');
  Object.defineProperty(input, 'files', { value: [new w.File([text], 'data.json')], configurable: true });
  input.dispatchEvent(new w.Event('change', { bubbles: true })); await tick(80);
}

test('The data file lists every supplier separately; a fragrance sold by two suppliers appears under each', async () => {
  const w = boot(); await addFragrance(w, 'company-2', { name: JANAN_NAME, priceKg: '55000' }); await addFragrance(w, 'company-3', { name: JANAN_NAME, priceKg: '58000' });
  const { json, fileName } = await exportJson(w);
  assert.match(fileName, /^amf-data-\d{4}-\d{2}-\d{2}\.json$/);
  assert.deepEqual([json.format, json.formatVersion, json.kind], ['amf-data', 3, 'full']);
  assert.deepEqual(json.suppliers.map(s => s.id), ['arabian', 'company-2', 'company-3', 'company-4']);
  assert.deepEqual(json.suppliers.map(s => s.fragrances.length), [206, 1, 1, 0]);
  const holders = json.suppliers.filter(s => s.fragrances.some(f => f.name === JANAN_NAME));
  assert.deepEqual(holders.map(s => s.id), ['arabian', 'company-2', 'company-3']);
  const prices = holders.map(s => s.fragrances.find(f => f.name === JANAN_NAME).priceKg); assert.deepEqual(prices, [60000, 55000, 58000], 'each supplier keeps its own price');
  const ids = json.suppliers.flatMap(s => s.fragrances.map(f => f.id)); assert.equal(new Set(ids).size, ids.length, 'ids are unique across the whole file');
  assert.ok(json.suppliers.every(s => s.fragrances.every(f => !('companyId' in f))), 'the supplier is the parent, not a field');
  assert.ok(Array.isArray(json.customers) && Array.isArray(json.orders) && json.settings.name);
  assert.deepEqual(json.suppliers[1].fragrances[0], { ...json.suppliers[1].fragrances[0], price25g: 1375, perGram: 55, price100g: 5500, serial: 'CO-001' });
});

test('Export then import restores everything, including new fragrances, customers and invoices', async () => {
  const a = boot(); await addFragrance(a, 'company-2', { name: 'Brand new oud', priceKg: '100000' }); await go(a, '#/billing'); await makeInvoice(a, { paid: 1600, key: 'k-1' });
  const { raw } = await exportJson(a);
  const b = boot(); await go(b, '#/dashboard'); await importText(b, raw);
  const [sa, sb] = [stored(a), stored(b)];
  assert.deepEqual(sb.products, sa.products); assert.deepEqual(sb.customers, sa.customers); assert.deepEqual(sb.orders, sa.orders);
  await go(b, '#/catalog/company-2'); assert.match(b.document.querySelector('#product-grid').textContent, /Brand new oud/);
});

test('"Catalog only" leaves out customers and invoices; importing it keeps the receiver\'s own customers, invoices and settings', async () => {
  const a = boot(); await addFragrance(a, 'company-4', { name: 'Catalog only oud', priceKg: '40000' });
  const { json, raw, fileName } = await exportJson(a, 'export-catalog-json');
  assert.match(fileName, /^amf-catalog-/); assert.equal(json.kind, 'catalog'); assert.ok(!('customers' in json) && !('orders' in json) && !('settings' in json));
  const b = boot(withCustomer('0300-1234567', { orders: [order('1', 2)] })), d = b.document; await go(b, '#/dashboard');
  await importText(b, raw);
  assert.match(d.querySelector('#toast').textContent, /Catalogs loaded/);
  assert.equal(stored(b).customers.length, 1); assert.equal(stored(b).orders.length, 1);
  assert.ok(stored(b).products.some(p => p.name === 'Catalog only oud' && p.companyId === 'company-4'));
});

test('Older flat backups can still be imported (and are re-exported in the new format)', async () => {
  const legacy = JSON.stringify({ version: 2, settings: { name: 'Old shop', theme: 'light' }, companyMeta: {}, products: [{ id: 'arabian-1', companyId: 'arabian', name: 'Old one', serial: 'AR-001', priceKg: 1000 }, { id: 'company-2-x', companyId: 'company-2', name: 'Old two', serial: 'CO-001', priceKg: 2000 }], customers: [], orders: [] });
  const w = boot(); await go(w, '#/dashboard'); await importText(w, legacy);
  assert.equal(stored(w).products.length, 2);
  const { json } = await exportJson(w); assert.deepEqual(json.suppliers.map(s => s.fragrances.length), [1, 1, 0, 0]);
});

test('Broken data files are refused with a clear message and change nothing', async () => {
  const w = boot(), d = w.document; await go(w, '#/dashboard');
  const bad = {
    'not json': ['{nope', /not valid JSON/],
    'an array': ['[]', /not an AMF data file/],
    'duplicate fragrance ids': [JSON.stringify({ suppliers: [{ id: 'arabian', fragrances: [{ id: 'x' }] }, { id: 'company-2', fragrances: [{ id: 'x' }] }], kind: 'catalog' }), /"x" appears twice/],
    'supplier without a list': [JSON.stringify({ suppliers: [{ id: 'arabian' }] }), /supplier in that file is malformed/],
    'fragrance without id': [JSON.stringify({ suppliers: [{ id: 'arabian', name: 'A', fragrances: [{ name: 'no id' }] }] }), /has no id/],
    'supplier twice': [JSON.stringify({ suppliers: [{ id: 'arabian', fragrances: [] }, { id: 'arabian', fragrances: [] }] }), /appears twice/],
    'full file without customers': [JSON.stringify({ kind: 'full', suppliers: [{ id: 'arabian', fragrances: [] }] }), /needs both customers and orders/],
    'bad customers': [JSON.stringify({ suppliers: [], customers: [{ nope: 1 }], orders: [] }), /customers in that file are malformed/]
  };
  for (const [label, [text, expected]] of Object.entries(bad)) { await importText(w, text); assert.match(d.querySelector('#toast').textContent, expected, label); }
  assert.equal(stored(w).products, undefined, 'nothing was imported');
});

test('Suppliers beyond the first four can be added, renamed and removed; each keeps its own fragrances', async () => {
  const w = boot(), d = w.document; await go(w, '#/settings');
  await submit(w, '#supplier-add-form', { name: 'Zaki Perfumes', note: 'Made in France' });
  assert.equal(stored(w).companyMeta['company-5'].name, 'Zaki Perfumes');
  await submit(w, '#supplier-add-form', { name: 'zaki perfumes' }); assert.match(d.querySelector('#toast').textContent, /already exists/);
  await submit(w, '#supplier-add-form', { name: 'Second extra' }); assert.equal(stored(w).companyMeta['company-6'].name, 'Second extra');
  await go(w, '#/catalog/company-5');
  assert.equal(d.querySelectorAll('.company-switcher a').length, 6); assert.match(d.querySelector('.catalog-head h2').textContent, /Zaki Perfumes/);
  assert.match(d.querySelector('.catalog-head .eyebrow').textContent, /Made in France/);
  await open(w, '[data-action="add-product"]'); await submit(w, '#product-form', { name: 'Zaki oud', priceKg: '80000' });
  assert.equal(stored(w).products.at(-1).companyId, 'company-5');
  await open(w, '[data-action="share-list"]'); assert.ok([...d.querySelectorAll('#share-supplier option')].some(o => o.textContent === 'Zaki Perfumes')); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await go(w, '#/billing'); await open(w, '[data-action="quick-order"]'); assert.ok([...d.querySelectorAll('select[name=companyId] option')].some(o => o.textContent === 'Zaki Perfumes'));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const { json } = await exportJson(w); assert.deepEqual(json.suppliers.map(s => s.id), ['arabian', 'company-2', 'company-3', 'company-4', 'company-5', 'company-6']);
  assert.equal(json.suppliers[4].fragrances[0].name, 'Zaki oud'); assert.equal(json.suppliers[4].note, 'Made in France');
  assert.equal(d.querySelectorAll('[data-action="remove-supplier"]').length, 2, 'only added suppliers can be removed');
  d.querySelector('[data-action="remove-supplier"][data-id="company-5"]').click(); assert.match(d.querySelector('#toast').textContent, /Remove its 1 fragrance first/);
  d.querySelector('[data-action="remove-supplier"][data-id="company-6"]').click(); await tick(); assert.equal(stored(w).companyMeta['company-6'], undefined);
});

test('A data file with a supplier the app has not seen creates that supplier; fragrances never get lost on export', async () => {
  const file = JSON.stringify({ format: 'amf-data', formatVersion: 3, kind: 'catalog', suppliers: [{ id: 'company-9', name: 'Nine Perfumes', note: 'Dubai', fragrances: [{ id: 'company-9-a', name: 'Nine oud', priceKg: 90000, serial: 'NI-001' }] }] });
  const w = boot(), d = w.document; await go(w, '#/dashboard'); await importText(w, file);
  await go(w, '#/catalog/company-9'); assert.match(d.querySelector('.catalog-head h2').textContent, /Nine Perfumes/); assert.match(d.querySelector('#product-grid').textContent, /Nine oud/);
  const orphan = boot({ products: [{ id: 'ghost-1', companyId: 'ghost', name: 'Orphan oud', serial: 'GH-001', priceKg: 1 }], customers: [], orders: [] });
  const { json } = await exportJson(orphan);
  assert.deepEqual(json.suppliers.find(s => s.id === 'ghost')?.fragrances.map(f => f.name), ['Orphan oud']);
});

test('Every save is time-stamped (used to decide which copy is newer)', async () => {
  const w = boot(); await addFragrance(w, 'arabian', { name: 'Stamped', priceKg: '1000' });
  const at = Date.parse(stored(w).savedAt); assert.ok(Date.now() - at < 5000 && at <= Date.now());
  const { json } = await exportJson(w); assert.equal(json.savedAt, stored(w).savedAt);
});

test('Without the File System Access API the settings say so and offer downloads instead', async () => {
  const w = boot(); await go(w, '#/settings');
  assert.match(w.document.querySelector('#file-panel').textContent, /cannot save to a file automatically/);
  for (const a of ['export-backup', 'export-catalog-json', 'import-backup']) assert.ok(w.document.querySelector(`.wide-panel [data-action="${a}"]`));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓', name); } catch (err) { failed++; console.log('  ✗', name, '\n     ', String(err.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
