/**
 * ============================================================
 *  Confluence.gs — los procedimientos vigentes, traídos a la auditoría
 * ============================================================
 *
 * PARA QUÉ ES
 *
 * Varios criterios juzgan si el agente siguió el procedimiento: plazos, pasos de
 * un reembolso, cuándo corresponde una penalización. Hoy el auditor automático no
 * tiene el procedimiento a la vista, así que la única forma honesta de no producir
 * falsos positivos es decirle que no penalice lo que no puede verificar. El
 * resultado es correcto pero pobre: esos criterios quedan sin evaluar.
 *
 * Con esto, el prompt lleva el TEXTO del procedimiento que aplica al caso, y el
 * veredicto puede citar el párrafo exacto. Un "no concluyente" se convierte en un
 * veredicto defendible — y, tanto o más importante, cuando el procedimiento
 * simplemente no cubre el caso, eso también queda visible.
 *
 * CÓMO SE CONFIGURA
 *
 * Nada de credenciales en el código. En Apps Script:
 *   Configuración del proyecto ▸ Propiedades de la secuencia de comandos
 *
 *   CONF_BASE_URL   https://cabify.atlassian.net/wiki   (Cloud)
 *                   o https://confluence.tudominio/     (Server/Data Center)
 *   CONF_EMAIL      tu correo corporativo
 *   CONF_API_TOKEN  el API token de Atlassian
 *   CONF_SPACE      la clave del espacio de procedimientos (ej. SOPB2B)
 *
 * Después, en este orden:
 *   1. confDiagnostico()        ¿la credencial funciona?
 *   2. confListarEspacios()     ¿cuál es la clave del espacio? (si no la sabes)
 *   3. confListarPaginas()      ¿qué páginas hay? De acá sale el mapa.
 *   4. confSincronizar()        baja el texto a la hoja "Procedimientos"
 *
 * POR QUÉ SE SINCRONIZA A UNA HOJA Y NO SE CONSULTA EN VIVO
 *
 * Tres razones. Una auditoría tiene que poder repetirse: si el procedimiento
 * cambia mañana, hay que saber contra qué texto se juzgó ayer, y para eso se
 * guarda la versión. Segundo, Apps Script tiene 6 minutos por ejecución y una
 * llamada HTTP por ticket no cabe. Y tercero, así se puede leer lo que el agente
 * va a recibir antes de mandárselo, que es la única forma de depurar esto.
 */

const CONF = {
  PROP_BASE:   "CONF_BASE_URL",
  PROP_EMAIL:  "CONF_EMAIL",
  PROP_TOKEN:  "CONF_API_TOKEN",
  PROP_SPACE:  "CONF_SPACE",
  HOJA:        "Procedimientos",
  MAX_CHARS:   12000,   // por página, en la hoja
  MAX_PROMPT:  14000,   // total de procedimiento que viaja en un prompt
  TIMEOUT_MS:  30000,
};

/**
 * Mapa motivo/tag del ticket → páginas de procedimiento que aplican.
 *
 * La clave se compara en minúsculas y sin acentos contra el motivo del ticket y
 * contra sus output tags, así que "Cargos y Tarifas" calza con "cargos y tarifas".
 *
 * OJO: el espacio NE tiene 2.607 documentos y la mayoría no es de esta auditoría
 * —hay procedimientos de Drivers, de Fleets, de Perú, de Logistics—. Meter todo
 * sería ruido, y ruido en el prompt es peor que silencio: el modelo empieza a
 * citar reglas que no aplican al caso.
 *
 * Este es un borrador SIN VERIFICAR: los ids salen de los títulos del listado,
 * no de haber leído las páginas. Antes de confiar en él hay que abrir cada una.
 */
const CONF_MAPA = {
  "cargos y tarifas":       ["159186948", "243269654", "155227667", "155227985"],
  "cargos no reconocidos":  ["159186948"],
  "retarificacion":         ["155227985", "782438992", "155228767"],
  "precio distinto":        ["263946254", "155227667", "243269654"],
  "reembolso":              ["197984257", "155228171", "155228503"],
  "devolucion":             ["197984257"],
  "cobros dobles":          ["214401070"],
  "no show":                ["156074040", "156500029", "156532766"],
  "cancelacion":            ["155228659", "350486966"],
  "peajes":                 ["156434473"],
  "descuento":              ["156467218", "155227499"],
  "facturacion":            ["220692481", "214597659"],
  "factura":                ["220692481", "668237927"],
  "usuarios":               ["211714053", "207126685"],
  "centro de coste":        ["338788906"],
  "org units":              ["324567130"],
};

/**
 * La rama "Manual de Quality" (229277760) y sus diez hijos.
 *
 * Esto no es un procedimiento operativo más: son las dimensiones de la rúbrica
 * —Bienvenida, Saludos, Presentación, Despedida, Personalización, Conexión
 * emocional, Comunicación, Procedimiento, Proceso— escritas por el equipo que
 * define cómo se audita. Es, con toda probabilidad, la fuente de la Matriz de
 * Auditoría que este sistema aplica.
 *
 * Mientras no se lean, AUD_REGLAS sigue siendo mi redacción a partir de casos
 * corregidos uno a uno. Leerlas es cambiar una reconstrucción por el original.
 *
 * Para bajarlas:  confSincronizar(CONF_QUALITY)
 * Para leer una:  confLeerPagina("229736494")
 */
const CONF_QUALITY = [
  "229277760",   // Manual de Quality (raíz)
  "229048462",   // Bienvenida
  "229277811",   // Saludos
  "229769218",   // Saludos en tiempos
  "229703714",   // Presentación
  "229736494",   // Despedida
  "229736504",   // Personalización
  "229703754",   // Conexión emocional
  "229736514",   // Comunicación
  "229703794",   // Procedimiento
  "229801997",   // Proceso
];

/**
 * Páginas que se adjuntan SIEMPRE, sea cual sea el motivo.
 *
 * Son los protocolos transversales: los que definen cómo se saluda, cómo se
 * despide, cuánto se puede esperar y cuándo se cierra un ticket. Es decir,
 * exactamente lo que miden C01, C03, C04, C05 y C21 — hoy evaluados contra la
 * intuición del modelo en vez de contra el documento.
 *
 * "Manual de Quality" y sus hijos son la rúbrica de la casa. Si algo de acá
 * merece leerse entero antes de seguir calibrando, es eso.
 */
const CONF_SIEMPRE = [
  "155228701",   // Protocolo de Bienvenida - Atención Tickets
  "155228365",   // Protocolo de Despedida - Atención Tickets
  "201523487",   // Estado y resolución de ticket
  "155227517",   // Cierre de ticket
];

