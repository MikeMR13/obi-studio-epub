# Obi Studio EPUB

Maquetador visual de novelas ligeras para Windows, macOS y Linux. Escribes y das formato como en un procesador de textos, y el programa genera un EPUB 3.3 válido (EPUBCheck) y accesible (EPUB Accessibility 1.1) y, del mismo libro, el PDF para imprenta y el PDF digital. Gratuito y de código cerrado.

> Esta es la reconstrucción desde cero (noviembre de 2026), empezando por el núcleo. El plan completo está en el documento «Estudio de mercado y plan técnico» del proyecto de Claude.

## Qué hace (versión 1.0.0-alpha.1)

- **Tabla de contenido** (botón ☰ de la estructura): qué secciones salen en el índice, con qué texto (puede ser distinto del título de la página), uno o dos niveles (secciones y subtítulos h2, que se pueden quitar uno a uno), vista previa, ir a cada sección, unir con la siguiente y añadir la página de índice. El EPUB lleva el nav y también `toc.ncx` para los lectores antiguos; el PDF pone el número de página a cada entrada.
- **Salto de página** dentro de una sección (también en el PDF y en el Word de corrección), **partir la sección en el cursor** (✂, con sus notas y comentarios) y **unir con la siguiente** (el título de la segunda queda como subtítulo). Antes de partir o unir se guarda una versión.
- **Importar:** EPUB 2 y 3 (Sigil, Calibre, InDesign, Kindle Create y los propios), Word (.docx), OpenDocument (.odt), HTML, Markdown y texto plano (UTF-8, UTF-16, Shift_JIS o Windows-1252). Conserva capítulos, subtítulos, negrita, cursiva, versalitas, alineación, estilos de novela ligera, notas al pie (también en otro archivo), enlaces, furigana, texto en otro idioma, imágenes con su descripción, portada, serie y volumen. Lo que el editor no sabe representar (tablas, SVG, MathML) se guarda intacto como bloque XHTML.
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

## Géneros, cubierta y conversión sencilla (F7)

- **Recuadros de novela ligera** (barra del editor → «Recuadro…»):
  - Isekai y fantasía: ventana de sistema, notificación y ventana de estado (filas con dato y valor).
  - Comedia romántica: chat (mensajes con quién escribe y lado), diario (con fecha) y nota o mensaje.
  - Son bloques del modelo: salen en el EPUB como `div.recuadro` con párrafos (legibles sin CSS y con nombre para los lectores de pantalla), en el PDF con el mismo diseño, vuelven al importar sin pérdidas, viajan al Word de corrección y entran en buscar, tipografía y notas.
