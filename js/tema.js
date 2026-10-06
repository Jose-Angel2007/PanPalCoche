/*
 * tema.js: modo claro / oscuro / automático elegido por el usuario.
 * Se carga en <head> (sin defer) para aplicar el tema antes de pintar y evitar el destello.
 * Sin elección guardada manda el sistema (prefers-color-scheme).
 */
(function () {
  const CLAVE = 'gasolina:tema';
  const ORDEN = ['auto', 'claro', 'oscuro'];
  const ETIQUETA = { auto: 'Tema: automático', claro: 'Tema: claro', oscuro: 'Tema: oscuro' };
  const raiz = document.documentElement;

  function leer() {
    try { return localStorage.getItem(CLAVE) || 'auto'; } catch { return 'auto'; }
  }
  function aplicar(tema) {
    if (tema === 'auto') delete raiz.dataset.tema;
    else raiz.dataset.tema = tema;
    const boton = document.getElementById('tema');
    if (boton) {
      boton.setAttribute('aria-label', ETIQUETA[tema] + '. Toca para cambiar');
      boton.title = ETIQUETA[tema];
    }
    // Color de la barra del navegador en móvil
    const oscuro = tema === 'oscuro' || (tema === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', oscuro ? '#0A1330' : '#1D3FA6'));
  }

  aplicar(leer());
  document.addEventListener('DOMContentLoaded', () => {
    aplicar(leer());
    document.getElementById('tema')?.addEventListener('click', () => {
      const siguiente = ORDEN[(ORDEN.indexOf(leer()) + 1) % ORDEN.length];
      try { localStorage.setItem(CLAVE, siguiente); } catch { /* sin persistencia */ }
      aplicar(siguiente);
    });
  });
})();
