"""
tcgplayer_product_details.py

Dado uno o varios product_id de TCGplayer, extrae:
    - Nombre del producto:
        <h1 data-testid="lblProductDetailsProductName">...</h1>
    - Todos los atributos tipo "Label: Value" que siguen el patron:
        <div><strong>Label:</strong><span>Value</span></div>
      (esto cubre Rarity, Number, y cualquier otro atributo con la misma
      estructura, ej. Card Type, Set, etc. -- no hace falta hardcodear
      cada label a mano)

Requisitos:
    pip install playwright
    playwright install chromium

Uso:
    python tcgplayer_product_details.py
        -> usa la lista PRODUCT_IDS definida mas abajo

    python tcgplayer_product_details.py 693417 454512 288228
        -> usa los product_id pasados por linea de comandos
"""

import sys
import json
import time
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from tcgplayer_db import init_db, save_product_data, export_web_data


def new_context(browser):
    """
    Crea un context con user-agent de escritorio y bloquea recursos que no
    necesitamos (imagenes, CSS, fuentes, video) para que cada pagina cargue
    mucho mas rapido -- solo nos interesa el HTML/JS que arma el DOM.
    """
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        ),
        viewport={"width": 1366, "height": 900},
    )

    def _block_heavy_resources(route):
        if route.request.resource_type in ("image", "media", "font", "stylesheet"):
            route.abort()
        else:
            route.continue_()

    context.route("**/*", _block_heavy_resources)
    return context


def build_url(product_id, language="English"):
    return f"https://www.tcgplayer.com/product/{product_id}?Language={language}"


def close_popups(page, timeout=3000):
    """
    Cierra popups que puede mostrar TCGplayer y que tapan el contenido,
    por ejemplo el de "Shipping to <pais>" que aparece segun la
    geolocalizacion/IP de quien accede (bloquea el click en "View More Data").
    Se intenta varias veces porque a veces tarda un toque en aparecer.
    """
    selectors = [
        "button:has-text('Close')",
        "button:has-text('Cerrar')",
        "[aria-label='Close']",
        "button:has-text('Accept')",
        "button:has-text('Aceptar')",
        "#onetrust-accept-btn-handler",
    ]
    for selector in selectors:
        try:
            page.click(selector, timeout=timeout)
        except PWTimeout:
            pass


def get_listed_median(page, timeout=5000):
    """
    Busca la celda "Listed Median" dentro de la tabla de Price Points del
    modal Sales History Snapshot y devuelve el valor de la celda siguiente
    (ej. "$68.00"). Usa contains() en vez de igualdad exacta porque la
    celda del label puede traer contenido anidado (icono/tooltip).
    Devuelve None si no aparece.
    """
    try:
        loc = page.locator(
            "xpath=//td[contains(normalize-space(.), 'Listed Median')]"
            "/following-sibling::td[1]"
        )
        loc.first.wait_for(state="visible", timeout=timeout)
        text = loc.first.inner_text().strip()
        return text if text else None
    except PWTimeout:
        return None


def get_recent_sales(page, max_sales=5, timeout=20000):
    """
    Asume que 'page' ya esta en la pagina del producto (get_product_details
    ya hizo el page.goto). Hace click en "View More Data" para abrir el
    modal "Sales History Snapshot" y extrae las primeras `max_sales` filas.
    """
    # Cerrar popups (banner de cookies, "Shipping to <pais>", etc.) que
    # puedan estar tapando el link "View More Data"
    close_popups(page)

    try:
        # <div class="modal__activator link-subdued" role="button">View More Data</div>
        view_more = page.locator(
            "div.modal__activator[role='button']", has_text="View More Data"
        )
        if view_more.count() == 0:
            view_more = page.get_by_text("View More Data", exact=False)

        view_more.first.scroll_into_view_if_needed(timeout=timeout)
        view_more.first.wait_for(state="visible", timeout=timeout)

        try:
            view_more.first.click(timeout=timeout, force=True)
        except Exception:
            view_more.first.evaluate("el => el.click()")
    except PWTimeout:
        # El producto puede no tener historial de ventas -> no hay boton
        return None, []

    table_body_selector = ".latest-sales-table__tbody"
    try:
        page.wait_for_selector(table_body_selector, timeout=timeout, state="attached")
        page.wait_for_timeout(500)  # instante extra para que Vue pinte las filas
    except PWTimeout:
        return None, []

    listed_median = get_listed_median(page)

    rows = page.query_selector_all(f"{table_body_selector} tr")

    sales = []
    for row in rows[:max_sales]:
        cells = row.query_selector_all("td")
        if len(cells) < 4:
            continue
        sales.append(
            {
                "date": cells[0].inner_text().strip(),
                "condition": clean_condition(cells[1].inner_text()),
                "quantity": cells[2].inner_text().strip(),
                "price": cells[3].inner_text().strip(),
            }
        )

    # Cerrar el modal por si se reutiliza la misma pestana
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass

    return listed_median, sales


def clean_condition(text):
    """
    La celda de condicion suele traer el texto corto y el largo pegados
    (ej. "NM Foil\\nNear Mint Foil"). Nos quedamos solo con la primera
    linea (el texto corto).
    """
    return text.strip().split("\n")[0].strip()


