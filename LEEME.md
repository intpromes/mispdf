# Mis PDF: app para Android

Abre PDFs, guárdalos en Google Drive y compártelos por WhatsApp. Es una app web instalable (PWA): una vez instalada tiene su propio ícono, se abre a pantalla completa y funciona sin internet para ver los PDF.

## 1. Publicarla (una sola vez, gratis)

La app necesita estar en una dirección **https**. La forma más fácil:

1. En la computadora, descomprime `MisPDF.zip`.
2. Entra a **https://app.netlify.com/drop** (crea una cuenta gratis si te la pide).
3. Arrastra la carpeta `pdfapp` a la página.
4. Netlify te da una dirección como `https://nombre-raro.netlify.app`. En *Site settings → Change site name* puedes ponerle un nombre, por ejemplo `mis-pdf-mauricio`.

(También sirve GitHub Pages o cualquier hosting con https.)

## 2. Instalarla en el celular

1. En Android abre **Chrome** y entra a la dirección de Netlify.
2. Toca **Instalar app** (botón rojo de arriba) o el menú ⋮ → **Instalar app** / **Agregar a pantalla principal**.
3. Aparece el ícono **Mis PDF** junto a tus demás apps.

Para que otras personas la instalen, solo mándales la misma dirección.

## 3. Uso

- **Abrir PDF**: elige archivos del celular. Quedan en *Recientes* para volver a abrirlos.
- **Desde otras apps**: en WhatsApp, Gmail o Archivos, mantén presionado un PDF → **Compartir** → **Mis PDF**.
- **WhatsApp**: abre el menú de compartir; elige WhatsApp y el contacto.
- **Drive**: abre el menú de compartir; elige **Drive** («Guardar en Drive»). No requiere configurar nada.
- **Compartir**: cualquier otra app (correo, Telegram, etc.).
- Zoom con los botones − / + o pellizcando la pantalla. Soporta PDF con contraseña.

## 4. Opcional: subida directa a Drive con enlace

Con esto la app sube el PDF sola, con barra de progreso, y te deja mandar **el enlace de Drive** por WhatsApp en lugar del archivo (útil para PDFs pesados).

1. En https://console.cloud.google.com crea un proyecto y habilita **Google Drive API**.
2. **Pantalla de consentimiento OAuth**: tipo «Externo»; agrega tu correo (y el de quien la vaya a usar) como *usuario de prueba*.
3. **Credenciales → Crear credenciales → ID de cliente OAuth → Aplicación web**.
4. En **Orígenes autorizados de JavaScript** pon tu dirección de Netlify, por ejemplo `https://mis-pdf-mauricio.netlify.app` (sin diagonal al final).
5. Copia el **ID de cliente** y pégalo en la app: ⚙ **Ajustes**. Si quieres, pon también el ID o el enlace de una carpeta de Drive para que todo se guarde ahí.

La app solo pide el permiso `drive.file`, así que únicamente ve los archivos que ella misma sube.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `manifest.webmanifest` | Nombre, ícono, «Compartir hacia Mis PDF» |
| `sw.js` | Modo sin conexión y recepción de PDFs compartidos |
| `vendor/` | PDF.js (Mozilla), el motor que dibuja los PDF |
| `icons/` | Íconos de la app |

Si cambias algún archivo, sube de versión `VERSION` en `sw.js` (`mispdf-v2`, …) para que los celulares descarguen la actualización.