- **Dividir una ilustración horizontal** en dos páginas (vista de la ilustración), para lectores que no muestran dobles páginas; en libros verticales va primero la mitad derecha.
- **Cubierta de imprenta** (Más → Cubierta de imprenta…): contraportada, lomo y portada en un PDF a la medida exacta. El lomo se calcula con los grosores de KDP (blanco, crema o color prémium) o se escribe el de la plantilla de IngramSpark u otra imprenta; zona del código de barras libre, texto en el lomo solo a partir de 80 páginas, aviso si la portada no llega a 300 ppp y vista previa.
- **CSS propio** (Tema → CSS propio): se añade después del tema en el EPUB y el PDF, y se revisa mientras se escribe con las reglas de EPUBCheck (sin `direction`, `@import`, recursos remotos ni `position: fixed`).
- **Revisiones rápidas** en buscar y reemplazar: espacios dobles, espacio antes de un signo, falta de espacio tras coma, guion de diálogo, comillas rectas, tres puntos y preguntas sin «¿».
- **Fuentes ofuscadas** (algoritmo del IDPF, con `encryption.xml`) para las fuentes propias que lo pidan, e **imágenes en escala de grises** para imprimir en blanco y negro.
- **Conversión sencilla** (en el inicio): de EPUB, Word, OpenDocument, HTML, Markdown o texto a EPUB con un asistente por pasos que muestra lo que se encontró en el original y deja elegir qué conservar. El diseño se lee con una cascada CSS reducida (`src/estilo-calculado.ts`: especificidad, selectores de descendiente e hijo, herencia, tamaño base en px de `html`/`body`, `%`, `pt`, `cm`…); las medidas `vh`/`vw` se avisan y no se conservan.
  1. Párrafos y títulos: sangría, interlineado y alineación del párrafo general (elegido por su aspecto calculado, no por su clase); alineación, color, tamaño y mayúsculas de los títulos y de los subtítulos.
  2. Estilos y adornos: los demás tipos de párrafo (cartas, citas, firmas, notas del autor…) como estilos de párrafo del libro; tamaño, color y fondo de fragmentos; separador de escena original (ornamento de texto o imagen repetida); capitular (`::first-letter` o un `span` flotante) y primera línea destacada. En un Word, sus estilos de párrafo propios.
  3. Espaciado: espacio entre párrafos, espacio propio de cada párrafo que se aparte del general (también en Word, heredado atributo a atributo), líneas en blanco, espacio antes y después de los títulos y espaciado entre letras y palabras.
  4. Letras e imágenes: las fuentes del archivo (TTF, OTF, WOFF, WOFF2, ofuscadas con el algoritmo del IDPF o de Adobe, e incrustadas en un Word, si su licencia lo permite), las instaladas en el equipo, e imágenes originales o reducidas.
  5. Capítulos e índice: dónde empieza cada capítulo (cada archivo y h1, también los h2 o también los saltos de página del original, de CSS, OpenDocument o el salto de página de un texto plano), la lista resultante con títulos editables, quitar del índice, unir con el siguiente, índice de uno o dos niveles y página de índice.
  6. Metadatos: título, subtítulo, créditos, serie y volumen, idioma, fecha, ISBN, editorial, descripción, derechos y portada, rellenos con los del original para revisarlos o corregirlos.
  7. Confirmación con lo que se conservará y lo que no y una vista previa del original y del resultado lado a lado; después, exportar a EPUB, KEPUB o PDF digital.
  Las opciones elegidas se recuerdan por serie: el siguiente volumen empieza con las mismas, y la editorial, los derechos y los créditos que el original no traiga (traductor, ilustrador…) se proponen con los del volumen anterior.
  HTML, Markdown, texto y OpenDocument pasan antes a un EPUB intermedio (`src/formatos/otros.ts`) y usan el mismo análisis. Si hay un plugin instalado para el formato, se usa el plugin.
  `npx tsx scripts/validar-conversion.mts` convierte un EPUB de prueba con cada opción y compara en el navegador los estilos calculados del original y del convertido (sangría, interlineado, márgenes, líneas en blanco, espaciado, letras y títulos).
  El espacio propio de cada párrafo es parte del modelo: sale en el EPUB y el PDF, vuelve al importar y sobrevive al Word de corrección (como las líneas en blanco).

## Publicación, imágenes y fuentes (F6)

