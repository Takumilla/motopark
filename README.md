# MotoPark 🏍️

**MotoPark** es una aplicación web gratuita diseñada para ayudar a los motoristas a encontrar **aparcamientos gratuitos** para motos cerca de cualquier destino antes de salir o mientras están en ruta.

## 🚀 Funcionalidades

- **Prioridad gratis por defecto (`Solo gratis`)**: oculta automáticamente los aparcamientos de pago y prioriza las plazas gratuitas confirmadas.
- **Búsqueda por dirección o edificios emblemáticos**: localiza aparcamientos buscando por calle y número o por lugares de interés (*Hospital Donostia*, *Hotel María Cristina*, estaciones, museos, etc.) con autocompletado y detección por **GPS**.
- **Inspección real antes de ir**:
  - Enlace directo a **Google Street View** en cada plaza para comprobar señalización, acera y bordillo.
  - Selector de vista del mapa entre **Callejero**, **Satélite** y **Ortofoto oficial IGN PNOA** (España alta resolución).
- **Mejor cobertura en barrios**: además de plazas exclusivas de moto, incluye parkings aptos para moto y muestra aparcamientos públicos en superficie cuando no hay reservas exclusivas cercanas.
- **Aportaciones de la comunidad (`Añadir plaza`)**: permite marcar nuevas zonas de aparcamiento sobre el mapa y proponerlas en OpenStreetMap.
- **Radios de búsqueda**: filtra resultados por **300 m**, **500 m** o **1 km**.
- **Ruta real por calles**: traza el recorrido real evitando edificios, tanto **a pie** como **en moto** (OSRM).
- **Navegación**: enlaces directos a **Google Maps** y **Street View** desde el listado y el mapa.
- **Responsive**: diseño adaptado para usar cómodamente desde el móvil y ordenador.

## 🛠️ Tecnologías utilizadas

- **React, TypeScript, Vite y Tailwind CSS**
- **Leaflet.js**: renderización de mapas interactivos.
- **OpenStreetMap & Overpass API**: datos de aparcamientos para motos y vía pública.
- **Photon & Nominatim API**: búsqueda y autocompletado de calles y edificios emblemáticos.
- **OSRM (Open Source Routing Machine)**: rutas reales por calles a pie y en moto.
- **IGN PNOA (WMTS) & Esri**: ortofotos oficiales de alta resolución en España y cartografía satélite/callejero.

## 🌐 Acceso

Puedes acceder a la versión en vivo aquí:

https://takumilla.github.io/motopark/