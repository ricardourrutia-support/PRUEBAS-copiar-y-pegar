/**
 * ============================================================
 *  Marketplace.gs — Cliente del agente de marketplace por API
 * ============================================================
 *  Cuarto archivo del proyecto. Llama al agente de marketplace
 *  a través de su API compatible con OpenAI, de modo que la
 *  auditoría deja de necesitar copiar y pegar.
 *
 *  ANTES DE USAR
 *  1. En el agente de marketplace: Configuración ▸ Data & Privacy ▸
 *     Agent API Keys ▸ Create API Key. Copia la clave.
 *  2. En Apps Script: Configuración del proyecto ▸ Propiedades del
 *     script ▸ Agregar propiedad
 *        nombre: MARKETPLACE_API_KEY
 *        valor:  la clave
 *     Así la clave NO queda escrita en el código ni aparece en los
 *     registros de ejecución, y no viaja si compartes el proyecto.
 *  3. Ajusta MK.BASE_URL abajo con la URL que indique la ayuda del
 *     diálogo de API keys, y ejecuta mkDiagnostico().
 *
 *  ORDEN DE PRUEBAS
 *     mkDiagnostico()   -> ¿llega? ¿autentica? ¿qué modelos hay?
 *     mkPrueba()        -> una pregunta trivial de ida y vuelta
 *     audAuditarTicket("74460137")  -> un ticket de punta a punta
 *     audAuditarPendientes(5)       -> los primeros 5 sin auditar
 * ============================================================
 */

const MK = {
  // Descubierto con mkExplorarProfundo(): la ruta responde con errores en
  // formato OpenAI y acepta la clave sk- como Bearer.
  BASE_URL: "https://marketplace-agent.cabify.tools/api/agents/v1",

  // Id del agente, sacado del cuerpo de POST /api/agents/chat/agents que
  // manda la propia aplicación (campo agent_id). No es un secreto.
  MODEL: "agent_quRWw7osVRJWszqVo9t56",

  // Cómo viaja la clave. mkExplorarProfundo() te dice cuál usar.
  //   "bearer"      -> Authorization: Bearer <clave>   (lo estándar)
  //   "raw"         -> Authorization: <clave>
  //   "x-api-key"   -> X-API-Key: <clave>
  //   "api-key"     -> api-key: <clave>
  //   "x-api-token" -> X-Api-Token: <clave>
  AUTH: "bearer",

  PROP_KEY:    "MARKETPLACE_API_KEY",
  TEMPERATURA: 0,        // determinista: dos corridas iguales deben coincidir
  MAX_TOKENS:  8000,
  TIMEOUT_MS:  300000,   // Apps Script corta a los 6 min de ejecución total
  REINTENTOS:  2,
  ESPERA_MS:   4000,     // entre reintentos y entre tickets
};

// ============================================================
//  CLIENTE
// ============================================================

/** La clave vive en las propiedades del script, nunca en el código. */
function mkClave_() {
  const k = PropertiesService.getScriptProperties().getProperty(MK.PROP_KEY);
  if (!k) throw new Error(
    'Falta la clave. Ve a Configuración del proyecto ▸ Propiedades del script y agrega "' +
    MK.PROP_KEY + '" con la API key del agente de marketplace.');
  return k;
}

/** Guarda la clave. Bórrala del editor después de ejecutarlo una vez. */
function mkGuardarClave(clave) {
  const k = String(clave || "").trim();
  if (!k) throw new Error("Pásame la clave como argumento o cárgala a mano en las propiedades del script.");
  PropertiesService.getScriptProperties().setProperty(MK.PROP_KEY, k);
  Logger.log("Clave guardada en las propiedades del script. Borra el valor de esta función antes de guardar el archivo.");
  return true;
}

/** Arma la cabecera de autenticación según MK.AUTH. */
function mkCabeceras_() {
  const clave = mkClave_();
  const h = { "Accept": "application/json" };
  switch (String(MK.AUTH || "bearer").toLowerCase()) {
    case "raw":         h["Authorization"] = clave;            break;
    case "x-api-key":   h["X-API-Key"]     = clave;            break;
    case "api-key":     h["api-key"]       = clave;            break;
    case "x-api-token": h["X-Api-Token"]   = clave;            break;
    default:            h["Authorization"] = "Bearer " + clave;
  }
  return h;
}