- **Publicar en tiendas** (Más → Publicar en tiendas…): revisión con las reglas oficiales de Kindle (KDP), Apple Books, Kobo, Google Play e IngramSpark (portada, peso y píxeles de las imágenes, página fija…), descarga de la portada aparte y EPUB ajustado a cada una y validado: reduce las imágenes que superan el límite, quita la página fija para IngramSpark y añade `com.apple.ibooks.display-options.xml` para Apple si hay fuentes incrustadas.
- **Muestra gratuita** (Más → Muestra gratuita…): EPUB con las secciones elegidas (por defecto, hasta el primer capítulo), una página final «Fin de la muestra» con el enlace de compra, identificador propio y «(muestra)» en el título, validado con EPUBCheck. Y una **página web de una sola pieza** (portada, sinopsis, créditos, botón de compra y capítulos, con imágenes y fuentes dentro) para colgarla en cualquier sitio.
- **Páginas a color:** tras crear el PDF de imprenta, la revisión previa dice qué páginas llevan color (imágenes y colores del texto, leídos del PDF real) para elegir bien la impresión.
- **Marcas de corte** opcionales en el PDF de imprenta, fuera del sangrado y en color de registro, para imprentas tradicionales (KDP e IngramSpark las rechazan, y se avisa).
- **Girar y recortar ilustraciones** en la vista de la ilustración; antes de cada cambio se guarda una versión con la imagen original.
- **Optimizar las imágenes del EPUB** (pestaña Libro): al exportar, las de más de 4 Mpx se reducen y los PNG grandes sin transparencia pasan a JPEG. El proyecto y el PDF conservan las originales.
- **Fuentes propias** (Tema → Fuentes propias…): sube un .ttf u .otf o elige una fuente instalada en el sistema. Se respeta su licencia de incrustación (`fsType`: las restringidas o solo de mapa de bits no se admiten) y se incrusta solo el subconjunto de letras que usa el libro (HarfBuzz en WebAssembly), en el EPUB, el PDF y la muestra web. Se guardan dentro del `.obi`; las versiones no las duplican.
- **Configuración** (Más → Configuración…): idioma de la interfaz y la colaboración en la red local, que viene **desactivada** y solo aparece en el menú al activarla.

## Pendientes cerrados antes de la siguiente fase

- **Buscar y reemplazar** (Ctrl+F / Ctrl+H) en todo el libro o en una sección, en párrafos, listas y notas: mayúsculas, palabra completa y expresiones regulares con grupos. Respeta el formato, el furigana y las llamadas a notas.
- **Versiones con nombre** (Más → Versiones…): guardar, comparar sección por sección, restaurar y borrar, dentro del `.obi` y con sus imágenes. Antes de importar correcciones de Word se guarda una automáticamente; restaurar guarda antes el estado actual.
- **Control de cambios propio**: las correcciones de Word pueden entrar como cambios propuestos (diferencia palabra por palabra en la pestaña Revisión) para aceptarlos o rechazarlos uno a uno o todos.
- **Editor en vertical** para los libros en tategaki, y **Noto Serif JP** incrustada en EPUB y PDF solo con los subconjuntos que cubren los caracteres japoneses del libro.
- **Interfaz en inglés** (selector en el inicio y en Más). El catálogo está en `app/renderer/i18n-en.ts`; una prueba falla si un texto queda sin traducir.
- **PDF/X-1a** (Impresión, o `obi pdf --pdfx`) con el Ghostscript del sistema: CMYK, texto en negro puro, PDF 1.3 sin transparencias y OutputIntent. Ghostscript no se incluye por su licencia AGPL.
- **Firma de instaladores** en GitHub Actions con secretos por sistema; ver [docs/firma.md](docs/firma.md).
- **Catálogo de plugins**: integrado y por URL https, con huella SHA-256 comprobada. `scripts/catalogo-plugins.mjs` genera un catálogo publicable.
- **Colaboración en tiempo real en la red local** (Más → Colaborar en la red local…): los invitados entran desde el navegador con un enlace con código y escriben a la vez (Yjs), con cursores con nombre. El servidor de colaboración solo expone la página de invitados y el texto de las secciones; el texto se guarda en el libro. En Windows, el cortafuegos pedirá permiso la primera vez.

## Ecosistema (F5)

