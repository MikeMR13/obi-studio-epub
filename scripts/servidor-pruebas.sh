#!/bin/sh
# Arranca el servidor de desarrollo con carpetas de plugins y configuración vacías, para la prueba de interfaz.
pkill -f "app/servidor.ts" 2>/dev/null
sleep 1
rm -rf /tmp/obi-e2e-plugins /tmp/obi-e2e-configuracion.json
OBI_PLUGINS=/tmp/obi-e2e-plugins OBI_CONFIGURACION=/tmp/obi-e2e-configuracion.json nohup npm run dev:web > /tmp/servidor.log 2>&1 &
sleep 9