/**
 * ============================================================
 *  PROCEDIMIENTOS POR AUDIENCIA
 * ============================================================
 * CONF_MAPA y CONF_SIEMPRE de arriba son los de B2B (eran los únicos que
 * había). Cada audiencia que tenga documentación propia se declara acá y
 * REEMPLAZA a los de arriba, no se suma: adjuntarle a un ticket de aeropuerto
 * el protocolo de despedida de B2B es exactamente el error que este sistema
 * tiene que evitar — el evaluador reprobaría al agente por no seguir un
 * documento que no le aplica.
 *
 * Las cuatro páginas de aeropuerto van en `siempre` porque todavía no sabemos
 * qué motivo cubre cada una. Cuando esté claro, se reparten en `mapa` y el
 * prompt deja de cargar las cuatro en todos los tickets. Mientras tanto es
 * preferible que sobre contexto a que falte: el presupuesto de caracteres de
 * confBloquePrompt_ ya se encarga de que no sepulten la conversación.
 */
const CONF_AUDIENCIA = {
  aeropuerto: {
    siempre: [
      "461409127",
      "781869670",
      "463208491",
      "468451731",
    ],
    mapa: {},
  },
};

/** Páginas que se adjuntan siempre, para esa audiencia. */
function confSiempreDe_(audiencia) {
  const a = CONF_AUDIENCIA[audiencia || ""];
  return (a && a.siempre) ? a.siempre : CONF_SIEMPRE;
}

/** Mapa motivo → páginas, para esa audiencia. */
function confMapaDe_(audiencia) {
  const a = CONF_AUDIENCIA[audiencia || ""];
  return (a && a.mapa) ? a.mapa : CONF_MAPA;
}

/** Todos los ids referidos por cualquier audiencia (para sincronizar). */
function confTodosLosIds_() {
  const ids = {};
  const sumar = (lista) => (lista || []).forEach(id => { ids[String(id)] = true; });
  sumar(CONF_SIEMPRE);
  Object.keys(CONF_MAPA).forEach(k => sumar(CONF_MAPA[k]));
  Object.keys(CONF_AUDIENCIA).forEach(a => {
    sumar(CONF_AUDIENCIA[a].siempre);
    const m = CONF_AUDIENCIA[a].mapa || {};
    Object.keys(m).forEach(k => sumar(m[k]));
  });
  return Object.keys(ids);
}

// ============================================================
//  Credenciales y llamada HTTP
// ============================================================

function confConfig_() {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty(CONF.PROP_BASE) || "").trim().replace(/\/+$/, "");
  const email = String(props.getProperty(CONF.PROP_EMAIL) || "").trim();
  const token = String(props.getProperty(CONF.PROP_TOKEN) || "").trim();
  const space = String(props.getProperty(CONF.PROP_SPACE) || "").trim();

  const faltan = [];
  if (!base)  faltan.push(CONF.PROP_BASE);
  if (!email) faltan.push(CONF.PROP_EMAIL);
  if (!token) faltan.push(CONF.PROP_TOKEN);
  if (faltan.length) throw new Error(
    "Faltan propiedades del script: " + faltan.join(", ") + ".\n" +
    "Ponlas en Configuración del proyecto ▸ Propiedades de la secuencia de comandos.\n" +
    "El token NO va en el código, ni en un documento, ni en un chat.");

  return { base: base, email: email, token: token, space: space };
}

/**
 * Prefijo de la API. Cloud sirve /rest/api bajo /wiki; Server y Data Center lo
 * sirven en la raíz. Se deduce de la URL base para no tener otra propiedad más
 * que se pueda configurar mal.
 */
function confPrefijo_(base) {
  return /\/wiki$/.test(base) ? base + "/rest/api" : base + "/rest/api";
}

function confGet_(ruta, params) {
  return confGetAbs_(confPrefijo_(confConfig_().base) + ruta, params);
}

/**
 * La API v2 de Confluence Cloud. Existe en paralelo a la v1 y en varios sitios
 * devuelve contenido que la v1 no ve — sobre todo en espacios de base de
 * conocimiento de Service Management, que es justo el caso de este proyecto.
 * Por eso se consultan las dos y no una sola.
 */
function confGetV2_(ruta, params) {
  const base = confConfig_().base;
  const raiz = /\/wiki$/.test(base) ? base : base + "/wiki";
  return confGetAbs_(raiz + "/api/v2" + ruta, params);
}

/** GET autenticado sobre una URL absoluta. Todo lo demás pasa por acá. */
function confGetAbs_(urlBase, params) {
  const cfg = confConfig_();
  let url = urlBase;

  // Un valor de array se repite como parámetro: ?status=current&status=archived.
  // Es como la v2 espera los multivalor, y es lo que hace falta para ver a la vez
  // el contenido vigente y el archivado.
  const partes = [];
  Object.keys(params || {}).forEach(k => {
    const v = params[k];
    if (v === undefined || v === null || v === "") return;
    const lista = Object.prototype.toString.call(v) === "[object Array]" ? v : [v];
    lista.forEach(x => partes.push(encodeURIComponent(k) + "=" + encodeURIComponent(x)));
  });
  const qs = partes.join("&");
  if (qs) url += (url.indexOf("?") >= 0 ? "&" : "?") + qs;

  const resp = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      // Basic con correo + API token es lo que acepta Atlassian Cloud.
      Authorization: "Basic " + Utilities.base64Encode(cfg.email + ":" + cfg.token),
      Accept: "application/json",
    },
  });

  const code = resp.getResponseCode();
  const cuerpo = resp.getContentText();

  if (code === 401) throw new Error(
    "401 de Confluence: la credencial no es válida.\n" +
    "Casi siempre es el API token (caducado o mal copiado) o que CONF_EMAIL no es el " +
    "correo dueño de ese token. Genera uno nuevo en id.atlassian.com y actualiza la propiedad.");
  if (code === 403) throw new Error(
    "403 de Confluence: la credencial es válida pero no tiene permiso sobre eso.\n" +
    "Pide acceso de lectura al espacio, o revisa que CONF_SPACE sea el correcto.\n" +
    "URL: " + url);
  if (code === 404) throw new Error(
    "404 de Confluence: la ruta o el contenido no existe.\n" +
    "Revisa CONF_BASE_URL — en Cloud termina en /wiki.\nURL: " + url);
  if (code < 200 || code >= 300) throw new Error(
    "Confluence respondió " + code + ".\nURL: " + url + "\n" + cuerpo.slice(0, 500));

  try { return JSON.parse(cuerpo); }
  catch (e) {
    throw new Error("Confluence respondió algo que no es JSON (" + code + "). " +
      "Suele pasar cuando CONF_BASE_URL apunta a la web y no a la API.\n" +
      "Empieza así: " + cuerpo.slice(0, 200));
  }
}