- **Plugins** (menú «Más» → Plugins…): archivos `.obiplugin` con `manifiesto.json` y `principal.js`. Hay cuatro tipos: revisión, transformación (se puede deshacer), exportador e importador (se usa desde «Importar»). Cada plugin corre en un proceso aparte con el modelo de permisos de Node (sin disco, sin procesos, memoria y tiempo limitados) y dentro de un contexto vacío sin `require`, `process` ni `fetch`. Solo ve el libro; las imágenes requieren el permiso «recursos» y la red el permiso «red», que se muestran antes de instalar. El libro que devuelve se valida antes de aceptarlo. Ejemplos en `ejemplos/plugins/` (revisión ortotipográfica, limpieza de espacios, texto plano .txt); se empaquetan con `node scripts/empaquetar-plugin.mjs <carpeta>`. La API se describe en [docs/plugins.md](docs/plugins.md).
- **Comentarios de revisión:** botón 💬 en el editor y pestaña Comentarios (responder, resolver, borrar, ir al texto). No salen en el EPUB ni en el PDF. Viajan al Word de corrección como comentarios reales de Word (con respuestas y estado resuelto) y vuelven con «Importar correcciones» sin duplicarse; los del corrector se anclan a su texto. Si el Word trae control de cambios, se toma como aceptado y se avisa.
- **Informe de accesibilidad** (pestaña Validación): axe-core en español sobre cada página del EPUB, con su CSS, en un navegador real (WCAG 2.1 A/AA y buenas prácticas), más comprobaciones de EPUB Accessibility 1.1 sobre el libro (idioma, títulos del índice, descripción de imágenes). Se guarda como HTML. Línea de comandos: `obi accesibilidad <proyecto.obi> <informe.html>`.

## Novela ligera avanzada (F4)

