// Servidor del chatbot recomendador de películas.
// Sin dependencias: requiere Node 18 o superior.
//
// Uso:
//   export ANTHROPIC_API_KEY=tu_clave_de_anthropic
//   export TMDB_API_KEY=tu_clave_v3_de_themoviedb
//   node server.js
// Y abrí http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
// Haiku es la opción más económica para un chat. Podés cambiarla por otro modelo.
const MODEL = process.env.MODEL || 'claude-haiku-5-5';

if (!ANTHROPIC_API_KEY || !TMDB_API_KEY) {
  console.error('Faltan ANTHROPIC_API_KEY y/o TMDB_API_KEY (variables de entorno).');
  process.exit(1);
}

// ⚠️ EDITÁ ESTO con la información real de tu sitio.
// El bot responde las dudas de atención al cliente usando solo este texto.
const INFO_DEL_SITIO = `
- Qué es: una web donde contás tus preferencias y te recomendamos una película. (completar)
- Costo: (completar, por ejemplo "es gratis")
- Contacto con una persona: soporte@tusitio.com (completar)
- Preguntas frecuentes: (completar con las dudas más comunes y sus respuestas)
`;

const SYSTEM = `Sos el asistente de una página web que recomienda películas según las preferencias de cada persona. Hablás en español rioplatense, con un tono cálido, breve y claro. Sos una IA y, si te preguntan, lo decís.

Cómo recomendar:
- Si la persona ya dio suficientes datos (género, ánimo, duración, época), buscá directamente. Si falta algo importante, hacé como máximo una o dos preguntas cortas.
- Para recomendar SIEMPRE usá la herramienta buscar_peliculas. Nunca recomiendes una película que no haya salido de sus resultados.
- Recomendá entre 1 y 3 películas. Para cada una: el título en **negrita**, el año y una o dos frases sobre por qué encaja con lo que pidió.
- Si no le gusta ninguna, ofrecé otras (cambiá los filtros o usá el parámetro pagina).
- Si no hay resultados, decilo y proponé aflojar algún filtro.

Atención al cliente:
- Si preguntan por el sitio (cuenta, errores, privacidad, etc.), respondé solo con la información de más abajo.
- Si no sabés la respuesta o la persona está molesta, no inventes: derivala al contacto que figura abajo.

Límites: hablá solo de películas y de este sitio. Si piden otra cosa, explicá amablemente que no podés ayudar con eso.

Información del sitio:
${INFO_DEL_SITIO}`;

// ---------- Herramienta: buscar películas en TMDB ----------

const GENEROS = {
  'acción': 28, 'aventura': 12, 'animación': 16, 'comedia': 35, 'crimen': 80,
  'documental': 99, 'drama': 18, 'familia': 10751, 'fantasía': 14, 'historia': 36,
  'terror': 27, 'música': 10402, 'misterio': 9648, 'romance': 10749,
  'ciencia ficción': 878, 'suspenso': 53, 'bélica': 10752, 'western': 37,
};

const TOOLS = [
  {
    name: 'buscar_peliculas',
    description:
      'Busca películas reales en la base de datos de TMDB. Usala para toda recomendación. ' +
      'Con "busqueda" busca por título o palabras; sin "busqueda" filtra por los demás criterios y ordena por popularidad.',
    input_schema: {
      type: 'object',
      properties: {
        generos: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(GENEROS) },
          description: 'Géneros que debe cumplir la película (todos a la vez).',
        },
        duracion_max_min: { type: 'integer', description: 'Duración máxima en minutos.' },
        anio_desde: { type: 'integer', description: 'Año de estreno mínimo.' },
        anio_hasta: { type: 'integer', description: 'Año de estreno máximo.' },
        nota_minima: { type: 'number', description: 'Nota mínima de 0 a 10.' },
        busqueda: { type: 'string', description: 'Texto para buscar por título.' },
        pagina: { type: 'integer', description: 'Número de página de resultados (por defecto 1).' },
      },
    },
  },
];

