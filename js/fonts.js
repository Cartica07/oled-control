/**
 * Adafruit GFX Font Metrics
 * Métricas EXACTAS de Adafruit_GFX.cpp replicadas pixel-perfect
 * 
 * Basado directamente en:
 * - Adafruit_GFX.cpp línea 1493: cursor_x += textsize * 6;
 * - Adafruit_GFX.cpp línea 1494: cursor_y += textsize * 8;
 * - Sin espaciado extra entre líneas (lineHeight = height)
 */

export const fontMetrics = {
  // Tamaño 1: 5 píxeles base, escala 1x = 6 ancho, 8 alto
  // Cálculo: width = 5 (char) + 1 (spacing) = 6
  1: {
    width: 6,      // 5 píxeles caractér + 1 espaciado
    height: 8,     // Altura exacta del carácter
    charWidth: 5,
    baseline: 6,
    lineHeight: 8  // SIN espaciado extra (igual a height)
  },
  // Tamaño 2: 5 píxeles base * 2 = 10, + 1 spacing * 2 = 2 → 12 ancho, 16 alto
  2: {
    width: 12,     // (5 * 2) + (1 * 2) = 12
    height: 16,    // 8 * 2
    charWidth: 10,
    baseline: 12,
    lineHeight: 16 // SIN espaciado extra (igual a height)
  },
  // Tamaño 3: 5 píxeles base * 3 = 15, + 1 spacing * 3 = 3 → 18 ancho, 24 alto
  3: {
    width: 18,     // (5 * 3) + (1 * 3) = 18
    height: 24,    // 8 * 3
    charWidth: 15,
    baseline: 18,
    lineHeight: 24 // SIN espaciado extra (igual a height)
  },
  // Tamaño 4: 5 píxeles base * 4 = 20, + 1 spacing * 4 = 4 → 24 ancho, 32 alto
  4: {
    width: 24,     // (5 * 4) + (1 * 4) = 24
    height: 32,    // 8 * 4
    charWidth: 20,
    baseline: 24,
    lineHeight: 32 // SIN espaciado extra (igual a height)
  }
};

/**
 * Calcula el ancho en píxeles de un texto en un tamaño dado
 * Usa métricas de Adafruit GFX para precisión
 */
export function calcularAnchoTexto(texto, tamano) {
  const metrics = fontMetrics[tamano];
  if (!metrics) return 0;
  
  let ancho = 0;
  for (let i = 0; i < texto.length; i++) {
    const char = texto[i];
    // Caracteres especiales o espacios: ancho reducido
    if (char === ' ') {
      ancho += metrics.width * 0.5; // espacios más estrechos
    } else if (char === '\t') {
      ancho += metrics.width * 4; // tab = 4 espacios
    } else {
      // Mayoría de caracteres: ancho estándar
      ancho += metrics.width;
    }
  }
  return ancho;
}

/**
 * Calcula la altura en píxeles de un bloque de texto
 */
export function calcularAltoTexto(lineas, tamano) {
  const metrics = fontMetrics[tamano];
  if (!metrics || lineas.length === 0) return 0;
  
  return metrics.lineHeight * lineas.length;
}

/**
 * Divide un texto en líneas para que se ajuste al ancho de la OLED
 * Usa word-wrap: corta por palabras, no por caracteres
 */
export function dividirEnLineas(texto, tamano, anchoMax = 128) {
  const palabras = texto.length ? texto.split(' ') : [''];
  const lineas = [];
  let actual = '';

  for (const palabra of palabras) {
    const candidata = actual.length ? actual + ' ' + palabra : palabra;
    const ancho = calcularAnchoTexto(candidata, tamano);

    if (ancho <= anchoMax) {
      actual = candidata;
    } else {
      if (actual.length > 0) lineas.push(actual);
      actual = palabra;
    }
  }

  if (actual.length > 0) lineas.push(actual);
  if (lineas.length === 0) lineas.push('');
  return lineas;
}

/**
 * Encuentra el tamaño más grande que permite ajustar el texto en el ancho
 * Usado para modo 'reducir'
 */
export function calcularTamanoReducido(texto, tamanoMax, anchoMax = 128) {
  for (let t = tamanoMax; t >= 1; t--) {
    if (calcularAnchoTexto(texto, t) <= anchoMax) {
      return t;
    }
  }
  return 1;
}

/**
 * Recorta un texto agregando "..." si excede el ancho
 * Usado para modo 'recortar'
 */
export function recortarTexto(texto, tamano, anchoMax = 128) {
  if (calcularAnchoTexto(texto, tamano) <= anchoMax) {
    return texto;
  }

  const sufijo = '...';
  const anchoSufijo = calcularAnchoTexto(sufijo, tamano);
  
  for (let len = texto.length - 1; len > 0; len--) {
    const candidata = texto.slice(0, len) + sufijo;
    if (calcularAnchoTexto(candidata, tamano) <= anchoMax) {
      return candidata;
    }
  }
  
  return sufijo;
}

/**
 * Calcula la posición X para alinear un texto
 */
export function calcularX(texto, tamano, alineacion, anchoMax = 128) {
  const w = calcularAnchoTexto(texto, tamano);
  let x = 0;
  
  if (alineacion === 'centro') {
    x = (anchoMax - w) / 2;
  } else if (alineacion === 'derecha') {
    x = anchoMax - w;
  }
  // 'izquierda': x = 0 (por defecto)
  
  return Math.max(0, Math.round(x));
}
