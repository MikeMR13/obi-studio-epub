// Importador y exportador de texto plano.

const TITULO = /^(cap[ií]tulo\b.*|pr[oó]logo\b.*|ep[ií]logo\b.*|interludio\b.*)$/i;

function tipoDe(titulo) {
  if (/^pr[oó]logo/i.test(titulo)) return 'prologo';
  if (/^ep[ií]logo/i.test(titulo)) return 'epilogo';
  if (/^interludio/i.test(titulo)) return 'interludio';
  return 'capitulo';
}

function decodificar(datos) {
  // UTF-8 sin TextDecoder (el plugin no tiene APIs del sistema).
  let s = '';
  for (let k = 0; k < datos.length; ) {
    const b = datos[k];
    let c, n;
    if (b < 0x80) { c = b; n = 1; }
    else if (b >> 5 === 6) { c = ((b & 31) << 6) | (datos[k + 1] & 63); n = 2; }
    else if (b >> 4 === 14) { c = ((b & 15) << 12) | ((datos[k + 1] & 63) << 6) | (datos[k + 2] & 63); n = 3; }
    else { c = ((b & 7) << 18) | ((datos[k + 1] & 63) << 12) | ((datos[k + 2] & 63) << 6) | (datos[k + 3] & 63); n = 4; }
    s += String.fromCodePoint(c);
    k += n;
  }
  return s.replace(/^﻿/, '');
}

obi.registrar({
  importar(datos, nombre) {
    const texto = decodificar(datos).replace(/\r\n?/g, '\n');
    const secciones = [];
    let actual = null;
    const nueva = (titulo) => {
      actual = { tipo: titulo ? tipoDe(titulo) : 'capitulo', titulo: titulo || 'Capítulo 1', mostrarTitulo: true, enIndice: true, bloques: [], notas: [] };
      secciones.push(actual);
    };
    for (const trozo of texto.split(/\n\s*\n/)) {
      const linea = trozo.replace(/\n/g, ' ').trim();
      if (!linea) continue;
      if (TITULO.test(linea) && linea.length < 120) { nueva(linea); continue; }
      if (!actual) nueva('');
      if (/^(\*\s*){3}$|^#$/.test(linea)) actual.bloques.push({ tipo: 'separador' });
      else actual.bloques.push({ tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: linea }] });
    }
    const titulo = nombre.replace(/\.[^.]+$/, '');
    console.log(`${secciones.length} secciones.`);
    return { metadatos: { titulo }, secciones };
  },

  exportar(libro) {
    const partes = [libro.metadatos.titulo, ''];
    for (const s of libro.secciones) {
      if (s.tipo === 'portada' || s.tipo === 'indice' || s.tipo === 'ilustracion') continue;
      if (s.titulo) partes.push(s.titulo, '');
      for (const b of s.bloques) {
        if (b.tipo === 'separador') partes.push('* * *', '');
        else {
          const t = obi.textoBloque(b);
          if (t) partes.push(t, '');
        }
      }
      s.notas.forEach((n, k) => partes.push(`[${k + 1}] ${obi.texto(n.contenido)}`, ''));
    }
    return { nombre: libro.metadatos.titulo, datos: partes.join('\n') };
  },
});
