/**dibujo
 * Módulo de Dibujo Libre (paint sencillo para la OLED)
 *
 * V1.12: cuarto tipo de contenido, "Dibujo" -- un lienzo de 128×64
 * (resolución NATIVA de la OLED, sin reescalar internamente) donde se
 * dibuja con mouse/dedo/lápiz. Grosor de línea ajustable y deshacer
 * multi-nivel, un paso por trazo.
 *
 * POR QUÉ ESTO NO TOCA EL FIRMWARE NI EL ESQUEMA DE FIREBASE: lo
 * dibujado, al enviar o guardar, se convierte al MISMO formato de
 * bitmap monocromático 1bpp que ya usa el tipo "imagen" (ver
 * imageProcessor.js) -- reutilizando el mismo pipeline (escala de
 * grises -> umbral -> Base64) que ya procesa fotos subidas. Para el
 * dispositivo y para Firebase, un dibujo enviado es indistinguible de
 * una imagen subida: mismo tipo:"imagen", mismos campos. El ESP8266
 * no se entera de que existe un modo "Dibujo" -- no hace falta
 * flashear nada nuevo para esta función.
 */

import { convertirAEscalaGrises, convertirAMonocromatico, codificarBase64 } from './imageProcessor.js';

// Colores del lienzo: mismo criterio que el resto del panel (fondo
// oscuro, trazo en el color de acento). Así lo que ves mientras
// dibujás ya es fiel a cómo se va a ver en la OLED real -- trazo =
// píxel encendido, fondo = apagado -- sin tener que invertir nada
// mentalmente mientras dibujás.
const COLOR_FONDO = '#060503';
const COLOR_TRAZO = '#4dd2ff';

let ctx = null;
let grosorActual = 2;
let dibujando = false;
let ultimoX = 0;
let ultimoY = 0;

// Pila de deshacer: una snapshot (ImageData) por cada trazo YA
// terminado, tomada ANTES de empezar el trazo siguiente. "Deshacer" =
// sacar la última snapshot guardada y restaurarla tal cual estaba.
// Tope de tamaño para no crecer sin límite en una sesión larga.
const TOPE_HISTORIAL = 60;
let historial = [];

function coordenadasDesdeEvento(canvas, evento) {
  const rect = canvas.getBoundingClientRect();
  const escalaX = canvas.width / rect.width;
  const escalaY = canvas.height / rect.height;
  return {
    x: (evento.clientX - rect.left) * escalaX,
    y: (evento.clientY - rect.top) * escalaY
  };
}

function guardarSnapshot(canvas) {
  historial.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (historial.length > TOPE_HISTORIAL) historial.shift();
}

function pintarFondo(canvas) {
  ctx.fillStyle = COLOR_FONDO;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Inicializa el lienzo: fondo + listeners de puntero (mouse, touch y
 * lápiz unificados vía Pointer Events). Llamar una sola vez al
 * arrancar la app, sobre el <canvas id="lienzoDibujo">.
 */
export function inicializarDibujo(canvas) {
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLOR_TRAZO;
  ctx.lineWidth = grosorActual;

  pintarFondo(canvas);

  // Evita que el navegador interprete el arrastre como scroll/zoom en
  // touch -- si no, dibujar con el dedo en el celular movería la
  // página en vez de trazar.
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (e) => {
    dibujando = true;
    guardarSnapshot(canvas);

    const p = coordenadasDesdeEvento(canvas, e);
    ultimoX = p.x;
    ultimoY = p.y;

    // Punto simple (tap sin arrastre) igual deja una marca.
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_TRAZO;
    ctx.fill();

    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    const p = coordenadasDesdeEvento(canvas, e);

    ctx.beginPath();
    ctx.moveTo(ultimoX, ultimoY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ultimoX = p.x;
    ultimoY = p.y;
  });

  function terminarTrazo() {
    dibujando = false;
  }

  canvas.addEventListener('pointerup', terminarTrazo);
  canvas.addEventListener('pointercancel', terminarTrazo);
  canvas.addEventListener('pointerleave', () => {
    if (dibujando) terminarTrazo();
  });
}

/** Cambia el grosor de línea (en píxeles de la OLED, no de pantalla). */
export function establecerGrosor(px) {
  grosorActual = px;
  if (ctx) ctx.lineWidth = px;
}

/** Deshace el último trazo completo. Devuelve false si no hay nada que deshacer. */
export function deshacerTrazo() {
  if (historial.length === 0) return false;
  const snapshot = historial.pop();
  ctx.putImageData(snapshot, 0, 0);
  return true;
}

/** Borra todo el lienzo (el borrado en sí también se puede deshacer). */
export function limpiarLienzo(canvas) {
  guardarSnapshot(canvas);
  pintarFondo(canvas);
}

/** true si hay al menos un trazo para deshacer. */
export function hayHistorial() {
  return historial.length > 0;
}

/**
 * Convierte el lienzo actual al mismo formato {imagenData, imagenAncho,
 * imagenAlto, preprocesada} que produce procesarImagen() en
 * imageProcessor.js -- así enviarEstado() y guardarImagenCatalogo() lo
 * reciben sin saber (ni les importa) que vino de un dibujo y no de un
 * archivo subido.
 */
export function obtenerResultadoImagen(canvas) {
  const preprocesada = canvas.toDataURL('image/png');

  // Se trabaja sobre una COPIA: convertirAEscalaGrises muta los
  // píxeles del canvas que recibe. Si operáramos sobre el lienzo
  // visible, el usuario vería el dibujo "apagarse" a gris cada vez
  // que envía o guarda, y encima perdería los colores para seguir
  // dibujando después.
  const copia = document.createElement('canvas');
  copia.width = canvas.width;
  copia.height = canvas.height;
  copia.getContext('2d').drawImage(canvas, 0, 0);

  const gris = convertirAEscalaGrises(copia);
  const { bitmap, width, height } = convertirAMonocromatico(gris, 127);
  const imagenData = codificarBase64(bitmap);

  return { imagenData, imagenAncho: width, imagenAlto: height, preprocesada };
}
