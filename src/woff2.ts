// WOFF2 → TrueType/OpenType: descompresión Brotli (la de node:zlib) y reconstrucción de las tablas
// glyf/loca y hmtx transformadas, según la especificación del W3C (https://www.w3.org/TR/WOFF2/).
// Las colecciones (ttcf) no se admiten.

import { brotliDecompressSync } from 'node:zlib';

const ETIQUETAS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

class Lector {
  pos = 0;
  private v: DataView;
  constructor(public d: Uint8Array, desde = 0, public fin = d.length) {
    this.v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    this.pos = desde;
  }
  private comprobar(n: number) {
    if (this.pos + n > this.fin) throw new Error('WOFF2 truncado');
  }
  u8() {
    this.comprobar(1);
    return this.d[this.pos++];
  }
  u16() {
    this.comprobar(2);
    const x = this.v.getUint16(this.pos);
    this.pos += 2;
    return x;
  }
  i16() {
    this.comprobar(2);
    const x = this.v.getInt16(this.pos);
    this.pos += 2;
    return x;
  }
  u32() {
    this.comprobar(4);
    const x = this.v.getUint32(this.pos);
    this.pos += 4;
    return x;
  }
  bytes(n: number) {
    this.comprobar(n);
    const x = this.d.subarray(this.pos, this.pos + n);
    this.pos += n;
    return x;
  }
  base128() {
    let r = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      if (i === 0 && b === 0x80) throw new Error('UIntBase128 no válido');
      r = r * 128 + (b & 0x7f);
      if (!(b & 0x80)) return r;
    }
    throw new Error('UIntBase128 demasiado largo');
  }
  u255() {
    const c = this.u8();
    if (c === 253) return this.u16();
    if (c === 255) return this.u8() + 253;
    if (c === 254) return this.u8() + 506;
    return c;
  }
}

class Escritor {
  partes: number[] = [];
  u8(x: number) {
    this.partes.push(x & 0xff);
  }
  u16(x: number) {
    this.partes.push((x >> 8) & 0xff, x & 0xff);
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.partes.push(x);
  }
  relleno(m: number) {
    while (this.partes.length % m) this.partes.push(0);
  }
  get largo() {
    return this.partes.length;
  }
  final() {
    return Uint8Array.from(this.partes);
  }
}

function conSigno(f: number, v: number) {
  return f & 1 ? v : -v;
}

interface Glifos {
  glyf: Uint8Array;
  loca: Uint8Array;
  xMin: Int16Array;
}

