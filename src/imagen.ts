// Lectura mínima de tamaño de imagen (sin dependencias nativas).

export const TIPOS_IMAGEN_EPUB: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export function tipoPorNombre(nombre: string): string | undefined {
  const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
  return TIPOS_IMAGEN_EPUB[ext];
}

export function tipoPorContenido(d: Uint8Array): string | undefined {
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg';
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return 'image/png';
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46) return 'image/gif';
  if (d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45) return 'image/webp';
  const inicio = new TextDecoder().decode(d.slice(0, 256)).trimStart();
  if (inicio.startsWith('<svg') || (inicio.startsWith('<?xml') && inicio.includes('<svg'))) return 'image/svg+xml';
  return undefined;
}

export function extension(tipoMime: string): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[tipoMime] ?? 'bin';
}

export function tamanoImagen(d: Uint8Array): { ancho: number; alto: number } | undefined {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  try {
    if (d[0] === 0x89 && d[1] === 0x50) return { ancho: v.getUint32(16), alto: v.getUint32(20) };
    if (d[0] === 0x47 && d[1] === 0x49) return { ancho: v.getUint16(6, true), alto: v.getUint16(8, true) };
    if (d[0] === 0xff && d[1] === 0xd8) {
      let i = 2;
      while (i < d.length) {
        if (d[i] !== 0xff) return undefined;
        const marca = d[i + 1];
        const largo = v.getUint16(i + 2);
        if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
          return { alto: v.getUint16(i + 5), ancho: v.getUint16(i + 7) };
        }
        i += 2 + largo;
      }
    }
    if (d[0] === 0x52 && d[8] === 0x57) {
      const fmt = String.fromCharCode(d[12], d[13], d[14], d[15]);
      if (fmt === 'VP8 ') return { ancho: v.getUint16(26, true) & 0x3fff, alto: v.getUint16(28, true) & 0x3fff };
      if (fmt === 'VP8L') {
        const b = v.getUint32(21, true);
        return { ancho: (b & 0x3fff) + 1, alto: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fmt === 'VP8X') {
        const ancho = 1 + (d[24] | (d[25] << 8) | (d[26] << 16));
        const alto = 1 + (d[27] | (d[28] << 8) | (d[29] << 16));
        return { ancho, alto };
      }
    }
    if (tipoPorContenido(d) === 'image/svg+xml') {
      const s = new TextDecoder().decode(d.slice(0, 4096));
      const vb = s.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
      if (vb) return { ancho: Math.round(+vb[1]), alto: Math.round(+vb[2]) };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
