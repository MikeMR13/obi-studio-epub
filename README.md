# Obi Studio EPUB

Maquetador visual de novelas ligeras para Windows, macOS y Linux. Escribes y das formato como en un procesador de textos, y el programa genera un EPUB 3.3 válido (EPUBCheck) y accesible (EPUB Accessibility 1.1) y, del mismo libro, el PDF para imprenta y el PDF digital. Gratuito y de código cerrado.

> Esta es la reconstrucción desde cero (noviembre de 2026), empezando por el núcleo. El plan completo está en el documento «Estudio de mercado y plan técnico» del proyecto de Claude.

## Qué hace (versión 1.0.0-alpha.1)

- **Importar:** EPUB 2 y 3 (Sigil, Calibre, InDesign, Kindle Create y los propios) y Word (.docx). Conserva capítulos, subtítulos, negrita, cursiva, versalitas, alineación, estilos de novela ligera, notas al pie (también en otro archivo), enlaces, furigana, texto en otro idioma, imágenes con su descripción, portada, serie y volumen. Lo que el editor no sabe representar (tablas, SVG, MathML) se guarda intacto como bloque XHTML.
- **Escribir:** editor visual (TipTap/ProseMirror) sobre el modelo del libro, nunca sobre HTML.
  - Estilos de párrafo: cuerpo, sin sangría, centrado, a la derecha, pensamiento, onomatopeya, carta y cita (Ctrl/⌘+Alt+0…7). Subtítulos.
  - Negrita, cursiva, subrayado, tachado, versalitas, superíndice, subíndice, enlaces.
  - Furigana (doble clic para editarla o quitarla), texto en otro idioma, notas al pie con su texto en un panel, separadores de escena, imágenes con descripción obligatoria o marca de decorativa, listas.
  - Corrector ortográfico del sistema en la app de escritorio.
- **Estructura:** secciones por tipo (portada, ilustración, créditos, índice, prólogo, capítulo…), reordenar arrastrando, miniaturas de ilustraciones, palabras por sección.
- **Páginas de ilustración y portada** con vista grande, tamaño, orientación y aviso de resolución baja.
- **Código editable:** el XHTML de cada sección se edita y, al aplicarlo, vuelve al modelo con el mismo importador. Un `<h1>` nuevo divide la sección. El XHTML mal formado se rechaza.
- **Vista previa** del EPUB real compilado, paginada, en Kindle Paperwhite, Kobo Clara, teléfono o tableta, vertical u horizontal, con tamaño de letra.
- **Tema:** letra del texto y de los títulos, interlineado, sangría, espacio entre párrafos, alineación y separador de escena.
- **Tipografía española:** raya de diálogo, puntos suspensivos y comillas latinas o inglesas, por sección o en todo el libro.
- **Validación:** EPUBCheck 5.4 con mensajes en español que llevan a la sección. **Exportar valida primero y bloquea si hay errores.**
- **EPUB generado:** EPUB 3.3 con `epub:type` y roles DPUB-ARIA, landmarks, notas `doc-noteref`/`doc-footnote`, metadatos de accesibilidad, serie (`belongs-to-collection`), créditos con función (MARC) y portada para todas las tiendas.
- **Proyecto `.obi`:** un ZIP con `libro.json` y las imágenes. Copia de recuperación automática cada minuto con cambios.
- EPUBCheck y un Java mínimo (jlink, 56 MB) van **dentro del instalador**.

## Diseño (F3)

- **Galería de temas:** Clásico, Novela ligera, Fantasía épica, Romance, Ciencia ficción, Misterio, Juvenil, Minimalista y Literario. Cada uno es un conjunto de valores del modelo; al tocar cualquier ajuste el tema pasa a «Personalizado».
- **Constructor visual sin CSS** (pestaña Tema), con muestra en vivo del EPUB real (lector) y de la página compaginada (impresión):
  - letra del texto y de los títulos: las del lector, o Literata, EB Garamond, Noto Sans y Cinzel (OFL), que se **incrustan en el EPUB y en el PDF**;
  - interlineado, sangría, espacio entre párrafos y alineación;
  - títulos de capítulo: centrado, «número arriba y título grande» (separa «Capítulo 3» de «El gremio»), a la izquierda o con línea; tamaño, espacio encima, versalitas y color;
  - letra capitular y primera línea en versalitas;
  - separador de escena: asteriscos, flor, rombos, puntos, línea, espacio o una imagen propia; color de acento.
- **Guardar y cargar temas** (`.obitema`) para usarlos en otros libros; los archivos se validan al cargarlos.
- **Imagen de cabecera por capítulo** (viñeta o emblema sobre el título), en el EPUB y en el PDF. Vuelve al modelo al reimportar el EPUB.
- **Doble página en impresión:** una ilustración horizontal ocupa dos páginas enfrentadas (siempre empieza en página par), cada una con su mitad.

## PDF de impresión (F2)

