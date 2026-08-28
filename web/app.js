// app.js -- toda la logica de la pagina. Lee la variable global TCG_DATA
// que viene definida en data.js (generado por tcgplayer_db.export_web_data()).

const state = {
  products: (typeof TCG_DATA !== "undefined" ? TCG_DATA.products : []) || [],
  generatedAt: (typeof TCG_DATA !== "undefined" ? TCG_DATA.generated_at : null),
};

const productsById = {};
for (const p of state.products) productsById[String(p.product_id)] = p;

const $grid = document.getElementById("grid");
const $empty = document.getElementById("empty");
const $search = document.getElementById("search");
const $sortBy = document.getElementById("sortBy");
const $overlay = document.getElementById("overlay");
const $modal = document.getElementById("modal");
const $metaInfo = document.getElementById("metaInfo");
const $filterExpansion = document.getElementById("filterExpansion");
const $filterColor = document.getElementById("filterColor");
const $filterCardType = document.getElementById("filterCardType");
const $catSuggestWrap = document.getElementById("catSuggestWrap");
const $catSuggestionsList = document.getElementById("catSuggestionsList");

function fmtDate(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

function priceNumber(str) {
  if (str == null) return null;
  const n = parseFloat(String(str).replace("$", "").replace(",", ""));
  return isNaN(n) ? null : n;
}

function fmtMoney(n) {
  return n == null ? "-" : "$" + n.toFixed(2);
}

function getExpansion(p) {
  const num = p && p.attributes && p.attributes["Number"];
  if (!num) return null;
  const s = String(num);
  const idx = s.indexOf("-");
  return idx > 0 ? s.slice(0, idx) : s;
}

function getFirstSeen(p) {
  if (!p) return "";
  if (p.first_seen) return p.first_seen;
  if (p.price_history && p.price_history.length) return p.price_history[0].scraped_at || "";
  return p.last_scraped || "";
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => naturalCompare(a, b));
}

function populateFilterOptions(selectEl, values, allLabel) {
  if (!selectEl) return;
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if (values.includes(current)) selectEl.value = current;
}

