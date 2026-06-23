#!/bin/bash
# ══════════════════════════════════════════════════════════════════
# deploy.sh — IoT Asistencial en AWS EC2 (Ubuntu 22.04)
# ══════════════════════════════════════════════════════════════════
set -e

echo "=== [1/5] Actualizando paquetes ==="
sudo apt update -y && sudo apt upgrade -y

echo "=== [2/5] Instalando Python3 y pip ==="
sudo apt install -y python3 python3-pip python3-venv

echo "=== [3/5] Creando entorno virtual ==="
python3 -m venv venv
source venv/bin/activate

echo "=== [4/5] Instalando dependencias ==="
pip install --upgrade pip
pip install -r requirements.txt

echo "=== [5/5] Iniciando servidor ==="
echo ""
echo "  Servidor corriendo en http://0.0.0.0:5000"
echo "  Conectado a HiveMQ broker"
echo ""
python3 app.py
