// Boots the real app (catalog.js + app.js) inside jsdom so behaviour can be tested without a browser.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORAGE_KEY = 'amf-store-v1';

function boot(preState) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (!w.structuredClone) w.structuredClone = o => JSON.parse(JSON.stringify(o));
  if (preState) w.localStorage.setItem(STORAGE_KEY, JSON.stringify(preState));

  w.confirm = () => true;
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { w.__lastDownload = this.download; };
  w.__opened = [];
  w.open = () => { const win = new JSDOM('<html><body></body></html>').window; win.print = () => {}; win.focus = () => {}; w.__opened.push(win); return win; };
  w.__errors = [];
  w.addEventListener('error', e => w.__errors.push(e.message));

  w.eval(fs.readFileSync(path.join(ROOT, 'src/data/catalog.js'), 'utf8').replace(/^\uFEFF/, ''));
  w.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  return w;
}

module.exports = { boot, STORAGE_KEY, ROOT };
