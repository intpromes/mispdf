# Mis PDF: app para Android

Abre PDFs y compártelos por WhatsApp, Drive o cualquier app. Es una app web instalable (PWA): una vez instalada tiene su propio ícono, se abre a pantalla completa y funciona sin internet para ver los PDF.

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
- **Compartir**: abre el menú de Android; elige WhatsApp, Drive («Guardar en Drive»), correo o la app que quieras.
- **Imprimir**: eliges color o blanco y negro, y todas las páginas, la actual o algunas (ej. `1-3, 5`). Luego Android muestra las impresoras Wi-Fi de tu red; ahí eliges impresora, copias y tamaño de papel. Si tu impresora no aparece, revisa en Ajustes de Android → *Impresión* que el **Servicio de impresión predeterminado** (o el de la marca, p. ej. *Brother Print Service Plugin*) esté activado, y que el celular esté en la misma red Wi-Fi.
- Zoom con los botones − / + o pellizcando la pantalla. Soporta PDF con contraseña.



## Archivos

| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `manifest.webmanifest` | Nombre, ícono, «Compartir hacia Mis PDF» |
| `sw.js` | Modo sin conexión y recepción de PDFs compartidos |
| `vendor/` | PDF.js (Mozilla), el motor que dibuja los PDF |
| `icons/` | Íconos de la app |

Si cambias algún archivo, sube de versión `VERSION` en `sw.js` (`mispdf-v3`, …) para que los celulares descarguen la actualización.
