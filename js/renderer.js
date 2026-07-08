/**
 * OLED Renderer
 * Dibuja pixel-perfect el bitmap real de Adafruit_GFX (glcdfont.c),
 * el mismo que usa pantalla.cpp en el ESP8266. Nada de fuentes del
 * sistema ni escalas manuales: cada punto que ves acá es el mismo
 * punto que se prende en la OLED física.
 */

import {
  fontMetrics,
  calcularAltoTexto,
  dividirEnLineas,
  calcularTamanoReducido,
  recortarTexto,
  calcularX,
  dibujarTextoBitmap
} from './fonts.js';

const ANCHO = 128;
const ALTO = 64;
const AMBAR = '#ffb000';
const NEGRO = '#000000';

/**
 * Dibuja la pantalla OLED completa basada en el estado actual
 */
export function dibujarOLED(canvas, estado, scrollX = null) {
  const ctx = canvas.getContext('2d');

  const fondo = estado.invertido ? AMBAR : NEGRO;
  const frente = estado.invertido ? NEGRO : AMBAR;

  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, ALTO);
  ctx.fillStyle = frente;

  if (estado.modoTexto === 'ajustar') {
    renderizarAjustar(ctx, estado, frente);
  } else if (estado.modoTexto === 'reducir') {
    renderizarReducir(ctx, estado, frente);
  } else if (estado.modoTexto === 'recortar') {
    renderizarRecortar(ctx, estado, frente);
  } else if (estado.modoTexto === 'scroll') {
    renderizarScroll(ctx, estado, frente, scrollX);
  }
}

/**
 * Modo 'ajustar': divide en líneas y centra verticalmente el bloque.
 * El bloque se mide con la altura de CELDA (8*tamaño por línea), no
 * solo la tinta -- así el margen inferior queda igual de "grande" que
 * en la pantalla real (ver nota en fonts.js).
 */
function renderizarAjustar(ctx, estado, colorFrente) {
  const tamano = estado.tamano;
  const lineas = dividirEnLineas(estado.texto, tamano, ANCHO);
  const metrics = fontMetrics[tamano];

  const alturaBloque = calcularAltoTexto(lineas, tamano);
  const y = Math.max(0, Math.round((ALTO - alturaBloque) / 2));

  dibujarLineas(ctx, lineas, tamano, estado.alineacion, y, colorFrente);
}

/** Modo 'reducir': encuentra el tamaño más grande que entra. */
function renderizarReducir(ctx, estado, colorFrente) {
  const tamanoOptimo = calcularTamanoReducido(estado.texto, estado.tamano, ANCHO);
  const metrics = fontMetrics[tamanoOptimo];

  const x = calcularX(estado.texto, tamanoOptimo, estado.alineacion, ANCHO);
  const y = Math.max(0, Math.round((ALTO - metrics.height) / 2));

  dibujarTextoBitmap(ctx, estado.texto, tamanoOptimo, x, y, colorFrente);
}

/** Modo 'recortar': corta con "..." si no entra. */
function renderizarRecortar(ctx, estado, colorFrente) {
  const tamano = estado.tamano;
  const textoRecortado = recortarTexto(estado.texto, tamano, ANCHO);
  const metrics = fontMetrics[tamano];

  const x = calcularX(textoRecortado, tamano, estado.alineacion, ANCHO);
  const y = Math.max(0, Math.round((ALTO - metrics.height) / 2));

  dibujarTextoBitmap(ctx, textoRecortado, tamano, x, y, colorFrente);
}

/** Modo 'scroll': una línea que se desliza horizontalmente. */
function renderizarScroll(ctx, estado, colorFrente, scrollX) {
  const tamano = estado.tamano;
  const metrics = fontMetrics[tamano];

  const x = typeof scrollX === 'number' ? scrollX : ANCHO;
  const y = Math.max(0, Math.round((ALTO - metrics.height) / 2));

  dibujarTextoBitmap(ctx, estado.texto, tamano, x, y, colorFrente);
}

/** Dibuja un bloque de líneas alineadas. */
function dibujarLineas(ctx, lineas, tamano, alineacion, startY, colorFrente) {
  const metrics = fontMetrics[tamano];

  lineas.forEach((linea, i) => {
    const x = calcularX(linea, tamano, alineacion, ANCHO);
    const y = startY + i * metrics.lineHeight;
    dibujarTextoBitmap(ctx, linea, tamano, x, y, colorFrente);
  });
}
