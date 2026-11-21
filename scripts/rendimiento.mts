// Prueba de rendimiento con un libro largo: 40 capítulos, ~150.000 palabras, notas e ilustraciones.
// Mide compilar, validar, importar, el análisis y la conversión sencilla, guardar el proyecto y el HTML de impresión.
// Uso: npx tsx scripts/rendimiento.mts [carpeta-de-salida]
import { writeFileSync, mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { libroNuevo, nuevaSeccion, nuevoId, type Bloque, type Libro } from '../src/model.ts';
import { compilar } from '../src/compilar.ts';
import { importarEpub } from '../src/formatos/epub.ts';
import { validarDatos } from '../src/validar.ts';
import { htmlImpresion } from '../src/impresion.ts';
import { serializarProyecto } from '../src/proyecto.ts';
import { pngSolido } from '../src/pruebas/fixtures.ts';
import { Backend } from '../app/backend.ts';

const salida = process.argv[2] ?? join(tmpdir(), 'obi-rendimiento');
mkdirSync(salida, { recursive: true });
const PALABRAS = 'el la de que y en un una espada gremio aventurero dragón magia reino princesa caballero bosque ciudad noche camino'.split(' ');
let semilla = 7;
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
const frase = (n: number) => {
  const p = Array.from({ length: n }, () => PALABRAS[Math.floor(azar() * PALABRAS.length)]);
  p[0] = p[0][0].toUpperCase() + p[0].slice(1);
  return p.join(' ') + '.';
};

function libroLargo(): Libro {
  const l = libroNuevo('Libro largo de prueba', 'Autora');
  l.secciones = l.secciones.filter((s) => s.tipo !== 'capitulo');
  for (let i = 0; i < 30; i++) {
    const id = nuevoId('r');
    l.recursos.push({ id, nombre: `ilustracion-${i + 1}.png`, tipoMime: 'image/png', datos: pngSolido(1200, 1700, [40 + i * 5, 90, 140]), ancho: 1200, alto: 1700 });
  }
  let palabras = 0;
  for (let c = 1; c <= 40; c++) {
    const s = nuevaSeccion('capitulo', `Capítulo ${c}`);
    const bloques: Bloque[] = [];
    for (let p = 0; p < 95; p++) {
      const texto = frase(20 + Math.floor(azar() * 40));
      palabras += texto.split(' ').length;
      if (p % 30 === 15) bloques.push({ tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto: `Parte ${p}` }] });
      if (p === 50) bloques.push({ tipo: 'separador' });
      const contenido: Bloque & { tipo: 'parrafo' } = { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto }] };
      if (p % 40 === 7) {
        const n = nuevoId('n');
        contenido.contenido.push({ tipo: 'nota', id: n });
        s.notas.push({ id: n, contenido: [{ tipo: 'texto', texto: 'Nota del traductor.' }] });
      }
      bloques.push(contenido);
    }
    if (c <= 30) bloques.splice(10, 0, { tipo: 'imagen', recurso: l.recursos[c - 1].id, alt: `Ilustración ${c}` });
    s.bloques = bloques;
    l.secciones.push(s);
  }
  console.log(`Libro: ${l.secciones.length} secciones, ${palabras.toLocaleString('es')} palabras, ${l.recursos.length} imágenes`);
  return l;
}

const tiempos: [string, number][] = [];
async function medir<T>(nombre: string, f: () => Promise<T> | T): Promise<T> {
  const t0 = performance.now();
  const r = await f();
  const ms = performance.now() - t0;
  tiempos.push([nombre, ms]);
  console.log(`${nombre.padEnd(42)} ${(ms / 1000).toFixed(2).padStart(7)} s`);
  return r;
}

const libro = libroLargo();
const epub = await medir('Compilar EPUB', () => compilar(libro));
writeFileSync(join(salida, 'largo.epub'), epub);
console.log(`  tamaño: ${(epub.length / 1e6).toFixed(1)} MB`);
const v = await medir('EPUBCheck', () => validarDatos(epub));
console.log(`  mensajes: ${v.mensajes.length}`);
const { libro: vuelta } = await medir('Importar EPUB', () => importarEpub(epub));
console.log(`  secciones importadas: ${vuelta.secciones.length}`);
const obi = await medir('Guardar proyecto .obi', () => serializarProyecto(libro));
writeFileSync(join(salida, 'largo.obi'), obi);
await medir('HTML de impresión', () => htmlImpresion(libro, { digital: true } as never).length);
const b = new Backend(await mkdtemp(join(tmpdir(), 'obi-rend-')));
await medir('Análisis de la conversión sencilla', () => b.analizarConversion('largo.epub', epub));
await medir('Lista de capítulos (asistente)', () => b.capitulosConversion({}));
await medir('Vista previa (asistente)', () => b.vistaPreviaConversion({}));
await medir('Conversión sencilla', () => b.conversionSencilla({}));
await medir('Exportar EPUB desde la app', () => b.exportar());
const memoria = process.memoryUsage();
console.log(`Memoria: ${(memoria.heapUsed / 1e6).toFixed(0)} MB en uso, ${(memoria.rss / 1e6).toFixed(0)} MB del proceso`);
writeFileSync(join(salida, 'tiempos.json'), JSON.stringify(Object.fromEntries(tiempos), null, 2));
