"""
tcgplayer_db.py

Base de datos local (SQLite, un solo archivo .db, sin dependencias externas)
para persistir los datos que extrae tcgplayer_product_details.py.

Tablas:
    products       -> datos "fijos" del producto (nombre, rareza, atributos...)
                       se actualiza (UPSERT) cada vez que se vuelve a scrapear.
    price_history   -> un registro por cada scrape: listed_median, promedio,
                       fecha. Sirve para ver evolucion de precio en el tiempo.
    sales          -> ventas individuales. Tiene UNIQUE(product_id, date,
                       condition, quantity, price) asi que si corres el
                       script de nuevo y vuelve a traer la misma venta, no
                       se duplica.

Uso tipico (ya integrado en tcgplayer_product_details.py):

    from tcgplayer_db import init_db, save_product_data

    conn = init_db()              # crea tcgplayer.db si no existe
    save_product_data(conn, data)  # data = dict que devuelve get_product()

Consultas rapidas desde la terminal:

    python tcgplayer_db.py list
        -> lista todos los productos guardados

    python tcgplayer_db.py history 693418
        -> historial de listed_median / promedio para ese producto

    python tcgplayer_db.py sales 693418
        -> todas las ventas guardadas de ese producto
"""

import sys
import os
import json
import sqlite3
from datetime import datetime, timezone

DEFAULT_DB_PATH = "tcgplayer.db"


def init_db(db_path=DEFAULT_DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS products (
            product_id TEXT PRIMARY KEY,
            name TEXT,
            url TEXT,
            image_url TEXT,
            category TEXT,
            attributes TEXT,           -- JSON: Rarity, Number, Color, Card Type, etc.
            listed_median TEXT,
            average_sale_price REAL,
            recent_sales_count INTEGER,
            last_scraped TEXT
        )
    """)

    # Migraciones para DBs creadas antes de agregar estas columnas
    for ddl in (
        "ALTER TABLE products ADD COLUMN image_url TEXT",
        "ALTER TABLE products ADD COLUMN category TEXT",
        "ALTER TABLE products ADD COLUMN first_seen TEXT",
    ):
        try:
            cur.execute(ddl)
        except sqlite3.OperationalError:
            pass

    cur.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            scraped_at TEXT NOT NULL,
            listed_median TEXT,
            average_sale_price REAL,
            FOREIGN KEY (product_id) REFERENCES products(product_id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            date TEXT,
            condition TEXT,
            quantity TEXT,
            price TEXT,
            scraped_at TEXT,
            FOREIGN KEY (product_id) REFERENCES products(product_id),
            UNIQUE(product_id, date, condition, quantity, price)
        )
    """)

    # Rellena 'first_seen' para productos que ya existian antes de agregar
    # esta columna: usamos el scrape mas viejo registrado en price_history
    # como mejor estimacion de "cuando se agrego" ese producto a la base.
    cur.execute("""
        UPDATE products
        SET first_seen = COALESCE(
            (SELECT MIN(scraped_at) FROM price_history WHERE price_history.product_id = products.product_id),
            last_scraped
        )
        WHERE first_seen IS NULL
    """)

    conn.commit()
    return conn


