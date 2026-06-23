import json
import logging
import random
import csv
import io
import threading
from datetime import datetime, timedelta

from flask import Flask, jsonify, request, render_template, Response
from flask_socketio import SocketIO

import database as db
import mqtt_client as mqttc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config["SECRET_KEY"] = "iot_asistencial_2026"

socketio = SocketIO(
    app,
    async_mode="threading",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

# ─── Estado en memoria ────────────────────────────────────────────────────────
_demo_activo  = False
_demo_hilo    = None
_ultimo_datos = {
    "nodo01": {},
    "nodo02": {},
    "nodo03": {},
}
_eventos = []          # log de los últimos 100 eventos
_mqtt_conectado = False


# ─── Callback que llama el cliente MQTT ───────────────────────────────────────
def on_mqtt_data(nodo: int, data: dict):
    global _mqtt_conectado
    _mqtt_conectado = True

    key = f"nodo{nodo:02d}"
    _ultimo_datos[key] = data
    db.guardar_lectura(nodo, data)

    _agregar_evento(nodo, data)

    socketio.emit("nuevo_dato", {"nodo": nodo, "data": data})

    # Modo automático: si CO2 > 1000 → VENT_ON
    if mqttc.get_auto_mode() and nodo == 2:
        co2 = data.get("co2", 0)
        if co2 and co2 > 1000:
            mqttc.publicar_comando("VENT_ON")
            socketio.emit("auto_accion", {"cmd": "VENT_ON", "razon": f"CO2={co2}"})


def _agregar_evento(nodo, data):
    ts = data.get("timestamp", datetime.utcnow().isoformat())
    evento = {"ts": ts, "nodo": nodo, "data": data}
    _eventos.insert(0, evento)
    if len(_eventos) > 100:
        _eventos.pop()


# ─── Modo Demo ─────────────────────────────────────────────────────────────────
_demo_state = {
    "temperatura": 23.0,
    "humedad":     62.0,
    "co2":         450.0,
    "pulso":       72.0,
    "spo2":        98.0,
    "luz":         False,
    "ventilador":  False,
}


def _demo_loop():
    import math, time
    t = 0
    while _demo_activo:
        t += 1
        ts = datetime.utcnow().isoformat()

        # Nodo 01 — Salud
        _demo_state["pulso"]  = 72 + 10 * math.sin(t * 0.15) + random.gauss(0, 1)
        _demo_state["spo2"]   = 97 + 1.5 * math.sin(t * 0.05) + random.gauss(0, 0.2)
        d1 = {
            "pulso":     round(_demo_state["pulso"], 1),
            "spo2":      round(min(100, _demo_state["spo2"]), 1),
            "timestamp": ts,
        }
        on_mqtt_data(1, d1)

        # Nodo 02 — Ambiente
        _demo_state["temperatura"] += random.uniform(-0.1, 0.15)
        _demo_state["temperatura"]  = max(20, min(28, _demo_state["temperatura"]))
        _demo_state["humedad"]     += random.uniform(-0.2, 0.2)
        _demo_state["humedad"]      = max(50, min(75, _demo_state["humedad"]))
        _demo_state["co2"]         += random.uniform(-5, 8)
        _demo_state["co2"]          = max(380, min(1100, _demo_state["co2"]))
        d2 = {
            "temperatura": round(_demo_state["temperatura"], 1),
            "humedad":     round(_demo_state["humedad"], 1),
            "co2":         round(_demo_state["co2"], 0),
            "presion":     round(1013 + random.gauss(0, 0.3), 1),
            "timestamp":   ts,
        }
        on_mqtt_data(2, d2)

        # Nodo 03 — Actuadores
        d3 = {
            "luz":        _demo_state["luz"],
            "ventilador": _demo_state["ventilador"],
            "timestamp":  ts,
        }
        on_mqtt_data(3, d3)

        time.sleep(3)


def iniciar_demo():
    global _demo_activo, _demo_hilo
    if not _demo_activo:
        _demo_activo = True
        _demo_hilo = threading.Thread(target=_demo_loop, daemon=True)
        _demo_hilo.start()
        logger.info("Modo demo ACTIVADO")


def detener_demo():
    global _demo_activo
    _demo_activo = False
    logger.info("Modo demo DESACTIVADO")


# ─── API REST ──────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/ultimo")
def api_ultimo():
    db_ultimo = db.get_ultimo()
    resultado = {}
    for key in ["nodo01", "nodo02", "nodo03"]:
        en_mem  = _ultimo_datos.get(key, {})
        en_db   = db_ultimo.get(key) or {}
        resultado[key] = en_mem if en_mem else en_db
    return jsonify(resultado)


@app.route("/api/historial")
def api_historial():
    nodo  = request.args.get("nodo", 2, type=int)
    horas = request.args.get("horas", 24, type=int)
    horas = max(1, min(168, horas))
    rows  = db.get_historial(nodo, horas)
    return jsonify(rows)


@app.route("/api/estadisticas")
def api_estadisticas():
    return jsonify(db.get_estadisticas())


@app.route("/api/comando", methods=["POST"])
def api_comando():
    body = request.get_json(force=True, silent=True) or {}
    cmd  = body.get("comando", "").strip().upper()
    VALID = {"LUZ_ON", "LUZ_OFF", "VENT_ON", "VENT_OFF"}
    if cmd not in VALID:
        return jsonify({"error": f"Comando inválido. Usa: {', '.join(VALID)}"}), 400

    ok = mqttc.publicar_comando(cmd)
    if _demo_activo:
        if cmd == "LUZ_ON":   _demo_state["luz"]        = True
        if cmd == "LUZ_OFF":  _demo_state["luz"]        = False
        if cmd == "VENT_ON":  _demo_state["ventilador"] = True
        if cmd == "VENT_OFF": _demo_state["ventilador"] = False
        ok = True

    socketio.emit("comando_enviado", {"cmd": cmd})
    return jsonify({"ok": ok, "comando": cmd})


@app.route("/api/demo", methods=["POST"])
def api_demo():
    body   = request.get_json(force=True, silent=True) or {}
    accion = body.get("accion", "toggle")
    if accion == "activar" or (accion == "toggle" and not _demo_activo):
        iniciar_demo()
        return jsonify({"demo": True})
    else:
        detener_demo()
        return jsonify({"demo": False})


@app.route("/api/demo/estado")
def api_demo_estado():
    return jsonify({"demo": _demo_activo})


@app.route("/api/auto_mode", methods=["POST"])
def api_auto_mode():
    body   = request.get_json(force=True, silent=True) or {}
    estado = bool(body.get("activo", False))
    mqttc.set_auto_mode(estado)
    return jsonify({"auto_mode": estado})


@app.route("/api/eventos")
def api_eventos():
    return jsonify(_eventos[:50])


@app.route("/api/exportar_csv")
def api_exportar_csv():
    horas = request.args.get("horas", 24, type=int)
    rows  = db.get_historial_csv(horas)
    output = io.StringIO()
    fieldnames = ["id", "nodo", "timestamp", "pulso", "spo2",
                  "temperatura", "humedad", "co2", "presion",
                  "luz_estado", "vent_estado", "rssi"]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    csv_data = output.getvalue()
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=iot_historial_{horas}h.csv"},
    )


