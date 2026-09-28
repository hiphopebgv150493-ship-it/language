# Language Lab

Aplicación web estática para estudiar idiomas. Los perfiles se guardan en el
navegador del dispositivo. La app usa IndexedDB cuando está disponible y conserva
la migración desde versiones anteriores que guardaban en `localStorage`.

## Publicar en GitHub Pages

1. Sube el contenido completo del proyecto al repositorio. `index.html` debe
   quedar en la raíz de la carpeta publicada, junto a `app.js`, `styles.css`,
   `tailwind.css`, `xlsx.full.min.js`, `sw.js` y `manifest.json`. Conserva también
   los iconos y la carpeta `uploads`.
2. En GitHub abre el repositorio y entra en **Settings → Pages**.
3. En **Build and deployment**, elige **Deploy from a branch**.
4. Selecciona la rama donde subiste los archivos (normalmente `main`) y la
   carpeta **/(root)**. Pulsa **Save**.
5. Abre **Actions** y espera a que la publicación de Pages termine con una marca
   verde. Usa la dirección que GitHub muestra en **Settings → Pages**.

Si la página aparece sin formato o los botones no responden, comprueba en el
repositorio que cada archivo conserva su contenido y su nombre exacto:
`app.js` debe contener la lógica de la aplicación, `tailwind.css` debe contener
reglas CSS y `sw.js` debe comenzar con `const CACHE_NAME`. Los tres archivos
deben estar junto a `index.html`; GitHub Pages distingue mayúsculas y minúsculas.
Después de sustituirlos, espera a que termine Pages y vuelve a cargar la web.

Para un repositorio llamado `mi-app`, la dirección suele ser
`https://TU-USUARIO.github.io/mi-app/`. La dirección `github.com/...` abre los
archivos del repositorio, no la aplicación. Si el repositorio se llama
`TU-USUARIO.github.io`, la aplicación se publica en `https://TU-USUARIO.github.io/`.

Si aparece 404, revisa que Pages use la rama y carpeta correctas y que el nombre
sea exactamente `index.html` (minúsculas). Si el despliegue falla, abre el último
trabajo de Pages en **Actions** y revisa el primer mensaje de error. Tras subir
una actualización, recarga la página publicada; el service worker renueva la
copia sin conexión con esta versión.

GitHub Pages no ejecuta un servidor ni sincroniza perfiles. Cada navegador y
dispositivo conserva sus propios datos; usa **Descargar base de datos** y
**Restaurar base de datos** para trasladar todos los perfiles en un archivo JSON.
Las opciones de Excel permiten exportar el perfil activo o importar hojas de
Diccionario, Canciones y Cuaderno. Instalar la app permite abrirla como aplicación y
trabajar sin conexión tras la primera carga. iOS y Android pueden suspender o
cerrar cualquier página en segundo plano; Language Lab guarda los cambios y
recupera la última pestaña y el contenido cuando se vuelve a abrir.