// ============================================================
//  Exploración — lo primero que hay que correr
// ============================================================

/** ¿Funciona la credencial? Una llamada mínima y un diagnóstico legible. */
function confDiagnostico() {
  const cfg = confConfig_();
  Logger.log("Base: %s", cfg.base);
  Logger.log("Prefijo API: %s", confPrefijo_(cfg.base));
  Logger.log("Correo: %s", cfg.email);
  Logger.log("Token: %s caracteres (no se muestra)", String(cfg.token).length);
  Logger.log("Espacio configurado: %s", cfg.space || "(ninguno todavía)");

  // Se piden 25 y no 1. Pedir uno solo y decir "al menos 1" hizo creer que ese
  // único espacio era el correcto, y nos fuimos dos pasos por el camino
  // equivocado. Un diagnóstico que induce a error es peor que ninguno.
  const r = confGet_("/space", { limit: 25 });
  const espacios = r.results || [];
  Logger.log("LISTO: la credencial funciona.");
  Logger.log("Espacios visibles (%s%s):", espacios.length, espacios.length === 25 ? "+, hay más" : "");
  // Logger.log solo entiende %s: el ancho se rellena a mano.
  espacios.forEach(s => {
    let k = String(s.key || "");
    while (k.length < 10) k += " ";
    Logger.log("   %s %s", k, s.name);
  });
  Logger.log("");
  if (cfg.space) {
    const elegido = espacios.filter(s => s.key === cfg.space)[0];
    Logger.log("Espacio configurado: %s%s", cfg.space,
      elegido ? "  — '" + elegido.name + "'" : "  (no aparece en la lista de arriba: revisa la clave)");
  } else {
    Logger.log("→ Elige de la lista el espacio de procedimientos y pon su clave en %s.", CONF.PROP_SPACE);
  }
  return espacios;
}

/**
 * Traduce un enlace de Confluence a lo que hace falta para configurar esto:
 * la clave del espacio y, si el enlace apunta a una página, su id.
 *
 * Sirve sobre todo para los enlaces cortos tipo
 *   https://cabify-service-desk.atlassian.net/wiki/x/CoBACQ
 * que es lo que da el botón de compartir y que no dice nada a simple vista.
 * En vez de descifrarlo, se le pregunta a Confluence a dónde lleva.
 *
 * Uso: confDesdeEnlace("https://.../wiki/x/CoBACQ")
 */