@app.route("/api/status")
def api_status():
    return jsonify({
        "mqtt_conectado": _mqtt_conectado,
        "demo_activo":    _demo_activo,
        "auto_mode":      mqttc.get_auto_mode(),
        "timestamp":      datetime.utcnow().isoformat(),
    })


# ─── SocketIO events ──────────────────────────────────────────────────────────
@socketio.on("connect")
def on_ws_connect():
    logger.info(f"Cliente WS conectado: {request.sid}")
    socketio.emit("mqtt_status", {"conectado": _mqtt_conectado}, to=request.sid)
    socketio.emit("demo_status", {"demo": _demo_activo}, to=request.sid)


@socketio.on("disconnect")
def on_ws_disconnect():
    logger.info(f"Cliente WS desconectado: {request.sid}")


# ─── Arranque ─────────────────────────────────────────────────────────────────
def arrancar_mqtt():
    db.init_db()
    client = mqttc.create_client()
    mqttc.set_callbacks(on_mqtt_data, socketio)
    client.connect_async(mqttc.BROKER_HOST, mqttc.BROKER_PORT, keepalive=60)
    client.loop_start()

    # Limpiar datos viejos al iniciar
    db.limpiar_viejos(7)
    logger.info("Base de datos lista")

    def _ping():
        import time
        while True:
            time.sleep(3600)
            db.limpiar_viejos(7)
    threading.Thread(target=_ping, daemon=True).start()

if __name__ == "__main__":
    arrancar_mqtt()
    print("=" * 50)
    print("Servidor corriendo en http://0.0.0.0:5000")
    print("Conectado a HiveMQ broker")
    print("=" * 50)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)