/**
 * OLED Renderer
 * Simula pixel-perfect el comportamiento de renderizado de la SSD1306
 * usando las métricas exactas de Adafruit GFX
 */

import {
  fontMetrics,
  calcularAnchoTexto,
  calcularAltoTexto,
  dividirEnLineas,
  calcularTamanoReducido,
  recortarTexto,
  calcularX
} from './fonts.js';

const ANCHO = 128;
const ALTO = 64;
const AMBAR = '#ffb000';
const NEGRO = '#000000';
const ESCALA_FUENTE = 1.2; // Ajusta este valor para cambiar el tamaño de las letras
const AJUSTE_VERTICAL = -2;
/**
 * Dibuja la pantalla OLED completa basada en el estado actual
 */
export function dibujarOLED(canvas, estado, scrollX = null) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  // Limpiar y establecer colores de fondo/frente
  const fondo = estado.invertido ? AMBAR : NEGRO;
  const frente = estado.invertido ? NEGRO : AMBAR;
  
  ctx.fillStyle = fondo;
  ctx.fillRect(0, 0, ANCHO, ALTO);
  ctx.fillStyle = frente;
  
  // Renderizar según el modo de texto
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
 * Modo 'ajustar': divide en líneas y centra verticalmente el bloque
 */
function renderizarAjustar(ctx, estado, colorFrente) {
  const tamano = estado.tamano;
  const lineas = dividirEnLineas(estado.texto, tamano, ANCHO);
  const metrics = fontMetrics[tamano];
  
  const alturaBloque = calcularAltoTexto(lineas, tamano);
  const y = Math.max(0, Math.round((ALTO - alturaBloque) / 2));
  
  dibujarLineas(ctx, lineas, tamano, estado.alineacion, y, colorFrente);
}

/**
 * Modo 'reducir': encuentra el tamaño más grande que entra
 */
function renderizarReducir(ctx, estado, colorFrente) {
  const tamanoOptimo = calcularTamanoReducido(estado.texto, estado.tamano, ANCHO);
  const metrics = fontMetrics[tamanoOptimo];
  
  const x = calcularX(estado.texto, tamanoOptimo, estado.alineacion, ANCHO);
  const y = Math.max(0, Math.round((ALTO - metrics.height) / 2) + AJUSTE_VERTICAL);
  
  dibujarTexto(ctx, estado.texto, tamanoOptimo, x, y, colorFrente);
}

/**
 * Modo 'recortar': corta con "..." si no entra
 */
function renderizarRecortar(ctx, estado, colorFrente) {
  const tamano = estado.tamano;
  const textoRecortado = recortarTexto(estado.texto, tamano, ANCHO);
  const metrics = fontMetrics[tamano];
  
  const x = calcularX(textoRecortado, tamano, estado.alineacion, ANCHO);
  const y = Math.max(0, Math.round((ALTO - metrics.height) / 2) + AJUSTE_VERTICAL);
  
  dibujarTexto(ctx, textoRecortado, tamano, x, y, colorFrente);
}

/**
 * Modo 'scroll': una línea que se desliza horizontalmente
 */
function renderizarScroll(ctx, estado, colorFrente, scrollX) {
  const tamano = estado.tamano;
  const metrics = fontMetrics[tamano];
  
  const x = typeof scrollX === 'number' ? scrollX : ANCHO;
  const y = Math.max(0, Math.round((ALTO - metrics.height) / 2) + AJUSTE_VERTICAL);
  
  dibujarTexto(ctx, estado.texto, tamano, x, y, colorFrente);
}

/**
 * Dibuja un bloque de líneas alineadas
 */
function dibujarLineas(ctx, lineas, tamano, alineacion, startY, colorFrente) {
  const metrics = fontMetrics[tamano];
  
  lineas.forEach((linea, i) => {
    const x = calcularX(linea, tamano, alineacion, ANCHO);
    const y = startY + i * metrics.lineHeight;
    dibujarTexto(ctx, linea, tamano, x, y, colorFrente);
  });
}

/**
 * Dibuja un texto en posición (x, y) con tamaño y color
 * Simula el comportamiento de Adafruit GFX con escala configurable
 */
function dibujarTexto(ctx, texto, tamano, x, y, color) {
  const metrics = fontMetrics[tamano];
  
  // Establecer fuente monoespaciada usando ESCALA_FUENTE
  const fontSize = metrics.height * ESCALA_FUENTE;
  ctx.font = `bold ${fontSize}px 'Courier New', 'JetBrains Mono', monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  
  // Renderizar letra por letra con espaciado exacto
  let currentX = x;
  for (const char of texto) {
    if (char === ' ') {
      currentX += metrics.width * 0.5 * ESCALA_FUENTE;
    } else if (char === '\t') {
      currentX += metrics.width * 4 * ESCALA_FUENTE;
    } else {
      ctx.fillText(char, Math.round(currentX), Math.round(y));
      currentX += metrics.width * ESCALA_FUENTE;
    }
  }
}