function matchesFilters(p, filters) {
  if (!filters) return true;
  if (filters.expansion && getExpansion(p) !== filters.expansion) return false;
  const a = (p && p.attributes) || {};
  if (filters.color && (a["Color"] || "") !== filters.color) return false;
  if (filters.cardType && (a["Card Type"] || "") !== filters.cardType) return false;
  return true;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateMeta() {
  const n = state.products.length;
  $metaInfo.textContent = n
    ? `${n} producto${n === 1 ? "" : "s"} · última actualización: ${fmtDate(state.generatedAt)}`
    : "Sin datos cargados";
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const $tabCatalogo = document.getElementById("tabCatalogo");
const $tabColeccion = document.getElementById("tabColeccion");
const $tabHerramientas = document.getElementById("tabHerramientas");
const $viewCatalogo = document.getElementById("viewCatalogo");
const $viewColeccion = document.getElementById("viewColeccion");
const $viewHerramientas = document.getElementById("viewHerramientas");

function showTab(tab) {
  $tabCatalogo.classList.toggle("active", tab === "catalogo");
  $tabColeccion.classList.toggle("active", tab === "coleccion");
  $tabHerramientas.classList.toggle("active", tab === "herramientas");
  $viewCatalogo.classList.toggle("active", tab === "catalogo");
  $viewColeccion.classList.toggle("active", tab === "coleccion");
  $viewHerramientas.classList.toggle("active", tab === "herramientas");
  if (tab === "coleccion") renderCollection();
}
$tabCatalogo.addEventListener("click", () => showTab("catalogo"));
$tabColeccion.addEventListener("click", () => showTab("coleccion"));
$tabHerramientas.addEventListener("click", () => showTab("herramientas"));

// ---------------------------------------------------------------------------
// Catalogo (grid)
// ---------------------------------------------------------------------------
function matchesSearch(p, q) {
  if (!q) return true;
  q = q.toLowerCase();
  const a = p.attributes || {};
  const haystack = [p.name, p.category, a["Number"], a["Rarity"], a["Card Type"], a["Color"], String(p.product_id)]
    .filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

function naturalCompare(a, b) {
  // localeCompare con {numeric:true} entiende los numeros dentro del texto,
  // asi "OP16-9" queda antes que "OP16-10" (una comparacion de texto plano
  // los pondria al reves, porque "1" < "9" caracter por caracter).
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

function sortProducts(list, mode) {
  const copy = [...list];
  if (mode === "added") copy.sort((a, b) => getFirstSeen(b).localeCompare(getFirstSeen(a)));
  else if (mode === "median_desc") copy.sort((a, b) => (priceNumber(b.listed_median) ?? -1) - (priceNumber(a.listed_median) ?? -1));
  else if (mode === "median_asc") copy.sort((a, b) => (priceNumber(a.listed_median) ?? Infinity) - (priceNumber(b.listed_median) ?? Infinity));
  else if (mode === "recent") copy.sort((a, b) => (b.last_scraped || "").localeCompare(a.last_scraped || ""));
  else if (mode === "number") copy.sort((a, b) => naturalCompare((a.attributes && a.attributes["Number"]), (b.attributes && b.attributes["Number"])));
  else copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return copy;
}

function currentCatalogFilters() {
  return {
    expansion: $filterExpansion.value,
    color: $filterColor.value,
    cardType: $filterCardType.value,
  };
}

function initCatalogFilters() {
  populateFilterOptions($filterExpansion, uniqueSorted(state.products.map(getExpansion)), "Expansión: Todas");
  populateFilterOptions($filterColor, uniqueSorted(state.products.map(p => p.attributes && p.attributes["Color"])), "Color: Todos");
  populateFilterOptions($filterCardType, uniqueSorted(state.products.map(p => p.attributes && p.attributes["Card Type"])), "Tipo de carta: Todos");
}

function renderGrid() {
  const q = $search.value.trim();
  const mode = $sortBy.value || "added";
  const filters = currentCatalogFilters();
  const filtered = sortProducts(state.products.filter(p => matchesSearch(p, q) && matchesFilters(p, filters)), mode);

  $grid.innerHTML = "";
  $empty.style.display = filtered.length ? "none" : "block";

  for (const p of filtered) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${p.image_url || ""}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0.15">
      <div class="body">
        <div class="name">${escapeHtml(p.name || "(sin nombre)")}</div>
        <div class="sub">${escapeHtml((p.attributes && p.attributes["Number"]) || "")} · ${escapeHtml((p.attributes && p.attributes["Rarity"]) || "")}</div>
        <div class="prices">
          <span class="median">${escapeHtml(p.listed_median || "-")}</span>
          <span class="avg">${p.average_sale_price != null ? "prom $" + p.average_sale_price : ""}</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => openModal(p));
    $grid.appendChild(card);
  }
}

function openModal(p) {
  const attrs = p.attributes || {};
  const attrRows = Object.entries(attrs).map(([k, v]) => `<div><span class="k">${escapeHtml(k)}:</span> ${escapeHtml(v)}</div>`).join("");

  const salesRows = (p.recent_sales || []).map(s => `
    <tr><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.condition)}</td><td>${escapeHtml(s.quantity)}</td><td>${escapeHtml(s.price)}</td></tr>
  `).join("") || `<tr><td colspan="4">Sin ventas registradas</td></tr>`;

  const historyRows = (p.price_history || []).slice().reverse().map(h => `
    <tr><td>${fmtDate(h.scraped_at)}</td><td>${escapeHtml(h.listed_median || "-")}</td><td>${h.average_sale_price != null ? "$" + h.average_sale_price : "-"}</td></tr>
  `).join("") || `<tr><td colspan="3">Sin historial</td></tr>`;

  $modal.innerHTML = `
    <div class="mhead">
      <img src="${p.image_url || ""}" alt="">
      <div class="info">
        <h2>${escapeHtml(p.name)}</h2>
        <div class="sub">${escapeHtml(p.category || "")} · <a class="link" href="${p.url}" target="_blank" rel="noopener">Ver en TCGplayer ↗</a></div>
        <div class="attrs">${attrRows}</div>
      </div>
      <div class="close" id="closeModal">✕</div>
    </div>
    <div class="section">
      <h3>Precio actual</h3>
      <div class="attrs">
        <div><span class="k">Listed Median:</span> ${escapeHtml(p.listed_median || "-")}</div>
        <div><span class="k">Promedio ventas recientes:</span> ${p.average_sale_price != null ? "$" + p.average_sale_price : "-"}</div>
        <div><span class="k">Última actualización:</span> ${fmtDate(p.last_scraped)}</div>
      </div>
    </div>
    <div class="section">
      <h3>Ventas recientes</h3>
      <table><thead><tr><th>Fecha</th><th>Condición</th><th>Cant.</th><th>Precio</th></tr></thead><tbody>${salesRows}</tbody></table>
    </div>
    <div class="section">
      <h3>Historial de precio (por corrida del script)</h3>
      <table><thead><tr><th>Fecha</th><th>Listed Median</th><th>Promedio</th></tr></thead><tbody>${historyRows}</tbody></table>
    </div>
  `;
  document.getElementById("closeModal").addEventListener("click", closeModal);
  $overlay.classList.add("open");
}
function closeModal() { $overlay.classList.remove("open"); }
$overlay.addEventListener("click", (e) => { if (e.target === $overlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

function renderCatSuggestions(list) {
  if (!list.length) { $catSuggestionsList.style.display = "none"; $catSuggestionsList.innerHTML = ""; return; }
  $catSuggestionsList.innerHTML = list.slice(0, 8).map(p => `
    <div class="suggest-item" data-id="${p.product_id}">
      <img src="${p.image_url || ""}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0.15">
      <div class="info">
        <div class="name">${escapeHtml(p.name || "(sin nombre)")}</div>
        <div class="sub">${escapeHtml((p.attributes && p.attributes["Number"]) || "")} · ${escapeHtml((p.attributes && p.attributes["Rarity"]) || "")}</div>
      </div>
      <div class="price">${escapeHtml(p.listed_median || "")}</div>
    </div>
  `).join("");
  $catSuggestionsList.style.display = "block";
  $catSuggestionsList.querySelectorAll("div[data-id]").forEach(el => {
    el.addEventListener("click", () => {
      const p = productsById[el.dataset.id];
      $catSuggestionsList.style.display = "none";
      if (p) openModal(p);
    });
  });
}

function updateCatSuggestions() {
  const q = $search.value.trim();
  if (!q) { $catSuggestionsList.style.display = "none"; $catSuggestionsList.innerHTML = ""; return; }
  const filters = currentCatalogFilters();
  const matches = state.products.filter(p => matchesSearch(p, q) && matchesFilters(p, filters));
  renderCatSuggestions(matches);
}

$search.addEventListener("input", () => { renderGrid(); updateCatSuggestions(); });
$search.addEventListener("focus", () => {
  if ($search.value.trim() && $catSuggestionsList.innerHTML) $catSuggestionsList.style.display = "block";
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#catSuggestWrap")) $catSuggestionsList.style.display = "none";
});

$sortBy.addEventListener("change", renderGrid);
[$filterExpansion, $filterColor, $filterCardType].forEach(el => {
  el.addEventListener("change", () => { renderGrid(); updateCatSuggestions(); });
});

// ---------------------------------------------------------------------------
// Coleccion (persistida en localStorage -- esta pagina corre local, sin
// internet ni servidor, asi que localStorage es el lugar natural)
// ---------------------------------------------------------------------------
const OLD_COLLECTION_KEY = "tcg_collection_v1"; // formato viejo: una sola coleccion, lista plana
const COLLECTIONS_KEY = "tcg_collections_v1";    // formato nuevo: varias colecciones

function uid() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadCollectionsStore() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_KEY);
    if (raw) {
      const store = JSON.parse(raw);
      if (store && Array.isArray(store.collections) && store.collections.length) {
        if (!store.activeId || !store.collections.some(c => c.id === store.activeId)) {
          store.activeId = store.collections[0].id;
        }
        return store;
      }
    }
  } catch (e) { /* ignora y sigue a migracion / default */ }

  // Migracion desde el formato viejo (una sola lista en localStorage)
  let migratedItems = [];
  try {
    const oldRaw = localStorage.getItem(OLD_COLLECTION_KEY);
    if (oldRaw) migratedItems = JSON.parse(oldRaw) || [];
  } catch (e) { /* ignora */ }

  const firstCollection = { id: uid(), name: "Mi colección", items: migratedItems };
  const store = { collections: [firstCollection], activeId: firstCollection.id };
  saveCollectionsStore(store);
  return store;
}

function saveCollectionsStore(store) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(store));
}

let colStore = loadCollectionsStore();

function getActiveCollection() {
  return colStore.collections.find(c => c.id === colStore.activeId) || colStore.collections[0];
}

function saveColStore() { saveCollectionsStore(colStore); }

const $colSelect = document.getElementById("colSelect");
const $colNewBtn = document.getElementById("colNewBtn");
const $colRenameBtn = document.getElementById("colRenameBtn");
const $colDeleteBtn = document.getElementById("colDeleteBtn");
const $colSearch = document.getElementById("colSearch");
const $suggestionsList = document.getElementById("suggestionsList");
const $addToCollection = document.getElementById("addToCollection");
const $colGrid = document.getElementById("colGrid");
const $colEmpty = document.getElementById("colEmpty");
const $totalMedian = document.getElementById("totalMedian");
const $totalAvg = document.getElementById("totalAvg");
const $totalCount = document.getElementById("totalCount");
const $updatePricesBtn = document.getElementById("updatePricesBtn");
const $updateBox = document.getElementById("updateBox");
const $updateCommand = document.getElementById("updateCommand");
const $copyCommand = document.getElementById("copyCommand");
const $colFilterExpansion = document.getElementById("colFilterExpansion");
const $colFilterColor = document.getElementById("colFilterColor");
const $colFilterCardType = document.getElementById("colFilterCardType");

