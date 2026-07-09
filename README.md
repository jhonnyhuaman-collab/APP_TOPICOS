# Sistema IoT Asistencial — UTEC 2026-1

Dashboard web en tiempo real para monitoreo de personas con movilidad reducida, usando ESP32, ESP-NOW, MQTT y Flask.

**Autores:** Piero Pittman · Franco Tapia · Jhonny Huaman

---

## Arquitectura

```
ESP32 Nodo01 (Salud)    ─┐
ESP32 Nodo02 (Ambiente)  ─┤──[ESP-NOW]──► ESP32 Gateway ──[MQTT]──► HiveMQ ──► Flask Server ──► Browser
ESP32 Nodo03 (Actuador)  ─┘                                                          │
                                                                                 SQLite DB
```

---

## Requisitos

- Python 3.9+
- Conexión a internet (para HiveMQ público)

---

## Instalación y ejecución

### Local (Windows / Mac / Linux)

```bash
# 1. Instalar dependencias
pip install -r requirements.txt

# 2. Correr el servidor
python app.py
```

Abrir en el navegador: `http://localhost:5000`

### AWS EC2 (Ubuntu 22.04)

```bash
# Clonar o copiar el proyecto al servidor
chmod +x deploy.sh
./deploy.sh
```

El servidor queda en `http://<IP-EC2>:5000`

> **Nota:** Abre el puerto 5000 en el Security Group de EC2 (TCP inbound).

---

## Estructura del proyecto

```
APP/
├── app.py              # Flask + SocketIO + MQTT + API REST
├── database.py         # Funciones SQLite / PostgreSQL (guardar, consultar, limpiar)
├── mqtt_client.py      # Conexión HiveMQ, pub/sub, modo automático
├── requirements.txt    # Dependencias Python
├── deploy.sh           # Script de despliegue para EC2
├── iot_data.db         # Base de datos SQLite local (se crea al iniciar)
├── templates/
│   └── index.html      # Dashboard completo (7 secciones)
└── static/
    ├── css/style.css   # Diseño premium dark, mobile-first
    ├── js/app.js       # WebSocket + Chart.js + controles
    ├── manifest.json   # PWA manifest
    ├── sw.js           # Service Worker
    └── icon.svg        # Ícono de la app
```

---

## Topics MQTT

| Dirección | Topic | Payload |
|-----------|-------|---------|
| Recibir | `casa/nodo01/salud` | `{"pulso": 72, "spo2": 98, "timestamp": "..."}` |
| Recibir | `casa/nodo02/ambiente` | `{"temperatura": 24.2, "humedad": 65.8, "co2": 540, "presion": 1013.2, "timestamp": "..."}` |
| Recibir | `casa/nodo03/actuadores` | `{"luz": true, "ventilador": false, "timestamp": "..."}` |
| Enviar | `casa/nodo03/comandos` | `"LUZ_ON"` · `"LUZ_OFF"` · `"VENT_ON"` · `"VENT_OFF"` |

**Broker:** `broker.hivemq.com:1883` (sin autenticación)

---

## API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/ultimo` | Última lectura de cada nodo |
| GET | `/api/historial?nodo=2&horas=24` | Historial de las últimas N horas |
| GET | `/api/estadisticas` | Promedio / mínimo / máximo del día |
| POST | `/api/comando` | Enviar comando al nodo 03 |
| POST | `/api/demo` | Activar / desactivar modo demo |
| GET | `/api/demo/estado` | Estado actual del modo demo |
| POST | `/api/auto_mode` | Activar / desactivar modo automático |
| GET | `/api/status` | Estado general del servidor |
| GET | `/api/eventos` | Últimos 50 eventos registrados |
| GET | `/api/exportar_csv?horas=24` | Descarga historial en CSV |

### Ejemplo — enviar comando

```bash
curl -X POST http://localhost:5000/api/comando \
     -H "Content-Type: application/json" \
     -d '{"comando": "LUZ_ON"}'
```

---

## Modo Demo

Sin necesidad de tener los ESP32 conectados, el sistema puede generar datos simulados realistas.

1. Abrir el dashboard en el navegador.
2. Presionar **"▶ Activar Demo"** en el footer.
3. Los datos se generan cada 3 segundos y se guardan igual que los reales.
4. Presionar **"⏹ Desactivar Demo"** para detener.

Rangos simulados:

| Variable | Rango |
|----------|-------|
| Temperatura | 20–28 °C (variación gradual) |
| Humedad | 50–75 % |
| CO₂ | 380–1100 ppm (sube gradualmente) |
| Pulso | 62–82 BPM |
| SpO₂ | 95–99 % |

---

## Funciones del dashboard

| Sección | Descripción |
|---------|-------------|
| **Resumen rápido** | 6 mini-cards con el último valor, tendencia (↑ ↓) y alerta por color |
| **Monitoreo de Salud** | Gauges circulares animados de pulso y SpO₂, sparkline, parpadeo de alerta |
| **Ambiente** | Gauge semicircular de temperatura, barra de humedad, semáforo de CO₂, gráfica en tiempo real |
| **Control actuadores** | Toggles iOS para luz y ventilador, modo automático CO₂ → ventilador |
| **Estadísticas del día** | Tabla promedio / mínimo / máximo de las últimas 24h |
| **Historial y gráficas** | Chart.js interactivo con zoom/pan táctil, selector de variable y rango |
| **Log de eventos** | Últimos 50 eventos en tiempo real, exportable a CSV |

---

## Rangos de alerta

| Variable | Normal | Precaución | Alerta |
|----------|--------|------------|--------|
| Pulso | 60–100 BPM | 50–60 / 100–120 | < 50 o > 120 |
| SpO₂ | > 95 % | 90–95 % | < 90 % |
| CO₂ | < 800 ppm | 800–1000 ppm | > 1000 ppm |
| Temperatura | 18–28 °C | 15–32 °C | fuera de rango |

---

## PWA — Instalar como app en el celular

1. Abrir `http://<IP>:5000` en Chrome (Android) o Safari (iOS).
2. **Android:** menú → "Agregar a pantalla de inicio".
3. **iOS:** botón compartir → "Añadir a pantalla de inicio".

La app funciona en pantalla completa sin barra del navegador.

---

## Dependencias Python

```
flask==3.0.3
flask-socketio==5.3.6
paho-mqtt==1.6.1
eventlet==0.36.1
```

---

## Notas para producción en EC2

- Usar proceso persistente: `nohup python3 app.py > app.log 2>&1 &`
- Abrir puerto **5000** (TCP) en el Security Group de AWS.
- Para HTTPS agregar Nginx como proxy reverso.
- `iot_data.db` se crea automáticamente al iniciar cuando no se establece `DATABASE_URL`.
- Para usar PostgreSQL, configura `DATABASE_URL` como:
  `postgresql://usuario:clave@host:5432/nombre_basedatos`
- Si necesitas crear la tabla manualmente, usa `create_postgres_table.sql`.
- Datos mayores a **7 días** se eliminan automáticamente.
