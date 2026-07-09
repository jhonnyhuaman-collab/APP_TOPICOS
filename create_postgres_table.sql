-- Crear la tabla de lecturas para PostgreSQL
CREATE TABLE IF NOT EXISTS lecturas (
    id SERIAL PRIMARY KEY,
    nodo INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    pulso REAL,
    spo2 REAL,
    temperatura REAL,
    humedad REAL,
    co2 REAL,
    presion REAL,
    gas REAL,
    luz_estado INTEGER,
    vent_estado INTEGER,
    rssi INTEGER
);

CREATE INDEX IF NOT EXISTS idx_nodo_ts ON lecturas(nodo, timestamp);