[$colFilterExpansion, $colFilterColor, $colFilterCardType].forEach(el => {
  el.addEventListener("change", renderCollection);
});

function renderColSelector() {
  $colSelect.innerHTML = colStore.collections.map(c =>
    `<option value="${c.id}" ${c.id === colStore.activeId ? "selected" : ""}>${escapeHtml(c.name)} (${c.items.reduce((s, i) => s + i.qty, 0)})</option>`
  ).join("");
}

$colSelect.addEventListener("change", () => {
  colStore.activeId = $colSelect.value;
  saveColStore();
  renderCollection();
});

$colNewBtn.addEventListener("click", () => {
  const name = prompt("Nombre de la nueva colección:", "Nueva colección");
  if (!name || !name.trim()) return;
  const c = { id: uid(), name: name.trim(), items: [] };
  colStore.collections.push(c);
  colStore.activeId = c.id;
  saveColStore();
  renderColSelector();
  renderCollection();
});

$colRenameBtn.addEventListener("click", () => {
  const active = getActiveCollection();
  const name = prompt("Nuevo nombre para la colección:", active.name);
  if (!name || !name.trim()) return;
  active.name = name.trim();
  saveColStore();
  renderColSelector();
});

$colDeleteBtn.addEventListener("click", () => {
  const active = getActiveCollection();
  if (colStore.collections.length <= 1) {
    alert("No podés eliminar la última colección. Creá otra primero si querés reemplazarla.");
    return;
  }
  if (!confirm(`¿Eliminar la colección "${active.name}" y todas sus cartas? Esta acción no se puede deshacer.`)) return;
  colStore.collections = colStore.collections.filter(c => c.id !== active.id);
  colStore.activeId = colStore.collections[0].id;
  saveColStore();
  renderColSelector();
  renderCollection();
});

let selectedSuggestion = null;

function sortedByPriceDesc(list) {
  return [...list].sort((a, b) => (priceNumber(b.listed_median) ?? -1) - (priceNumber(a.listed_median) ?? -1));
}

