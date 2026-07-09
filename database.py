import sqlite3
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "iot_data.db")


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS lecturas (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            nodo        INTEGER NOT NULL,
            timestamp   TEXT    NOT NULL,
            pulso       REAL,
            spo2        REAL,
            temperatura REAL,
            humedad     REAL,
            co2         REAL,
            presion     REAL,
            gas         REAL,
            luz_estado  INTEGER,
            vent_estado INTEGER,
            rssi        INTEGER
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_nodo_ts ON lecturas(nodo, timestamp)")
    try:
        c.execute("ALTER TABLE lecturas ADD COLUMN gas REAL")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    conn.close()


def guardar_lectura(nodo: int, data: dict):
    conn = get_connection()
    c = conn.cursor()
    ts = data.get("timestamp", datetime.utcnow().isoformat())
    c.execute("""
        INSERT INTO lecturas
            (nodo, timestamp, pulso, spo2, temperatura, humedad, co2, presion, gas, luz_estado, vent_estado, rssi)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        nodo,
        ts,
        data.get("pulso"),
        data.get("spo2"),
        data.get("temperatura"),
        data.get("humedad"),
        data.get("co2"),
        data.get("presion"),
        data.get("gas"),
        1 if data.get("luz") is True else (0 if data.get("luz") is False else None),
        1 if data.get("ventilador") is True else (0 if data.get("ventilador") is False else None),
        data.get("rssi"),
    ))
    conn.commit()
    conn.close()


def limpiar_viejos(dias: int = 7):
    conn = get_connection()
    c = conn.cursor()
    limite = (datetime.utcnow() - timedelta(days=dias)).isoformat()
    c.execute("DELETE FROM lecturas WHERE timestamp < ?", (limite,))
    conn.commit()
    conn.close()


def get_ultimo():
    conn = get_connection()
    c = conn.cursor()
    result = {}
    for nodo in [1, 2, 3]:
        c.execute(
            "SELECT * FROM lecturas WHERE nodo=? ORDER BY timestamp DESC LIMIT 1",
            (nodo,)
        )
        row = c.fetchone()
        result[f"nodo{nodo:02d}"] = dict(row) if row else None
    conn.close()
    return result


def get_historial(nodo: int, horas: int = 24):
    conn = get_connection()
    c = conn.cursor()
    desde = (datetime.utcnow() - timedelta(hours=horas)).isoformat()
    c.execute(
        "SELECT * FROM lecturas WHERE nodo=? AND timestamp>=? ORDER BY timestamp ASC",
        (nodo, desde)
    )
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


def get_estadisticas():
    conn = get_connection()
    c = conn.cursor()
    desde = (datetime.utcnow() - timedelta(hours=24)).isoformat()

    def stats(campo, nodo):
        c.execute(f"""
            SELECT AVG({campo}), MIN({campo}), MAX({campo})
            FROM lecturas WHERE nodo=? AND timestamp>=? AND {campo} IS NOT NULL
        """, (nodo, desde))
        row = c.fetchone()
        if row and row[0] is not None:
            return {"promedio": round(row[0], 1), "minimo": round(row[1], 1), "maximo": round(row[2], 1)}
        return {"promedio": None, "minimo": None, "maximo": None}

    result = {
        "temperatura": stats("temperatura", 2),
        "humedad":     stats("humedad", 2),
        "co2":         stats("co2", 2),
        "presion":     stats("presion", 2),
        "gas":         stats("gas", 2),
        "pulso":       stats("pulso", 1),
        "spo2":        stats("spo2", 1),
    }
    conn.close()
    return result


def get_eventos(limite: int = 50):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM lecturas ORDER BY timestamp DESC LIMIT ?", (limite,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows


def get_historial_csv(horas: int = 24):
    conn = get_connection()
    c = conn.cursor()
    desde = (datetime.utcnow() - timedelta(hours=horas)).isoformat()
    c.execute("SELECT * FROM lecturas WHERE timestamp>=? ORDER BY timestamp ASC", (desde,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows
