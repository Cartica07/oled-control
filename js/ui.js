/**ui
 * UI Controller
 * Maneja los eventos de la interfaz de usuario y actualización de controles
 */

/**
 * Actualiza los controles con los valores del estado actual
 */
export function poblarControles(estado, elementos) {
  // Para Texto
  if (elementos.texto) {
    elementos.texto.value = estado.texto || '';
    elementos.contador.textContent = String((estado.texto || '').length);
  }
  
  if (elementos.invertido) {
    elementos.invertido.checked = !!estado.invertido;
  }
  
  if (elementos.grupoTamano) {
    marcarSegmentoActivo(elementos.grupoTamano, estado.tamano);
  }
  
  if (elementos.grupoAlineacion) {
    marcarSegmentoActivo(elementos.grupoAlineacion, estado.alineacion);
  }

  if (elementos.grupoAlineacionV) {
    marcarSegmentoActivo(elementos.grupoAlineacionV, estado.alineacionV || 'centro');
  }
  
  if (elementos.grupoModo) {
    elementos.grupoModo.querySelectorAll('input[name="modoTexto"]').forEach(r => {
      r.checked = (r.value === estado.modoTexto);
    });
  }
  
  // Marcar tipo de contenido
  if (elementos.grupoTipo) {
    marcarSegmentoActivo(elementos.grupoTipo, estado.tipo || 'texto');
  }
}

/**
 * Marca el botón activo en un grupo de segmentos
 */
export function marcarSegmentoActivo(grupo, valor) {
  grupo.querySelectorAll('button').forEach(b => {
    b.classList.toggle('activo', b.dataset.valor === String(valor));
  });
}

/**
 * Muestra un mensaje de estado en la pantalla
 */
export function marcarEstado(texto, tipo, elementos) {
  elementos.estadoTexto.textContent = texto;
  elementos.estadoLinea.classList.remove('ok', 'error');
  elementos.ledEstado.classList.remove('ok', 'error', 'conectado');
  
  if (tipo === 'ok') {
    elementos.estadoLinea.classList.add('ok');
    elementos.ledEstado.classList.add('conectado');
  } else if (tipo === 'error') {
    elementos.estadoLinea.classList.add('error');
    elementos.ledEstado.classList.add('error');
  }
}

/**
 * Muestra el estado de la conexión
 */
export function marcarConexion(texto, tipo, elementos) {
  elementos.textoConexion.textContent = texto;
  elementos.ledConexion.classList.remove('conectado', 'error');
  
  if (tipo === 'ok') {
    elementos.ledConexion.classList.add('conectado');
  } else if (tipo === 'error') {
    elementos.ledConexion.classList.add('error');
  }
}

/**
 * Habilita/deshabilita el botón de envío
 */
export function setBotonEnviarEstado(habilitado, elementos) {
  elementos.botonEnviar.disabled = !habilitado;
}

/**
 * Activa la animación LED de transmisión
 */
export function activarLedTransmision(elementos) {
  elementos.ledEstado.classList.add('tx-activo');
}

/**
 * Desactiva la animación LED de transmisión
 */
export function desactivarLedTransmision(elementos, delay = 250) {
  setTimeout(() => {
    elementos.ledEstado.classList.remove('tx-activo');
  }, delay);
}

/**
 * Retorna todos los elementos del DOM en un objeto
 */
export function obtenerElementos() {
  return {
    // Selector de tipo
    grupoTipo: document.getElementById('grupoTipo'),
    seccionTexto: document.getElementById('seccionTexto'),
    seccionImagen: document.getElementById('seccionImagen'),
    seccionCancion: document.getElementById('seccionCancion'),
    seccionDibujo: document.getElementById('seccionDibujo'),
    seccionGaleria: document.getElementById('seccionGaleria'),
    seccionGaleriaFinal: document.getElementById('seccionGaleriaFinal'),
    
    // Texto y contador
    texto: document.getElementById('texto'),
    contador: document.getElementById('contador'),
    
    // Controles de formato
    grupoTamano: document.getElementById('grupoTamano'),
    grupoAlineacion: document.getElementById('grupoAlineacion'),
    grupoAlineacionV: document.getElementById('grupoAlineacionV'),
    grupoModo: document.getElementById('grupoModo'),
    invertido: document.getElementById('invertido'),
    filaInvertido: document.getElementById('filaInvertido'),
    
    // Controles de imagen
    cargadorImagen: document.getElementById('cargadorImagen'),
    umbral: document.getElementById('umbral'),
    valorUmbral: document.getElementById('valorUmbral'),
    dithering: document.getElementById('dithering'),

    // Guardar imagen actual (sección Imagen) en el catálogo
    nombreGaleria: document.getElementById('nombreGaleria'),
    botonGuardarGaleria: document.getElementById('botonGuardarGaleria'),
    avisoGaleria: document.getElementById('avisoGaleria'),

    // Sección Galería: catálogo completo, añadir nueva, reeditar, borrar
    cargadorImagenGaleria: document.getElementById('cargadorImagenGaleria'),
    nombreGaleriaNueva: document.getElementById('nombreGaleriaNueva'),
    botonGuardarGaleriaNueva: document.getElementById('botonGuardarGaleriaNueva'),
    avisoGaleriaNueva: document.getElementById('avisoGaleriaNueva'),
    ditheringGaleria: document.getElementById('ditheringGaleria'),
    umbralGaleria: document.getElementById('umbralGaleria'),
    valorUmbralGaleria: document.getElementById('valorUmbralGaleria'),
    gridGaleria: document.getElementById('gridGaleria'),
    galeriaVacio: document.getElementById('galeriaVacio'),
    botonBorrarGaleria: document.getElementById('botonBorrarGaleria'),
    
    // Controles de canción
    seleccionCancion: document.getElementById('seleccionCancion'),
    inputRepeticiones: document.getElementById('inputRepeticiones'),
    avisoCancion: document.getElementById('avisoCancion'),

    // Controles de dibujo
    lienzoDibujo: document.getElementById('lienzoDibujo'),
    grupoGrosor: document.getElementById('grupoGrosor'),
    botonDeshacerDibujo: document.getElementById('botonDeshacerDibujo'),
    botonRehacerDibujo: document.getElementById('botonRehacerDibujo'),
    botonLimpiarDibujo: document.getElementById('botonLimpiarDibujo'),
    nombreGaleriaDibujo: document.getElementById('nombreGaleriaDibujo'),
    botonGuardarGaleriaDibujo: document.getElementById('botonGuardarGaleriaDibujo'),
    avisoGaleriaDibujo: document.getElementById('avisoGaleriaDibujo'),
    
    // Botón enviar
    botonEnviar: document.getElementById('enviar'),
    
    // LEDs y estado
    ledConexion: document.getElementById('ledConexion'),
    textoConexion: document.getElementById('textoConexion'),
    ledEstado: document.getElementById('ledEstado'),
    estadoLinea: document.getElementById('estadoLinea'),
    estadoTexto: document.getElementById('estadoTexto'),
    
    // Canvas OLED
    canvas: document.getElementById('oled')
  };
}
