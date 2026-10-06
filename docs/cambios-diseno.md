# Cambios de contrato · rediseño Trencadís

Todos los IDs que usa `app.js` se mantienen: `#combustible`, `#orden`, `#solo-abiertas`, `#ubicacion`, `#refrescar` (con `.girando`), `#actualizado`, `#error[hidden]`, `#resumen[hidden]`, `#mapa`, `#lista`.

## Ficheros nuevos
- `js/tema.js`: botón `#tema` (automático → claro → oscuro). Se carga en `<head>`, guarda `gasolina:tema` y pone `html[data-tema]`. No toca `app.js`.
- `img/icon.svg`, `img/icon-maskable.svg`, `img/logo.svg`, `img/icon-192.png`, `img/icon-512.png`, `img/icon-maskable-512.png`, `img/apple-touch-icon.png`, `img/favicon-32.png`, `img/puente-dragon.jpg`.
- `manifest.webmanifest` (para instalarla en la pantalla de inicio).

## Marcado nuevo en index.html (no lo genera JS)
- `#tema` y `#vista` (botón flotante Lista/Mapa en móvil, con `.ver-mapa` y `.ver-lista` dentro).
- Los controles son chips: `label.chip.chip-select > select`, `label.chip.chip-check > input`, `button#ubicacion.chip`. Las etiquetas "Combustible" y "Ordenar por" quedan como texto oculto (`.sr`).
- Las opciones de `#orden` dicen "Por precio" y "Por distancia" (los `value` no cambian).

## Cambios en app.js
1. **Lista/Mapa en móvil.** Al pulsar `#vista`: `document.body.classList.toggle('vista-mapa'); mapa.invalidateSize();`
2. **Tocar una tarjeta en móvil** (`matchMedia('(max-width: 899px)').matches`): añadir `vista-mapa`, `mapa.invalidateSize()` y después `zoomToShowLayer`. En móvil, quitar el `$('#mapa').scrollIntoView(...)`.
3. **Cerradas al final.** En `estacionesVisibles()`, ordenar primero por `abierta === false` y luego como ahora. Numerar solo las abiertas: en las cerradas `.pos` va vacío.
4. **Empates visibles.** Añadir la clase `barata` a la tarjeta y `pin-barata` a la chincheta cuando `e.precio === min` (y no esté cerrada).
5. **Resumen nuevo:**
   ```html
   <div class="r-barata">
     <span class="etq">Lo más barato ahora · empate a tres</span>
     <span class="r-precio">1,639<small>€/L</small></span>
     <span class="r-marcas"><strong>BALLENOIL</strong>, <strong>PETROPRIX</strong> y <strong>PLENERGY</strong></span>
   </div>
   <div class="r-ahorro">Llenando 50 L te ahorras <strong>19,90 €</strong> frente a la más cara.</div>
   ```
   (El marcado antiguo sigue viéndose bien, pero sin el precio grande.)
6. **Popup nuevo** (con `{ offset: [0, -24] }` en `bindPopup`):
   ```html
   <div class="popup"><strong class="p-marca">BALLENOIL</strong><span class="p-dir">AUTOVIA A- 92 KM. 10</span><span class="p-precio">1,639 <small>€/L</small></span><a class="ruta" href="…" target="_blank" rel="noopener">Cómo llegar</a></div>
   ```
7. **Estados de la ubicación.** En `pedirUbicacion()`, además del texto: `boton.dataset.estado = 'localizando' | 'activada' | 'denegada' | 'error'`.
8. **Escala de color (opcional, recomendada).** El color `--c` solo se usa en una tesela pequeña junto al precio y en la chincheta, nunca como única pista. Propongo cambiar de verde→rojo a azul→naranja, que se distingue bien con daltonismo y se adapta al tema:
   ```js
   return `color-mix(in oklab, var(--caro) ${Math.round(t * 100)}%, var(--barato))`;
   ```

## Lo que resuelve el CSS solo (sin JS)
- Primera carga: esqueletos en el resumen y la lista (`#refrescar.girando` + `#lista:empty`).
- Actualizando con datos: barra animada bajo los controles.
- Error sin datos (bloque grande con aviso de reintentar) frente a error con datos (aviso compacto): lo distingue `body:has(.tarjeta)`.
- Filtro sin resultados: `.vacio` con una sugerencia.
- Rótulo "Cerradas ahora" antes de la primera cerrada (necesita el punto 3).
