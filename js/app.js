/*
 * app.js — Estado de la app y pintado (lista + mapa).
 *
 * Patrón: un único objeto `estado` y una función `render()` que pinta TODO a
 * partir de él. Cualquier cambio (elegir combustible, llegar datos nuevos,
 * conocer tu ubicación) modifica `estado` y llama a `render()`. Así la pantalla
 * nunca se desincroniza de los datos: es la idea de fondo de React/Vue, sin framework.
 */

const ID_MUNICIPIO = '6058'; // Alcalá de Guadaíra (Sevilla)
const REFRESCO_MS = 30 * 60 * 1000; // la API actualiza cada media hora
const LITROS_DEPOSITO = 50; // para traducir céntimos/litro a euros por depósito

const estado = {
  estaciones: [],
  fecha: null, // hora de los datos según el Ministerio
  ultimaDescarga: 0, // cuándo los descargamos nosotros (ms)
  cargando: false,
  error: null,
  combustible: leerPreferencia('combustible', 'Gasolina 95 E5'),
  orden: 'precio', // 'precio' | 'distancia'
  soloAbiertas: leerPreferencia('soloAbiertas', 'false') === 'true',
  ubicacion: null, // { lat, lon }
  seleccionada: null, // id de estación
};

// ---------- Preferencias (localStorage puede fallar: modo privado, etc.) ----------
function leerPreferencia(clave, porDefecto) {
  try {
    return localStorage.getItem('gasolina:' + clave) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}
function guardarPreferencia(clave, valor) {
  try {
    localStorage.setItem('gasolina:' + clave, String(valor));
  } catch {
    /* sin persistencia, no pasa nada */
  }
}

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);