/** Petición cruda al API. Nunca escribe la clave en el log. */
function mkFetch_(ruta, metodo, payload) {
  const url = MK.BASE_URL.replace(/\/+$/, "") + ruta;
  const opciones = {
    method: metodo,
    contentType: "application/json",
    headers: mkCabeceras_(),
    muteHttpExceptions: true,
  };
  if (payload) opciones.payload = JSON.stringify(payload);

  let ultimo = null;
  for (let intento = 0; intento <= MK.REINTENTOS; intento++) {
    let res;
    try {
      res = UrlFetchApp.fetch(url, opciones);
    } catch (e) {
      // Error de red: si el dominio es interno, los servidores de Google
      // pueden no alcanzarlo. Eso no se arregla reintentando.
      throw new Error("No se pudo llegar a " + url + " — " + e.message +
        "\nSi dice DNS o timeout, el dominio probablemente solo es accesible desde la red interna de Cabify " +
        "y este camino no sirve: habría que llamarlo desde el navegador.");
    }

    const codigo = res.getResponseCode();
    const cuerpo = res.getContentText();

    if (codigo >= 200 && codigo < 300) {
      try { return JSON.parse(cuerpo); }
      catch (e) {
        // Respondió 200 pero con HTML: casi siempre es la SPA o una pantalla
        // de login. La ruta existe como página, no como API.
        throw new Error("La ruta " + url + " devolvió " + codigo + " con " +
          (cuerpo.indexOf("<!DOCTYPE") >= 0 || cuerpo.indexOf("<html") >= 0 ? "una página HTML" : "algo que no es JSON") +
          " en vez de JSON. Es la URL equivocada o el API vive en otra ruta." +
          "\nEjecuta mkExplorar() para probar las candidatas." +
          "\nInicio de lo que volvió: " + cuerpo.slice(0, 200).replace(/\s+/g, " "));
      }
    }

    ultimo = "HTTP " + codigo + ": " + mkMensajeError_(cuerpo);
    if (codigo === 403 && /remote access|access_denied/i.test(cuerpo)) {
      // Todo correcto de nuestro lado: el agente existe y la clave vale.
      // Simplemente no tiene habilitado el acceso por API.
      throw new Error(
        "El agente existe y tu clave es válida, pero NO tiene habilitado el acceso remoto (API).\n" +
        ultimo + "\n" +
        "Esto se arregla en la configuración del agente, no en el código. Dos caminos:\n" +
        "  a) crea TU PROPIO agente en la aplicación y actívale el acceso remoto;\n" +
        "     luego pon su agent_id en MK.MODEL\n" +
        "  b) pide al dueño del agente que le habilite el acceso remoto");
    }
    if (codigo === 401 || codigo === 403) throw new Error("Autenticación rechazada. " + ultimo);
    if (codigo === 404) {
      // Un 404 con un error de modelo NO es una ruta mala: es el id del agente.
      if (/model_not_found|Agent not found/i.test(cuerpo))
        throw new Error("La ruta es correcta, el que no existe es el agente. " + ultimo +
          '\nEjecuta mkProbarModelo() o mkDiagnostico() para ver los ids válidos.');
      throw new Error("Ruta no encontrada. Revisa MK.BASE_URL. " + ultimo);
    }
    if (codigo === 429 || codigo >= 500) { Utilities.sleep(MK.ESPERA_MS * (intento + 1)); continue; }
    throw new Error(ultimo);
  }
  throw new Error("El agente no respondió tras " + (MK.REINTENTOS + 1) + " intentos. " + ultimo);
}

/** Saca el mensaje útil de un error, venga en formato OpenAI o suelto. */
function mkMensajeError_(cuerpo) {
  try {
    const j = JSON.parse(cuerpo);
    if (j && j.error && j.error.message) return j.error.message + (j.error.code ? " [" + j.error.code + "]" : "");
    if (j && j.message) return j.message;
  } catch (e) { /* no era JSON */ }
  return String(cuerpo).slice(0, 400);
}

/**
 * Prueba uno o varios ids de agente contra el endpoint real y dice cuál
 * funciona. Sin argumentos prueba los candidatos habituales.
 *
 *   mkProbarModelo()                        -> candidatos por defecto
 *   mkProbarModelo("1db70bef-2a0f-...")     -> uno concreto
 *   mkProbarModelo(["uno","otro"])          -> una lista
 */
function mkProbarModelo(candidatos) {
  let lista = candidatos;
  if (!lista) lista = ["marketplace-agent", "Marketplace Agent", "default", "agent"];
  if (typeof lista === "string") lista = [lista];

  Logger.log("Probando %s id%s contra %s/chat/completions",
    lista.length, lista.length === 1 ? "" : "s", MK.BASE_URL);

  let bueno = null;
  lista.forEach(id => {
    const r = mkSonda_(MK.BASE_URL.replace(/\/+$/, "") + "/chat/completions", "post", mkCabeceras_(),
      { model: id, messages: [{ role: "user", content: "ping" }], stream: false });
    const ok = r.codigo >= 200 && r.codigo < 300;
    Logger.log("  %s | %s | %s", String(r.codigo), id, r.pista.slice(0, 120));
    if (ok && !bueno) bueno = id;
  });

  Logger.log("");
  if (bueno) {
    Logger.log('FUNCIONA: pon  MK.MODEL = "%s"', bueno);
    return bueno;
  }
  Logger.log("Ninguno funcionó. Dónde buscar el id correcto:");
  Logger.log("  - en la app, abre el agente y mira la URL: suele traer su uuid");
  Logger.log("  - el id de la URL de tu chat (/c/<uuid>) es del CHAT, no siempre del agente");
  Logger.log("  - la ayuda (?) del diálogo de API keys normalmente lo dice");
  Logger.log("Cuando tengas uno, pásalo así: mkProbarModelo(\"el-id\")");
  return null;
}

/** Manda un prompt y devuelve el texto de la respuesta. */
function mkPreguntar(prompt) {
  if (!MK.MODEL) throw new Error("Falta MK.MODEL. Ejecuta mkDiagnostico() para ver los nombres disponibles.");

  const json = mkFetch_("/chat/completions", "post", {
    model: MK.MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: MK.TEMPERATURA,
    max_tokens: MK.MAX_TOKENS,
    stream: false,
  });

  const texto = json && json.choices && json.choices[0] &&
                json.choices[0].message && json.choices[0].message.content;
  if (!texto) throw new Error("El agente respondió sin contenido: " + JSON.stringify(json).slice(0, 400));
  return texto;
}