function renderSuggestionList(matches) {
  if (!matches.length) { $suggestionsList.style.display = "none"; return; }

  $suggestionsList.innerHTML = matches.map(p => `
    <div class="suggest-item" data-id="${p.product_id}">
      <img src="${p.image_url || ""}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0.15">
      <div class="info">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="sub">${escapeHtml((p.attributes && p.attributes["Number"]) || "")} · ${escapeHtml((p.attributes && p.attributes["Rarity"]) || "")}</div>
      </div>
      <div class="price">${escapeHtml(p.listed_median || "")}</div>
    </div>
  `).join("");
  $suggestionsList.style.display = "block";

  $suggestionsList.querySelectorAll("div[data-id]").forEach(el => {
    el.addEventListener("click", () => {
      const p = productsById[el.dataset.id];
      selectedSuggestion = p;
      $colSearch.value = p.name;
      $suggestionsList.style.display = "none";
    });
  });
}

$colSearch.addEventListener("input", () => {
  const q = $colSearch.value.trim().toLowerCase();
  selectedSuggestion = null;
  if (!q) {
    renderSuggestionList(sortedByPriceDesc(state.products));
    return;
  }
  const matches = sortedByPriceDesc(state.products.filter(p => matchesSearch(p, q)));
  renderSuggestionList(matches);
});

