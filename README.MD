# Language Lab

Aplicación web estática para estudiar idiomas. Guarda los perfiles y el contenido
en el almacenamiento local del navegador donde se usa.

## Publicar en GitHub Pages

1. Sube todos los archivos y carpetas de este proyecto al repositorio. `index.html`
   debe quedar en la raíz publicada.
2. En GitHub, abre **Settings → Pages**.
3. En **Build and deployment**, elige **Deploy from a branch**, selecciona la rama
   que contiene la app y la carpeta `/ (root)`, y guarda.
4. Abre la URL que muestra GitHub Pages, normalmente
   `https://USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/`.

La dirección `https://github.com/USUARIO/NOMBRE-DEL-REPOSITORIO` muestra el
repositorio; no es la dirección de la aplicación.

La app necesita conexión para cargar Tailwind CSS desde su CDN. Los archivos,
el manifest y el service worker usan rutas relativas para funcionar tanto en
un dominio raíz como dentro de la ruta de un repositorio.