function reconstruirGlyf(datos: Uint8Array, formatoLoca: number | undefined): Glifos {
  const h = new Lector(datos);
  h.u16(); // reservado
  const opciones = h.u16();
  const numGlifos = h.u16();
  const formato = h.u16();
  const tam = [h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32()];
  let p = h.pos;
  const flujo = tam.map((t) => {
    const l = new Lector(datos, p, p + t);
    p += t;
    return l;
  });
  const [contornos, puntos, banderas, glifo, compuesto, cajas, instrucciones] = flujo;
  void opciones; // el mapa de solapes (bit 0) no hace falta para leer la letra
  const bytesMapa = ((numGlifos + 31) >> 5) * 4;
  const mapaCajas = cajas.bytes(bytesMapa);
  const salida = new Escritor();
  const desplazamientos: number[] = [];
  const xMin = new Int16Array(numGlifos);
  for (let g = 0; g < numGlifos; g++) {
    desplazamientos.push(salida.largo);
    const nc = contornos.i16();
    const conCaja = !!(mapaCajas[g >> 3] & (0x80 >> (g & 7)));
    if (nc === 0) {
      if (conCaja) throw new Error('Glifo vacío con caja');
      continue;
    }
    if (nc === -1) {
      if (!conCaja) throw new Error('Glifo compuesto sin caja');
      const caja = [cajas.i16(), cajas.i16(), cajas.i16(), cajas.i16()];
      const inicio = compuesto.pos;
      let mas = true;
      let conInstr = false;
      while (mas) {
        const fl = compuesto.u16();
        compuesto.u16();
        let n = fl & 0x0001 ? 4 : 2;
        if (fl & 0x0008) n += 2;
        else if (fl & 0x0040) n += 4;
        else if (fl & 0x0080) n += 8;
        compuesto.bytes(n);
        if (fl & 0x0100) conInstr = true;
        mas = !!(fl & 0x0020);
      }
      const datosComp = compuesto.d.subarray(inicio, compuesto.pos);
      salida.u16(0xffff);
      for (const c of caja) salida.u16(c);
      salida.bytes(datosComp);
      if (conInstr) {
        const ni = glifo.u255();
        salida.u16(ni);
        salida.bytes(instrucciones.bytes(ni));
      }
      xMin[g] = caja[0];
      salida.relleno(4);
      continue;
    }
    // Glifo simple.
    const finales: number[] = [];
    let total = 0;
    for (let c = 0; c < nc; c++) {
      total += puntos.u255();
      finales.push(total - 1);
    }
    const xs: number[] = [];
    const ys: number[] = [];
    const sobre: boolean[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < total; i++) {
      let f = banderas.u8();
      sobre.push(!(f >> 7));
      f &= 0x7f;
      const n = f < 84 ? 1 : f < 120 ? 2 : f < 124 ? 3 : 4;
      const b = glifo.bytes(n);
      let dx: number;
      let dy: number;
      if (f < 10) {
        dx = 0;
        dy = conSigno(f, ((f & 14) << 7) + b[0]);
      } else if (f < 20) {
        dx = conSigno(f, (((f - 10) & 14) << 7) + b[0]);
        dy = 0;
      } else if (f < 84) {
        const b0 = f - 20;
        dx = conSigno(f, 1 + (b0 & 0x30) + (b[0] >> 4));
        dy = conSigno(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b[0] & 0x0f));
      } else if (f < 120) {
        const b0 = f - 84;
        dx = conSigno(f, 1 + (Math.floor(b0 / 12) << 8) + b[0]);
        dy = conSigno(f >> 1, 1 + (((b0 % 12) >> 2) << 8) + b[1]);
      } else if (f < 124) {
        dx = conSigno(f, (b[0] << 4) + (b[1] >> 4));
        dy = conSigno(f >> 1, ((b[1] & 0x0f) << 8) + b[2]);
      } else {
        dx = conSigno(f, (b[0] << 8) + b[1]);
        dy = conSigno(f >> 1, (b[2] << 8) + b[3]);
      }
      x += dx;
      y += dy;
      xs.push(x);
      ys.push(y);
    }
    const ni = glifo.u255();
    const instr = instrucciones.bytes(ni);
    const caja = conCaja
      ? [cajas.i16(), cajas.i16(), cajas.i16(), cajas.i16()]
      : total
        ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
        : [0, 0, 0, 0];
    xMin[g] = caja[0];
    salida.u16(nc);
    for (const c of caja) salida.u16(c);
    for (const e of finales) salida.u16(e);
    salida.u16(ni);
    salida.bytes(instr);
    // Coordenadas como diferencias de 16 bits: banderas solo con «sobre la curva».
    for (let i = 0; i < total; i++) salida.u8(sobre[i] ? 1 : 0);
    let ant = 0;
    for (const v of xs) {
      salida.u16(v - ant);
      ant = v;
    }
    ant = 0;
    for (const v of ys) {
      salida.u16(v - ant);
      ant = v;
    }
    salida.relleno(4);
  }
  desplazamientos.push(salida.largo);
  const corto = (formatoLoca ?? formato) === 0;
  const loca = new Escritor();
  for (const d of desplazamientos) {
    if (corto) loca.u16(d >> 1);
    else {
      loca.u16(Math.floor(d / 65536));
      loca.u16(d & 0xffff);
    }
  }
  return { glyf: salida.final(), loca: loca.final(), xMin };
}

function reconstruirHmtx(datos: Uint8Array, numGlifos: number, numMetricas: number, xMin: Int16Array): Uint8Array {
  const l = new Lector(datos);
  const banderas = l.u8();
  const avances: number[] = [];
  for (let i = 0; i < numMetricas; i++) avances.push(l.u16());
  const lsb: number[] = [];
  for (let i = 0; i < numMetricas; i++) lsb.push(banderas & 1 ? xMin[i] : l.i16());
  for (let i = numMetricas; i < numGlifos; i++) lsb.push(banderas & 2 ? xMin[i] : l.i16());
  const s = new Escritor();
  for (let i = 0; i < numGlifos; i++) {
    if (i < numMetricas) s.u16(avances[i]);
    s.u16(lsb[i]);
  }
  return s.final();
}