// Al hacer foco (aunque no haya nada escrito), mostrar todas las cartas
// ordenadas alfabeticamente, para poder elegir sin tener que tipear
$colSearch.addEventListener("focus", () => {
  if (!$colSearch.value.trim()) {
    renderSuggestionList(sortedByPriceDesc(state.products));
  } else {
    $suggestionsList.style.display = "block";
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#suggestions")) $suggestionsList.style.display = "none";
});

$addToCollection.addEventListener("click", () => {
  let product = selectedSuggestion;
  // Si no eligio de la lista de sugerencias, intentamos matchear por nombre exacto o id
  if (!product) {
    const q = $colSearch.value.trim();
    product = state.products.find(p => String(p.product_id) === q) ||
              state.products.find(p => (p.name || "").toLowerCase() === q.toLowerCase());
  }
  if (!product) {
    alert("Elegí una carta de la lista de sugerencias antes de agregar.");
    return;
  }
  const active = getActiveCollection();
  const existing = active.items.find(c => c.product_id === String(product.product_id));
  if (existing) existing.qty += 1;
  else active.items.push({ product_id: String(product.product_id), qty: 1 });

  saveColStore();
  $colSearch.value = "";
  selectedSuggestion = null;
  $suggestionsList.style.display = "none";
  renderColSelector();
  renderCollection();
});

function renderCollection() {
  renderColSelector();
  const active = getActiveCollection();
  const items = active.items;

  const ownedProducts = items.map(i => productsById[i.product_id]).filter(Boolean);
  populateFilterOptions($colFilterExpansion, uniqueSorted(ownedProducts.map(getExpansion)), "Expansión: Todas");
  populateFilterOptions($colFilterColor, uniqueSorted(ownedProducts.map(p => p.attributes && p.attributes["Color"])), "Color: Todos");
  populateFilterOptions($colFilterCardType, uniqueSorted(ownedProducts.map(p => p.attributes && p.attributes["Card Type"])), "Tipo de carta: Todos");

  const colFilters = {
    expansion: $colFilterExpansion.value,
    color: $colFilterColor.value,
    cardType: $colFilterCardType.value,
  };
  const visible = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => {
      const p = productsById[item.product_id];
      if (!p) return true; // siempre mostramos las cartas "huerfanas" (ya no en la base)
      return matchesFilters(p, colFilters);
    });

  $colGrid.style.display = items.length ? "grid" : "none";
  $colEmpty.style.display = items.length ? "none" : "block";

  if (items.length && !visible.length) {
    $colGrid.style.display = "block";
    $colGrid.innerHTML = `<div style="color:var(--muted); padding:20px 0;">Ningún resultado coincide con esos filtros.</div>`;
    $totalMedian.textContent = fmtMoney(0);
    $totalAvg.textContent = fmtMoney(0);
    $totalCount.textContent = 0;
    return;
  }

  let totalMedian = 0, totalAvg = 0, totalCount = 0;
  let missingMedian = false, missingAvg = false;

  $colGrid.innerHTML = visible.map(({ item, idx }) => {
    const p = productsById[item.product_id];
    if (!p) {
      return `
        <div class="colcard">
          <div class="body">
            <div class="name" style="color:var(--muted);">Producto ${escapeHtml(item.product_id)} ya no está en la base (¿lo borraste?)</div>
            <button class="rm-btn" data-idx="${idx}">✕ Quitar</button>
          </div>
        </div>`;
    }
    const a = p.attributes || {};
    const median = priceNumber(p.listed_median);
    const avg = p.average_sale_price;
    const subMedian = median != null ? median * item.qty : null;
    const subAvg = avg != null ? avg * item.qty : null;

    if (median != null) totalMedian += subMedian; else missingMedian = true;
    if (avg != null) totalAvg += subAvg; else missingAvg = true;
    totalCount += item.qty;

    return `
      <div class="colcard" data-product-id="${escapeHtml(p.product_id)}">
        <img src="${p.image_url || ""}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.style.opacity=0.15">
        <div class="body">
          <div class="name">${escapeHtml(p.name || "(sin nombre)")}</div>
          <div class="sub">${escapeHtml(a["Number"] || "")} · ${escapeHtml(a["Rarity"] || "")}</div>

          <div class="info-row qtyRow">
            <span class="k">Cantidad</span>
            <input type="number" class="qty" min="1" value="${item.qty}" data-idx="${idx}">
          </div>
          <div class="info-row median-row">
            <span class="k">Listed Median</span>
            <span class="v">${escapeHtml(p.listed_median || "-")}</span>
          </div>
          <div class="info-row">
            <span class="k">Ventas recientes (prom.)</span>
            <span class="v">${avg != null ? "$" + avg : "-"}</span>
          </div>
          <div class="info-row">
            <span class="k">Subtotal (Median)</span>
            <span class="v">${fmtMoney(subMedian)}</span>
          </div>
          <div class="info-row">
            <span class="k">Subtotal (Ventas Recientes)</span>
            <span class="v">${fmtMoney(subAvg)}</span>
          </div>
          <div class="info-row">
            <span class="k">Última actualización</span>
            <span class="v">${fmtDate(p.last_scraped)}</span>
          </div>

          <button class="rm-btn" data-idx="${idx}">✕ Quitar de la colección</button>
        </div>
      </div>`;
  }).join("");

  $colGrid.querySelectorAll("input.qty").forEach(inp => {
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.dataset.idx, 10);
      active.items[idx].qty = Math.max(1, parseInt(inp.value, 10) || 1);
      saveColStore();
      renderCollection();
    });
  });
  $colGrid.querySelectorAll("button.rm-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      active.items.splice(idx, 1);
      saveColStore();
      renderCollection();
    });
  });
  $colGrid.querySelectorAll(".colcard").forEach(el => {
    el.addEventListener("click", () => {
      const p = productsById[el.dataset.productId];
      if (p) openModal(p);
    });
  });

  $totalMedian.textContent = fmtMoney(totalMedian) + (missingMedian ? " *" : "");
  $totalAvg.textContent = fmtMoney(totalAvg) + (missingAvg ? " *" : "");
  $totalCount.textContent = totalCount;
}

$updatePricesBtn.addEventListener("click", () => {
  const active = getActiveCollection();
  if (!active.items.length) {
    alert("Esta colección está vacía, agregá cartas primero.");
    return;
  }
  const ids = active.items.map(c => c.product_id).join(" ");
  $updateCommand.textContent = `python details.py ${ids}`;
  $updateBox.style.display = "block";
});

$copyCommand.addEventListener("click", () => {
  navigator.clipboard.writeText($updateCommand.textContent).then(() => {
    $copyCommand.textContent = "¡Copiado!";
    setTimeout(() => { $copyCommand.textContent = "Copiar comando"; }, 1500);
  });
});

