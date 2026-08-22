// app.js -- toda la logica de la pagina. Lee la variable global TCG_DATA
// que viene definida en data.js (generado por tcgplayer_db.export_web_data()).

const state = {
  products: (typeof TCG_DATA !== "undefined" ? TCG_DATA.products : []) || [],
  generatedAt: (typeof TCG_DATA !== "undefined" ? TCG_DATA.generated_at : null),
};

const $grid = document.getElementById("grid");
const $empty = document.getElementById("empty");
const $search = document.getElementById("search");
const $sortBy = document.getElementById("sortBy");
const $overlay = document.getElementById("overlay");
const $modal = document.getElementById("modal");
const $metaInfo = document.getElementById("metaInfo");

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (e) {
    return iso;
  }
}

function priceNumber(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace("$", "").replace(",", ""));
  return isNaN(n) ? null : n;
}

function updateMeta() {
  const n = state.products.length;
  $metaInfo.textContent = n
    ? `${n} producto${n === 1 ? "" : "s"} · última actualización: ${fmtDate(state.generatedAt)}`
    : "Sin datos cargados";
}

function matchesSearch(p, q) {
  if (!q) return true;
  q = q.toLowerCase();
  const haystack = [
    p.name,
    p.category,
    p.attributes && p.attributes["Number"],
    p.attributes && p.attributes["Rarity"],
    p.attributes && p.attributes["Card Type"],
    p.attributes && p.attributes["Color"],
    String(p.product_id),
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

function sortProducts(list, mode) {
  const copy = [...list];
  if (mode === "median_desc") {
    copy.sort((a, b) => (priceNumber(b.listed_median) ?? -1) - (priceNumber(a.listed_median) ?? -1));
  } else if (mode === "median_asc") {
    copy.sort((a, b) => (priceNumber(a.listed_median) ?? Infinity) - (priceNumber(b.listed_median) ?? Infinity));
  } else if (mode === "recent") {
    copy.sort((a, b) => (b.last_scraped || "").localeCompare(a.last_scraped || ""));
  } else {
    copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }
  return copy;
}

function renderGrid() {
  const q = $search.value.trim();
  const mode = $sortBy.value;
  const filtered = sortProducts(state.products.filter(p => matchesSearch(p, q)), mode);

  $grid.innerHTML = "";
  $empty.style.display = filtered.length ? "none" : "block";

  for (const p of filtered) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <img src="${p.image_url || ""}" alt="${escapeHtml(p.name || "")}" loading="lazy"
           onerror="this.style.opacity=0.15">
      <div class="body">
        <div class="name">${escapeHtml(p.name || "(sin nombre)")}</div>
        <div class="sub">${escapeHtml((p.attributes && p.attributes["Number"]) || "")} · ${escapeHtml((p.attributes && p.attributes["Rarity"]) || "")}</div>
        <div class="prices">
          <span class="median">${p.listed_median || "-"}</span>
          <span class="avg">${p.average_sale_price != null ? "prom $" + p.average_sale_price : ""}</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => openModal(p));
    $grid.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function openModal(p) {
  const attrs = p.attributes || {};
  const attrRows = Object.entries(attrs)
    .map(([k, v]) => `<div><span class="k">${escapeHtml(k)}:</span> ${escapeHtml(v)}</div>`)
    .join("");

  const salesRows = (p.recent_sales || []).map(s => `
    <tr>
      <td>${escapeHtml(s.date)}</td>
      <td>${escapeHtml(s.condition)}</td>
      <td>${escapeHtml(s.quantity)}</td>
      <td>${escapeHtml(s.price)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">Sin ventas registradas</td></tr>`;

  const historyRows = (p.price_history || []).slice().reverse().map(h => `
    <tr>
      <td>${fmtDate(h.scraped_at)}</td>
      <td>${escapeHtml(h.listed_median || "-")}</td>
      <td>${h.average_sale_price != null ? "$" + h.average_sale_price : "-"}</td>
    </tr>
  `).join("") || `<tr><td colspan="3">Sin historial</td></tr>`;

  $modal.innerHTML = `
    <div class="mhead">
      <img src="${p.image_url || ""}" alt="">
      <div class="info">
        <h2>${escapeHtml(p.name || "")}</h2>
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
      <table>
        <thead><tr><th>Fecha</th><th>Condición</th><th>Cant.</th><th>Precio</th></tr></thead>
        <tbody>${salesRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h3>Historial de precio (por corrida del script)</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Listed Median</th><th>Promedio</th></tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;

  document.getElementById("closeModal").addEventListener("click", closeModal);
  $overlay.classList.add("open");
}

function closeModal() {
  $overlay.classList.remove("open");
}

$overlay.addEventListener("click", (e) => {
  if (e.target === $overlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

$search.addEventListener("input", renderGrid);
$sortBy.addEventListener("change", renderGrid);

updateMeta();
renderGrid();