def save_product_data(conn, data):
    """
    Guarda en la base de datos el dict que devuelve get_product()/get_product_details().
    Hace upsert de 'products', agrega una fila a 'price_history', e inserta
    las ventas nuevas en 'sales' (ignorando las que ya existian).
    """
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    product_id = str(data["product_id"])

    # Todo lo que no es un campo "core" lo guardamos como JSON en 'attributes'
    core_keys = {
        "product_id", "url", "name", "category", "image_url", "valid", "recent_sales",
        "recent_sales_count", "average_sale_price", "listed_median", "elapsed_seconds",
    }
    attributes = {k: v for k, v in data.items() if k not in core_keys}

    cur = conn.cursor()

    cur.execute("""
        INSERT INTO products (product_id, name, url, image_url, category, attributes, listed_median,
                               average_sale_price, recent_sales_count, last_scraped, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET
            name=excluded.name,
            url=excluded.url,
            image_url=excluded.image_url,
            category=excluded.category,
            attributes=excluded.attributes,
            listed_median=excluded.listed_median,
            average_sale_price=excluded.average_sale_price,
            recent_sales_count=excluded.recent_sales_count,
            last_scraped=excluded.last_scraped
    """, (
        product_id,
        data.get("name"),
        data.get("url"),
        data.get("image_url"),
        data.get("category"),
        json.dumps(attributes, ensure_ascii=False),
        data.get("listed_median"),
        data.get("average_sale_price"),
        data.get("recent_sales_count"),
        now,
        now,
    ))

    cur.execute("""
        INSERT INTO price_history (product_id, scraped_at, listed_median, average_sale_price)
        VALUES (?, ?, ?, ?)
    """, (product_id, now, data.get("listed_median"), data.get("average_sale_price")))

    for s in data.get("recent_sales", []):
        cur.execute("""
            INSERT OR IGNORE INTO sales (product_id, date, condition, quantity, price, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (product_id, s.get("date"), s.get("condition"), s.get("quantity"), s.get("price"), now))

    conn.commit()


def export_web_data(conn, out_path="web/data.js"):
    """
    Exporta toda la base a un archivo JS (const TCG_DATA = {...};) para que
    la pagina web local (web/index.html) lo cargue con un simple
    <script src="data.js">, sin necesitar servidor ni conexion a internet.
    Se debe llamar despues de guardar datos nuevos (ya esta integrado en
    tcgplayer_product_details.py).
    """
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    rows = conn.execute("""
        SELECT product_id, name, url, image_url, category, attributes,
               listed_median, average_sale_price, recent_sales_count, last_scraped, first_seen
        FROM products ORDER BY name
    """).fetchall()

    products = []
    for (product_id, name, url, image_url, category, attributes_json,
         listed_median, average_sale_price, recent_sales_count, last_scraped, first_seen) in rows:

        attributes = json.loads(attributes_json) if attributes_json else {}

        sales_rows = conn.execute("""
            SELECT date, condition, quantity, price FROM sales
            WHERE product_id = ? ORDER BY date DESC LIMIT 10
        """, (product_id,)).fetchall()
        recent_sales = [
            {"date": d, "condition": c, "quantity": q, "price": p}
            for d, c, q, p in sales_rows
        ]

        history_rows = conn.execute("""
            SELECT scraped_at, listed_median, average_sale_price FROM price_history
            WHERE product_id = ? ORDER BY scraped_at
        """, (product_id,)).fetchall()
        price_history = [
            {"scraped_at": s, "listed_median": lm, "average_sale_price": avg}
            for s, lm, avg in history_rows
        ]

        products.append({
            "product_id": product_id,
            "name": name,
            "url": url,
            "image_url": image_url,
            "category": category,
            "attributes": attributes,
            "listed_median": listed_median,
            "average_sale_price": average_sale_price,
            "recent_sales_count": recent_sales_count,
            "last_scraped": last_scraped,
            "first_seen": first_seen or (price_history[0]["scraped_at"] if price_history else last_scraped),
            "recent_sales": recent_sales,
            "price_history": price_history,
        })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "products": products,
    }

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Archivo generado automaticamente -- no editar a mano.\n")
        f.write("// Se regenera cada vez que corres details.py\n")
        f.write("const TCG_DATA = ")
        f.write(json.dumps(payload, ensure_ascii=False, indent=2))
        f.write(";\n")

    print(f"Pagina web actualizada: {out_path} ({len(products)} productos)")


def check_range(conn, prefix, start, end):
    """
    Verifica que existan en la base todos los numeros de carta esperados,
    ej. check_range(conn, "OP16", 1, 119) revisa OP16-001 ... OP16-119.
    Nota: es normal que un mismo numero tenga varias filas (ej. version
    normal + alternate art comparten el mismo "Number"), asi que solo
    chequea que EXISTA al menos una, no que sea unico.
    """
    rows = conn.execute("SELECT attributes FROM products").fetchall()
    found = {}
    for (attrs_json,) in rows:
        attrs = json.loads(attrs_json) if attrs_json else {}
        num = attrs.get("Number")
        if num:
            found[num] = found.get(num, 0) + 1

    missing = []
    for i in range(start, end + 1):
        num = f"{prefix}-{i:03d}"
        if num not in found:
            missing.append(num)

    total_expected = end - start + 1
    present = total_expected - len(missing)
    print(f"Rango esperado: {prefix}-{start:03d} a {prefix}-{end:03d} ({total_expected} numeros)")
    print(f"Presentes: {present} | Faltantes: {len(missing)}")

    if missing:
        print("\nFaltan:")
        for m in missing:
            print(f"  {m}")
    else:
        print("\nNo falta ninguno. ✔")

    return missing


# ---------------------------------------------------------------------------
# Utilidades de consulta rapida desde la terminal
# ---------------------------------------------------------------------------

def _print_table(rows, headers):
    if not rows:
        print("(sin resultados)")
        return
    widths = [max(len(str(h)), max((len(str(r[i])) for r in rows), default=0)) for i, h in enumerate(headers)]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    print(fmt.format(*headers))
    print(fmt.format(*["-" * w for w in widths]))
    for r in rows:
        print(fmt.format(*[str(x) for x in r]))


def list_products(conn):
    cur = conn.execute("""
        SELECT product_id, name, listed_median, average_sale_price, image_url, last_scraped
        FROM products ORDER BY last_scraped DESC
    """)
    _print_table(cur.fetchall(), ["product_id", "name", "listed_median", "avg_sale_price", "image_url", "last_scraped"])


def show_history(conn, product_id):
    cur = conn.execute("""
        SELECT scraped_at, listed_median, average_sale_price
        FROM price_history WHERE product_id = ? ORDER BY scraped_at
    """, (str(product_id),))
    _print_table(cur.fetchall(), ["scraped_at", "listed_median", "avg_sale_price"])


def show_sales(conn, product_id):
    cur = conn.execute("""
        SELECT date, condition, quantity, price, scraped_at
        FROM sales WHERE product_id = ? ORDER BY date DESC
    """, (str(product_id),))
    _print_table(cur.fetchall(), ["date", "condition", "qty", "price", "scraped_at"])


if __name__ == "__main__":
    conn = init_db()
    if len(sys.argv) >= 2 and sys.argv[1] == "list":
        list_products(conn)
    elif len(sys.argv) >= 3 and sys.argv[1] == "history":
        show_history(conn, sys.argv[2])
    elif len(sys.argv) >= 3 and sys.argv[1] == "sales":
        show_sales(conn, sys.argv[2])
    elif len(sys.argv) >= 5 and sys.argv[1] == "check-range":
        # python tcgplayer_db.py check-range OP16 1 119
        prefix = sys.argv[2]
        start = int(sys.argv[3])
        end = int(sys.argv[4])
        check_range(conn, prefix, start, end)
    else:
        print("Uso:")
        print("  python tcgplayer_db.py list")
        print("  python tcgplayer_db.py history <product_id>")
        print("  python tcgplayer_db.py sales <product_id>")
        print("  python tcgplayer_db.py check-range <prefix> <inicio> <fin>")