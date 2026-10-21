(() => {
  const STORAGE_KEY = "amf-catalog-v1";
  let catalog = loadCatalog();
  let activeFilter = "all";
  let selected = null;

  const $ = (selector) => document.querySelector(selector);
  const format = (value) => new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value);
  const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  function loadCatalog() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(stored) ? stored : [...window.INITIAL_CATALOG];
    } catch {
      return [...window.INITIAL_CATALOG];
    }
  }

  function render() {
    const query = $("#search").value.trim().toLowerCase();
    const sort = $("#sort").value;
    let items = catalog.filter((item) => {
      const matchesQuery = !query || [item.name, item.code, item.no].some((value) => String(value).toLowerCase().includes(query));
      const matchesFilter = activeFilter === "all" || (activeFilter === "premium" ? item.priceKg > 60000 : item.priceKg < 40000);
      return matchesQuery && matchesFilter;
    });
    items.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "price" ? a.priceKg - b.priceKg : Number.parseInt(a.no) - Number.parseInt(b.no));
    $("#catalog").innerHTML = items.map(cardTemplate).join("");
    $("#emptyState").hidden = items.length > 0;
    $("#totalCount").textContent = catalog.length;
    $("#allCount").textContent = catalog.length;
    const average = catalog.reduce((sum, item) => sum + item.perGram, 0) / (catalog.length || 1);
    $("#averagePrice").textContent = format(average);
    const prices = catalog.map((item) => item.priceKg);
    $("#priceRange").textContent = `${format(Math.min(...prices))} — ${format(Math.max(...prices))}`;
  }

  function cardTemplate(item) {
    return `<article class="fragrance-card"><div class="card-top"><span>No. ${item.no}</span><span class="card-code">${escapeHtml(item.code)}</span></div><h3>${escapeHtml(item.name)}</h3><div class="card-price"><div><small>Per gram</small><strong>PKR ${format(item.perGram)}</strong></div><small>PKR ${format(item.priceKg)} / kg</small></div><div class="card-footer"><span>25g · ${format(item.price25g)}</span><button data-view="${item.id}">View details →</button></div></article>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function showDetail(item) {
    selected = item;
    $("#detailContent").innerHTML = `<div class="detail-header"><p class="eyebrow">Fragrance no. ${escapeHtml(item.no)}</p><h2 id="detailTitle">${escapeHtml(item.name)}</h2><span class="detail-code">Catalog code · ${escapeHtml(item.code)}</span></div><div class="price-table"><div class="price-cell"><small>Per gram</small><strong>PKR ${format(item.perGram)}</strong></div><div class="price-cell"><small>25 grams</small><strong>PKR ${format(item.price25g)}</strong></div><div class="price-cell"><small>100 grams</small><strong>PKR ${format(item.price100g)}</strong></div><div class="price-cell"><small>Per kilogram</small><strong>PKR ${format(item.priceKg)}</strong></div></div><div class="calculator"><div><p class="eyebrow">Quick calculator</p><strong>Price for your fill size</strong></div><label><span>Grams</span><input id="gramsInput" type="number" min="0" step="0.1" value="25"></label><output id="calculatedPrice">PKR ${format(item.perGram * 25)}</output></div><div class="detail-actions"><span>Prices from official AMF catalog</span><button class="danger" data-delete="${item.id}">Remove entry</button></div>`;
    $("#detailModal").hidden = false;
    $("#gramsInput").addEventListener("input", (event) => {
      const grams = Math.max(0, Number(event.target.value) || 0);
      $("#calculatedPrice").textContent = `PKR ${format(item.perGram * grams)}`;
    });
  }

  function closeModals() {
    $("#detailModal").hidden = true;
    $("#addModal").hidden = true;
    selected = null;
  }

  $("#search").addEventListener("input", render);
  $("#sort").addEventListener("change", render);
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelector(".tab.active").classList.remove("active");
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    render();
  }));
  $("#catalog").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) showDetail(catalog.find((item) => item.id === button.dataset.view));
  });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeModals));
  [$("#detailModal"), $("#addModal")].forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) closeModals(); }));
  $("#openAdd").addEventListener("click", () => { $("#addForm").reset(); $("#addModal").hidden = false; });
  $("#addForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const item = {
      id: `custom-${Date.now()}`, no: `C${catalog.filter((entry) => String(entry.no).startsWith("C")).length + 1}`,
      name: form.get("name"), code: form.get("code"), priceKg: Number(form.get("priceKg")),
      perGram: Number(form.get("perGram")), price25g: Number(form.get("price25g")), price100g: Number(form.get("price100g"))
    };
    catalog.push(item); persist(); closeModals(); render();
  });
  $("#detailModal").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete]");
    if (!button || !selected || !window.confirm(`Remove ${selected.name} from your collection?`)) return;
    catalog = catalog.filter((item) => item.id !== button.dataset.delete);
    persist(); closeModals(); render();
  });
  $("#resetCatalog").addEventListener("click", () => {
    if (!window.confirm("Restore the official catalog and remove custom changes?")) return;
    catalog = [...window.INITIAL_CATALOG]; persist(); render();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModals(); });
  render();
})();