- **Compaginación con Vivliostyle** (CSS Paged Media) en el Chromium de Electron, o en Chrome/Edge desde la línea de comandos. El PDF sale del mismo modelo y del mismo tema que el EPUB.
- **Tamaños de imprenta:** 5 × 8, 5,25 × 8, 5,5 × 8,5 y 6 × 9 in, A5, B6 (tankōbon) y A6 (bunkobon), o personalizado. El PDF mide exactamente el tamaño de corte (más el sangrado).
- **Margen interior automático** según el número de páginas (tabla de KDP Print): se compagina, se cuentan las páginas y, si cambia el tramo, se vuelve a compaginar.
- **Sangrado:** ninguno, KDP Print (3,175 mm arriba, abajo y en el borde exterior; se recorta el interior página a página) o IngramSpark/Lulu (3 mm por lado). Cajas `TrimBox` y `BleedBox` en cada página. Ilustraciones de página completa a sangre opcionales.
- **Composición de libro:** capítulos en página impar, páginas en blanco sin cabecera ni folio, aperturas sin cabecera, cabeceras con el título del libro (izquierda) y del capítulo (derecha), folios, **notas al pie en la misma página**, índice con números de página, viudas y huérfanas.
- **División silábica española** con Hyphenopoly (patrones TeX): igual en cualquier sistema.
- **Fuentes incrustadas:** Literata y Noto Sans (licencia OFL) van con la app.
- **Revisión previa:** resolución efectiva de cada ilustración (300 ppp), páginas mínimas y máximas, márgenes mínimos de KDP, proporción de las ilustraciones y bloques XHTML a revisar.
- **PDF digital:** sin sangrado, márgenes simétricos, enlaces, marcadores y PDF etiquetado.
- Pendiente: conversión a PDF/X-1a y CMYK (requiere Ghostscript; KDP Print no la exige).

## Desarrollo

Requisitos: Node.js 22, Java 21 con `jlink` (solo para preparar los recursos) y Chrome o Edge para generar PDF fuera de la app de escritorio (pruebas y línea de comandos; o la variable `OBI_CHROME`).

```bash
npm install
node scripts/preparar-recursos.mjs   # EPUBCheck, Java mínimo, visor de Vivliostyle, fuentes y patrones en recursos/
npm run dev:web                      # interfaz en el navegador: http://127.0.0.1:5180
npm run app                          # compila y abre la app de escritorio
npm test                             # pruebas del motor (incluye EPUBCheck)
npm run tipos                        # comprobación de tipos
```

Prueba de punta a punta de la interfaz (Playwright para Python), con `npm run dev:web` en marcha:

```bash
python3 scripts/prueba-interfaz.py http://127.0.0.1:5180/ <carpeta-con-ajeno.epub-prueba.docx-ilustracion.png> <carpeta-capturas>
```

Línea de comandos del motor (después de `npm run build`):

```bash
node dist/cli.mjs importar libro.epub libro.obi      # también .docx
node dist/cli.mjs compilar libro.obi libro.epub
node dist/cli.mjs validar libro.epub
node dist/cli.mjs pdf libro.obi libro.pdf           # PDF para imprenta (--digital para el de pantalla)
```

## Instaladores

Cada instalador se construye en su propio sistema (el Java mínimo es nativo). Lo hace GitHub Actions (`.github/workflows/instaladores.yml`):

- Al subir una etiqueta `v*` construye Windows (.exe) y Linux (.AppImage y .deb) y crea una versión en la pestaña **Releases**.
- Desde la pestaña **Actions → Instaladores → Run workflow** se puede lanzar a mano y marcar macOS.

Para firmar, añade estos secretos al repositorio (Settings → Secrets and variables → Actions). Sin ellos se construye sin firmar y Windows/macOS muestran un aviso:

| Secreto | Para qué |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Certificado de firma de código (.pfx/.p12 en base64) y su contraseña |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarización en macOS |

En local: `npm run instaladores` construye el del sistema actual en `instaladores/`.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/model.ts` | Modelo del libro: secciones, bloques, inlines, notas, recursos, metadatos, tema |
| `src/compilar.ts` | Compilador a EPUB 3.3 (OPF, navegación, XHTML, CSS, empaquetado OCF) |
| `src/formatos/` | Importadores: `epub.ts`, `docx.ts`, conversión HTML → bloques (`convertir.ts`) y utilidades DOM |
| `src/editor-modelo.ts` | Puente entre el JSON de ProseMirror y los bloques del modelo |
| `src/validar.ts` | EPUBCheck con mensajes en español |
| `src/impresion.ts`, `src/pdf.ts`, `src/servicio-impresion.ts` | HTML y CSS de impresión, generación y posproceso del PDF, servicio del visor |
| `src/estilo-tema.ts`, `src/temas.ts`, `src/fuentes.ts` | CSS del tema común al EPUB y al PDF, galería de temas, fuentes incrustadas |
| `src/preflight.ts`, `src/division.ts`, `src/recursos.ts` | Revisión previa, división silábica, ubicación de los recursos |
| `src/proyecto.ts`, `src/tipografia.ts`, `src/imagen.ts`, `src/cli.ts` | Proyecto .obi, tipografía española, tamaño de imágenes, línea de comandos |
| `src/pruebas/` | Pruebas del motor y documentos de prueba generados al vuelo |
| `app/backend.ts` | Operaciones sobre el libro abierto |
| `app/servidor.ts` | API HTTP local (127.0.0.1 con token por sesión) para Electron y el navegador |
| `app/main.ts` | Proceso principal de Electron: ventana, menú, descargas, aviso al cerrar, corrector |
| `app/renderer/` | Interfaz React: `App.tsx`, `editor/` (esquema y editor), `paneles/` (estructura, inspector, vista previa, código, ilustración) |
| `scripts/` | Compilación, preparación de recursos y prueba de la interfaz |

## Siguientes pasos (plan F1 en adelante)

- Firma de instaladores y prueba en un Windows real.
- Interfaz en inglés.
- Fuentes del sistema incrustadas (subconjunto con HarfBuzz), recorte y giro de ilustraciones, dobles páginas.
- Buscar y reemplazar, versiones con nombre, revisión de accesibilidad con axe-core.
- PDF/X-1a y CMYK con Ghostscript.
- Novela ligera avanzada (F4): escritura vertical, layout fijo selectivo, KEPUB, DOCX de ida y vuelta.
