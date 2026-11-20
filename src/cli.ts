// Línea de comandos del motor de Obi Studio.
//   obi importar <entrada.epub|.docx> <salida.obi>
//   obi compilar <proyecto.obi> <salida.epub>
//   obi validar <libro.epub>
//   obi pdf <proyecto.obi> <salida.pdf> [--digital]

import { readFile, writeFile } from 'node:fs/promises';
import { importarEpub } from './formatos/epub.js';
import { importarDocx } from './formatos/docx.js';
import { compilar } from './compilar.js';
import { deserializarProyecto, guardarProyecto } from './proyecto.js';
import { validarArchivo } from './validar.js';
import { pdfDesdeLibro } from './servicio-impresion.js';

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
    const r = await pdfDesdeLibro(libro, process.argv.includes('--digital') ? 'digital' : 'impresion');
    await writeFile(salida, r.datos);
    console.log(`PDF escrito en ${salida}: ${r.paginas} páginas, margen interior ${r.interior} mm`);
  } else {
    console.log('Uso:\n  obi importar <entrada.epub|.docx> <salida.obi>\n  obi compilar <proyecto.obi> <salida.epub>\n  obi validar <libro.epub>\n  obi pdf <proyecto.obi> <salida.pdf> [--digital]');
    process.exitCode = 2;
  }
}

principal().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