async function buscarPeliculas(input) {
  const p = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-AR',
    include_adult: 'false',
    page: String(input.pagina || 1),
  });
  let url;
  if (input.busqueda) {
    p.set('query', input.busqueda);
    url = 'https://api.themoviedb.org/3/search/movie?' + p;
  } else {
    p.set('sort_by', 'popularity.desc');
    p.set('vote_count.gte', '200'); // evita películas con muy pocos votos
    if (input.generos && input.generos.length) {
      p.set('with_genres', input.generos.map((g) => GENEROS[g]).filter(Boolean).join(','));
    }
    if (input.duracion_max_min) p.set('with_runtime.lte', String(input.duracion_max_min));
    if (input.anio_desde) p.set('primary_release_date.gte', input.anio_desde + '-01-01');
    if (input.anio_hasta) p.set('primary_release_date.lte', input.anio_hasta + '-12-31');
    if (input.nota_minima) p.set('vote_average.gte', String(input.nota_minima));
    url = 'https://api.themoviedb.org/3/discover/movie?' + p;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('TMDB respondió ' + r.status);
  const data = await r.json();
  return (data.results || []).slice(0, 8).map((m) => ({
    id: m.id,
    titulo: m.title,
    anio: (m.release_date || '').slice(0, 4),
    nota: Math.round((m.vote_average || 0) * 10) / 10,
    sinopsis: (m.overview || '').slice(0, 300),
    poster: m.poster_path ? 'https://image.tmdb.org/t/p/w185' + m.poster_path : null,
    url: 'https://www.themoviedb.org/movie/' + m.id,
  }));
}

// ---------- Conversación con Claude (con uso de herramientas) ----------

async function conversar(mensajes) {
  const msgs = mensajes.slice();
  const peliculas = [];

  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: SYSTEM, tools: TOOLS, messages: msgs }),
    });
    if (!r.ok) throw new Error('Anthropic respondió ' + r.status + ': ' + (await r.text()));
    const data = await r.json();
    msgs.push({ role: 'assistant', content: data.content });

    if (data.stop_reason !== 'tool_use') {
      const reply = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply, movies: peliculas };
    }

    const resultados = [];
    for (const bloque of data.content.filter((b) => b.type === 'tool_use')) {
      try {
        const pelis = await buscarPeliculas(bloque.input || {});
        peliculas.push(...pelis);
        resultados.push({
          type: 'tool_result',
          tool_use_id: bloque.id,
          content: pelis.length ? JSON.stringify(pelis) : 'Sin resultados con esos filtros.',
        });
      } catch (e) {
        resultados.push({
          type: 'tool_result',
          tool_use_id: bloque.id,
          content: 'Error al buscar: ' + e.message,
          is_error: true,
        });
      }
    }
    msgs.push({ role: 'user', content: resultados });
  }
  return { reply: 'Perdón, me trabé buscando. ¿Probamos de nuevo?', movies: [] };
}

// ---------- Servidor HTTP ----------

const visitas = new Map(); // límite simple: 20 mensajes por minuto por IP
function limitado(ip) {
  const ahora = Date.now();
  const lista = (visitas.get(ip) || []).filter((t) => ahora - t < 60000);
  lista.push(ahora);
  visitas.set(ip, lista);
  return lista.length > 20;
}

function limpiarMensajes(raw) {
  if (!Array.isArray(raw)) return null;
  let msgs = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))
    .slice(-20);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

function responder(res, estado, obj) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, html) => {
      if (err) return responder(res, 500, { error: 'No se encontró index.html' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    if (limitado(req.socket.remoteAddress)) {
      return responder(res, 429, { error: 'Demasiados mensajes, esperá un momento.' });
    }
    let cuerpo = '';
    req.on('data', (chunk) => {
      cuerpo += chunk;
      if (cuerpo.length > 20000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const msgs = limpiarMensajes(JSON.parse(cuerpo).messages);
        if (!msgs) return responder(res, 400, { error: 'Mensajes inválidos.' });
        responder(res, 200, await conversar(msgs));
      } catch (e) {
        console.error(e.message);
        responder(res, 500, { error: 'Algo falló del lado del servidor.' });
      }
    });
    return;
  }

  responder(res, 404, { error: 'No encontrado' });
});

server.listen(PORT, () => console.log('Listo en http://localhost:' + PORT));