// ---------------------------------------------------------------------------
// Herramientas: generadores de comando (no ejecutan nada -- la pagina es
// estatica y no tiene backend. Solo arman el comando exacto para copiar y
// correr en la terminal, reutilizando los modos que ya tiene details.py)
// ---------------------------------------------------------------------------
function setupCommandTool(genBtnId, copyBtnId, cmdBoxId, buildFn) {
  const $gen = document.getElementById(genBtnId);
  const $copy = document.getElementById(copyBtnId);
  const $box = document.getElementById(cmdBoxId);

  $gen.addEventListener("click", () => {
    const cmd = buildFn();
    if (cmd === null) return; // buildFn ya mostro el error (alert)
    $box.textContent = cmd;
    $box.style.display = "block";
    $copy.style.display = "inline-block";
    $copy.textContent = "Copiar comando";
  });

  $copy.addEventListener("click", () => {
    navigator.clipboard.writeText($box.textContent).then(() => {
      $copy.textContent = "¡Copiado!";
      setTimeout(() => { $copy.textContent = "Copiar comando"; }, 1500);
    });
  });
}

// 1) IDs especificos -> python details.py <id1> <id2> ...
setupCommandTool("toolIdsGen", "toolIdsCopy", "toolIdsCmd", () => {
  const raw = document.getElementById("toolIds").value.trim();
  if (!raw) { alert("Ingresá al menos un ID."); return null; }
  const ids = raw.split(/[\s,]+/).filter(Boolean);
  return `python details.py ${ids.join(" ")}`;
});

// 2) Rango -> python details.py --range <inicio> <fin> "<categoria>"
const $toolRangeStart = document.getElementById("toolRangeStart");
const $toolRangeCount = document.getElementById("toolRangeCount");
const $toolRangePreview = document.getElementById("toolRangePreview");

function updateRangePreview() {
  const start = parseInt($toolRangeStart.value, 10);
  const count = parseInt($toolRangeCount.value, 10);
  if (!isNaN(start) && !isNaN(count) && count > 0) {
    const end = start + count - 1;
    $toolRangePreview.textContent = `Esto va a recorrer desde ${start} hasta ${end} (${count} IDs).`;
  } else {
    $toolRangePreview.textContent = "";
  }
}
$toolRangeStart.addEventListener("input", updateRangePreview);
$toolRangeCount.addEventListener("input", updateRangePreview);

setupCommandTool("toolRangeGen", "toolRangeCopy", "toolRangeCmd", () => {
  const start = parseInt($toolRangeStart.value, 10);
  const count = parseInt($toolRangeCount.value, 10);
  if (isNaN(start) || isNaN(count) || count <= 0) {
    alert("Completá 'Inicio' y 'Cantidad de registros hacia adelante' (mayor a 0).");
    return null;
  }
  const end = start + count - 1;
  const category = document.getElementById("toolRangeCategory").value.trim();
  return category
    ? `python details.py --range ${start} ${end} "${category}"`
    : `python details.py --range ${start} ${end}`;
});

// 3) Verificar rango de numeros -> python tcgplayer_db.py check-range <prefijo> <desde> <hasta>
setupCommandTool("toolCheckGen", "toolCheckCopy", "toolCheckCmd", () => {
  const prefix = document.getElementById("toolCheckPrefix").value.trim();
  const start = parseInt(document.getElementById("toolCheckStart").value, 10);
  const end = parseInt(document.getElementById("toolCheckEnd").value, 10);
  if (!prefix || isNaN(start) || isNaN(end)) {
    alert("Completá prefijo, 'Desde' y 'Hasta'.");
    return null;
  }
  return `python tcgplayer_db.py check-range ${prefix} ${start} ${end}`;
});

// ---------------------------------------------------------------------------
// Ejecucion real via server.py (fetch al servidor local). Si el servidor
// no esta corriendo (pagina abierta con doble-click, sin server.py), los
// botones "Ejecutar ahora" muestran un error explicando que hace falta
// levantarlo -- las cajas de "Generar comando" siguen funcionando igual.
// ---------------------------------------------------------------------------
const API_BASE = "http://localhost:8000";
let serverOnline = false;

