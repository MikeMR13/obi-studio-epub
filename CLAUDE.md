# Instrucciones para Claude en este repositorio

- Todo (código, comentarios, interfaz, mensajes de commit y documentos) va en **español**.
- El libro vive en el modelo (`src/model.ts`). El editor visual, el código y los exportadores leen y escriben el modelo; **nunca** se guarda HTML como fuente.
- Cualquier cambio en el compilador o los importadores debe mantener:
  - `npm test` en verde (incluye EPUBCheck: 0 errores y 0 avisos en los libros de prueba).
  - La ida y vuelta compilar → importar sin pérdidas.
  - `npm run tipos` sin errores.
- Para cambios de interfaz, ejecuta `scripts/prueba-interfaz.py` contra `npm run dev:web` y revisa las capturas, también a 1024 px de ancho.
- Las reglas del EPUB generado se basan en EPUBCheck (https://www.w3.org/publishing/epubcheck/) y EPUB Accessibility 1.1.
- Sube cada avance a este repositorio: el trabajo hecho en otras conversaciones se perdió por no estar aquí.