function suma(d: Uint8Array): number {
  let s = 0;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = d.length & ~3;
  for (let i = 0; i < n; i += 4) s = (s + v.getUint32(i)) >>> 0;
  if (d.length & 3) {
    let ultimo = 0;
    for (let i = n; i < d.length; i++) ultimo |= d[i] << (24 - 8 * (i - n));
    s = (s + (ultimo >>> 0)) >>> 0;
  }
  return s;
}

/** Convierte una fuente WOFF2 en TrueType/OpenType; undefined si no es WOFF2 o no se puede leer. */
export function woff2ASfnt(d: Uint8Array): Uint8Array | undefined {
  try {
    const l = new Lector(d);
    if (l.u32() !== 0x774f4632) return undefined;
    const sabor = l.u32();
    if (sabor === 0x74746366) return undefined; // colección
    l.u32(); // largo
    const n = l.u16();
    l.u16();
    l.u32(); // totalSfntSize
    const comprimido = l.u32();
    l.pos = 48;
    const dir: { tag: string; transf: boolean; largo: number; largoTransf: number }[] = [];
    for (let i = 0; i < n; i++) {
      const fl = l.u8();
      const indice = fl & 0x3f;
      const tag = indice === 63 ? String.fromCharCode(...l.bytes(4)) : ETIQUETAS[indice];
      const version = (fl >> 6) & 3;
      const largo = l.base128();
      const transf = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
      const largoTransf = transf ? l.base128() : largo;
      dir.push({ tag, transf, largo, largoTransf });
    }
    const datos = new Uint8Array(brotliDecompressSync(l.bytes(comprimido)));
    const tablas = new Map<string, Uint8Array>();
    let p = 0;
    for (const t of dir) {
      tablas.set(t.tag, datos.subarray(p, p + t.largoTransf));
      p += t.largoTransf;
    }
    const head = tablas.get('head');
    const formatoLoca = head && head.length >= 52 ? new DataView(head.buffer, head.byteOffset).getInt16(50) : undefined;
    let xMin: Int16Array | undefined;
    const glyf = dir.find((t) => t.tag === 'glyf');
    if (glyf?.transf) {
      const g = reconstruirGlyf(tablas.get('glyf')!, formatoLoca);
      tablas.set('glyf', g.glyf);
      tablas.set('loca', g.loca);
      xMin = g.xMin;
    }
    const hmtx = dir.find((t) => t.tag === 'hmtx');
    if (hmtx?.transf) {
      const maxp = tablas.get('maxp')!;
      const hhea = tablas.get('hhea')!;
      const numGlifos = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
      const numMetricas = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
      tablas.set('hmtx', reconstruirHmtx(tablas.get('hmtx')!, numGlifos, numMetricas, xMin ?? new Int16Array(numGlifos)));
    }
    // Montaje del sfnt (tablas ordenadas por etiqueta).
    const orden = [...tablas.keys()].sort();
    const m = orden.length;
    let largo = 12 + 16 * m;
    for (const t of orden) largo += (tablas.get(t)!.length + 3) & ~3;
    const salida = new Uint8Array(largo);
    const w = new DataView(salida.buffer);
    const pot = 2 ** Math.floor(Math.log2(Math.max(1, m)));
    w.setUint32(0, sabor);
    w.setUint16(4, m);
    w.setUint16(6, pot * 16);
    w.setUint16(8, Math.log2(pot));
    w.setUint16(10, m * 16 - pot * 16);
    let pos = 12 + 16 * m;
    let posHead = -1;
    orden.forEach((t, i) => {
      const td = tablas.get(t)!.slice();
      if (t === 'head' && td.length >= 12) {
        new DataView(td.buffer).setUint32(8, 0);
        posHead = pos;
      }
      const e = 12 + i * 16;
      for (let k = 0; k < 4; k++) salida[e + k] = t.charCodeAt(k);
      w.setUint32(e + 4, suma(td));
      w.setUint32(e + 8, pos);
      w.setUint32(e + 12, td.length);
      salida.set(td, pos);
      pos += (td.length + 3) & ~3;
    });
    if (posHead >= 0) w.setUint32(posHead + 8, (0xb1b0afba - suma(salida)) >>> 0);
    return salida;
  } catch {
    return undefined;
  }
}
