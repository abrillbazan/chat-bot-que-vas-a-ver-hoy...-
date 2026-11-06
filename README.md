# Chatbot recomendador de películas

Un chat para sumar a una página web: la persona cuenta qué tiene ganas de ver y el bot le recomienda películas reales. También responde dudas básicas sobre el sitio y deriva a una persona cuando no sabe.

- **Frontend:** `index.html`, una página con un widget de chat (HTML, CSS y JS sin librerías).
- **Backend:** `server.js`, un servidor de Node sin dependencias que conecta con la [API de Claude](https://docs.claude.com) y con [TMDB](https://www.themoviedb.org/documentation/api).

## Cómo funciona

1. El navegador envía la conversación a `/api/chat`.
2. El servidor se la pasa a Claude junto con una herramienta, `buscar_peliculas`.
3. Cuando Claude necesita recomendar, usa esa herramienta, que consulta TMDB con los filtros que pidió la persona (género, duración, año, nota).
4. Claude responde usando solo las películas que devolvió TMDB, así no inventa títulos.
5. El navegador muestra la respuesta y tarjetas con póster y link de las películas recomendadas.

## Requisitos

- Node 18 o superior (20.6 o superior si usan `npm run dev`).
- Una clave de API de Anthropic, desde la [Claude Console](https://console.anthropic.com).
- Una clave gratuita (v3) de TMDB, desde [themoviedb.org](https://www.themoviedb.org/settings/api).

## Uso local

```bash
cp .env.example .env     # y completar las dos claves
npm run dev              # arranca en http://localhost:3000
```

Si prefieren no usar el archivo `.env`, pueden definir las variables a mano y correr `npm start`:

```bash
export ANTHROPIC_API_KEY=su_clave
export TMDB_API_KEY=su_clave
npm start
```

En Windows PowerShell: `$env:ANTHROPIC_API_KEY="su_clave"`.

## Variables de entorno

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Sí | Clave de la API de Anthropic |
| `TMDB_API_KEY` | Sí | Clave v3 de TMDB |
| `MODEL` | No | Modelo de Claude a usar (por defecto `claude-haiku-5-5`, el más económico) |
| `PORT` | No | Puerto del servidor (por defecto `3000`) |

## Personalizar

- **Información del sitio:** en `server.js`, completar `INFO_DEL_SITIO` con sus preguntas frecuentes y el contacto de soporte. El bot responde las dudas de atención al cliente usando solo ese texto.
- **Tono y reglas del bot:** en `server.js`, la constante `SYSTEM`.
- **Diseño del chat:** en `index.html`, los estilos del widget.

## Integrarlo en una página existente

1. Copiar de `index.html` lo que está entre los comentarios "copiá desde acá" y "fin del widget" (CSS, HTML y JS) dentro de su página.
2. Publicar `server.js` en un hosting con Node (Render, Railway, Fly.io, un VPS, etc.) y cargar las variables de entorno ahí.
3. Si el servidor queda en otro dominio que la página, cambiar `API_URL` en el script del widget por la URL completa del servidor.

## Seguridad y costos

- Las claves van **solo** en el servidor. Nunca las pongan en el HTML ni las suban a GitHub (`.env` está en `.gitignore`).
- El servidor limita a 20 mensajes por minuto por IP y recorta el largo de la conversación. Es un límite básico: para producción conviene reforzarlo.
- Cada mensaje tiene un costo en la API de Anthropic. Revisen el uso en la Console.
- Si el servidor queda público en otro dominio, restrinjan quién puede llamarlo (CORS u otro control).
- El widget avisa que se habla con una IA. Mantengan ese aviso.

## Créditos

Los datos de películas provienen de [TMDB](https://www.themoviedb.org). Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.