async function checkServer() {
  const $note = document.getElementById("serverNote");
  try {
    const res = await fetch(`${API_BASE}/data.js`, { method: "GET" });
    serverOnline = res.ok;
  } catch (e) {
    serverOnline = false;
  }
  if (serverOnline) {
    $note.textContent = "✔ server.py detectado — los botones \"Ejecutar ahora\" van a correr los scripts de verdad.";
    $note.className = "server-note online";
  } else {
    $note.textContent = "server.py no está corriendo. Los botones \"Ejecutar ahora\" no van a funcionar hasta que lo inicies (python server.py) y abras esta página como http://localhost:8000 en vez de abrir el archivo directo. Mientras tanto podés usar \"Generar comando\" y correrlo vos a mano.";
    $note.className = "server-note offline";
  }
}
checkServer();

function setupRunTool(runBtnId, statusId, buildPayload, endpoint, onSuccess) {
  const $run = document.getElementById(runBtnId);
  const $status = document.getElementById(statusId);

  $run.addEventListener("click", async () => {
    const payload = buildPayload();
    if (payload === null) return; // buildPayload ya mostro el error

    if (!serverOnline) {
      $status.className = "tool-status err";
      $status.textContent = "server.py no está corriendo. Iniciálo con `python server.py` y abrí http://localhost:8000.";
      return;
    }

    $run.disabled = true;
    $status.className = "tool-status running";
    $status.textContent = "Ejecutando... esto puede tardar bastante según la cantidad de productos. No cierres esta pestaña.";

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      $status.className = "tool-status ok";
      onSuccess(data, $status);
    } catch (e) {
      $status.className = "tool-status err";
      $status.textContent = `Error: ${e.message}`;
    } finally {
      $run.disabled = false;
    }
  });
}

setupRunTool("toolIdsRun", "toolIdsStatus", () => {
  const raw = document.getElementById("toolIds").value.trim();
  if (!raw) { alert("Ingresá al menos un ID."); return null; }
  return { ids: raw.split(/[\s,]+/).filter(Boolean) };
}, "/api/scrape-ids", (data, $status) => {
  $status.textContent = `Listo, ${data.count} producto(s) procesados. Recargando página en 2s...`;
  setTimeout(() => location.reload(), 2000);
});

setupRunTool("toolRangeRun", "toolRangeStatus", () => {
  const start = parseInt(document.getElementById("toolRangeStart").value, 10);
  const count = parseInt(document.getElementById("toolRangeCount").value, 10);
  if (isNaN(start) || isNaN(count) || count <= 0) {
    alert("Completá 'Inicio' y 'Cantidad de registros hacia adelante' (mayor a 0).");
    return null;
  }
  const end = start + count - 1;
  const category = document.getElementById("toolRangeCategory").value.trim();
  return { start, end, category: category || undefined };
}, "/api/scrape-range", (data, $status) => {
  $status.textContent = "Listo. Recargando página en 2s...";
  setTimeout(() => location.reload(), 2000);
});

setupRunTool("toolCheckRun", "toolCheckStatus", () => {
  const prefix = document.getElementById("toolCheckPrefix").value.trim();
  const start = parseInt(document.getElementById("toolCheckStart").value, 10);
  const end = parseInt(document.getElementById("toolCheckEnd").value, 10);
  if (!prefix || isNaN(start) || isNaN(end)) {
    alert("Completá prefijo, 'Desde' y 'Hasta'.");
    return null;
  }
  return { prefix, start, end };
}, "/api/check-range", (data, $status) => {
  if (!data.missing.length) {
    $status.textContent = "✔ No falta ningún número en ese rango.";
  } else {
    $status.textContent = `Faltan ${data.missing.length}: ${data.missing.join(", ")}`;
  }
});

// ---------------------------------------------------------------------------
updateMeta();
initCatalogFilters();
renderGrid();