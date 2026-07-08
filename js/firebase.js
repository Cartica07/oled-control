/**firebase
 * Firebase Integration
 * Maneja la carga y almacenamiento de configuración en Firebase Realtime Database
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyACebxW1oTWpBWfinBUJwmynxHxQmtRMDo",
  authDomain: "lorenita-6ad1e.firebaseapp.com",
  databaseURL: "https://lorenita-6ad1e-default-rtdb.firebaseio.com",
  projectId: "lorenita-6ad1e",
  storageBucket: "lorenita-6ad1e.firebasestorage.app",
  messagingSenderId: "426829616333",
  appId: "1:426829616333:web:f1f5ce42ebf0e0aea04584"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

/**
 * Carga el estado actual desde Firebase
 * Retorna un objeto con la configuración actual o null si hay error
 */
export async function cargarEstado() {
  try {
    const snap = await get(ref(db, 'oled_remota'));

    if (snap.exists()) {
      const datos = snap.val();
      const pantalla = datos.pantalla || {};
      const config = pantalla.config || {};
      const imagen = pantalla.imagen || {};

      return {
        tipo: pantalla.tipo || 'texto',
        texto: (typeof pantalla.texto === 'string') ? pantalla.texto : 'Hola Mundo',
        tamano: Number(config.tamano) || 2,
        alineacion: config.alineacion || 'centro',
        invertido: !!config.invertido,
        modoTexto: config.modoTexto || 'ajustar',
        imagenData: imagen.datos || '',
        imagenAncho: Number(imagen.ancho) || 0,
        imagenAlto: Number(imagen.alto) || 0,
        version: Number(datos.version) || 0,
        exito: true
      };
    } else {
      // No hay datos aún, retornar estado por defecto
      return {
        tipo: 'texto',
        texto: 'Hola Mundo',
        tamano: 2,
        alineacion: 'centro',
        invertido: false,
        modoTexto: 'ajustar',
        imagenData: '',
        imagenAncho: 0,
        imagenAlto: 0,
        version: 0,
        exito: true,
        vacio: true
      };
    }
  } catch (err) {
    console.error('Error al cargar estado de Firebase:', err);
    return {
      exito: false,
      error: err.message
    };
  }
}

/**
 * Envía la configuración actualizada a Firebase
 */
export async function enviarEstado(estado) {
  try {
    const snapVersion = await get(ref(db, 'oled_remota/version'));
    const nuevaVersion = (snapVersion.exists() ? Number(snapVersion.val()) : 0) + 1;

    await set(ref(db, 'oled_remota'), {
      version: nuevaVersion,
      pantalla: {
        texto: estado.texto,
        tipo: estado.tipo,
        config: {
          tamano: estado.tamano,
          alineacion: estado.alineacion,
          invertido: estado.invertido,
          modoTexto: estado.modoTexto
        },
        imagen: {
          ancho: estado.imagenAncho,
          alto: estado.imagenAlto,
          datos: estado.imagenData
        }
      }
    });

    return {
      exito: true,
      version: nuevaVersion
    };
  } catch (err) {
    console.error('Error al enviar estado a Firebase:', err);
    return {
      exito: false,
      error: err.message
    };
  }
}