// ============================================================
//  DIAGNÓSTICO — ejecutar esto PRIMERO
// ============================================================
function mkDiagnostico() {
  Logger.log("Base: %s", MK.BASE_URL);
  Logger.log("Clave configurada: %s", PropertiesService.getScriptProperties().getProperty(MK.PROP_KEY) ? "sí" : "NO");

  let modelos;
  try {
    modelos = mkFetch_("/models", "get", null);
  } catch (e) {
    Logger.log("FALLÓ al listar modelos: %s", e.message);
    Logger.log("");
    Logger.log("Ejecuta mkExplorar(): prueba todas las rutas candidatas de una y");
    Logger.log("te dice cuál responde JSON.");
    return null;
  }

  // La lista puede venir bajo distintas llaves segun la implementacion
  let lista = [];
  ["data", "agents", "models", "items", "results"].forEach(k => {
    if (!lista.length && modelos && modelos[k] && modelos[k].length) lista = modelos[k];
  });
  if (!lista.length && Object.prototype.toString.call(modelos) === "[object Array]") lista = modelos;

  Logger.log("Conectado (200): la clave FUE ACEPTADA en esta ruta.");
  Logger.log("Agentes listados: %s", lista.length);
  lista.forEach(m => Logger.log("   %s   %s",
    (m && (m.id || m.model || m.slug)) || JSON.stringify(m), (m && (m.name || m.title)) || ""));

  if (!lista.length) {
    Logger.log("");
    Logger.log("Respondió sin lista. Esto es lo que devolvió, tal cual:");
    Logger.log("   %s", JSON.stringify(modelos).slice(0, 800));
    Logger.log("");
    Logger.log("Puede ser que la clave no tenga agentes asignados, o que la lista");
    Logger.log("viva en otra ruta. Dos caminos, por orden de rapidez:");
    Logger.log("  1) En la app, el botón 'Copiar código' de la conversación: ese snippet");
    Logger.log("     trae la URL, el id del agente y la cabecera exactos. Es lo más directo.");
    Logger.log("  2) mkBuscarAgentes() prueba otras rutas de listado.");
    Logger.log("  3) mkProbarModelo(\"<id>\") si ya tienes un candidato.");
    return [];
  }
  if (!MK.MODEL) Logger.log('Copia uno de esos ids en MK.MODEL. Sugerido: "%s"', lista[0].id);
  return lista.map(m => m.id);
}

/**
 * Prueba las rutas candidatas y dice qué devuelve cada una.
 * Sirve para encontrar la base correcta sin ir adivinando de a una.
 * Nunca imprime la clave.
 */
function mkExplorar() {
  const host = MK.BASE_URL.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
  const candidatas = [
    "/v1/models", "/api/v1/models", "/openai/v1/models", "/v1/openai/models",
    "/api/models", "/models", "/api/v1/chat/completions", "/v1/chat/completions",
  ];

  Logger.log("Host: %s", host);
  Logger.log("Probando %s rutas. GET, sin seguir redirecciones.", candidatas.length);
  Logger.log("codigo | tipo | ruta | que volvio");

  const hallazgos = [];
  candidatas.forEach(ruta => {
    let res;
    try {
      res = UrlFetchApp.fetch(host + ruta, {
        method: "get",
        headers: mkCabeceras_(),
        muteHttpExceptions: true,
        followRedirects: false,
      });
    } catch (e) {
      Logger.log("  ERR  | ---- | %s | %s", ruta, e.message.slice(0, 80));
      return;
    }

    const codigo = res.getResponseCode();
    const cuerpo = res.getContentText();
    const heads  = res.getAllHeaders() || {};
    const ctype  = String(heads["Content-Type"] || heads["content-type"] || "?").split(";")[0];

    let tipo = "otro", pista = cuerpo.slice(0, 90).replace(/\s+/g, " ");
    if (codigo >= 300 && codigo < 400) {
      tipo = "redir";
      pista = "-> " + (heads["Location"] || heads["location"] || "(sin Location)");
    } else if (cuerpo.indexOf("<!DOCTYPE") >= 0 || cuerpo.indexOf("<html") >= 0) {
      tipo = "HTML";
      pista = "pagina web, no API";
    } else {
      try {
        JSON.parse(cuerpo);
        tipo = "JSON";
        // Solo un 2xx cuenta como ruta buena. Un 404 con cuerpo JSON igual
        // es informativo (significa que ahí SÍ hay un API respondiendo),
        // pero no es la base que buscamos.
        if (codigo >= 200 && codigo < 300) hallazgos.push({ ruta: ruta, codigo: codigo, cuerpo: cuerpo });
      } catch (e) { /* se queda en otro */ }
    }
    Logger.log("  %s | %s | %s | %s", codigo, tipo, ruta, pista);
    Logger.log("        content-type: %s", ctype);
  });

  Logger.log("");
  if (!hallazgos.length) {
    Logger.log("Ninguna ruta respondió JSON con código 2xx.");
    Logger.log("Si arriba ves 404 con cuerpo JSON, hay un API vivo ahí pero con otra ruta:");
    Logger.log("ese 404 es buena señal, solo falta el path exacto.");
    Logger.log("Abre la ayuda (?) del diálogo de Agent API Keys: normalmente trae la URL base");
    Logger.log("y un ejemplo de curl. Pásame ese ejemplo y ajusto el cliente.");
    Logger.log("Si todo salió redir a un login, el API pide otra forma de autenticación.");
    return [];
  }

  Logger.log("RUTAS QUE RESPONDEN JSON:");
  hallazgos.forEach(h => {
    Logger.log("  %s (HTTP %s)", h.ruta, h.codigo);
    Logger.log("     %s", h.cuerpo.slice(0, 300).replace(/\s+/g, " "));
    const base = h.ruta.replace(/\/(models|chat\/completions)$/, "");
    Logger.log("     => prueba MK.BASE_URL = \"%s%s\"", host, base);
  });
  return hallazgos.map(h => h.ruta);
}

