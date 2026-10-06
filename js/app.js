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
const DONAR_URL = 'https://paypal.me/JoseAP0209'; // + '/1EUR' = importe sugerido
const AHORRO_MIN_DONAR = 2; // € por depósito: por debajo no tiene sentido pedir nada

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

/**
 * Color según la posición del precio en el rango: de azul (barata) a naranja (cara).
 * Azul/naranja se distingue bien con daltonismo (verde/rojo no). Devolvemos una
 * mezcla CSS (color-mix) de las variables --barato y --caro, así el color se adapta
 * solo al tema claro u oscuro sin que JS sepa cuál está activo.
 */
function colorPrecio(precio, min, max) {
  const t = max > min ? (precio - min) / (max - min) : 0;
  return `color-mix(in oklab, var(--caro) ${Math.round(t * 100)}%, var(--barato))`;
}

/**
 * Precio más bajo entre las ABIERTAS (o de horario desconocido). Una gasolinera
 * cerrada no debe salir como "la más barata": no te sirve para repostar ahora.
 * Si todas están cerradas, usamos todas para que la pantalla no quede vacía.
 */
function precioMinimoUtil(lista) {
  const utiles = lista.filter((e) => e.abierta !== false);
  const base = utiles.length ? utiles : lista;
  return base.length ? Math.min(...base.map((e) => e.precio)) : null;
}
const esBarata = (e, minUtil) => e.precio === minUtil && e.abierta !== false;

/** ¿Pantalla estrecha? Debe coincidir con el punto de corte del CSS (900px). */
const esMovil = () => window.matchMedia('(max-width: 899px)').matches;

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
  const criterio = estado.orden === 'distancia' && estado.ubicacion ? porDistancia : porPrecio;
  // Ordenación por clave compuesta: primero abiertas/cerradas (las cerradas al final),
  // y dentro de cada grupo el criterio elegido.
  const cerrada = (e) => (e.abierta === false ? 1 : 0);
  lista.sort((a, b) => cerrada(a) - cerrada(b) || criterio(a, b));
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
  const minUtil = precioMinimoUtil(lista);

  for (const e of lista) {
    if (e.lat == null || e.lon == null) continue;
    const clases = ['pin'];
    if (e.abierta === false) clases.push('pin-cerrada');
    if (esBarata(e, minUtil)) clases.push('pin-barata');
    if (e.id === estado.seleccionada) clases.push('pin-sel');
    const icono = L.divIcon({
      className: '',
      html: `<div class="${clases.join(' ')}" style="--c:${colorPrecio(e.precio, min, max)}">${fmtPrecio(e.precio)}</div>`,
      iconSize: null,
      iconAnchor: [28, 30],
    });
    const zIndex = e.id === estado.seleccionada ? 2000 : esBarata(e, minUtil) ? 1000 : 0;
    const m = L.marker([e.lat, e.lon], { icon: icono, title: e.rotulo, precio: e.precio, zIndexOffset: zIndex })
      .bindPopup(
        `<div class="popup"><strong class="p-marca">${esc(e.rotulo)}</strong>` +
          `<span class="p-dir">${esc(e.direccion)}</span>` +
          `<span class="p-precio">${fmtPrecio(e.precio)} <small>€/L</small></span>` +
          `<a class="ruta" href="${urlRuta(e)}" target="_blank" rel="noopener">Cómo llegar</a></div>`,
        { offset: [0, -24] } // que el popup salga por encima de la chincheta, no tapándola
      )
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

  encuadrar(lista);
}

/**
 * Encuadrar solo la primera vez, para no mover el mapa mientras el usuario lo usa.
 * Ojo: en móvil el mapa empieza OCULTO (display:none) y Leaflet lo ve de tamaño 0x0;
 * un fitBounds ahí calcula un zoom absurdo. Por eso solo damos el encuadre por hecho
 * cuando el contenedor tiene tamaño real.
 */
function encuadrar(lista) {
  if (encuadreHecho || !mapa) return;
  const tam = mapa.getSize();
  if (tam.x === 0 || tam.y === 0) return;
  const puntos = lista.filter((e) => e.lat != null).map((e) => [e.lat, e.lon]);
  if (!puntos.length) return;
  mapa.fitBounds(puntos, { padding: [30, 30] });
  encuadreHecho = true;
}

/** Leaflet cachea el tamaño del contenedor: tras mostrarlo hay que avisarle. */
function mapaVisibleOtraVez() {
  if (!mapa) return;
  mapa.invalidateSize();
  encuadrar(estacionesVisibles());
}

