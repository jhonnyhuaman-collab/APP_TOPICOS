import json
import logging
from datetime import datetime
import paho.mqtt.client as mqtt

BROKER_HOST = "broker.hivemq.com"
BROKER_PORT = 1883

TOPICS_SUB = [
    ("casa/nodo01/salud",      1),
    ("casa/nodo02/ambiente",   1),
    ("casa/nodo03/actuadores", 1),
]

TOPIC_CMD = "casa/nodo03/comandos"

logger = logging.getLogger(__name__)

# Callbacks se inyectan desde app.py
_on_data_cb = None
_socketio   = None
_auto_mode  = {"activo": False}


def set_callbacks(on_data_fn, socketio_instance):
    global _on_data_cb, _socketio
    _on_data_cb = on_data_fn
    _socketio   = socketio_instance


def set_auto_mode(estado: bool):
    _auto_mode["activo"] = estado


def get_auto_mode() -> bool:
    return _auto_mode["activo"]


def _on_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("Conectado a HiveMQ broker")
        for topic, qos in TOPICS_SUB:
            client.subscribe(topic, qos)
            logger.info(f"Suscrito a {topic}")
        if _socketio:
            _socketio.emit("mqtt_status", {"conectado": True})
    else:
        logger.error(f"Error conexion MQTT: rc={rc}")
        if _socketio:
            _socketio.emit("mqtt_status", {"conectado": False})


def _on_disconnect(client, userdata, rc):
    logger.warning(f"Desconectado de MQTT: rc={rc}")
    if _socketio:
        _socketio.emit("mqtt_status", {"conectado": False})


def _on_message(client, userdata, msg):
    topic   = msg.topic
    payload = msg.payload.decode("utf-8", errors="ignore")
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        data = {"raw": payload}

    if "timestamp" not in data:
        data["timestamp"] = datetime.utcnow().isoformat()

    nodo_map = {
        "casa/nodo01/salud":      1,
        "casa/nodo02/ambiente":   2,
        "casa/nodo03/actuadores": 3,
    }
    nodo = nodo_map.get(topic, 0)
    data["nodo"] = nodo
    data["topic"] = topic

    logger.debug(f"MQTT [{topic}]: {data}")

    if _on_data_cb:
        _on_data_cb(nodo, data)


_client: mqtt.Client = None


def create_client() -> mqtt.Client:
    global _client
    client = mqtt.Client(client_id=f"flask_iot_{datetime.now().strftime('%H%M%S')}")
    client.on_connect    = _on_connect
    client.on_disconnect = _on_disconnect
    client.on_message    = _on_message
    _client = client
    return client


def get_client() -> mqtt.Client:
    return _client


def publicar_comando(cmd: str):
    if _client and _client.is_connected():
        _client.publish(TOPIC_CMD, cmd, qos=1)
        logger.info(f"Comando publicado: {cmd}")
        return True
    logger.warning("No conectado al broker, comando descartado")
    return False