/**
 * Segunda vuelta, cuando ya sabemos que el API vive bajo /api pero rechaza
 * la clave. Hace dos cosas en orden:
 *
 *   FASE 1 — sobre una ruta que SABEMOS que existe (devolvió 401, no 404),
 *   prueba distintas formas de mandar la clave. Aísla el problema de
 *   autenticación de el de la ruta.
 *
 *   FASE 2 — con la forma que funcione, busca la ruta del chat.
 *
 * Nunca imprime la clave: solo su largo y su forma.
 */
function mkExplorarProfundo() {
  const host  = MK.BASE_URL.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
  const clave = mkClave_();
  const ORACULO = "/api/models";   // la ruta que respondió 401

  // --- Cómo se ve la clave (sin mostrarla) ---
  const partes = clave.split(".").length;
  Logger.log("La clave mide %s caracteres, empieza con \"%s\" y tiene %s parte%s separada%s por punto.",
    clave.length, clave.slice(0, 3), partes, partes === 1 ? "" : "s", partes === 1 ? "" : "s");
  Logger.log(partes === 3
    ? "Tiene forma de JWT (3 partes)."
    : "NO tiene forma de JWT. Si el servidor exige un JWT, esta clave va por otra cabecera.");
  if (/^Bearer /i.test(clave)) Logger.log("OJO: la clave guardada ya empieza con 'Bearer '. Quita esa palabra del valor.");
  if (/^["\'].*["\']$/.test(clave)) Logger.log("OJO: la clave guardada tiene comillas alrededor. Quítalas.");
  Logger.log("");

  // --- FASE 1: formas de autenticar ---
  const formas = [
    { nombre: "sin cabecera",           modo: "-",           headers: {} },
    { nombre: "Authorization: Bearer",  modo: "bearer",      headers: { "Authorization": "Bearer " + clave } },
    { nombre: "Authorization: a secas", modo: "raw",         headers: { "Authorization": clave } },
    { nombre: "X-API-Key",              modo: "x-api-key",   headers: { "X-API-Key": clave } },
    { nombre: "api-key",                modo: "api-key",     headers: { "api-key": clave } },
    { nombre: "X-Api-Token",            modo: "x-api-token", headers: { "X-Api-Token": clave } },
  ];

  Logger.log("FASE 1 — formas de mandar la clave, sobre %s", ORACULO);
  let ganadora = null;
  formas.forEach(f => {
    const r = mkSonda_(host + ORACULO, "get", f.headers);
    f.pista = r.pista;
    Logger.log("  %s | %s | %s", String(r.codigo), f.nombre, r.pista);
    if (!ganadora && r.codigo >= 200 && r.codigo < 300) ganadora = f;
  });

  Logger.log("");
  if (ganadora) {
    Logger.log("AUTENTICA CON: %s", ganadora.nombre);
    Logger.log('  =>  pon  MK.AUTH = "%s"  en la configuración de arriba', ganadora.modo);
  } else {
    Logger.log("Ninguna forma autenticó CONTRA %s.", ORACULO);
    const distintos = {};
    formas.forEach(f => { distintos[f.pista] = true; });
    if (Object.keys(distintos).length > 1) {
      Logger.log("Pero los mensajes NO son todos iguales: la que cambió es la que el");
      Logger.log("servidor lee de verdad. Si solo 'Bearer' dice 'jwt malformed', esa ruta");
      Logger.log("pide un JWT de sesión — es el API interno de la aplicación, no el de agentes.");
      Logger.log("Tu clave sk- pertenece a otra puerta, así que sigo buscándola.");
    }
    ganadora = { nombre: "Authorization: Bearer", modo: "bearer",
                 headers: { "Authorization": "Bearer " + clave } };
  }

  // --- FASE 2: dónde vive el API de agentes ---
  const rutas = [
    "/api/v1/chat/completions",        "/api/chat/completions",
    "/api/agents/chat/completions",    "/api/agents/v1/chat/completions",
    "/api/v1/agents/chat/completions", "/api/agent/chat/completions",
    "/api/openai/chat/completions",    "/api/openai/v1/chat/completions",
    "/api/external/v1/chat/completions","/api/public/v1/chat/completions",
    "/api/v1/completions",             "/api/completions",
    "/api/assistants/chat/completions","/api/v1/responses",
  ];

  Logger.log("");
  Logger.log("FASE 2 — buscando el API de agentes (POST con %s)", ganadora.nombre);
  Logger.log("Cualquier respuesta que NO sea 'Endpoint not found' ni una página web es una pista.");

  const vivas = [], pistas = [];
  rutas.forEach(ruta => {
    const r = mkSonda_(host + ruta, "post", ganadora.headers,
      { model: MK.MODEL || "test", messages: [{ role: "user", content: "ping" }], stream: false });
    const noExiste = /Endpoint not found/i.test(r.pista) || /pagina web/.test(r.pista);
    Logger.log("  %s | %s | %s", String(r.codigo), ruta, r.pista);
    if (r.codigo >= 200 && r.codigo < 300) vivas.push(ruta);
    else if (!noExiste) pistas.push(ruta + "  (" + r.codigo + ": " + r.pista.slice(0, 70) + ")");
  });

  Logger.log("");
  if (vivas.length) {
    const base = host + vivas[0].replace(/\/chat\/completions$/, "").replace(/\/responses$/, "");
    Logger.log("FUNCIONA: %s", vivas.join(", "));
    Logger.log('  =>  pon  MK.BASE_URL = "%s"', base);
    Logger.log('  =>  pon  MK.AUTH = "%s"', ganadora.modo);
    Logger.log("Después: mkDiagnostico() y mkPrueba().");
    return { auth: ganadora.modo, rutas: vivas };
  }

  if (pistas.length) {
    // Si TODAS responden lo mismo, no son 14 rutas distintas: es un muro de
    // autenticación delante de todo. Distinguirlo evita perseguir fantasmas.
    const mensajes = {};
    pistas.forEach(p => { mensajes[p.replace(/^[^(]+\(\d+: /, "")] = true; });

    if (Object.keys(mensajes).length === 1 && pistas.length > 3) {
      Logger.log("Las %s rutas responden EXACTAMENTE lo mismo:", pistas.length);
      Logger.log("   %s", Object.keys(mensajes)[0]);
      Logger.log("Eso no son rutas distintas: es un control de autenticación delante de todo.");
      Logger.log("La clave sk- no está siendo aceptada en ninguna parte de este host.");
      Logger.log("");
      Logger.log("Dos explicaciones posibles:");
      Logger.log("  a) el API de agentes vive en OTRO host (por ejemplo api.marketplace-agent...)");
      Logger.log("  b) la clave hay que canjearla por un token antes de usarla");
      Logger.log("Las dos las resuelve la ayuda (?) del diálogo de Agent API Keys.");
      return { auth: ganadora.modo, rutas: [], muro: Object.keys(mensajes)[0] };
    }

    Logger.log("Ninguna respondió OK, pero estas rutas EXISTEN (no dieron 'Endpoint not found'):");
    pistas.forEach(p => Logger.log("   %s", p));
    Logger.log("Si el error habla de modelo o de agente, la ruta es correcta y solo falta MK.MODEL:");
    Logger.log("prueba con el id del agente que aparece en la URL del chat.");
    return { auth: ganadora.modo, rutas: [], pistas: pistas };
  }

  Logger.log("Ninguna ruta de agentes respondió.");
  Logger.log("Abre la ayuda (?) que está al lado del título 'Agent API Keys': esos");
  Logger.log("diálogos casi siempre traen la URL base y un ejemplo de curl. Con eso lo cierro.");
  return { auth: ganadora.modo, rutas: [] };
}


/** Una sonda: devuelve código y un resumen corto de lo que volvió. */
function mkSonda_(url, metodo, headers, payload) {
  const op = {
    method: metodo,
    headers: headers || {},
    muteHttpExceptions: true,
    followRedirects: false,
  };
  if (payload) { op.contentType = "application/json"; op.payload = JSON.stringify(payload); }

  let res;
  try { res = UrlFetchApp.fetch(url, op); }
  catch (e) { return { codigo: "ERR", pista: e.message.slice(0, 80) }; }

  const codigo = res.getResponseCode();
  const cuerpo = res.getContentText();
  const h = res.getAllHeaders() || {};

  if (codigo >= 300 && codigo < 400)
    return { codigo: codigo, pista: "-> " + (h["Location"] || h["location"] || "(sin Location)") };
  if (cuerpo.indexOf("<!DOCTYPE") >= 0 || cuerpo.indexOf("<html") >= 0)
    return { codigo: codigo, pista: "pagina web (ruta inexistente para el API)" };
  return { codigo: codigo, pista: cuerpo.slice(0, 160).replace(/\s+/g, " ") };
}

/**
 * Busca la lista de agentes en varias rutas y muestra en crudo lo que
 * devuelve cada una. Cuando /models responde vacío, alguna de estas suele
 * traer los ids.
 */
function mkBuscarAgentes() {
  const host = MK.BASE_URL.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
  const rutas = [
    "/api/agents/v1/models", "/api/agents/v1/agents", "/api/agents/v1",
    "/api/agents", "/api/agents/list", "/api/agents/v1/assistants",
    "/api/agents/v1/models?limit=100",
  ];

  Logger.log("Buscando la lista de agentes. Cabecera: %s", MK.AUTH);
  const conDatos = [];
  rutas.forEach(ruta => {
    const r = mkSonda_(host + ruta, "get", mkCabeceras_());
    const vacio = /^\s*[\[{]\s*("data"\s*:\s*\[\s*\])?\s*[\]}]\s*$/.test(r.pista);
    Logger.log("  %s | %s", String(r.codigo), ruta);
    Logger.log("      %s", r.pista.slice(0, 220));
    if (r.codigo >= 200 && r.codigo < 300 && !vacio && r.pista.length > 15) conDatos.push(ruta);
  });

  Logger.log("");
  if (conDatos.length) {
    Logger.log("Estas devolvieron contenido: %s", conDatos.join(", "));
    Logger.log("Busca ahí el id del agente y ponlo en MK.MODEL.");
  } else {
    Logger.log("Ninguna trajo agentes. El camino corto es el botón 'Copiar código'");
    Logger.log("de la conversación en la app: ese snippet trae el id exacto.");
  }
  return conDatos;
}

/**
 * Última milla: caza el identificador del agente probando todo lo que falta.
 *
 *   A) el id como "model": nombres, slugs y el uuid que le pases
 *   B) el id en la RUTA: /api/agents/v1/<uuid>/chat/completions
 *
 * Agrupa los errores distintos, porque un mensaje que cambia dice más que
 * veinte iguales.
 *
 *   mkCazarAgente()                       -> candidatos por nombre
 *   mkCazarAgente("1db70bef-2a0f-...")    -> además prueba ese uuid
 */
function mkCazarAgente(uuid) {
  const host = MK.BASE_URL.replace(/^(https?:\/\/[^\/]+).*$/, "$1");
  const base = MK.BASE_URL.replace(/\/+$/, "");

  const nombres = ["Marketplace Agent", "marketplace-agent", "marketplace_agent",
                   "marketplaceagent", "MarketplaceAgent", "marketplace",
                   "default", "agent", "assistant"];

  if (uuid) {
    // Varias implementaciones piden el id con prefijo
    nombres.unshift(uuid, "agent_" + uuid, "agent-" + uuid, "agents/" + uuid);
  } else {
    Logger.log("OJO: lo ejecutaste SIN uuid, así que NO se prueba el id de tu chat");
    Logger.log("ni la variante con el id dentro de la ruta, que es la que falta.");
    Logger.log('Usa la función cazar() del final del archivo, o llama así:');
    Logger.log('   mkCazarAgente("1db70bef-2a0f-4eca-83b4-98ef3934f393")');
    Logger.log("");
  }

  Logger.log("A) el id como campo \"model\" — %s candidatos", nombres.length);
  const errores = {};
  let bueno = null;

  nombres.forEach(id => {
    const r = mkSonda_(base + "/chat/completions", "post", mkCabeceras_(),
      { model: id, messages: [{ role: "user", content: "ping" }], stream: false });
    const ok = r.codigo >= 200 && r.codigo < 300;
    Logger.log("   %s | %s", String(r.codigo), id);
    if (ok && !bueno) { bueno = { modo: "model", valor: id }; Logger.log("       ¡RESPONDIÓ! %s", r.pista.slice(0, 120)); }
    else {
      const clave = mkNormalizarError_(r.pista, id);
      errores[clave] = (errores[clave] || 0) + 1;
    }
  });

  if (!bueno && uuid) {
    Logger.log("");
    Logger.log("B) el id en la ruta — /api/agents/v1/<uuid>/chat/completions");
    const rutas = [
      base + "/" + uuid + "/chat/completions",
      host + "/api/agents/" + uuid + "/chat/completions",
      host + "/api/agents/v1/agents/" + uuid + "/chat/completions",
    ];
    rutas.forEach(u => {
      const r = mkSonda_(u, "post", mkCabeceras_(),
        { model: uuid, messages: [{ role: "user", content: "ping" }], stream: false });
      Logger.log("   %s | %s", String(r.codigo), u.replace(host, ""));
      if (r.codigo >= 200 && r.codigo < 300 && !bueno) {
        bueno = { modo: "ruta", valor: u.replace(host, "").replace("/chat/completions", "") };
        Logger.log("       ¡RESPONDIÓ! %s", r.pista.slice(0, 120));
      }
    });
  }

  Logger.log("");
  if (bueno) {
    if (bueno.modo === "model") Logger.log('LISTO: pon  MK.MODEL = "%s"', bueno.valor);
    else Logger.log('LISTO: pon  MK.BASE_URL = "%s%s"', host, bueno.valor);
    return bueno;
  }

  Logger.log("Ningún candidato funcionó. Errores distintos que devolvió:");
  Object.keys(errores).forEach(e => Logger.log("   x%s  %s", errores[e], e));
  Logger.log("");
  if (Object.keys(errores).length === 1 && /not found/i.test(Object.keys(errores)[0])) {
    Logger.log("Todos dan el mismo 'no encontrado': el id existe pero no lo estamos adivinando,");
    Logger.log("o la clave no quedó asociada a ningún agente.");
    Logger.log("");
    Logger.log("Lo que yo haría ahora, en este orden:");
    Logger.log("  1. Borra la API key y créala de nuevo, mirando si al crearla hay algún");
    Logger.log("     paso para elegir el agente. La actual dice 'Never used' y su lista");
    Logger.log("     de agentes vuelve vacía: encaja con una clave sin agente asignado.");
    Logger.log("  2. Pregúntaselo al agente en el chat: 'cuál es tu id de agente para el API'.");
    Logger.log("  3. Escríbele a Cabify Engineering, que aparece al pie de la aplicación.");
    Logger.log("     Con la pregunta concreta te responden en un minuto: qué valor va en");
    Logger.log("     'model' al llamar POST /api/agents/v1/chat/completions.");
  }
  return null;
}

/** Agrupa errores parecidos: reemplaza el id probado por un comodín. */
function mkNormalizarError_(pista, id) {
  return String(pista).split(id).join("<id>").slice(0, 150);
}

/** Ida y vuelta trivial, para confirmar que el agente responde de verdad. */
function mkPrueba() {
  const t = mkPreguntar('Responde exactamente con la palabra: LISTO');
  Logger.log("Respuesta: %s", t.slice(0, 200));
  return t;
}

// ============================================================
//  AUDITORÍA AUTOMÁTICA
// ============================================================

/**
 * Audita UN ticket de punta a punta: arma el prompt, lo manda al agente,
 * parsea la respuesta, calcula la nota y escribe en las hojas.
 * Sin copiar ni pegar nada.
 */
function audAuditarTicket(ticketId) {
  const id = zdClaveTicket_(ticketId);
  const t = audTicketsDeConversaciones_().filter(x => x.ticket === id)[0];
  if (!t) throw new Error('El ticket ' + id + ' no está en la hoja "' + ZD.HOJA_CONVER + '". Corre zdIngestar() primero.');
  // Solo lo que impide LA CONVERSACIÓN bloquea. "PARCIAL (sin viaje asociado)"
  // no es un bloqueo: significa que se audita con menos datos, y en aeropuerto
  // la mitad de los tickets no tienen viaje porque son consultas previas.
  const bloqueo = audBloqueoDeConversacion_(t.auditable);
  if (bloqueo)
    throw new Error("El ticket " + id + " no se puede auditar: " + bloqueo +
                    ". (valor en la hoja: " + t.auditable + ")");

  return audCorrerUno_(t);
}

/**
 * Audita los primeros N tickets auditables que aún no tienen veredicto.
 * Va de a uno: si algo falla, se detiene ahí y lo anterior queda guardado.
 *
 * Apps Script corta a los 6 minutos, así que N alto puede quedar a medias.
 * No pasa nada: los ya guardados no se repiten, vuelve a ejecutarlo.
 */
function audAuditarPendientes(cuantos) {
  const n = cuantos || 5;
  const yaAuditados = audTicketsConVeredicto_();
  const pendientes = audTicketsDeConversaciones_()
    .filter(t => audConversacionAuditable_(t.auditable) && !yaAuditados[t.ticket])
    .slice(0, n);

  if (!pendientes.length) { Logger.log("No hay tickets auditables sin veredicto."); return []; }
  Logger.log("Por auditar: %s tickets — %s", pendientes.length, pendientes.map(t => t.ticket).join(", "));

  const hechos = [], fallidos = [];
  const inicio = new Date().getTime();

  for (let i = 0; i < pendientes.length; i++) {
    // Margen para no morir a mitad de escritura
    if (new Date().getTime() - inicio > 4.5 * 60 * 1000) {
      Logger.log("Corto por tiempo tras %s tickets. Vuelve a ejecutar para seguir con el resto.", hechos.length);
      break;
    }
    try {
      hechos.push(audCorrerUno_(pendientes[i]));
    } catch (e) {
      Logger.log("FALLÓ %s: %s", pendientes[i].ticket, e.message);
      fallidos.push({ ticket: pendientes[i].ticket, error: e.message });
    }
    if (i < pendientes.length - 1) Utilities.sleep(MK.ESPERA_MS);
  }

  Logger.log("Listo: %s auditados, %s fallidos.", hechos.length, fallidos.length);
  hechos.forEach(r => Logger.log("   %s nota=%s techo=%s %s", r.ticket, r.nota, r.techo, r.estado));
  return { hechos: hechos, fallidos: fallidos };
}

/** El ciclo completo para un ticket ya normalizado. */
function audCorrerUno_(t) {
  // El prompt vigente del ticket. Si el guardado quedó de una versión anterior
  // de las reglas, se regenera acá mismo, para este ticket. Antes esto era un
  // error que obligaba a correr zdRefrescarPrompts() a mano: detectaba el
  // problema y le pasaba el trabajo a quien no lo había causado.
  //
  // Lo que NO cambió: se sigue partiendo de la FILA de la hoja, que es la que
  // conserva las señales del hilo y las output tags. Rearmar el prompt desde
  // cero sin eso producía "cierre_del_hilo=desconocido".
  const pv = zdPromptVigenteDe_(t.ticket);
  const prompt = pv.prompt;
  if (!prompt) throw new Error(
    "El ticket " + t.ticket + " no tiene prompt y no se pudo generar: " +
    (pv.motivo || "motivo desconocido") + ".");

  // Si aun después de regenerarlo el sello no coincide, algo va mal de verdad
  // (la fila no da para rearmarlo) y sí hay que parar: auditar con reglas
  // viejas sale más caro que no auditar.
  if (!audPromptAlDia_(prompt)) throw new Error(
    "El prompt del ticket " + t.ticket + " sigue siendo de una versión anterior después de " +
    "intentar regenerarlo (" + (pv.motivo || "sin motivo") + ").\n" +
    "Esperaba el sello [" + AUD_VERSION_REGLAS + "].");

  if (pv.regenerado)
    Logger.log("   (prompt de %s regenerado solo: %s)", t.ticket, pv.motivo);

  Logger.log("→ %s [%s] enviando %s caracteres...", t.ticket, t.canal, prompt.length);
  const respuesta = mkPreguntar(prompt);

  const pegado = audParsearTexto_(respuesta, t.ticket);
  const veredictos = pegado.veredictos[t.ticket];
  if (!veredictos || !veredictos.length)
    throw new Error("La respuesta no traía veredictos para " + t.ticket + ". Empieza así: " + respuesta.slice(0, 300));

  const r = audCalcularNota_(t.canal, veredictos, t.audiencia);
  r.ticket = t.ticket;
  r.canal  = t.canal;

  if (pv.regenerado) r.promptRegenerado = true;
  audEscribirVeredictos_(t.ticket, t.canal, veredictos, r);
  if (pegado.viajes[t.ticket]) { audEscribirViaje_(t.ticket, pegado.viajes[t.ticket]); r.viajeGuardado = true; }
  audEscribirEnHistorico_(t.ticket, r);
  audGuardarRespuestaCruda_(t.ticket, respuesta);

  Logger.log("← %s nota=%s (riesgo %s) techo=%s cobertura=%s%% | %s",
    t.ticket, r.nota, r.notaEnRiesgo, r.techo, r.cobertura, r.estado);
  r.avisos.forEach(a => Logger.log("   AVISO %s: %s", t.ticket, a));
  return r;
}

/**
 * Guarda la respuesta literal del agente. Es la evidencia de qué dijo
 * exactamente, con qué versión del prompt y en qué fecha: sin esto, una
 * nota que alguien discuta en tres meses no se puede reconstruir.
 */
function audGuardarRespuestaCruda_(ticket, texto) {
  const ss = histGetSpreadsheet_(true);
  let sh = ss.getSheetByName("Respuestas");
  const headers = ["Ticket Number", "Fecha", "Modelo", "Version matriz", "Respuesta literal"];
  if (!sh) {
    sh = ss.insertSheet("Respuestas");
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  }
  sh.appendRow([ticket, Utilities.formatDate(new Date(), AUD.TZ, "yyyy-MM-dd HH:mm:ss"),
                MK.MODEL, AUD.VERSION_MATRIZ, zdRecortar_(texto)]);
  sh.getRange(sh.getLastRow(), 1).setNumberFormat("@");
}

// ============================================================
//  ESTABILIDAD — el mismo ticket, varias veces
// ============================================================
/**
 * Audita el mismo ticket N veces y compara los veredictos criterio por
 * criterio. Si el instrumento no es estable, la nota no significa nada,
 * por buena que se vea. Esta prueba NO escribe en las hojas.
 */
function audProbarEstabilidad(ticketId, veces) {
  const id = zdClaveTicket_(ticketId);
  const n = veces || 3;
  const t = audTicketsDeConversaciones_().filter(x => x.ticket === id)[0];
  if (!t) throw new Error("El ticket " + id + " no está en Conversaciones.");

  const prompt = audPromptAuditoria_(t);
  const corridas = [];
  for (let i = 0; i < n; i++) {
    const texto = mkPreguntar(prompt);
    const v = audParsearTexto_(texto, id).veredictos[id] || [];
    const mapa = {};
    v.forEach(x => { mapa[x.id] = x.veredicto; });
    corridas.push(mapa);
    const r = audCalcularNota_(t.canal, v, t.audiencia);
    Logger.log("Corrida %s: nota=%s criticos=%s", i + 1, r.nota, r.criticosIncumplidos.join(",") || "ninguno");
    if (i < n - 1) Utilities.sleep(MK.ESPERA_MS);
  }

  const ids = audCriteriosDeCanal_(t.canal, t.audiencia).map(c => c[AUD_IDX.ID]);
  const inestables = ids.filter(cid => {
    const vals = corridas.map(c => c[cid] || "(falta)");
    return vals.some(v => v !== vals[0]);
  });

  Logger.log("— Estabilidad de %s en %s corridas —", id, n);
  Logger.log("Criterios estables: %s de %s", ids.length - inestables.length, ids.length);
  inestables.forEach(cid => Logger.log("   INESTABLE %s: %s", cid, corridas.map(c => c[cid] || "(falta)").join(" | ")));
  if (!inestables.length) Logger.log("   Ningún criterio cambió entre corridas.");
  return { ticket: id, corridas: n, inestables: inestables };
}


// ============================================================
//  ATAJO — ejecuta esta desde el desplegable
// ============================================================
/**
 * Pega aquí el uuid que aparece en la URL de tu conversación
 * (marketplace-agent.cabify.tools/c/<ESTE-UUID>) y ejecuta "cazar"
 * desde el desplegable de arriba. Prueba el uuid como modelo, con
 * prefijos, y también dentro de la ruta.
 */
function cazar() {
  return mkCazarAgente("1db70bef-2a0f-4eca-83b4-98ef3934f393");
}
