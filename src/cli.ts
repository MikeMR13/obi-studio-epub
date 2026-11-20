// Línea de comandos del motor de Obi Studio.
//   obi importar <entrada.epub|.docx> <salida.obi>
//   obi compilar <proyecto.obi> <salida.epub>
//   obi validar <libro.epub>
//   obi pdf <proyecto.obi> <salida.pdf> [--digital | --pdfx]
//   obi kepub <proyecto.obi> <salida.kepub.epub>
//   obi word <proyecto.obi> <salida.docx>
//   obi correcciones <proyecto.obi> <corregido.docx>   (actualiza el proyecto)
//   obi accesibilidad <proyecto.obi> <informe.html>

import { readFile, writeFile } from 'node:fs/promises';
import { importarEpub } from './formatos/epub.js';
import { importarDocx } from './formatos/docx.js';
import { compilar } from './compilar.js';
import { deserializarProyecto, guardarProyecto } from './proyecto.js';
import { validarArchivo } from './validar.js';
import { pdfDesdeLibro } from './servicio-impresion.js';
import { compilarKepub } from './kepub.js';
import { IMPRESION_PREDETERMINADA } from './model.js';
import { evaluadorChrome, informeHtml, revisarAccesibilidad } from './accesibilidad.js';
import { exportarWord, importarCorrecciones } from './formatos/word.js';

const [orden, entrada, salida] = process.argv.slice(2);

async function principal() {
  if (orden === 'importar' && entrada && salida) {
    const datos = new Uint8Array(await readFile(entrada));
    const r = entrada.toLowerCase().endsWith('.docx') ? await importarDocx(datos) : await importarEpub(datos);
    await guardarProyecto(salida, r.libro);
    console.log(`Importado: ${r.libro.metadatos.titulo} (${r.libro.secciones.length} secciones)`);
    for (const a of r.avisos) console.log(`Aviso: ${a.mensaje}${a.archivo ? ` (${a.archivo})` : ''}`);
  } else if (orden === 'compilar' && entrada && salida) {
    const libro = await deserializarProyecto(new Uint8Array(await readFile(entrada)));
    await writeFile(salida, await compilar(libro));
    console.log(`EPUB escrito en ${salida}`);
  } else if (orden === 'validar' && entrada) {
    const r = await validarArchivo(entrada);
    for (const m of r.mensajes) console.log(`${m.gravedad.toUpperCase()} ${m.codigo} ${m.archivo ?? ''}${m.linea ? `:${m.linea}` : ''} ${m.mensaje}`);
    console.log(r.valido ? `Válido (${r.avisos} avisos)` : `${r.errores} errores, ${r.avisos} avisos`);
    process.exitCode = r.valido ? 0 : 1;
  } else if (orden === 'pdf' && entrada && salida) {
    const libro = await deserializarProyecto(new Uint8Array(await readFile(entrada)));
    if (process.argv.includes('--pdfx')) libro.impresion = { ...(libro.impresion ?? IMPRESION_PREDETERMINADA), pdfx: true };
    const r = await pdfDesdeLibro(libro, process.argv.includes('--digital') ? 'digital' : 'impresion');
    await writeFile(salida, r.datos);
    console.log(`PDF escrito en ${salida}: ${r.paginas} páginas, margen interior ${r.interior} mm`);
  } else if (orden === 'kepub' && entrada && salida) {
    const libro = await deserializarProyecto(new Uint8Array(await readFile(entrada)));
    await writeFile(salida, await compilarKepub(libro));
    console.log(`KEPUB escrito en ${salida}`);
  } else if (orden === 'word' && entrada && salida) {
    const libro = await deserializarProyecto(new Uint8Array(await readFile(entrada)));
    await writeFile(salida, await exportarWord(libro));
    console.log(`Word para corrección escrito en ${salida}`);
  } else if (orden === 'correcciones' && entrada && salida) {
    const libro = await deserializarProyecto(new Uint8Array(await readFile(entrada)));
    const r = await importarCorrecciones(libro, new Uint8Array(await readFile(salida)));
    await guardarProyecto(entrada, libro);
    console.log(`Actualizadas: ${r.actualizadas.join(', ') || 'ninguna'}. Nuevas: ${r.nuevas.join(', ') || 'ninguna'}. Sin cambios: ${r.sinCambios}.`);
    for (const a of r.avisos) console.log(`Aviso: ${a}`);
  } else if (orden === 'accesibilidad' && entrada && salida) {
    const libro = await deserializarProyecto(new Uint8Array(await readFile(entrada)));
    const r = await revisarAccesibilidad(libro, evaluadorChrome());
    await writeFile(salida, informeHtml(r));
    for (const c of r.comprobaciones.filter((x) => !x.ok)) console.log(`✕ ${c.nombre}: ${c.detalle}`);
    for (const i of r.incidencias) console.log(`${i.impacto}: ${i.ayuda} (${i.tituloSeccion ?? i.archivo}, ${i.cantidad})`);
    console.log(r.conforme ? 'Sin problemas graves de accesibilidad.' : 'Hay problemas de accesibilidad que corregir.');
    console.log(`Informe escrito en ${salida}`);
    if (!r.conforme) process.exitCode = 1;
  } else {
    console.log('Uso:\n  obi importar <entrada.epub|.docx> <salida.obi>\n  obi compilar <proyecto.obi> <salida.epub>\n  obi validar <libro.epub>\n  obi pdf <proyecto.obi> <salida.pdf> [--digital | --pdfx]\n  obi kepub <proyecto.obi> <salida.kepub.epub>\n  obi word <proyecto.obi> <salida.docx>\n  obi correcciones <proyecto.obi> <corregido.docx>\n  obi accesibilidad <proyecto.obi> <informe.html>');
    process.exitCode = 2;
  }
}

principal().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