def parse_price(price_str):
    """Convierte '$78.01' -> 78.01. Devuelve None si no se puede parsear."""
    try:
        return float(price_str.replace("$", "").replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def get_image_url(page, timeout=5000):
    """
    Extrae la URL de la imagen del producto, ej:
        <img data-testid="product-image__container--..." src="https://tcgplayer-cdn.../696100_in_200x200.jpg">
    Como bloqueamos la carga de imagenes por velocidad, esto solo lee el
    atributo 'src' del HTML -- no descarga el archivo. Devuelve la version
    mas grande disponible (usa el srcset si esta presente).
    """
    try:
        img = page.locator('img[data-testid^="product-image__container"]').first
        img.wait_for(state="attached", timeout=timeout)

        srcset = img.get_attribute("srcset")
        if srcset:
            # srcset trae varias resoluciones separadas por coma, ej:
            # "...200x200.jpg 200w,...400x400.jpg 400w,...1000x1000.jpg 1000w"
            # nos quedamos con la de mayor resolucion (la ultima)
            candidates = [c.strip().split(" ")[0] for c in srcset.split(",") if c.strip()]
            if candidates:
                return candidates[-1]

        return img.get_attribute("src")
    except PWTimeout:
        return None


def get_category(page, timeout=5000):
    """
    Extrae la categoria del breadcrumb, ej:
        <a data-testid="lnkProductDetailsCategoryLine">One Piece Card Game</a>
    Devuelve el texto o None si no aparece (producto invalido/redirigido).
    """
    try:
        loc = page.locator('[data-testid="lnkProductDetailsCategoryLine"]')
        loc.first.wait_for(state="visible", timeout=timeout)
        return loc.first.inner_text().strip()
    except PWTimeout:
        return None


def get_product_details(page, product_id, language="English", timeout=20000):
    url = build_url(product_id, language)
    page.goto(url, wait_until="domcontentloaded", timeout=timeout)

    # Cerrar banner de cookies / popups de shipping si aparecen
    close_popups(page)

    # Nombre del producto -- si esto no aparece, el product_id probablemente
    # no existe o redirige a otra pagina (comun al escanear un rango de ids)
    name_selector = '[data-testid="lblProductDetailsProductName"]'
    try:
        page.wait_for_selector(name_selector, timeout=timeout)
    except PWTimeout:
        return {
            "product_id": product_id,
            "url": url,
            "name": None,
            "category": None,
            "valid": False,
        }
    name = page.locator(name_selector).inner_text().strip()

    category = get_category(page)
    image_url = get_image_url(page)

    # Atributos tipo "Label: Value" -> <div><strong>Label:</strong><span>Value</span></div>
    # NOTA: este selector busca ese patron en TODA la pagina. Si el sitio
    # tiene otros bloques con la misma estructura (menu, footer, etc.) podrian
    # colarse claves no deseadas. Si eso pasa, conviene acotar la busqueda a
    # un contenedor padre especifico (ej. ".product-details__attributes" o
    # el que corresponda) -- mandame el inspeccionar elemento de ese
    # contenedor y lo ajusto.
    attr_divs = page.query_selector_all("div:has(> strong)")
    attributes = {}
    for div in attr_divs:
        strong = div.query_selector("strong")
        span = div.query_selector("span")
        if not strong or not span:
            continue
        label = strong.inner_text().strip().rstrip(":").strip()
        value = span.inner_text().strip()
        if label and value:
            attributes[label] = value

    listed_median, recent_sales = get_recent_sales(page)

    prices = [p for p in (parse_price(s["price"]) for s in recent_sales) if p is not None]
    average_price = round(sum(prices) / len(prices), 2) if prices else None

    return {
        "product_id": product_id,
        "url": url,
        "name": name,
        "category": category,
        "image_url": image_url,
        "valid": True,
        **attributes,
        "recent_sales": recent_sales,
        "recent_sales_count": len(recent_sales),
        "average_sale_price": average_price,
        "listed_median": listed_median,
    }


CYAN = ""
YELLOW = ""
RESET = ""


def get_product(product_id, language="English", headless=True):
    """
    Punto de entrada simple: le das UN product_id y te devuelve el dict
    con los datos extraidos. Maneja el navegador internamente, asi que
    no necesitas preocuparte por Playwright para usarlo.

    headless=False abre una ventana de Chrome visible -- util para
    depurar si algo no esta funcionando (ver que esta pasando en pantalla).

    Ejemplo:
        data = get_product(693417)
        print(data["name"])           # "Portgas.D.Ace (001) - The Time of Battle (OP16)"
        print(data["Rarity"])         # "L"
        print(data["Number"])         # "OP16-001"
        print(data["recent_sales"])   # lista de las ultimas 5 ventas [{date, condition, quantity, price}, ...]
        print(data["elapsed_seconds"])  # cuanto tardo en procesar este producto
    """
    start = time.perf_counter()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = new_context(browser)
        page = context.new_page()
        try:
            data = get_product_details(page, product_id, language)
        finally:
            browser.close()
    data["elapsed_seconds"] = round(time.perf_counter() - start, 2)
    return data


def scan_range(start_id, end_id, category_filter=None, language="English"):
    """
    Recorre TODOS los product_id entre start_id y end_id (inclusive),
    extrae sus datos, y guarda en la base SOLO los que coincidan con
    `category_filter` (comparacion exacta, ej. "One Piece Card Game").
    Si category_filter es None, guarda todos los productos validos.

    Los ids que no correspondan a ningun producto real (paginas invalidas/
    redirigidas) se saltean automaticamente.
    """
    conn = init_db()
    saved, skipped_category, skipped_invalid = 0, 0, 0
    total_start = time.perf_counter()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = new_context(browser)
        page = context.new_page()

        for pid in range(start_id, end_id + 1):
            start = time.perf_counter()
            try:
                data = get_product_details(page, pid, language)
            except Exception as e:
                print(f"[{pid}] Error: {e}")
                skipped_invalid += 1
                time.sleep(0.5)
                continue

            elapsed = round(time.perf_counter() - start, 2)

            if not data.get("valid"):
                print(f"[{pid}] (no existe / redirige) - {elapsed}s")
                skipped_invalid += 1
                time.sleep(0.5)
                continue

            category = data.get("category")
            if category_filter and category != category_filter:
                print(f"[{pid}] {data.get('name')} -> categoria '{category}' (omitido) - {elapsed}s")
                skipped_category += 1
                time.sleep(0.5)
                continue

            data["elapsed_seconds"] = elapsed
            save_product_data(conn, data)
            saved += 1
            print(f"[{pid}] {data.get('name')} -> GUARDADO (categoria: {category}) - {elapsed}s")

            time.sleep(0.5)  # pausa breve entre paginas

        browser.close()

    total_elapsed = round(time.perf_counter() - total_start, 2)
    print(
        f"\nListo. Guardados: {saved} | Omitidos por categoria: {skipped_category} "
        f"| Invalidos/no existen: {skipped_invalid}"
    )
    print(f"Tiempo total: {total_elapsed}s ({round(total_elapsed / 60, 2)} min)")
    export_web_data(conn)


def main(product_ids, language="English"):
    results = {}
    conn = init_db()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = new_context(browser)
        page = context.new_page()

        for pid in product_ids:
            print(f"Procesando product_id={pid}")
            start = time.perf_counter()
            try:
                data = get_product_details(page, pid, language)
                elapsed = round(time.perf_counter() - start, 2)
                data["elapsed_seconds"] = elapsed
                results[str(pid)] = data
                print(f"  Nombre: {data.get('name')}")
                for k, v in data.items():
                    if k not in (
                        "product_id", "url", "name", "category", "image_url", "valid", "listed_median",
                        "recent_sales", "recent_sales_count",
                        "average_sale_price", "elapsed_seconds",
                    ):
                        print(f"  {k}: {v}")
                for s in data.get("recent_sales", []):
                    print(
                        f"    Sale: {s['date']:<8} {s['condition']:<12} "
                        f"qty={s['quantity']:<3} {s['price']}"
                    )
                print(f"  Promedio ({data.get('recent_sales_count')} ventas): ${data.get('average_sale_price')}")
                print(f"  {CYAN}Listed Median: {data.get('listed_median')}{RESET}")
                print(f"  {YELLOW}Tiempo: {elapsed}s{RESET}")
                save_product_data(conn, data)
            except Exception as e:
                print(f"  Error: {e}")
                results[str(pid)] = {"error": str(e), "url": build_url(pid, language)}
            time.sleep(0.5)  # pausa breve entre paginas

        browser.close()

    out_path = "tcgplayer_product_details.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nGuardado en {out_path} y en tcgplayer.db")
    export_web_data(conn)
    return results


# IDs de ejemplo (los que compartiste)
PRODUCT_IDS = [693417, 454512, 288228]


if __name__ == "__main__":
    # Un solo id -> imprime el resultado directo (sin JSON de batch)
    if len(sys.argv) >= 3 and sys.argv[1] == "--range":
        # python details.py --range 696007 696100 "One Piece Card Game"
        start_id = int(sys.argv[2])
        end_id = int(sys.argv[3])
        category_filter = sys.argv[4] if len(sys.argv) > 4 else None
        print(f"Escaneando product_id {start_id} a {end_id} "
              f"(filtro categoria: {category_filter or 'ninguno'})")
        scan_range(start_id, end_id, category_filter)
    elif len(sys.argv) == 2:
        pid = sys.argv[1]
        print(f"Procesando product_id={pid}")
        data = get_product(pid)
        print(json.dumps(data, ensure_ascii=False, indent=2))

        conn = init_db()
        save_product_data(conn, data)
        print("Guardado en tcgplayer.db")
        export_web_data(conn)
    else:
        # Varios ids (o ninguno -> usa PRODUCT_IDS) -> corre en batch y guarda JSON
        ids = sys.argv[1:] if len(sys.argv) > 1 else PRODUCT_IDS
        main(ids)
