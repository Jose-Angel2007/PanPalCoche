# PanPalCoche

Precios de combustible de las 28 gasolineras de Alcalá de Guadaíra, con mapa,
filtro de "abiertas ahora" y orden por distancia. Datos oficiales del
Ministerio para la Transición Ecológica (se actualizan cada 30 min).

## Probarla

- **Rápido:** doble clic en `index.html`. Funciona todo menos el fondo del mapa
  (OpenStreetMap exige saber desde qué web se le piden los mapas, y `file://` no lo dice).
- **Completa en local:** en la carpeta del proyecto, `python -m http.server 8000`
  y abre http://localhost:8000
- **Con geolocalización en el móvil:** el navegador solo da la ubicación en
  HTTPS, así que hay que publicarla (abajo).

## Publicar en GitHub Pages

```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/panpalcoche.git
git push -u origin main
```

En GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
En un par de minutos estará en `https://<tu-usuario>.github.io/panpalcoche/`.

## Tests

```bash
node --test
```

## Estructura

| Fichero | Responsabilidad |
|---|---|
| `js/api.js` | Pedir datos a la API y **normalizarlos** ("1,849" → 1.849, claves con tildes → objeto limpio). Capa anticorrupción. |
| `js/horario.js` | Lógica pura: convierte "L-V: 06:00-22:00; S-D: 07:00-15:00" en intervalos por día y responde "¿abierta ahora?". |
| `js/app.js` | Estado único + `render()` que pinta lista, resumen y mapa. Polling cada 30 min. |
| `css/style.css` | Estilos, móvil primero, modo oscuro automático. |

## API usada

```
GET https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroMunicipio/6058
```

`6058` es Alcalá de Guadaíra. Para otro pueblo, busca su ID en
`.../Listados/MunicipiosPorProvincia/<IDProvincia>` y cambia `ID_MUNICIPIO` en `js/app.js`.

## Limitaciones conocidas

- Los horarios no contemplan festivos (la API no los da).
- "Abierta" usa la hora del dispositivo.
- Sin histórico: solo el precio actual (para eso haría falta un backend que guarde los datos).
