(() => {
  const STORAGE_KEY = 'amf-catalog-v1';
  const THEME_KEY = 'amf-theme-v1';
  let catalog = loadCatalog();
  let activeFilter = 'all';
  let selectedItem = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const formatMoney = (value) => new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);

  function persistCatalog() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = nextTheme;
    localStorage.setItem(THEME_KEY, nextTheme);
    const toggle = $('#themeToggle');
    if (toggle) {
      toggle.textContent = nextTheme === 'dark' ? '☀' : '☾';
      toggle.title = nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      toggle.setAttribute('aria-label', nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
  }

  function loadCatalog() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(stored) && stored.length ? stored : [...window.INITIAL_CATALOG];
    } catch {
      return [...window.INITIAL_CATALOG];
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function toTitleCase(value) {
    const words = String(value || '').trim().split(/\s+/).filter(Boolean);
    return words.map((word) => {
      if (!word) return word;
      if (/^[A-Z0-9]+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
  }

  function formatDisplayName(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Unnamed fragrance';

    const hasLatin = /[A-Za-z]/.test(raw);
    const hasArabic = /[\u0600-\u06FF]/.test(raw);

    if (!(hasLatin && hasArabic)) {
      return toTitleCase(raw);
    }

    const tokens = raw.split(/\s+/).filter(Boolean);
    const englishTokens = [];
    const secondaryTokens = [];

    tokens.forEach((token) => {
      if (/[A-Za-z0-9]/.test(token)) {
        englishTokens.push(token);
      } else {
        secondaryTokens.push(token);
      }
    });

    const englishName = englishTokens.length ? toTitleCase(englishTokens.join(' ')) : '';
    const secondaryName = secondaryTokens.length ? secondaryTokens.join(' ') : '';

    if (!englishName) return secondaryName;
    if (!secondaryName) return englishName;
    return `${englishName} · ${secondaryName}`;
  }

  function getFilteredItems() {
    const query = $('#search').value.trim().toLowerCase();
    const sortValue = $('#sort').value;

    let items = catalog.filter((item) => {
      const haystack = `${item.name} ${item.code} ${item.no}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesFilter = activeFilter === 'all'
        ? true
        : activeFilter === 'premium'
          ? Number(item.priceKg) > 60000
          : Number(item.priceKg) < 40000;
      return matchesQuery && matchesFilter;
    });

    items.sort((a, b) => {
      if (sortValue === 'name') return String(formatDisplayName(a.name)).localeCompare(String(formatDisplayName(b.name)));
      if (sortValue === 'price') return Number(a.priceKg) - Number(b.priceKg);
      return Number(a.no) - Number(b.no);
    });

    return items;
  }

  function renderCatalog() {
    const items = getFilteredItems();

    $('#catalog').innerHTML = items.map((item) => `
      <article class="fragrance-card">
        <div class="card-top">
          <span>No. ${escapeHtml(item.no)}</span>
          <span class="card-code">${escapeHtml(item.code)}</span>
        </div>
        <h3>${escapeHtml(formatDisplayName(item.name))}</h3>
        <div class="card-price">
          <div>
            <small>Per gram</small>
            <strong>PKR ${formatMoney(item.perGram || 0)}</strong>
          </div>
          <div class="card-price-note">PKR ${formatMoney(item.priceKg || 0)} / kg</div>
        </div>
        <div class="card-footer">
          <span>25g · ${formatMoney(item.price25g || 0)}</span>
          <button type="button" data-view="${item.id}">View details →</button>
        </div>
      </article>
    `).join('');

    $('#emptyState').hidden = items.length > 0;
    $('#totalCount').textContent = String(catalog.length);
    $('#allCount').textContent = String(catalog.length);

    const average = catalog.length ? catalog.reduce((sum, item) => sum + (Number(item.perGram) || 0), 0) / catalog.length : 0;
    $('#averagePrice').textContent = formatMoney(average);

    const kgPrices = catalog.map((item) => Number(item.priceKg) || 0);
    const minPrice = kgPrices.length ? Math.min(...kgPrices) : 0;
    const maxPrice = kgPrices.length ? Math.max(...kgPrices) : 0;
    $('#priceRange').textContent = `${formatMoney(minPrice)} — ${formatMoney(maxPrice)}`;

    $$('.tab').forEach((node) => {
      node.classList.toggle('active', node.dataset.filter === activeFilter);
    });
  }

  function calculatePrice(item, unit, value) {
    const numeric = Number(value) || 0;
    if (!item) return 0;

    switch (unit) {
      case 'grams':
        return numeric * (Number(item.perGram) || 0);
      case 'ml':
        return numeric * (Number(item.perGram) || 0);
      case '25g':
        return numeric * (Number(item.price25g) || 0);
      case '100g':
        return numeric * (Number(item.price100g) || 0);
      case 'kg':
        return numeric * (Number(item.priceKg) || 0);
      default:
        return numeric * (Number(item.perGram) || 0);
    }
  }

  function updateCalculator(item) {
    const calc = $('#calculator');
    if (!calc) return;

    const metricInput = $('#metricInput');
    const amountInput = $('#amountInput');
    const unitSelect = $('#calcUnit');

    const getUnitLabel = (mode) => (mode === 'ml' ? 'mL' : 'g');
    const getUnitPrice = (basis) => {
      switch (basis) {
        case '25g': return Number(item.price25g) / 25;
        case '100g': return Number(item.price100g) / 100;
        case 'kg': return Number(item.priceKg) / 1000;
        default: return Number(item.perGram) || 0;
      }
    };

    const updateQuote = () => {
      const quantity = Number(amountInput.value) || 0;
      const metric = metricInput.value;
      const basis = unitSelect.value;
      const unitPrice = getUnitPrice(basis);
      const purchasePrice = calculatePrice(item, basis, quantity);
      const displayAmount = `${formatMoney(quantity)} ${getUnitLabel(metric)}`;

      $('#calcTotal').textContent = `PKR ${formatMoney(purchasePrice)}`;
      $('#calcBreakdown').textContent = `${displayAmount} × ${formatMoney(unitPrice)} = PKR ${formatMoney(purchasePrice)}`;
    };

    metricInput.addEventListener('change', updateQuote);
    amountInput.addEventListener('input', updateQuote);
    unitSelect.addEventListener('change', updateQuote);

    metricInput.value = 'grams';
    amountInput.value = '25';
    unitSelect.value = 'grams';
    updateQuote();
  }

  function openDetail(item) {
    selectedItem = item;
    $('#detailContent').innerHTML = `
      <div class="detail-header">
        <p class="eyebrow">Fragrance no. ${escapeHtml(item.no)}</p>
        <h2 id="detailTitle">${escapeHtml(formatDisplayName(item.name))}</h2>
        <span class="detail-code">Catalog code · ${escapeHtml(item.code)}</span>
      </div>

      <div class="price-table">
        <div class="price-cell"><small>Per gram</small><strong>PKR ${formatMoney(item.perGram || 0)}</strong></div>
        <div class="price-cell"><small>25 grams</small><strong>PKR ${formatMoney(item.price25g || 0)}</strong></div>
        <div class="price-cell"><small>100 grams</small><strong>PKR ${formatMoney(item.price100g || 0)}</strong></div>
        <div class="price-cell"><small>Per kilogram</small><strong>PKR ${formatMoney(item.priceKg || 0)}</strong></div>
      </div>

      <div class="calculator" id="calculator">
        <div class="calculator-head">
          <div>
            <p class="eyebrow">Advanced calculator</p>
            <strong>Convert metric quantity and cost</strong>
          </div>
        </div>
        <div class="calculator-grid">
          <label>
            <span>Metric input</span>
            <select id="metricInput">
              <option value="grams">Grams</option>
              <option value="ml">Milliliters</option>
            </select>
          </label>
          <label>
            <span>Quantity</span>
            <input id="amountInput" type="number" min="0" step="0.1" value="25">
          </label>
          <label>
            <span>Price basis</span>
            <select id="calcUnit">
              <option value="grams">Per gram</option>
              <option value="ml">Per mL</option>
              <option value="25g">Per 25g</option>
              <option value="100g">Per 100g</option>
              <option value="kg">Per kg</option>
            </select>
          </label>
        </div>
        <div class="calc-output">
          <small>Estimated total</small>
          <strong id="calcTotal">PKR 0</strong>
          <small id="calcBreakdown">0 g × 0</small>
        </div>
        <div class="metric-hint">For liquid fragrance pricing, 1 mL is treated as approximately 1 g for quick conversion.</div>
      </div>

      <div class="detail-actions">
        <span>Official pricing reference</span>
        <button class="danger" type="button" data-delete="${item.id}">Remove entry</button>
      </div>
    `;

    $('#detailModal').hidden = false;
    updateCalculator(item);
  }

  function closeModals() {
    $('#detailModal').hidden = true;
    $('#addModal').hidden = true;
    selectedItem = null;
  }

  function bindEvents() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

    $('#search').addEventListener('input', renderCatalog);
    $('#sort').addEventListener('change', renderCatalog);

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach((node) => node.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderCatalog();
      });
    });

    document.querySelectorAll('[data-panel-filter]').forEach((panel) => {
      panel.addEventListener('click', () => {
        activeFilter = panel.dataset.panelFilter;
        $$('.tab').forEach((node) => {
          const isMatch = node.dataset.filter === activeFilter;
          node.classList.toggle('active', isMatch);
        });
        renderCatalog();
      });
    });

    $('#themeToggle').addEventListener('click', () => {
      const current = document.body.dataset.theme === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    $('#exportCatalog').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(catalog, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'al-madina-fragrances-export.json';
      link.click();
      URL.revokeObjectURL(url);
    });

    $('#triggerImport').addEventListener('click', () => {
      $('#importInput').click();
    });

    $('#importInput').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!Array.isArray(parsed) || !parsed.length) {
            throw new Error('Catalog file must contain a list of fragrances.');
          }

          catalog = parsed.map((item, index) => ({
            id: String(item.id || `import-${index + 1}`),
            no: String(item.no || `${index + 1}`),
            code: String(item.code || ''),
            name: String(item.name || ''),
            priceKg: Number(item.priceKg || 0),
            perGram: Number(item.perGram || 0),
            price25g: Number(item.price25g || 0),
            price100g: Number(item.price100g || 0),
          }));

          persistCatalog();
          renderCatalog();
          window.alert('Catalog imported successfully.');
        } catch (error) {
          window.alert(error.message || 'Unable to import catalog.');
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsText(file);
    });

    $('#catalog').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      const item = catalog.find((entry) => entry.id === button.dataset.view);
      if (item) openDetail(item);
    });

    $('#detailModal').addEventListener('click', (event) => {
      const deleteButton = event.target.closest('[data-delete]');
      if (deleteButton && selectedItem) {
        const shouldDelete = window.confirm(`Remove ${selectedItem.name} from your collection?`);
        if (!shouldDelete) return;
        catalog = catalog.filter((item) => item.id !== selectedItem.id);
        persistCatalog();
        closeModals();
        renderCatalog();
      }

      if (event.target === $('#detailModal')) closeModals();
    });

    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', closeModals);
    });

    $('#openAdd').addEventListener('click', () => {
      $('#addForm').reset();
      $('#addModal').hidden = false;
    });

    $('#addModal').addEventListener('click', (event) => {
      if (event.target === $('#addModal')) closeModals();
    });

    $('#addForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const item = {
        id: `custom-${Date.now()}`,
        no: `C${catalog.filter((entry) => String(entry.no).startsWith('C')).length + 1}`,
        name: String(form.get('name') || '').trim(),
        code: String(form.get('code') || '').trim(),
        priceKg: Number(form.get('priceKg') || 0),
        perGram: Number(form.get('perGram') || 0),
        price25g: Number(form.get('price25g') || 0),
        price100g: Number(form.get('price100g') || 0),
      };

      if (!item.name || !item.code || !item.priceKg) return;

      catalog.unshift(item);
      persistCatalog();
      closeModals();
      renderCatalog();
    });

    $('#resetCatalog').addEventListener('click', () => {
      const shouldReset = window.confirm('Restore the official catalog and remove custom changes?');
      if (!shouldReset) return;
      catalog = [...window.INITIAL_CATALOG];
      persistCatalog();
      renderCatalog();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeModals();
    });
  }

  function init() {
    bindEvents();
    renderCatalog();
  }

  init();
})();