function confDesdeEnlace(url) {
  const cfg = confConfig_();
  const enlace = String(url || "").trim();
  if (!enlace) throw new Error('Pásame el enlace: confDesdeEnlace("https://.../wiki/x/XXXX")');

  // Si ya es un enlace largo, no hace falta preguntarle a nadie.
  let destino = enlace;
  const yaEsLargo = /\/spaces\/[^\/]+\/pages\/\d+/.test(enlace);

  if (!yaEsLargo) {
    const resp = UrlFetchApp.fetch(enlace, {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: false,          // queremos VER el redirect, no seguirlo
      headers: {
        Authorization: "Basic " + Utilities.base64Encode(cfg.email + ":" + cfg.token),
        Accept: "application/json",
      },
    });
    const code = resp.getResponseCode();
    const headers = resp.getAllHeaders() || {};
    const loc = headers.Location || headers.location || "";

    if (loc) {
      destino = /^https?:\/\//.test(loc) ? loc : cfg.base.replace(/\/wiki$/, "") + loc;
    } else if (code >= 200 && code < 300) {
      throw new Error(
        "El enlace no redirigió a ninguna parte (" + code + ").\n" +
        "Ábrelo en el navegador, copia la URL LARGA de la barra de direcciones " +
        "—la que tiene /spaces/CLAVE/pages/12345/— y pásame esa.");
    } else {
      throw new Error(
        "Confluence respondió " + code + " a ese enlace y no dio destino.\n" +
        (code === 401 || code === 403
          ? "Suele ser la credencial: revisa CONF_EMAIL y CONF_API_TOKEN."
          : "Comprueba que el enlace sea correcto y que tengas acceso al espacio."));
    }
  }

  const m = /\/spaces\/([^\/\?#]+)\/pages\/(\d+)/.exec(destino);
  const soloEspacio = /\/spaces\/([^\/\?#]+)/.exec(destino);
  const porQuery = /[?&]pageId=(\d+)/.exec(destino);

  const espacio = m ? decodeURIComponent(m[1]) : (soloEspacio ? decodeURIComponent(soloEspacio[1]) : "");
  const pagina  = m ? m[2] : (porQuery ? porQuery[1] : "");

  Logger.log("Enlace corto:  %s", enlace);
  Logger.log("Lleva a:       %s", destino);
  Logger.log("");
  Logger.log("CLAVE DEL ESPACIO: %s", espacio || "(no la pude sacar de la URL)");
  if (pagina) Logger.log("ID DE LA PÁGINA:   %s", pagina);
  Logger.log("");
  if (espacio) {
    Logger.log("→ Pon %s = %s en las propiedades del script.", CONF.PROP_SPACE, espacio);
    Logger.log("→ Después corre confListarPaginas().");
  } else {
    Logger.log("→ No pude deducir el espacio. Corre confListarEspacios() y búscalo por nombre.");
  }
  return { enlace: enlace, destino: destino, espacio: espacio, pagina: pagina };
}

/** Los espacios que la credencial puede ver. Para dar con la clave correcta. */
function confListarEspacios() {
  const out = [];
  let inicio = 0;
  for (let i = 0; i < 10; i++) {
    const r = confGet_("/space", { limit: 50, start: inicio, type: "global" });
    (r.results || []).forEach(s => out.push({ clave: s.key, nombre: s.name }));
    if (!r._links || !r._links.next) break;
    inicio += 50;
  }
  Logger.log("%s espacios visibles:", out.length);
  out.forEach(s => Logger.log("   %s  —  %s", s.clave, s.nombre));
  Logger.log("→ Pon la clave del espacio de procedimientos en la propiedad %s.", CONF.PROP_SPACE);
  return out;
}

/** Normaliza una página venga de la ruta que venga. */
function confPagina_(p, base, tipo) {
  const wui = (p._links && p._links.webui) || "";
  return {
    id: String(p.id),
    titulo: p.title || "(sin título)",
    tipo: tipo || p.type || "page",
    estado: p.status || "",
    version: p.version ? (p.version.number || "") : "",
    actualizado: p.version ? (p.version.when || p.version.createdAt || "") : "",
    url: wui ? (/^https?:/.test(wui) ? wui : base + wui) : "",
  };
}

/**
 * Ruta A: API v2. La que funciona en este sitio.
 *
 * Dos cosas que costaron un ciclo averiguar y por eso quedan escritas:
 *   - "body-format" NO vale en el listado (devuelve 400). El cuerpo se pide
 *     después, página por página.
 *   - Hay que pedir status current Y archived. El espacio de procedimientos
 *     está archivado, así que filtrar por "current" devolvía cero.
 */
function confPaginasV2_(clave) {
  const base = confConfig_().base;
  const esp = confGetV2_("/spaces", { keys: clave, limit: 5 });
  const encontrado = (esp.results || [])[0];
  if (!encontrado) return { paginas: [], nota: "la v2 no conoce ese espacio" };

  const raiz = /\/wiki$/.test(base) ? base.replace(/\/wiki$/, "") : base;
  const out = [];

  // Las entradas de blog también cuentan: en este espacio hay comunicados
  // publicados como blogpost que son procedimiento igual que cualquier página.
  [["pages", "page"], ["blogposts", "blogpost"]].forEach(([recurso, tipo]) => {
    let ruta = "/spaces/" + encodeURIComponent(encontrado.id) + "/" + recurso;
    let params = { limit: 250, status: ["current", "archived"] };
    for (let i = 0; i < 20; i++) {
      let r;
      try { r = /^https?:/.test(ruta) ? confGetAbs_(ruta) : confGetV2_(ruta, params); }
      catch (e) { break; }                       // un recurso ausente no invalida el otro
      (r.results || []).forEach(p => out.push(confPagina_(p, base, tipo)));
      const sig = r._links && r._links.next;
      if (!sig) break;
      ruta = /^https?:/.test(sig) ? sig : raiz + sig;
      params = null;
    }
  });

  return { paginas: out, espacioId: encontrado.id, espacioEstado: encontrado.status };
}

/** Ruta B: búsqueda CQL de la v1. Suele ver lo que el listado directo no ve. */
function confPaginasCql_(clave) {
  const base = confConfig_().base;
  const out = [];
  let inicio = 0;
  for (let i = 0; i < 20; i++) {
    const r = confGet_("/content/search", {
      cql: 'space="' + clave + '" and type=page order by title',
      expand: "version", limit: 50, start: inicio,
    });
    const lote = r.results || [];
    lote.forEach(p => out.push(confPagina_(p, base)));
    if (lote.length < 50) break;
    inicio += 50;
  }
  return { paginas: out };
}

/**
 * Ruta C: el listado directo de la v1. La más antigua y la más restrictiva.
 * Recorre los dos estados y los dos tipos, porque filtrar por "current" en un
 * espacio archivado devuelve cero sin decir por qué.
 */
function confPaginasV1_(clave, tipo, estado) {
  const base = confConfig_().base;
  const tipos = tipo ? [tipo] : ["page", "blogpost"];
  const estados = estado ? [estado] : ["current", "archived"];
  const out = [], vistos = {};

  tipos.forEach(tp => estados.forEach(st => {
    let inicio = 0;
    for (let i = 0; i < 20; i++) {
      let r;
      try {
        r = confGet_("/content", {
          spaceKey: clave, type: tp, status: st,
          expand: "version", limit: 50, start: inicio,
        });
      } catch (e) { break; }
      const lote = r.results || [];
      lote.forEach(p => {
        if (vistos[String(p.id)]) return;
        vistos[String(p.id)] = true;
        out.push(confPagina_(p, base, tp));
      });
      if (lote.length < 50) break;
      inicio += 50;
    }
  }));
  return { paginas: out };
}

/**
 * Las páginas del espacio, con su id, título y URL. De acá sale CONF_MAPA:
 * hay que ver los títulos reales antes de decidir qué procedimiento aplica a
 * qué motivo de ticket.
 *
 * Prueba TRES rutas y se queda con la primera que devuelva algo. La razón es un
 * caso real: el listado v1 devolvió cero páginas en un espacio que sí tenía
 * contenido. Las bases de conocimiento de Service Management no siempre
 * aparecen por esa vía, y no hay forma de saberlo de antemano — así que se
 * prueban las tres y se dice cuál funcionó.
 */
function confListarPaginas(espacio) {
  const cfg = confConfig_();
  const clave = espacio || cfg.space;
  if (!clave) throw new Error(
    "No sé de qué espacio listar. Pon la clave en la propiedad " + CONF.PROP_SPACE +
    " o pásala como argumento: confListarPaginas(\"C4B1\").");

  // Orden probado en este sitio: la v2 es la única que lo ve todo, la v1 sirve de
  // respaldo, y la búsqueda CQL va al final porque acá responde 403.
  const rutas = [
    ["API v2",        () => confPaginasV2_(clave)],
    ["listado v1",    () => confPaginasV1_(clave)],
    ["búsqueda CQL",  () => confPaginasCql_(clave)],
  ];

  let out = [], usada = "", problemas = [], estadoEspacio = "";
  for (let i = 0; i < rutas.length; i++) {
    try {
      const r = rutas[i][1]();
      if (r.espacioEstado) estadoEspacio = r.espacioEstado;
      if (r.paginas && r.paginas.length) { out = r.paginas; usada = rutas[i][0]; break; }
      problemas.push(rutas[i][0] + ": 0 páginas" + (r.nota ? " (" + r.nota + ")" : ""));
    } catch (e) {
      problemas.push(rutas[i][0] + ": " + e.message.split("\n")[0]);
    }
  }

  if (!out.length) {
    Logger.log("No encontré NINGUNA página en el espacio %s. Lo que respondió cada ruta:", clave);
    problemas.forEach(p => Logger.log("   %s", p));
    Logger.log("");
    Logger.log("→ Corre confDiagnosticoEspacio(\"%s\") para ver qué hay realmente ahí dentro.", clave);
    Logger.log("→ Y confirma la clave con tu enlace: confDesdeEnlace(\"<tu link>\").");
    return [];
  }

  Logger.log("%s documentos en el espacio %s   (vía %s)", out.length, clave, usada);
  if (problemas.length) problemas.forEach(p => Logger.log("   (antes falló → %s)", p));
  Logger.log("");
  out.forEach(p => Logger.log("   %s  v%s  [%s%s]  %s",
    p.id, p.version, p.tipo, p.estado ? "/" + p.estado : "", p.titulo));
  Logger.log("");

  // Esto no es un detalle técnico: el proyecto promete auditar contra el
  // procedimiento VIGENTE. Si la fuente está archivada, hay que decirlo antes de
  // construir nada encima.
  const archivadas = out.filter(p => p.estado === "archived").length;
  if (estadoEspacio === "archived" || archivadas) {
    Logger.log("=================================================================");
    Logger.log("AVISO IMPORTANTE");
    if (estadoEspacio === "archived") Logger.log("  El espacio %s está ARCHIVADO en Confluence.", clave);
    if (archivadas) Logger.log("  %s de %s documentos están archivados.", archivadas, out.length);
    Logger.log("  Un procedimiento archivado puede estar superado por otro vigente.");
    Logger.log("  Antes de auditar contra esto, confirma con el dueño del contenido");
    Logger.log("  si es la referencia operativa actual o si existe un espacio nuevo.");
    Logger.log("=================================================================");
    Logger.log("");
  }

  Logger.log("→ Con estos ids se llena CONF_MAPA.");
  return out;
}

/**
 * Qué hay de verdad en un espacio, mirado por todas las vías disponibles.
 *
 * Se escribió porque un espacio visible devolvió cero páginas y no había forma
 * de saber si el problema era la clave, los permisos, la versión de la API o
 * que el contenido no fueran páginas. Esto responde esa pregunta de una vez, en
 * lugar de ir probando a ciegas.
 */
function confDiagnosticoEspacio(espacio) {
  const cfg = confConfig_();
  const clave = espacio || cfg.space;
  if (!clave) throw new Error("Pásame la clave: confDiagnosticoEspacio(\"C4B1\")");

  Logger.log("=== Diagnóstico del espacio %s ===", clave);

  // 1. ¿Existe y cómo se llama?
  try {
    const e1 = confGet_("/space/" + encodeURIComponent(clave), { expand: "description.plain,homepage" });
    Logger.log("v1 /space: existe — nombre '%s', tipo '%s'", e1.name, e1.type);
    if (e1.homepage) Logger.log("   página de inicio: %s  (id %s)", e1.homepage.title, e1.homepage.id);
  } catch (e) { Logger.log("v1 /space: %s", e.message.split("\n")[0]); }

  try {
    const e2 = confGetV2_("/spaces", { keys: clave, limit: 5 });
    const s = (e2.results || [])[0];
    Logger.log("v2 /spaces: %s", s ? "existe — id " + s.id + ", tipo '" + s.type + "', estado '" + s.status + "'" : "no lo encuentra");
    if (s) {
      // 2. ¿Qué tipos de contenido tiene?
      [["pages", "páginas"], ["blogposts", "entradas de blog"],
       ["folders", "carpetas"], ["databases", "bases de datos"],
       ["whiteboards", "pizarras"]].forEach(([ruta, etiqueta]) => {
        try {
          const r = confGetV2_("/spaces/" + s.id + "/" + ruta, { limit: 5 });
          const n = (r.results || []).length;
          Logger.log("   v2 %s: %s%s", etiqueta, n, n === 5 ? "+ (hay más)" : "");
          (r.results || []).slice(0, 3).forEach(x => Logger.log("        %s  %s", x.id, x.title));
        } catch (e) { Logger.log("   v2 %s: %s", etiqueta, e.message.split("\n")[0]); }
      });
    }
  } catch (e) { Logger.log("v2 /spaces: %s", e.message.split("\n")[0]); }

  // 3. Las tres rutas de listado
  [["búsqueda CQL", () => confPaginasCql_(clave)],
   ["listado v1 (page)", () => confPaginasV1_(clave, "page")],
   ["listado v1 (blogpost)", () => confPaginasV1_(clave, "blogpost")]].forEach(([nombre, fn]) => {
    try { Logger.log("%s: %s resultados", nombre, fn().paginas.length); }
    catch (e) { Logger.log("%s: %s", nombre, e.message.split("\n")[0]); }
  });

  // 4. Búsqueda global, para saber si el contenido está en OTRO espacio
  try {
    const g = confGet_("/content/search", { cql: "type=page order by lastmodified desc", limit: 10, expand: "space" });
    const res = g.results || [];
    Logger.log("");
    Logger.log("Páginas visibles en TODO el sitio: %s (muestra de las últimas modificadas)", res.length);
    res.forEach(p => Logger.log("   [%s] %s", (p.space && p.space.key) || "?", p.title));
    if (res.length) Logger.log("→ Si acá ves tus procedimientos, la clave del espacio correcta es la del corchete.");
  } catch (e) { Logger.log("búsqueda global: %s", e.message.split("\n")[0]); }

  return true;
}

// ============================================================
//  Sincronización a la hoja
// ============================================================

/** Igual que confListarPaginas pero sin escribir 2.600 líneas en el registro. */
function confListarPaginasSilencioso_(espacio) {
  const clave = espacio || confConfig_().space;
  const rutas = [() => confPaginasV2_(clave), () => confPaginasV1_(clave), () => confPaginasCql_(clave)];
  for (let i = 0; i < rutas.length; i++) {
    try { const r = rutas[i](); if (r.paginas && r.paginas.length) return r.paginas; }
    catch (e) { /* siguiente ruta */ }
  }
  return [];
}

/**
 * Explora una rama del árbol: una página y sus descendientes.
 *
 * Con 2.607 documentos en el espacio, listar todo no ayuda a decidir nada. Esto
 * permite mirar sólo lo que cuelga de, por ejemplo, "B2B - Procedimientos" y ver
 * si esa rama es la que corresponde a la audiencia auditada.
 *
 * Uso: confRama("168887053")
 */
function confRama(raiz, profundidad) {
  const base = confConfig_().base;
  const tope = profundidad === undefined ? 3 : profundidad;
  const out = [];

  const bajar = (id, nivel, sangria) => {
    if (nivel > tope) return;
    let r;
    try { r = confGetV2_("/pages/" + encodeURIComponent(id) + "/children", { limit: 250 }); }
    catch (e) { return; }
    (r.results || []).forEach(h => {
      const p = confPagina_(h, base);
      p.nivel = nivel;
      out.push(p);
      Logger.log("%s%s  %s", sangria, p.id, p.titulo);
      bajar(p.id, nivel + 1, sangria + "   ");
    });
  };

  try {
    const raizP = confGetV2_("/pages/" + encodeURIComponent(raiz), {});
    Logger.log("=== %s  %s ===", raiz, raizP.title || "(sin título)");
  } catch (e) { Logger.log("=== %s ===", raiz); }

  bajar(raiz, 1, "   ");
  Logger.log("");
  Logger.log("%s descendientes hasta %s niveles.", out.length, tope);
  Logger.log("→ Para sincronizar la rama entera: confSincronizar([lista de ids]).");
  return out;
}

/** Los ids que el sistema va a usar de verdad: los del mapa más los fijos. */
function confIdsReferenciados_() {
  return confTodosLosIds_();
}

/**
 * Baja el texto de las páginas SELECCIONADAS a la hoja "Procedimientos".
 *
 * Sin argumentos sincroniza exactamente las páginas que CONF_MAPA y CONF_SIEMPRE
 * referencian. Eso es deliberado: el espacio tiene miles de documentos y bajarlos
 * todos serían miles de llamadas HTTP que no caben en los 6 minutos de Apps
 * Script — y la mayoría no aplica a esta auditoría.
 *
 * Es ACUMULATIVA y REANUDABLE: no borra lo ya sincronizado, salta las páginas que
 * ya están en la misma versión, y si se acerca al límite de tiempo se detiene
 * ordenadamente diciendo cuántas faltan. Correrla otra vez continúa donde quedó.
 *
 * Se guarda la versión y la fecha de cada página: es lo que permite decir
 * "esta auditoría se juzgó contra la v7 del procedimiento" y rehacerla si cambió.
 */
function confSincronizar(ids) {
  const arranque = new Date().getTime();
  const LIMITE_MS = 4.5 * 60 * 1000;          // margen sobre los 6 minutos

  const pedidos = (ids && ids.length ? ids.map(String) : confIdsReferenciados_());
  if (!pedidos.length) {
    Logger.log("No hay nada que sincronizar: CONF_MAPA y CONF_SIEMPRE están vacíos.");
    Logger.log("→ Llénalos con los ids de confListarPaginas(), o pasa una lista: confSincronizar([\"155228701\"]).");
    return { pedidas: 0 };
  }

  const ss = histGetSpreadsheet_(true);
  let sh = ss.getSheetByName(CONF.HOJA);
  const headers = ["Id", "Titulo", "Version", "Actualizado", "URL", "Caracteres", "Texto"];
  if (!sh) {
    sh = ss.insertSheet(CONF.HOJA);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#5b2ee5").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  }

  const yaEsta = confLeerHoja_();             // id -> {version, ...}
  const filaDe = {};                          // id -> nº de fila, para actualizar en sitio
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach((r, i) => { const id = String(r[0] || "").trim(); if (id) filaDe[id] = i + 2; });
  }

  // Metadatos (título y versión) de una sola pasada, para saber qué cambió
  const meta = {};
  confListarPaginasSilencioso_().forEach(p => { meta[p.id] = p; });

  let nuevas = 0, actualizadas = 0, saltadas = 0, fallidas = 0, sinMeta = 0;
  const pendientes = [];

  for (let i = 0; i < pedidos.length; i++) {
    const id = pedidos[i];

    if (new Date().getTime() - arranque > LIMITE_MS) {
      pendientes.push.apply(pendientes, pedidos.slice(i));
      break;
    }

    const m = meta[id];
    if (!m) { sinMeta++; continue; }           // id que ya no existe en el espacio

    const previo = yaEsta[id];
    if (previo && String(previo.version) === String(m.version) && previo.texto) { saltadas++; continue; }

    let texto = "";
    try { texto = confTextoDePagina_(id); }
    catch (e) { fallidas++; texto = "(no se pudo leer: " + e.message + ")"; }
    const recortado = texto.length > CONF.MAX_CHARS
      ? texto.slice(0, CONF.MAX_CHARS) + "\n[...TRUNCADO...]" : texto;
    const fila = [id, m.titulo, m.version, m.actualizado, m.url, texto.length, recortado];

    if (filaDe[id]) { sh.getRange(filaDe[id], 1, 1, headers.length).setValues([fila]); actualizadas++; }
    else            { sh.appendRow(fila); filaDe[id] = sh.getLastRow(); nuevas++; }
  }
  SpreadsheetApp.flush();

  Logger.log("Procedimientos — pedidos: %s | nuevos: %s | actualizados: %s | sin cambios: %s",
             pedidos.length, nuevas, actualizadas, saltadas);
  if (fallidas) Logger.log("AVISO: %s páginas no se pudieron leer.", fallidas);
  if (sinMeta)  Logger.log("AVISO: %s ids del mapa ya no existen en el espacio. Corre confEstado() para verlos.", sinMeta);
  if (pendientes.length) {
    Logger.log("Me detuve cerca del límite de tiempo. Quedan %s páginas.", pendientes.length);
    Logger.log("→ Vuelve a correr confSincronizar(): continúa donde quedó, no repite lo hecho.");
  } else {
    Logger.log("→ Listo. Prueba con confQueLeToca(\"<ticket>\") qué procedimiento se adjuntaría.");
  }
  return { pedidas: pedidos.length, nuevas: nuevas, actualizadas: actualizadas,
           saltadas: saltadas, fallidas: fallidas, sinMeta: sinMeta, pendientes: pendientes.length };
}

/**
 * El cuerpo de una página en texto plano.
 *
 * Confluence guarda el cuerpo en formatos distintos segun con que editor se
 * creo la pagina. Las del editor clasico traen "storage" (un HTML propio); las
 * del editor nuevo traen "atlas_doc_format" (un JSON) y devuelven storage VACIO.
 *
 * Eso fue exactamente lo que paso con la rama del Manual de Quality: la
 * sincronizacion dijo "11 nuevos" y las once quedaron con cero caracteres,
 * porque solo se pedia storage. Pedir un solo formato es apostar a que la
 * pagina se creo con el editor que uno supone.
 *
 * Asi que se prueban todas las vias y se devuelve la primera que traiga texto.
 */
const CONF_VIAS_CUERPO = [
  ["v2 storage",    id => { const r = confGetV2_("/pages/" + id, { "body-format": "storage" });
                            return confHtmlATexto_((r.body && r.body.storage && r.body.storage.value) || ""); }],
  ["v2 atlas_doc",  id => { const r = confGetV2_("/pages/" + id, { "body-format": "atlas_doc_format" });
                            const b = r.body && r.body.atlas_doc_format;
                            return confAdfATexto_(b && b.value); }],
  ["v2 view",       id => { const r = confGetV2_("/pages/" + id, { "body-format": "view" });
                            return confHtmlATexto_((r.body && r.body.view && r.body.view.value) || ""); }],
  ["v1 storage",    id => { const r = confGet_("/content/" + id, { expand: "body.storage" });
                            return confHtmlATexto_((r.body && r.body.storage && r.body.storage.value) || ""); }],
  ["v1 view",       id => { const r = confGet_("/content/" + id, { expand: "body.view" });
                            return confHtmlATexto_((r.body && r.body.view && r.body.view.value) || ""); }],
];

function confTextoDePagina_(id) {
  const clave = encodeURIComponent(id);
  for (let i = 0; i < CONF_VIAS_CUERPO.length; i++) {
    try {
      const t = CONF_VIAS_CUERPO[i][1](clave);
      if (t && t.trim()) return t;
    } catch (e) { /* formato no soportado en este sitio: siguiente */ }
  }
  return "";
}

/**
 * Atlas Document Format (el JSON del editor nuevo) a texto plano.
 *
 * No es un renderizador: lo que hace falta es que el agente pueda LEER el
 * procedimiento y citar una frase. Se recorre el arbol juntando los nodos de
 * texto y respetando lo que da estructura — parrafos, titulos, items de lista y
 * celdas de tabla— para que una tabla no se lea como una frase corrida.
 */
function confAdfATexto_(doc) {
  let raiz = doc;
  if (typeof raiz === "string") {
    try { raiz = JSON.parse(raiz); } catch (e) { return ""; }
  }
  if (!raiz || typeof raiz !== "object") return "";

  // El salto de linea de un parrafo sobra cuando el parrafo es el contenido de
  // una vineta o de una celda: ahi el separador ya lo puso el padre. Sin esta
  // distincion una tabla sale como "Canal |\nPlazo" en vez de "Canal | Plazo".
  const DENTRO = { listItem: true, tableCell: true, tableHeader: true };

  const partes = [];
  const recorrer = (nodo, padre) => {
    if (!nodo || typeof nodo !== "object") return;
    if (Object.prototype.toString.call(nodo) === "[object Array]") {
      nodo.forEach(x => recorrer(x, padre));
      return;
    }

    switch (nodo.type) {
      case "text":        partes.push(nodo.text || ""); return;
      case "hardBreak":   partes.push("\n"); return;
      case "listItem":    partes.push("\n  - "); break;
      case "tableRow":    partes.push("\n"); break;
      case "tableCell":
      case "tableHeader": partes.push(" | "); break;
      case "paragraph":
      case "heading":
      case "blockquote":
      case "codeBlock":   if (!DENTRO[padre]) partes.push("\n"); break;
      default: break;
    }
    if (nodo.attrs && typeof nodo.attrs.text === "string") partes.push(nodo.attrs.text);
    if (nodo.content) recorrer(nodo.content, nodo.type);
  };
  recorrer(raiz.content || raiz, "");

  return partes.join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Que devuelve cada formato para una pagina concreta.
 *
 * Cuando una pagina vuelve vacia hay que saber si es que no tiene texto o que
 * se esta pidiendo el formato equivocado. Esto lo responde sin adivinar.
 */
function confDiagnosticoPagina(id) {
  const clave = encodeURIComponent(id);
  Logger.log("=== Formatos disponibles para la pagina %s ===", id);
  let ganador = "";
  CONF_VIAS_CUERPO.forEach(via => {
    try {
      const t = via[1](clave);
      const n = t ? t.trim().length : 0;
      Logger.log("   %s: %s caracteres%s", via[0], n, n && !ganador ? "   <-- se usa esta" : "");
      if (n && !ganador) ganador = via[0];
    } catch (e) {
      Logger.log("   %s: %s", via[0], e.message.split("\n")[0]);
    }
  });
  if (!ganador) {
    Logger.log("");
    Logger.log("Ninguna via devuelve texto. Puede que la pagina solo tenga tablas de macros,");
    Logger.log("adjuntos o contenido embebido, o que el contenido este en sus paginas hijas.");
    Logger.log("Comprueba con confRama(\"" + id + "\") si cuelga algo debajo.");
  }
  return ganador;
}

/**
 * Storage format de Confluence a texto legible.
 *
 * No es un parser de HTML y no pretende serlo: lo que se necesita es que el
 * agente pueda LEER el procedimiento y citar una frase. Así que se conservan los
 * saltos que dan estructura —párrafos, filas de tabla, ítems de lista— y se tira
 * el resto del marcado.
 */
function confHtmlATexto_(html) {
  let t = String(html || "");

  // Bloques de macro que no son prosa (código, adjuntos) estorban más que ayudan
  t = t.replace(/<ac:structured-macro[^>]*ac:name="(code|attachments|toc)"[\s\S]*?<\/ac:structured-macro>/gi, " ");

  t = t
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|li|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  - ")
    // Las celdas se separan con " | ": si se colapsan a un espacio, una fila como
    // "Cargo   5 días" se lee como una frase y el agente no distingue las columnas.
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ");            // todo el marcado restante

  // Entidades más comunes
  t = t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
       .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
       .replace(/&[a-z]+;/gi, " ");

  return t
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================
//  Selección: qué procedimiento aplica a este ticket
// ============================================================

/** Igual que audEtiqueta_ pero acá para no depender del orden de carga. */
function confClave_(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/** Lo sincronizado, indexado por id. */
function confLeerHoja_() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(CONF.HOJA);
  const mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;

  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = vals[0].map(x => String(x || "").trim());
  const c = n => h.indexOf(n);
  vals.slice(1).forEach(r => {
    const id = String(r[c("Id")] || "").trim();
    if (!id) return;
    mapa[id] = {
      id: id,
      titulo: String(r[c("Titulo")] || ""),
      version: String(r[c("Version")] || ""),
      actualizado: String(r[c("Actualizado")] || ""),
      url: String(r[c("URL")] || ""),
      texto: String(r[c("Texto")] || ""),
    };
  });
  return mapa;
}

/**
 * Procedimientos que aplican a un ticket, según su motivo y sus output tags.
 * Devuelve [] si no hay mapa o no calza ninguno — y eso está bien: significa que
 * los criterios de proceso siguen yendo a no_concluyente, como hasta ahora.
 */
function confProcedimientosDe_(t, hoja) {
  const disponibles = hoja || confLeerHoja_();
  if (!Object.keys(disponibles).length) return [];

  const claves = [];
  if (t && t.contactReason) claves.push(confClave_(t.contactReason));
  (t && t.outputTags || []).forEach(x => claves.push(confClave_(x)));

  const audiencia = (t && t.audiencia) || "";
  const mapa = confMapaDe_(audiencia);

  const ids = {};
  confSiempreDe_(audiencia).forEach(id => { ids[String(id)] = true; });
  Object.keys(mapa).forEach(k => {
    const kk = confClave_(k);
    if (claves.some(c => c && (c === kk || c.indexOf(kk) >= 0 || kk.indexOf(c) >= 0))) {
      (mapa[k] || []).forEach(id => { ids[String(id)] = true; });
    }
  });

  return Object.keys(ids).map(id => disponibles[id]).filter(Boolean);
}

/**
 * El bloque de procedimiento para el prompt. Vacío si no hay nada que adjuntar,
 * y en ese caso el prompt no cambia en absoluto respecto de hoy.
 */
function confBloquePrompt_(t) {
  const procs = confProcedimientosDe_(t);
  if (!procs.length) return "";

  const L = [];
  L.push("=== PROCEDIMIENTO VIGENTE ===");
  L.push("Esto es el procedimiento oficial que aplica a este caso, tal como esta");
  L.push("publicado hoy. Los criterios de proceso se juzgan CONTRA ESTE TEXTO y no");
  L.push("contra tu expectativa de como deberia hacerse.");
  L.push("");
  L.push("Tres reglas al usarlo:");
  L.push("1. Para afirmar que el agente se aparto del procedimiento, CITA la linea del");
  L.push("   procedimiento que incumplio. Sin esa cita el veredicto es no_concluyente.");
  L.push("2. Si el procedimiento NO cubre la situacion, no hay incumplimiento: el");
  L.push("   agente no puede saltarse una regla que no existe. Dilo como hallazgo.");
  L.push("3. Si el procedimiento y la conversacion se contradicen en un dato del");
  L.push("   sistema, manda el dato del sistema. El procedimiento dice que hacer, no");
  L.push("   que paso.");
  L.push("");

  // Presupuesto de caracteres. Sin esto, tres procedimientos largos multiplican
  // el tamaño del prompt y sepultan la conversación, que es la evidencia. Los
  // procedimientos son contexto: si no caben, mejor decirlo que empujar el resto
  // fuera de la vista del modelo.
  let usado = 0;
  const omitidos = [];
  procs.forEach(p => {
    const cabecera = "--- " + p.titulo + "  (v" + p.version + ", actualizado " + p.actualizado + ") ---";
    if (usado + p.texto.length > CONF.MAX_PROMPT) { omitidos.push(p.titulo); return; }
    L.push(cabecera);
    L.push(p.texto);
    L.push("");
    usado += p.texto.length;
  });

  if (!usado) return "";                        // no cupo nada: mejor sin bloque
  if (omitidos.length) {
    L.push("(No caben aca, por espacio: " + omitidos.join("; ") + ". Su ausencia NO");
    L.push(" es evidencia de nada: si el caso depende de uno de ellos, di no_concluyente.)");
    L.push("");
  }
  return L.join("\n");
}

/** Qué procedimiento se le adjuntaría a un ticket, sin auditarlo. Para depurar. */
function confQueLeToca(ticket) {
  const t = (typeof audTicketsDeConversaciones_ === "function")
    ? audTicketsDeConversaciones_().filter(x => x.ticket === zdClaveTicket_(ticket))[0]
    : null;
  if (!t) { Logger.log("No encuentro el ticket %s en Conversaciones.", ticket); return null; }

  const procs = confProcedimientosDe_(t);
  Logger.log("Ticket %s — motivo: %s | tags: %s",
             t.ticket, t.contactReason || "(sin motivo)", (t.outputTags || []).join(" > ") || "(sin tags)");
  if (!procs.length) {
    Logger.log("No aplica ningún procedimiento. Revisa CONF_MAPA: %s claves definidas.",
               Object.keys(CONF_MAPA).length);
    return [];
  }
  procs.forEach(p => Logger.log("   %s  v%s  (%s caracteres)", p.titulo, p.version, p.texto.length));
  return procs;
}

/**
 * Vuelca el texto de una página en el registro, en trozos legibles.
 *
 * Existe para poder LEER un procedimiento antes de decidir qué regla escribir
 * encima. El registro de Apps Script corta las entradas largas, así que se parte
 * en bloques en vez de mandar todo de una.
 *
 * Uso: confLeerPagina("229736494")
 */
function confLeerPagina(id, tam) {
  const trozo = tam || 4000;
  let meta = null;
  try { meta = confGetV2_("/pages/" + encodeURIComponent(id), {}); } catch (e) {}

  const texto = confTextoDePagina_(id);
  Logger.log("=== %s — %s ===", id, (meta && meta.title) || "(sin título)");
  Logger.log("%s caracteres", texto.length);
  Logger.log("");
  if (!texto.trim()) { Logger.log("(la página no tiene texto legible: puede ser solo tablas o adjuntos)"); return ""; }

  for (let i = 0; i < texto.length; i += trozo) {
    Logger.log("--- %s de %s ---", Math.floor(i / trozo) + 1, Math.ceil(texto.length / trozo));
    Logger.log(texto.slice(i, i + trozo));
  }
  return texto;
}

/** Diagnóstico de la sincronización: qué hay en la hoja y qué falta mapear. */
function confEstado() {
  const hoja = confLeerHoja_();
  const ids = Object.keys(hoja);
  Logger.log("Páginas sincronizadas en la hoja %s: %s", CONF.HOJA, ids.length);

  const audiencias = (typeof audAudiencias_ === "function")
    ? audAudiencias_() : [(typeof AUD_AUDIENCIA_DEFECTO !== "undefined" ? AUD_AUDIENCIA_DEFECTO : "b2b")];
  audiencias.forEach(a => {
    const m = confMapaDe_(a), f = confSiempreDe_(a);
    Logger.log("  %s → %s claves en el mapa, %s páginas fijas", a, Object.keys(m).length, f.length);
  });

  const referidos = {};
  confTodosLosIds_().forEach(id => { referidos[String(id)] = true; });

  const huerfanos = Object.keys(referidos).filter(id => !hoja[id]);
  if (huerfanos.length)
    Logger.log("AVISO: %s ids del mapa no están en la hoja (¿se borró la página o cambió el id?): %s",
               huerfanos.length, huerfanos.join(", "));

  const sinUsar = ids.filter(id => !referidos[id]);
  if (sinUsar.length)
    Logger.log("%s páginas sincronizadas que ningún motivo usa todavía.", sinUsar.length);

  // Tamaños: sin esto no se sabe si lo fijo ya se come el presupuesto del prompt
  // y deja fuera justo el procedimiento específico del caso.
  audiencias.forEach(a => {
    const fijas = confSiempreDe_(a).map(id => hoja[String(id)]).filter(Boolean);
    if (!fijas.length) return;
    const pesoFijas = fijas.reduce((n, p) => n + p.texto.length, 0);
    Logger.log("");
    Logger.log("[%s] páginas fijas (van en TODOS sus prompts): %s caracteres de %s de presupuesto",
               a, pesoFijas, CONF.MAX_PROMPT);
    fijas.forEach(p => Logger.log("   %s  %s  (%s car.)", p.id, p.titulo, p.texto.length));
    if (pesoFijas > CONF.MAX_PROMPT * 0.6)
      Logger.log("   AVISO: lo fijo ocupa mas del 60%% del presupuesto y va a desplazar al " +
                 "procedimiento especifico del caso. Conviene recortar las paginas fijas.");
  });

  if (!ids.length) Logger.log("→ Empieza por confDiagnostico() y confSincronizar().");
  else if (!Object.keys(CONF_MAPA).length) Logger.log("→ Falta llenar CONF_MAPA. Sin eso, ningún prompt lleva procedimiento.");
  return { sincronizadas: ids.length, mapeadas: Object.keys(referidos).length,
           huerfanos: huerfanos, sinUsar: sinUsar.length };
}