function urlRuta(e) {
  return e.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}` : '#';
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
  // El resumen habla de las que te sirven AHORA (abiertas o de horario desconocido).
  const utiles = lista.filter((e) => e.abierta !== false);
  const base = utiles.length >= 2 ? utiles : lista;
  const min = precioMinimoUtil(base);
  const max = Math.max(...base.map((e) => e.precio));
  const ahorro = (max - min) * LITROS_DEPOSITO;

  // Con datos reales es habitual el empate (p. ej. tres low-cost al mismo precio).
  const empatadas = base.filter((e) => esBarata(e, min) || (e.precio === min && !utiles.length));
  const NUMEROS = ['', '', 'dos', 'tres', 'cuatro', 'cinco'];
  const etiqueta = empatadas.length > 1
    ? `Lo más barato ahora · empate a ${NUMEROS[empatadas.length] || empatadas.length}`
    : 'Lo más barato ahora';
  el.hidden = false;
  el.innerHTML = `
    <div class="r-barata">
      <span class="etq">${etiqueta}</span>
      <span class="r-precio">${fmtPrecio(min)}<small>€/L</small></span>
      <span class="r-marcas">${listaNatural(empatadas.map((e) => `<strong>${esc(e.rotulo)}</strong>`))}</span>
    </div>
    <div class="r-ahorro">Llenando ${LITROS_DEPOSITO} L te ahorras <strong>${fmtEuros(ahorro)}</strong> frente a la más cara.${
      // Petición sutil justo donde se ve lo que te ahorras, y solo si el ahorro es real.
      ahorro >= AHORRO_MIN_DONAR
        ? ` <a class="r-invita" href="${DONAR_URL}/1EUR" target="_blank" rel="noopener">¿Me invitas a un café? :) ☕</a>`
        : ''
    }</div>`;
}

/** ["A","B","C"] -> "A, B y C". Con muchas, corta: "A, B, C y 3 más". */
function listaNatural(items, maximo = 3) {
  if (items.length > maximo) return `${items.slice(0, maximo).join(', ')} y ${items.length - maximo} más`;
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
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
  const minUtil = precioMinimoUtil(lista);
  let posicion = 0; // solo se numeran las que te sirven; las cerradas van sin número

  ul.innerHTML = lista
    .map((e) => {
      const estadoTxt = e.abierta === true ? 'Abierta' : e.abierta === false ? 'Cerrada' : 'Horario desconocido';
      const estadoCls = e.abierta === true ? 'ok' : e.abierta === false ? 'ko' : 'nd';
      const rutaUrl = e.lat != null ? urlRuta(e) : null;
      const clases = ['tarjeta'];
      if (e.id === estado.seleccionada) clases.push('sel');
      if (e.abierta === false) clases.push('cerrada');
      if (esBarata(e, minUtil)) clases.push('barata');
      return `
      <li class="${clases.join(' ')}" data-id="${esc(e.id)}" tabindex="0">
        <div class="pos">${e.abierta === false ? '' : ++posicion}</div>
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
  // En móvil con el mapa a pantalla completa la lista está oculta: no hay nada que desplazar.
  if (desdeMapa && tarjeta && !document.body.classList.contains('vista-mapa')) {
    tarjeta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const m = marcadores.get(id);
  if (!desdeMapa && m && mapa) {
    // En móvil el mapa está oculto tras la lista: primero lo mostramos.
    if (esMovil()) cambiarVista(true);
    if (capaMarcadores.zoomToShowLayer) {
      capaMarcadores.zoomToShowLayer(m, () => m.openPopup());
    } else {
      mapa.setView(m.getLatLng(), Math.max(mapa.getZoom(), 15));
      m.openPopup();
    }
    if (!esMovil()) $('#mapa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/** Móvil: alterna entre lista y mapa a pantalla completa (lo pinta el CSS con body.vista-mapa). */
function cambiarVista(verMapa = !document.body.classList.contains('vista-mapa')) {
  document.body.classList.toggle('vista-mapa', verMapa);
  if (verMapa) mapaVisibleOtraVez();
}

function pedirUbicacion() {
  const boton = $('#ubicacion');
  if (!('geolocation' in navigator)) {
    boton.textContent = 'Ubicación no disponible';
    return;
  }
  // data-estado lo usa el CSS para el icono y el color de cada estado.
  boton.disabled = true;
  boton.dataset.estado = 'localizando';
  boton.textContent = 'Localizando…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      estado.ubicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      estado.orden = 'distancia';
      boton.dataset.estado = 'activada';
      boton.textContent = 'Ubicación activa';
      render();
      if (mapa) mapa.setView([estado.ubicacion.lat, estado.ubicacion.lon], 14);
    },
    (err) => {
      boton.disabled = false;
      const denegada = err.code === err.PERMISSION_DENIED;
      boton.dataset.estado = denegada ? 'denegada' : 'error';
      boton.textContent = denegada ? 'Permiso denegado' : 'No se pudo localizar';
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
  $('#vista')?.addEventListener('click', () => cambiarVista());
  // Si se pasa de móvil a escritorio (girar la tablet, redimensionar), el mapa
  // vuelve a estar siempre visible: quitamos la vista de mapa y recolocamos Leaflet.
  window.matchMedia('(max-width: 899px)').addEventListener('change', (ev) => {
    if (!ev.matches) document.body.classList.remove('vista-mapa');
    mapaVisibleOtraVez();
  });

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
