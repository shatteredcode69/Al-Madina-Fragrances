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
  await choose('{"products":[]}'); assert.match(d.querySelector('#toast').textContent, /not an AMF backup/);
  assert.equal(stored(w).orders, undefined, 'a rejected file must not touch the data');
  await choose(backup);
  assert.match(d.querySelector('#toast').textContent, /Backup restored/);
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

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓', name); } catch (err) { failed++; console.log('  ✗', name, '\n     ', String(err.message).split('\n').slice(0, 3).join('\n      ')); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
