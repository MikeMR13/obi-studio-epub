"""Prueba de punta a punta de la interfaz de Obi Studio con Playwright.

Uso: python3 scripts/prueba-interfaz.py <url> <carpeta-documentos> <carpeta-capturas>
La carpeta de documentos debe tener ajeno.epub, prueba.docx e ilustracion.png.
"""

import json
import os
import subprocess
import sys

from playwright.sync_api import expect, sync_playwright

URL, DOCS, CAPTURAS = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(CAPTURAS, exist_ok=True)
errores_consola = []
resultados = []


def paso(nombre, ok, detalle=""):
    resultados.append((nombre, ok, detalle))
    print(("✓ " if ok else "✕ ") + nombre + (f" — {detalle}" if detalle else ""), flush=True)


with sync_playwright() as p:
    navegador = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pagina = navegador.new_page(viewport={"width": 1366, "height": 860}, accept_downloads=True)
    pagina.on("console", lambda m: m.type == "error" and errores_consola.append(m.text))
    pagina.on("pageerror", lambda e: errores_consola.append(str(e)))
    pagina.goto(URL)
    expect(pagina.get_by_text("Libro nuevo")).to_be_visible()
    pagina.screenshot(path=f"{CAPTURAS}/01-inicio.png")
    paso("Pantalla de inicio", True)

    # Importar un EPUB ajeno.
    pagina.locator('input[type=file][accept=".epub,.docx,.obi"]').set_input_files(f"{DOCS}/ajeno.epub")
    expect(pagina.locator(".titulo-libro strong")).to_have_text("Mi vida en otro mundo")
    secciones = pagina.locator(".lista-secciones > li")
    paso("Importar EPUB ajeno", secciones.count() == 3, f"{secciones.count()} secciones")
    pagina.locator(".lista-secciones").get_by_role("button", name="Capítulo 1 – La llegada").click()
    editor = pagina.locator(".pagina-editor")
    expect(editor).to_contain_text("Desperté en un bosque")
    paso("Furigana visible en el editor", editor.locator("ruby").count() == 1)
    paso("Llamada de nota visible", editor.locator(".llamada-nota").count() == 1)
    paso("Tabla conservada como bloque XHTML", editor.locator(".bloque-crudo").count() == 1)
    pagina.screenshot(path=f"{CAPTURAS}/02-editor-epub-importado.png")

    # Escribir y dar formato.
    editor.locator("p").last.click()
    pagina.keyboard.press("End")
    pagina.keyboard.press("Enter")
    pagina.keyboard.type("—Esto lo escribí en Obi Studio... ")
    pagina.keyboard.press("Control+b")
    pagina.keyboard.type("en negrita")
    pagina.keyboard.press("Control+b")
    pagina.keyboard.press("Enter")
    pagina.keyboard.type("漢字")
    pagina.keyboard.press("Shift+Home")
    pagina.get_by_role("button", name="Furigana").click()
    pagina.get_by_label("Lectura de «漢字»").fill("かんじ")
    pagina.get_by_role("button", name="Aceptar").click()
    expect(editor.locator("ruby")).to_have_count(2)
    pagina.keyboard.press("End")
    pagina.get_by_role("button", name="Nota al pie").click()
    pagina.get_by_label("Texto de la nota", exact=True).fill("Nota escrita desde la prueba.")
    pagina.get_by_role("button", name="Añadir nota").click()
    expect(pagina.locator(".notas-editor textarea")).to_have_count(2)
    # Estilo de párrafo pensamiento con atajo (Ctrl+Alt+4).
    pagina.keyboard.press("Enter")
    pagina.keyboard.type("No puede ser verdad.")
    pagina.locator(".barra-editor select").select_option("pensamiento")
    expect(editor.locator("p.pensamiento")).to_have_count(1)
    pagina.wait_for_timeout(1200)
    estado = pagina.evaluate("fetch('/api/estado').then(r => r.json())")
    cap = [s for s in estado["libro"]["secciones"] if s["titulo"].startswith("Capítulo 1")][0]
    texto = json.dumps(cap["bloques"], ensure_ascii=False)
    paso("El texto escrito llega al modelo", "Esto lo escribí en Obi Studio" in texto and '"negrita"' in texto and "かんじ" in texto and '"pensamiento"' in texto)
    paso("La nota nueva está en el modelo", len(cap["notas"]) == 2)
    pagina.screenshot(path=f"{CAPTURAS}/03-editor-escrito.png")

    # Tipografía española.
    pagina.get_by_role("tab", name="Sección").click()
    pagina.get_by_role("button", name="Aplicar tipografía a esta sección").click()
    pagina.wait_for_timeout(600)
    expect(editor).to_contain_text("Obi Studio… ")
    paso("Tipografía española (puntos suspensivos)", True)

    # Página de ilustración: añadir y describir.
    pagina.get_by_role("button", name="+ Sección").click()
    pagina.get_by_role("menuitem", name="🖼 Ilustración").click()
    pagina.locator(".datos-ilustracion input[type=file]").set_input_files(f"{DOCS}/ilustracion.png")
    expect(pagina.locator(".lienzo-ilustracion img")).to_be_visible()
    pagina.get_by_label("Descripción de la imagen").fill("Aria y el dragón frente al castillo")
    pagina.get_by_label("Descripción de la imagen").blur()
    pagina.wait_for_timeout(500)
    pagina.screenshot(path=f"{CAPTURAS}/04-ilustracion.png")
    estado = pagina.evaluate("fetch('/api/estado').then(r => r.json())")
    ilus = [s for s in estado["libro"]["secciones"] if s["tipo"] == "ilustracion"]
    paso("Página de ilustración con descripción", any(b.get("alt") == "Aria y el dragón frente al castillo" for s in ilus for b in s["bloques"]))

    # Metadatos y tema.
    pagina.get_by_role("tab", name="Libro").click()
    serie = pagina.get_by_label("Serie")
    paso("Serie importada en el inspector", serie.input_value() == "Otro mundo")
    pagina.get_by_label("Sinopsis").fill("Un chico despierta en otro mundo.")
    pagina.get_by_label("Sinopsis").blur()
    pagina.get_by_role("tab", name="Tema").click()
    pagina.get_by_label("Separador de escena").select_option("linea")
    pagina.wait_for_timeout(400)
    pagina.screenshot(path=f"{CAPTURAS}/05-tema.png")

    # Vista previa.
    pagina.locator(".lista-secciones").get_by_role("button", name="Capítulo 1 – La llegada").click()
    pagina.get_by_role("tab", name="Vista previa").click()
    marco = pagina.frame_locator(".dispositivo iframe")
    expect(marco.locator("h1")).to_have_text("Capítulo 1 – La llegada")
    paso("Vista previa con el EPUB compilado", marco.locator("hr.escena").count() >= 1, "separador con el tema nuevo")
    pagina.wait_for_timeout(500)
    pagina.screenshot(path=f"{CAPTURAS}/06-vista-previa.png")

    # Código editable.
    pagina.get_by_role("tab", name="Código").click()
    area = pagina.locator(".area-codigo")
    expect(area).to_contain_text("doc-chapter")
    codigo = area.input_value()
    codigo = codigo.replace("Fin de la escena.", "Fin de la escena (editado en código).")
    codigo = codigo.replace("</section>", "<h1>Capítulo 2 – Desde el código</h1><p>Texto nuevo.</p></section>", 1)
    area.fill(codigo)
    pagina.get_by_role("button", name="Aplicar cambios").click()
    pagina.wait_for_timeout(800)
    nombres = pagina.locator(".titulo-seccion").all_inner_texts()
    paso("Código aplicado; un <h1> nuevo divide la sección", "Capítulo 2 – Desde el código" in nombres, ", ".join(nombres))
    codigo_malo = area.input_value().replace("<p>", "<p><b>", 1)
    area.fill(codigo_malo)
    pagina.get_by_role("button", name="Aplicar cambios").click()
    expect(pagina.locator(".codigo .error")).to_contain_text("no está bien formado")
    # El 400 de esta petición es el rechazo esperado, no un error de la app.
    errores_consola[:] = [e for e in errores_consola if "400 (Bad Request)" not in e]
    paso("XHTML mal formado se rechaza", True)
    pagina.get_by_role("button", name="Descartar").click()
    pagina.get_by_role("tab", name="Escribir").click()
    pagina.locator(".lista-secciones").get_by_role("button", name="Capítulo 1 – La llegada").click()
    expect(pagina.locator(".pagina-editor")).to_contain_text("editado en código")
    paso("El editor visual refleja el código", True)

    # Validación y exportación.
    pagina.get_by_role("button", name="Validar", exact=True).click()
    expect(pagina.locator(".resultado-validacion")).to_be_visible(timeout=60000)
    valido = pagina.locator(".resultado-validacion .ok").count() == 1
    paso("Validación EPUBCheck en la interfaz", valido, pagina.locator(".resultado-validacion").inner_text()[:300])
    pagina.screenshot(path=f"{CAPTURAS}/07-validacion.png")
    with pagina.expect_download(timeout=90000) as d:
        pagina.get_by_role("button", name="Exportar EPUB").click()
    ruta_epub = f"{CAPTURAS}/exportado.epub"
    d.value.save_as(ruta_epub)
    r = subprocess.run(["java", "-jar", "recursos/epubcheck/epubcheck.jar", ruta_epub], capture_output=True, text=True)
    paso("EPUB exportado pasa EPUBCheck", "No errors or warnings detected" in r.stdout, r.stdout.strip().splitlines()[-1] if r.stdout else r.stderr[-200:])

    # Impresión: ajustes, vista previa compaginada y PDF.
    pagina.locator(".inspector").get_by_role("tab", name="Impresión").click()
    pagina.get_by_label("Tamaño de corte").select_option("6x9")
    pagina.wait_for_timeout(500)
    estado = pagina.evaluate("fetch('/api/estado').then(r => r.json())")
    paso("Ajustes de impresión guardados", abs(estado["libro"]["impresion"]["ancho"] - 152.4) < 0.01)
    pagina.screenshot(path=f"{CAPTURAS}/10-ajustes-impresion.png")
    pagina.locator(".pestanas-centro").get_by_role("tab", name="Impresión").click()
    visor = pagina.frame_locator(".vista-impresion iframe")
    expect(visor.locator('[data-vivliostyle-viewer-status="complete"]').first).to_be_attached(timeout=90000)
    pagina.wait_for_timeout(800)
    pagina.screenshot(path=f"{CAPTURAS}/11-vista-impresion.png")
    paso("Vista previa de impresión compaginada", True)
    with pagina.expect_download(timeout=180000) as d:
        pagina.get_by_role("button", name="PDF para imprenta").click()
    ruta_pdf = f"{CAPTURAS}/impresion.pdf"
    d.value.save_as(ruta_pdf)
    info = subprocess.run(["pdfinfo", ruta_pdf], capture_output=True, text=True).stdout
    tam = [l for l in info.splitlines() if l.startswith("Page size")]
    paso("PDF para imprenta 6 × 9 in", bool(tam) and "432 x 648" in tam[0], tam[0] if tam else info[:200])
    expect(pagina.locator(".revision-impresion h3")).to_contain_text("páginas")
    paso("Revisión previa con número de páginas", True, pagina.locator(".revision-impresion h3").inner_text())

    # Guardar el proyecto.
    with pagina.expect_download() as d:
        pagina.get_by_role("button", name="Guardar", exact=True).click()
    ruta_obi = f"{CAPTURAS}/proyecto.obi"
    d.value.save_as(ruta_obi)
    expect(pagina.locator(".guardado")).to_be_visible()
    paso("Guardar proyecto .obi", os.path.getsize(ruta_obi) > 1000)

    # Importar Word.
    pagina.locator('input[type=file][accept=".epub,.docx,.obi"]').set_input_files(f"{DOCS}/prueba.docx")
    expect(pagina.locator(".titulo-libro strong")).to_have_text("La espada del alba")
    nombres = pagina.locator(".titulo-seccion").all_inner_texts()
    paso("Importar Word", nombres == ["Prólogo", "Capítulo 1: El despertar"], ", ".join(nombres))
    pagina.locator(".lista-secciones").get_by_role("button", name="Capítulo 1: El despertar").click()
    expect(pagina.locator(".pagina-editor img")).to_be_visible()
    pagina.screenshot(path=f"{CAPTURAS}/08-word-importado.png")

    # Volver a abrir el proyecto guardado.
    pagina.locator('input[type=file][accept=".epub,.docx,.obi"]').set_input_files(ruta_obi)
    pagina.get_by_role("dialog").get_by_role("button", name="Abrir").click()  # confirmar: hay cambios sin guardar
    expect(pagina.locator(".titulo-libro strong")).to_have_text("Mi vida en otro mundo")
    nombres = pagina.locator(".titulo-seccion").all_inner_texts()
    paso("Reabrir el proyecto .obi", "Capítulo 2 – Desde el código" in nombres, ", ".join(nombres))

    # Ventana pequeña (1024 px).
    pagina.set_viewport_size({"width": 1024, "height": 700})
    pagina.wait_for_timeout(300)
    pagina.screenshot(path=f"{CAPTURAS}/09-1024px.png")
    desborda = pagina.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    paso("Cabe en una ventana de 1024 px", not desborda)
    navegador.close()

fallos = [r for r in resultados if not r[1]]
print(f"\n{len(resultados) - len(fallos)}/{len(resultados)} pasos correctos")
if errores_consola:
    print("Errores de consola:", *errores_consola[:10], sep="\n  ")
sys.exit(1 if fallos or errores_consola else 0)