/** Escapa texto que viene de la API antes de meterlo en HTML (evita inyección). */
function esc(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const fmtPrecio = (p) => p.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtEuros = (e) => e.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`);

/**
 * Fórmula de Haversine: distancia en km entre dos puntos (lat/lon en grados)
 * sobre una esfera del radio de la Tierra. Suficiente a escala de un pueblo.
 */
function distanciaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Color de verde (más barata) a rojo (más cara) según la posición en el rango. */
function colorPrecio(precio, min, max) {
  const t = max > min ? (precio - min) / (max - min) : 0;
  const tono = 130 - 130 * t; // 130 = verde, 0 = rojo (HSL)
  return `hsl(${tono}, 70%, 38%)`;
}

// ---------- Datos derivados ----------
/** Combustibles que vende al menos una gasolinera, ordenados por cuántas lo venden. */
function combustiblesDisponibles() {
  const cuenta = {};
  for (const e of estado.estaciones) for (const c of Object.keys(e.precios)) cuenta[c] = (cuenta[c] || 0) + 1;
  return Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
}

/** La lista que se ve: filtrada, enriquecida con distancia/abierta y ordenada. */
function estacionesVisibles() {
  const ahora = new Date();
  let lista = estado.estaciones
    .filter((e) => e.precios[estado.combustible] != null)
    .map((e) => ({
      ...e,
      precio: e.precios[estado.combustible],
      abierta: estaAbierta(e.horario, ahora),
      distancia: estado.ubicacion && e.lat != null ? distanciaKm(estado.ubicacion, e) : null,
    }));

  // "Solo abiertas" deja las de horario desconocido (null): mejor no ocultar sin certeza.
  if (estado.soloAbiertas) lista = lista.filter((e) => e.abierta !== false);

  const porPrecio = (a, b) => a.precio - b.precio || (a.distancia ?? 0) - (b.distancia ?? 0);
  const porDistancia = (a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity) || a.precio - b.precio;
  lista.sort(estado.orden === 'distancia' && estado.ubicacion ? porDistancia : porPrecio);
  return lista;
}

// ---------- Mapa (Leaflet) ----------
let mapa = null;
let capaMarcadores = null;
let marcadorYo = null;
const marcadores = new Map(); // id -> marcador
let encuadreHecho = false;

function iniciarMapa() {
  if (typeof L === 'undefined') {
    // Sin conexión a la CDN de Leaflet: la lista sigue funcionando.
    $('#mapa').innerHTML = '<p class="aviso">No se pudo cargar el mapa.</p>';
    return;
  }
  mapa = L.map('mapa', { zoomControl: true }).setView([37.338, -5.84], 13);
  // Teselas de OpenStreetMap. Su política de uso exige que el navegador envíe la
  // cabecera Referer (la web desde la que se piden). Desde una web (GitHub Pages,
  // Netlify, o un servidor local) se envía sola; abriendo el fichero con doble clic
  // (file://) no hay Referer y OSM devuelve un 403. En ese caso no pedimos teselas
  // y avisamos, en vez de llenar el mapa de carteles de "Access blocked".
  if (location.protocol === 'file:') {
    $('#mapa').classList.add('sin-fondo');
    $('#mapa').dataset.aviso = 'Mapa sin fondo: abre la app desde un servidor (ver README)';
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
  }

  // Agrupación de marcadores (clustering): las gasolineras de la A-92 están tan juntas
  // que a zoom bajo se tapan unas a otras. El plugin las agrupa en un círculo que
  // se abre al acercarte. Mostramos en el grupo el precio MÍNIMO, que es lo que interesa.
  if (L.markerClusterGroup) {
    capaMarcadores = L.markerClusterGroup({
      maxClusterRadius: 70, // los iconos son anchos: radio mayor para que no se pisen
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (grupo) => {
        const hijos = grupo.getAllChildMarkers();
        const min = Math.min(...hijos.map((m) => m.options.precio));
        return L.divIcon({
          className: '',
          html: `<div class="grupo" title="${hijos.length} gasolineras, desde ${fmtPrecio(min)} €/L"><b>${hijos.length}</b>${fmtPrecio(min)}</div>`,
          iconSize: null,
        });
      },
    });
  } else {
    capaMarcadores = L.layerGroup(); // si el plugin no carga, marcadores sueltos
  }
  capaMarcadores.addTo(mapa);
}

let firmaMapa = '';

function pintarMapa(lista) {
  if (!mapa) return;
  // Reconstruir los marcadores cierra el popup abierto. Para no hacerlo cada minuto
  // sin motivo, calculamos una "firma" de lo que se ve y solo repintamos si cambia.
  const firma = JSON.stringify([
    estado.seleccionada, estado.ubicacion,
    lista.map((e) => [e.id, e.precio, e.abierta]),
  ]);
  if (firma === firmaMapa) return;
  firmaMapa = firma;

  capaMarcadores.clearLayers();
  marcadores.clear();
  if (lista.length === 0) return;

  const precios = lista.map((e) => e.precio);
  const min = Math.min(...precios);
  const max = Math.max(...precios);

  for (const e of lista) {
    if (e.lat == null || e.lon == null) continue;
    const icono = L.divIcon({
      className: '',
      html: `<div class="pin ${e.abierta === false ? 'pin-cerrada' : ''} ${e.id === estado.seleccionada ? 'pin-sel' : ''}"
                  style="--c:${colorPrecio(e.precio, min, max)}">${fmtPrecio(e.precio)}</div>`,
      iconSize: null,
      iconAnchor: [28, 30],
    });
    const m = L.marker([e.lat, e.lon], { icon: icono, title: e.rotulo, precio: e.precio, zIndexOffset: e.precio === min ? 1000 : 0 })
      .bindPopup(`<strong>${esc(e.rotulo)}</strong><br>${esc(e.direccion)}<br>${fmtPrecio(e.precio)} €/L`)
      .on('click', () => seleccionar(e.id, { desdeMapa: true }));
    m.addTo(capaMarcadores);
    marcadores.set(e.id, m);
  }

  if (estado.ubicacion) {
    if (!marcadorYo) {
      marcadorYo = L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
        .bindTooltip('Estás aquí')
        .addTo(mapa);
    }
    marcadorYo.setLatLng([estado.ubicacion.lat, estado.ubicacion.lon]);
  }

  // Encuadrar solo la primera vez, para no mover el mapa mientras el usuario lo usa.
  if (!encuadreHecho) {
    const puntos = lista.filter((e) => e.lat != null).map((e) => [e.lat, e.lon]);
    if (puntos.length) mapa.fitBounds(puntos, { padding: [30, 30] });
    encuadreHecho = true;
  }
}

// ---------- Lista y cabecera ----------
function pintarSelectorCombustible() {
  const disponibles = combustiblesDisponibles();
  if (disponibles.length && !disponibles.includes(estado.combustible)) estado.combustible = disponibles[0];
  $('#combustible').innerHTML = disponibles
    .map((c) => `<option value="${esc(c)}" ${c === estado.combustible ? 'selected' : ''}>${esc(nombreCombustible(c))}</option>`)
    .join('');
}

function pintarResumen(lista) {
  const el = $('#resumen');
  if (lista.length < 2) {
    el.hidden = true;
    return;
  }
  const baratas = [...lista].sort((a, b) => a.precio - b.precio);
  const barata = baratas[0];
  const cara = baratas[baratas.length - 1];
  const ahorro = (cara.precio - barata.precio) * LITROS_DEPOSITO;
  // Con datos reales es habitual el empate (p. ej. tres low-cost al mismo precio).
  const empatadas = baratas.filter((e) => e.precio === barata.precio).length;
  const extra = empatadas > 1 ? ` y ${empatadas - 1} más` : '';
  el.hidden = false;
  el.innerHTML = `
    <div><span class="etq">Más barata</span><strong>${esc(barata.rotulo)}</strong>${extra} · ${fmtPrecio(barata.precio)} €/L</div>
    <div><span class="etq">Diferencia con la más cara</span>${fmtEuros(ahorro)} en un depósito de ${LITROS_DEPOSITO} L</div>`;
}

function pintarLista(lista) {
  const ul = $('#lista');
  if (lista.length === 0) {
    ul.innerHTML = estado.estaciones.length
      ? '<li class="vacio">Ninguna gasolinera cumple el filtro.</li>'
      : '';
    return;
  }
  const min = Math.min(...lista.map((e) => e.precio));
  const max = Math.max(...lista.map((e) => e.precio));

  ul.innerHTML = lista
    .map((e, i) => {
      const estadoTxt = e.abierta === true ? 'Abierta' : e.abierta === false ? 'Cerrada' : 'Horario desconocido';
      const estadoCls = e.abierta === true ? 'ok' : e.abierta === false ? 'ko' : 'nd';
      const rutaUrl = e.lat != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}`
        : null;
      return `
      <li class="tarjeta ${e.id === estado.seleccionada ? 'sel' : ''} ${e.abierta === false ? 'cerrada' : ''}" data-id="${esc(e.id)}" tabindex="0">
        <div class="pos">${i + 1}</div>
        <div class="info">
          <div class="nombre">${esc(e.rotulo)}</div>
          <div class="dir">${esc(e.direccion)}</div>
          <div class="meta">
            <span class="estado ${estadoCls}">${estadoTxt}</span>
            <span class="horario">${esc(e.horario)}</span>
            ${e.distancia != null ? `<span class="dist">${fmtKm(e.distancia)}</span>` : ''}
            ${rutaUrl ? `<a class="ruta" href="${rutaUrl}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}
          </div>
        </div>
        <div class="precio" style="--c:${colorPrecio(e.precio, min, max)}">
          ${fmtPrecio(e.precio)}<small>€/L</small>
        </div>
      </li>`;
    })
    .join('');
}

function pintarEstado() {
  const el = $('#actualizado');
  if (estado.cargando && !estado.estaciones.length) el.textContent = 'Cargando precios…';
  else if (estado.fecha) {
    const min = Math.round((Date.now() - estado.fecha.getTime()) / 60000);
    const hora = estado.fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `Precios de las ${hora}${min >= 1 ? ` (hace ${min} min)` : ''}`;
  } else el.textContent = '';

  $('#refrescar').disabled = estado.cargando;
  $('#refrescar').classList.toggle('girando', estado.cargando);

  const err = $('#error');
  err.hidden = !estado.error;
  if (estado.error) {
    err.textContent = estado.estaciones.length
      ? `No se pudo actualizar (${estado.error}). Se muestran los últimos precios descargados.`
      : `No se pudieron cargar los precios: ${estado.error}.`;
  }

  $('#orden').value = estado.ubicacion ? estado.orden : 'precio';
  $('#orden option[value="distancia"]').disabled = !estado.ubicacion;
  $('#solo-abiertas').checked = estado.soloAbiertas;
}

function render() {
  const lista = estacionesVisibles();
  pintarSelectorCombustible();
  pintarEstado();
  pintarResumen(lista);
  pintarLista(lista);
  pintarMapa(lista);
}

// ---------- Acciones ----------
async function cargar() {
  if (estado.cargando) return;
  estado.cargando = true;
  render();
  try {
    const { fecha, estaciones } = await obtenerEstaciones(ID_MUNICIPIO);
    estado.estaciones = estaciones;
    estado.fecha = fecha;
    estado.ultimaDescarga = Date.now();
    estado.error = null;
  } catch (err) {
    estado.error = err.message || 'error de red';
  } finally {
    estado.cargando = false;
    render();
  }
}

function seleccionar(id, { desdeMapa = false } = {}) {
  estado.seleccionada = id;
  render();
  const tarjeta = document.querySelector(`.tarjeta[data-id="${CSS.escape(id)}"]`);
  if (desdeMapa && tarjeta) tarjeta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const m = marcadores.get(id);
  if (!desdeMapa && m && mapa) {
    if (capaMarcadores.zoomToShowLayer) {
      capaMarcadores.zoomToShowLayer(m, () => m.openPopup());
    } else {
      mapa.setView(m.getLatLng(), Math.max(mapa.getZoom(), 15));
      m.openPopup();
    }
    $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function pedirUbicacion() {
  const boton = $('#ubicacion');
  if (!('geolocation' in navigator)) {
    boton.textContent = 'Ubicación no disponible';
    return;
  }
  boton.disabled = true;
  boton.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      estado.ubicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      estado.orden = 'distancia';
      boton.textContent = 'Ubicación activada';
      render();
      if (mapa) mapa.setView([estado.ubicacion.lat, estado.ubicacion.lon], 14);
    },
    (err) => {
      boton.disabled = false;
      boton.textContent = err.code === err.PERMISSION_DENIED ? 'Permiso denegado' : 'No se pudo localizar';
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ---------- Arranque ----------
function iniciar() {
  iniciarMapa();

  $('#combustible').addEventListener('change', (ev) => {
    estado.combustible = ev.target.value;
    guardarPreferencia('combustible', estado.combustible);
    render();
  });
  $('#orden').addEventListener('change', (ev) => {
    estado.orden = ev.target.value;
    render();
  });
  $('#solo-abiertas').addEventListener('change', (ev) => {
    estado.soloAbiertas = ev.target.checked;
    guardarPreferencia('soloAbiertas', estado.soloAbiertas);
    render();
  });
  $('#refrescar').addEventListener('click', cargar);
  $('#ubicacion').addEventListener('click', pedirUbicacion);

  // Delegación de eventos: un solo listener en la lista en vez de uno por tarjeta,
  // porque las tarjetas se regeneran en cada render().
  $('#lista').addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return; // el enlace "Cómo llegar" funciona normal
    const li = ev.target.closest('.tarjeta');
    if (li) seleccionar(li.dataset.id);
  });
  $('#lista').addEventListener('keydown', (ev) => {
    const li = ev.target.closest('.tarjeta');
    if (li && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      seleccionar(li.dataset.id);
    }
  });

  // Polling: cada 30 min. Además, al volver a la pestaña (el móvil suele
  // congelar los temporizadores en segundo plano), refrescamos si toca.
  setInterval(cargar, REFRESCO_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - estado.ultimaDescarga > REFRESCO_MS) cargar();
  });
  // Cada minuto repintamos para que "abierta/cerrada" y "hace X min" no se queden viejos.
  setInterval(() => {
    if (document.visibilityState === 'visible') render();
  }, 60 * 1000);

  cargar();
}

document.addEventListener('DOMContentLoaded', iniciar);
