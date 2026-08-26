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
const $viewCatalogo = document.getElementById("viewCatalogo");
const $viewColeccion = document.getElementById("viewColeccion");

function showTab(tab) {
  const isCat = tab === "catalogo";
  $tabCatalogo.classList.toggle("active", isCat);
  $tabColeccion.classList.toggle("active", !isCat);
  $viewCatalogo.classList.toggle("active", isCat);
  $viewColeccion.classList.toggle("active", !isCat);
  if (!isCat) renderCollection();
}
$tabCatalogo.addEventListener("click", () => showTab("catalogo"));
$tabColeccion.addEventListener("click", () => showTab("coleccion"));

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
  if (mode === "median_desc") copy.sort((a, b) => (priceNumber(b.listed_median) ?? -1) - (priceNumber(a.listed_median) ?? -1));
  else if (mode === "median_asc") copy.sort((a, b) => (priceNumber(a.listed_median) ?? Infinity) - (priceNumber(b.listed_median) ?? Infinity));
  else if (mode === "recent") copy.sort((a, b) => (b.last_scraped || "").localeCompare(a.last_scraped || ""));
  else if (mode === "number") copy.sort((a, b) => naturalCompare((a.attributes && a.attributes["Number"]), (b.attributes && b.attributes["Number"])));
  else copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return copy;
}

function renderGrid() {
  const q = $search.value.trim();
  const mode = $sortBy.value || "number";
  const filtered = sortProducts(state.products.filter(p => matchesSearch(p, q)), mode);

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

$search.addEventListener("input", renderGrid);
$sortBy.addEventListener("change", renderGrid);

// ---------------------------------------------------------------------------
// Coleccion (persistida en localStorage -- esta pagina corre local, sin
// internet ni servidor, asi que localStorage es el lugar natural)
// ---------------------------------------------------------------------------
const COLLECTION_KEY = "tcg_collection_v1";

function loadCollection() {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
function saveCollection(items) {
  localStorage.setItem(COLLECTION_KEY, JSON.stringify(items));
}

let collection = loadCollection(); // [{product_id, qty}]

const $colSearch = document.getElementById("colSearch");
const $suggestionsList = document.getElementById("suggestionsList");
const $addToCollection = document.getElementById("addToCollection");
const $colTable = document.getElementById("colTable");
const $colBody = document.getElementById("colBody");
const $colEmpty = document.getElementById("colEmpty");
const $totalMedian = document.getElementById("totalMedian");
const $totalAvg = document.getElementById("totalAvg");
const $totalCount = document.getElementById("totalCount");
const $updatePricesBtn = document.getElementById("updatePricesBtn");
const $updateBox = document.getElementById("updateBox");
const $updateCommand = document.getElementById("updateCommand");
const $copyCommand = document.getElementById("copyCommand");

let selectedSuggestion = null;

function sortedByPriceDesc(list) {
  return [...list].sort((a, b) => (priceNumber(b.listed_median) ?? -1) - (priceNumber(a.listed_median) ?? -1));
}

function renderSuggestionList(matches) {
  if (!matches.length) { $suggestionsList.style.display = "none"; return; }

  $suggestionsList.innerHTML = matches.map(p => `
    <div data-id="${p.product_id}">
      <span>${escapeHtml(p.name)}</span>
      <span style="color:var(--muted);">${escapeHtml(p.listed_median || "")}</span>
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
  const existing = collection.find(c => c.product_id === String(product.product_id));
  if (existing) existing.qty += 1;
  else collection.push({ product_id: String(product.product_id), qty: 1 });

  saveCollection(collection);
  $colSearch.value = "";
  selectedSuggestion = null;
  $suggestionsList.style.display = "none";
  renderCollection();
});

function renderCollection() {
  $colTable.style.display = collection.length ? "table" : "none";
  $colEmpty.style.display = collection.length ? "none" : "block";

  let totalMedian = 0, totalAvg = 0, totalCount = 0;
  let missingMedian = false, missingAvg = false;

  $colBody.innerHTML = collection.map((item, idx) => {
    const p = productsById[item.product_id];
    if (!p) {
      return `<tr>
        <td colspan="6" style="color:var(--muted);">Producto ${item.product_id} ya no está en la base (¿lo borraste?)</td>
        <td><button class="rm" data-idx="${idx}">✕</button></td>
      </tr>`;
    }
    const median = priceNumber(p.listed_median);
    const avg = p.average_sale_price;
    const subMedian = median != null ? median * item.qty : null;
    const subAvg = avg != null ? avg * item.qty : null;

    if (median != null) totalMedian += subMedian; else missingMedian = true;
    if (avg != null) totalAvg += subAvg; else missingAvg = true;
    totalCount += item.qty;

    return `<tr>
      <td>
        <img class="thumb" src="${p.image_url || ""}" onerror="this.style.opacity=0.15">
        ${escapeHtml(p.name)}
      </td>
      <td><input type="number" class="qty" min="1" value="${item.qty}" data-idx="${idx}"></td>
      <td>${escapeHtml(p.listed_median || "-")}</td>
      <td>${avg != null ? "$" + avg : "-"}</td>
      <td>${fmtMoney(subMedian)}</td>
      <td>${fmtMoney(subAvg)}</td>
      <td><button class="rm" data-idx="${idx}">✕</button></td>
    </tr>`;
  }).join("");

  $colBody.querySelectorAll("input.qty").forEach(inp => {
    inp.addEventListener("change", () => {
      const idx = parseInt(inp.dataset.idx, 10);
      collection[idx].qty = Math.max(1, parseInt(inp.value, 10) || 1);
      saveCollection(collection);
      renderCollection();
    });
  });
  $colBody.querySelectorAll("button.rm").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.idx, 10);
      collection.splice(idx, 1);
      saveCollection(collection);
      renderCollection();
    });
  });

  $totalMedian.textContent = fmtMoney(totalMedian) + (missingMedian ? " *" : "");
  $totalAvg.textContent = fmtMoney(totalAvg) + (missingAvg ? " *" : "");
  $totalCount.textContent = totalCount;
}

$updatePricesBtn.addEventListener("click", () => {
  if (!collection.length) {
    alert("Tu colección está vacía, agregá cartas primero.");
    return;
  }
  const ids = collection.map(c => c.product_id).join(" ");
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
updateMeta();
renderGrid();