- **Escritura vertical japonesa (tategaki):** en la pestaña Libro. El EPUB sale con `writing-mode: vertical-rl` y avance de páginas de derecha a izquierda; los números de una o dos cifras y «!?» se ponen en horizontal (tate-chū-yoko) solos. El PDF también se compagina en vertical (capítulos en página par, dobles páginas invertidas). El EPUB vertical se reconoce al importarlo.
- **Puntos de énfasis (傍点)** en el editor (botón 傍), en el EPUB, el PDF y Word.
- **Página fija selectiva:** una ilustración o la portada puede ir como página fija (`rendition:layout-pre-paginated`) dentro de un libro refluible; una doble página fija se divide en dos páginas enfrentadas (`page-spread-left/right`). Para Apple Books y Kobo; Kindle la muestra como imagen normal.
- **KEPUB para Kobo** (menú «Más»): el mismo EPUB con `koboSpan` por frase para las estadísticas de lectura y el subrayado. Pasa EPUBCheck y se valida antes de exportar.
- **Word de ida y vuelta para correctores** (menú «Más»): el Word lleva estilos con nombre (Pensamiento, Onomatopeya, Carta, Cita, SinSangria, Énfasis), notas al pie, furigana en notación Aozora `｜漢字《かんじ》` y marcadores `⟦XHTML n⟧`/`⟦Imagen n⟧` para lo que Word no puede editar. **Importar correcciones** funde los cambios capítulo a capítulo (por título y, si no, por posición) y conserva tema, ilustraciones, imágenes de cabecera, páginas fijas y bloques XHTML; avisa de lo que no pudo casar.
- Línea de comandos: `obi kepub`, `obi word` y `obi correcciones`.

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
node scripts/preparar-recursos.mjs   # EPUBCheck, Java mínimo, visor de Vivliostyle, fuentes, HarfBuzz y patrones en recursos/
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
| `src/formatos/` | Importadores: `epub.ts`, `docx.ts`, Word de ida y vuelta (`word.ts`), conversión HTML → bloques (`convertir.ts`) y utilidades DOM |
| `src/editor-modelo.ts` | Puente entre el JSON de ProseMirror y los bloques del modelo |
| `src/validar.ts` | EPUBCheck con mensajes en español |
| `src/impresion.ts`, `src/pdf.ts`, `src/servicio-impresion.ts` | HTML y CSS de impresión, generación y posproceso del PDF, servicio del visor |
| `src/estilo-tema.ts`, `src/temas.ts`, `src/fuentes.ts` | CSS del tema común al EPUB y al PDF, galería de temas, fuentes incrustadas |
| `src/preflight.ts`, `src/division.ts`, `src/recursos.ts` | Revisión previa, división silábica, ubicación de los recursos |
| `src/buscar.ts`, `src/versiones.ts`, `src/cambios.ts`, `src/diferencias.ts` | Buscar y reemplazar, versiones, control de cambios y diferencias palabra por palabra |
| `src/pdfx.ts`, `src/catalogo.ts` | PDF/X-1a con Ghostscript; catálogos de plugins |
| `src/tiendas-lista.ts`, `src/tiendas.ts` | Reglas de cada tienda, revisión y EPUB ajustado |
| `src/muestra.ts` | Muestra gratuita: EPUB y página web de una sola pieza |
| `src/color-pdf.ts` | Páginas a color de un PDF (operadores de color e imágenes) |
| `src/procesar-imagen.ts` | Reducir, girar, recortar y optimizar imágenes (jimp, JavaScript puro) |
| `src/fuentes-propias.ts`, `src/fuentes-sistema.ts` | Fuentes del usuario: nombre, licencia `fsType`, subconjuntos con HarfBuzz; fuentes instaladas en el sistema |
| `src/configuracion.ts` | Configuración de la app (colaboración desactivada por defecto) |
| `src/cubierta.ts` | Cubierta de imprenta: medidas, lomo, revisión, HTML y posproceso del PDF |
| `src/css-propio.ts`, `src/revisiones.ts` | CSS propio revisado y revisiones rápidas de ortotipografía |
| `src/diseno-original.ts`, `src/estilo-calculado.ts` | Diseño y fuentes del archivo original para la conversión sencilla: cascada CSS reducida, tipos de párrafo, separadores, capitular, WOFF → TTF y fuentes de Adobe |
| `src/diseno-word.ts` | Word párrafo a párrafo: estilos propios, espacio de cada párrafo y fuentes incrustadas (.odttf) |
| `src/woff2.ts` | WOFF2 → TrueType (Brotli y transformaciones de glyf/loca y hmtx) |
| `src/formatos/otros.ts` | HTML, Markdown, texto plano y OpenDocument a un EPUB intermedio |
| `app/colaboracion.ts`, `app/renderer/colaborar.tsx` | Servidor de colaboración (Yjs) y página de invitados |
| `app/renderer/i18n.ts`, `app/renderer/i18n-en.ts` | Idioma de la interfaz y catálogo inglés |
| `src/plugins.ts` | Plugins: manifiesto, ejecución aislada, validación de lo que devuelven, plugins instalados |
| `src/comentarios.ts` | Anclas de comentarios y comentarios de Word (hilos y resueltos) |
| `src/accesibilidad.ts` | Informe de accesibilidad (axe-core + EPUB Accessibility 1.1) |
| `src/kepub.ts`, `src/formatos/word.ts` | KEPUB para Kobo; Word para corrección e importación de correcciones |
| `src/proyecto.ts`, `src/tipografia.ts`, `src/imagen.ts`, `src/cli.ts` | Proyecto .obi, tipografía española, tamaño de imágenes, línea de comandos |
| `src/pruebas/` | Pruebas del motor y documentos de prueba generados al vuelo |
| `app/backend.ts` | Operaciones sobre el libro abierto |
| `app/servidor.ts` | API HTTP local (127.0.0.1 con token por sesión) para Electron y el navegador |
| `app/main.ts` | Proceso principal de Electron: ventana, menú, descargas, aviso al cerrar, corrector |
| `app/renderer/` | Interfaz React: `App.tsx`, `editor/` (esquema y editor), `paneles/` (estructura, inspector, vista previa, código, ilustración) |
| `scripts/` | Compilación, preparación de recursos y prueba de la interfaz |

## Siguientes pasos

- Probar los instaladores en un Windows y un macOS reales, con certificados de firma.
- Colaboración por internet (hoy, solo en la red local) y comentarios y control de cambios para los invitados.
- Más recuadros de género si hacen falta (fichas de personaje, mapas de mazmorra) y plantillas de cubierta con tipografía de título.
- Más idiomas de interfaz (el sistema ya admite añadir catálogos).
