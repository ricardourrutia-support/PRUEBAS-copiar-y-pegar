/**
 * ============================================================
 *  Zendesk.gs — Normalizador del extractor de tickets
 * ============================================================
 *  Toma el CSV que devuelve n8n.cabify.tools/form/zendesk_support_tools
 *  (una fila por comentario) y lo convierte en UNA conversación por
 *  ticket, con el canal detectado, los turnos ordenados, quién habló
 *  en cada uno, métricas y banderas de riesgo.
 *
 *  Por qué hace falta:
 *   - En chat, TODA la conversación llega en un solo comentario con
 *     author_id = -1 y formato "(HH:MM:SS) Nombre: mensaje". Contar
 *     respuestas por autor da 0 en todos los chats.
 *   - Las llamadas no traen transcripción: solo metadata de Amazon
 *     Connect. No son auditables con este CSV.
 *   - El extractor no trae el campo de visibilidad (público / nota
 *     interna), así que hay que inferirlo por rol + dominio del correo.
 *
 *  USO
 *    1) En el Sheet del histórico: Archivo ▸ Importar ▸ sube el CSV del
 *       extractor ▸ "Insertar hojas nuevas". (No lo pegues en una celda:
 *       el CSV pasa de los 50.000 caracteres que aguanta una celda.)
 *    2) En el editor de Apps Script ejecuta zdIngestar().
 *    3) En el Sheet aparece la hoja "Conversaciones": una fila por ticket
 *       y en la última columna la conversación lista para el Prompt 2.
 *
 *  zdDiagnostico() muestra qué columnas trae el extractor y qué criterios
 *  quedan sin poder evaluarse por campos que faltan.
 * ============================================================
 */

const ZD = {
  HOJA_INBOX:  "Inbox",
  HOJA_CONVER: "Conversaciones",

  // Dominios que identifican a quien atiende (no al cliente)
  DOMINIOS_AGENTE: ["cabify.com", "cco.cabify.com", "external.cabify.com"],
  // cco = BPO,  cabify.com = interno,  external = externo
  DOMINIO_BPO:     "cco.cabify.com",

  // Nombres que en la transcripción de chat NO son personas
  BOTS: ["abi", "help support", "helpsupport"],

  // Cuentas de sistema que dejan instrucciones al agente dentro del ticket
  CUENTAS_SISTEMA: ["cops.tech.global@cabify.com"],

  MAX_CHARS_CELDA: 45000,
};

// ============================================================
//  ENTRADAS
// ============================================================

/**
 * ESTA ES LA FUNCIÓN QUE HAY QUE EJECUTAR.
 * Lee el CSV del extractor y construye la hoja Conversaciones.
 *
 * Acepta las dos formas de tenerlo en el Sheet:
 *   a) importado como hoja (Archivo ▸ Importar) — recomendado, sin límite de tamaño
 *   b) el CSV completo pegado en la celda A1 (solo sirve bajo 50.000 caracteres)
 * Encuentra la hoja sola: busca una llamada "Inbox" o cualquiera cuya
 * primera fila tenga las columnas ticket_id y comments.
 */
function zdIngestar() {
  const rows = zdLeerInbox_();
  if (!rows.length) throw new Error("No encontré filas de comentarios. Revisa que el CSV del extractor esté importado en el Sheet.");

  const tickets = zdNormalizar_(rows);
  const hist = zdLeerHistorico_();
  zdEnriquecerConHistorico_(tickets, hist);
  zdEscribirConversaciones_(tickets);

  const porCanal = {};
  tickets.forEach(t => { porCanal[t.canal] = (porCanal[t.canal] || 0) + 1; });
  const conJourney = tickets.filter(t => t.journeyId).length;

  Logger.log("Comentarios leídos: %s | Tickets: %s | Canal: %s",
             rows.length, tickets.length, JSON.stringify(porCanal));
  Logger.log("Cruce con el histórico: %s de %s tickets con Journey Id (%s sin cruzar)",
             conJourney, tickets.length, tickets.filter(t => t.banderas.indexOf("no_esta_en_historico") >= 0).length);
  Logger.log('Listo. Abre la hoja "%s".', ZD.HOJA_CONVER);
  return { comentarios: rows.length, tickets: tickets.length, porCanal, conJourney };
}

/**
 * Regenera SOLO las columnas de prompt de la hoja Conversaciones, PARA TODAS
 * las filas de la hoja.
 *
 * Hace falta cada vez que se tocan las reglas de la matriz: el prompt se
 * genera al ingerir y queda guardado en la celda, así que cambiar AUD_REGLAS
 * no reescribe lo que ya está en la hoja. Sin esto auditarías con las reglas
 * viejas creyendo que usas las nuevas.
 *
 * OJO CON LA VERSIÓN ANTERIOR DE ESTA FUNCIÓN: recorría el CSV del Inbox, o sea
 * el último lote cargado. Como Conversaciones acumula, los tickets de lotes
 * viejos se quedaban con su prompt viejo para siempre, y la función informaba
 * "10 tickets" como si hubiera terminado el trabajo. Ahora la fuente es la HOJA:
 * si una fila está en Conversaciones, se refresca.
 *
 * El Inbox se sigue usando cuando está: sus turnos son el dato más fresco. Para
 * las demás filas se rearma el ticket desde la propia fila, que para esto tiene
 * todo lo necesario (columna "Señales" incluida).
 *
 * No toca la conversación ni ninguna otra columna, y a diferencia de zdIngestar()
 * SÍ refresca los tickets ya auditados: lo que se congela es la evidencia, no las
 * instrucciones con que se la evalúa.
 */
function zdRefrescarPrompts() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2) throw new Error("No existe la hoja " + ZD.HOJA_CONVER + " o está vacía.");

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cP = h.indexOf("PROMPT AUDITORIA (copiar y pegar)");
  const cV = h.indexOf("Prompt solo viaje");
  const cT = h.indexOf("Ticket Number");
  const cA = h.indexOf("Audiencia");
  const cS = h.indexOf("Version reglas");
  if (cP < 0) throw new Error("La hoja no tiene la columna del prompt. Corre zdIngestar() una vez para crearla.");
  if (cT < 0) throw new Error("La hoja no tiene la columna Ticket Number.");

  // El lote fresco, si sigue pegado. No es obligatorio.
  const frescos = {};
  try {
    const rows = zdLeerInbox_();
    if (rows.length) {
      const tks = zdNormalizar_(rows);
      zdEnriquecerConHistorico_(tks, zdLeerHistorico_());
      tks.forEach(t => { frescos[zdClaveTicket_(t.ticket)] = t; });
    }
  } catch (e) {
    Logger.log("(sin Inbox: se regenera todo desde la hoja) %s", e.message);
  }

  const hist = zdLeerHistorico_();
  const ultima = sh.getLastRow();
  let deInbox = 0, deHoja = 0, sinDatos = 0, sinSenales = 0, audienciasEscritas = 0;

  // Fila por fila: cada prompt puede pesar decenas de miles de caracteres, así
  // que no se lee ni se escribe la hoja entera de una vez.
  for (let n = 2; n <= ultima; n++) {
    const fila = sh.getRange(n, 1, 1, h.length).getValues()[0];
    const tk = zdClaveTicket_(fila[cT]);
    if (!tk) continue;

    let t = frescos[tk], origen = "inbox";
    if (t) deInbox++;
    else {
      t = zdTicketDeFila_(h, fila, hist);
      origen = "hoja";
      if (!t) { sinDatos++; continue; }
      deHoja++;
      if (t.senalesReconstruidas) sinSenales++;
    }

    // La columna Audiencia se rellena acá para las filas que venían de antes
    // de que existiera. Importa: el prompt que se está regenerando ya sale con
    // la matriz de esa audiencia, así que la hoja tiene que decir cuál fue.
    if (cA >= 0 && !String(fila[cA] || "").trim() && t.audiencia) {
      sh.getRange(n, cA + 1).setValue(t.audiencia);
      audienciasEscritas++;
    }

    const nuevoPrompt = zdPromptAuditoria_(t);
    sh.getRange(n, cP + 1).setValue(zdRecortar_(nuevoPrompt));
    if (cV >= 0) sh.getRange(n, cV + 1).setValue(t.promptMarketplace || "");
    if (cS >= 0) sh.getRange(n, cS + 1).setValue(nuevoPrompt ? AUD_VERSION_REGLAS : "");
  }

  const total = deInbox + deHoja;
  Logger.log("Prompts regenerados: %s de %s filas   (del Inbox: %s | de la hoja: %s)",
             total, ultima - 1, deInbox, deHoja);
  if (sinSenales)
    Logger.log("AVISO: %s filas no tenían la columna Señales guardada; se reconstruyeron leyendo los turnos del bloque. " +
               "Se arreglan solas la próxima vez que ese ticket pase por zdIngestar().", sinSenales);
  if (audienciasEscritas)
    Logger.log("Se completó la columna Audiencia en %s filas que venían sin ella.", audienciasEscritas);
  if (sinDatos)
    Logger.log("AVISO: %s filas no se pudieron regenerar (sin canal ni conversación en la hoja).", sinDatos);

  SpreadsheetApp.flush();
  return { tocados: total, deInbox: deInbox, deHoja: deHoja,
           sinSenales: sinSenales, sinDatos: sinDatos, filas: ultima - 1 };
}

/**
 * Rearma un ticket a partir de su fila de Conversaciones, lo justo para volver a
 * generar el prompt. No reemplaza al extractor: reconstruye lo que la hoja sí
 * guardó, que resulta ser todo lo que el prompt necesita.
 */
function zdTicketDeFila_(h, fila, hist) {
  const g = n => { const i = h.indexOf(n); return i < 0 ? "" : String(fila[i] == null ? "" : fila[i]); };

  const ticket = zdClaveTicket_(g("Ticket Number"));
  const conversacion = g("Conversacion");
  const canal = g("Canal");
  if (!ticket || (!canal && !conversacion)) return null;

  const t = {
    ticket: ticket,
    canal: canal || "ticket",
    audiencia: g("Audiencia") || "",
    journeyId: g("Journey Id"),
    journeyDate: g("Fecha del viaje"),
    riderId: g("Rider Id"),
    fechaSolved: g("Fecha solved"),
    fuenteFecha: g("Fuente fecha"),
    semanaSolved: g("Semana solved"),
    status: g("Estado"),
    creado: g("Creado"),
    actualizado: g("Actualizado"),
    contactReason: g("Motivo"),
    estadoAud: g("Estado auditoría"),
    banderas: g("Banderas") ? g("Banderas").split(",").map(s => s.trim()).filter(Boolean) : [],
    conversacion: conversacion,   // audCuerpoInteraccion_ la usa tal cual
    tags: [],
  };

  // Señales: primero la columna guardada; si no está (filas de antes de que
  // existiera), se reconstruyen releyendo los turnos del bloque formateado.
  const crudo = g("Señales");
  if (crudo) {
    try { t.senales = JSON.parse(crudo); } catch (e) { t.senales = null; }
  }
  if (!t.senales) {
    const turnos = zdTurnosDeBloque_(conversacion);
    // El ticket va incluido: zdSenales_ lo necesita para no confundir el
    // propio número con el de un ticket al que se derive.
    t.senales = zdSenales_({ turnos: turnos, ticket: ticket });
    t.senalesReconstruidas = true;
  }

  // Lo que vive en el Historico y no en esta hoja: tags de salida, grupo, agente.
  const hh = (hist || {})[ticket];
  t.grupoZendesk = hh ? hh.grupo : "";
  if (!AUD_AUDIENCIAS[t.audiencia])
    t.audiencia = audAudienciaDeGrupo_(t.grupoZendesk, (hh && hh.audiencia) || null);
  t.outputTags   = hh ? (hh.tags || []) : [];
  t.agenteHist   = hh ? hh.agente : "";
  if (hh && hh.journeyDate && !t.journeyDate) t.journeyDate = hh.journeyDate;

  t.promptMarketplace = t.journeyId && typeof zdPromptMarketplace_ === "function"
    ? zdPromptMarketplace_(t) : "";
  return t;
}

/**
 * ============================================================
 *  EL PROMPT VIGENTE DE UN TICKET
 * ============================================================
 *
 * Devuelve el prompt de un ticket con las reglas de HOY, regenerándolo si el
 * guardado es viejo.
 *
 * Por qué existe. El sello de versión se inventó para detectar prompts
 * caducos, y eso estaba bien. Lo que estaba mal era la consecuencia: el
 * sistema paraba con un error y le pedía a la persona que corriera
 * zdRefrescarPrompts() a mano. Es decir, detectaba el problema y luego le
 * pasaba el trabajo a quien no lo había causado, justo en el momento en que
 * quería auditar. Cada cambio de reglas —que es lo que más se hace— obligaba
 * a un paso manual que nada impedía olvidar.
 *
 * Ahora el prompt caduco se regenera solo, para ESE ticket, en el momento en
 * que se necesita. Es una celda, no quinientas: no hay riesgo de agotar el
 * tiempo de ejecución, y el que no se audita no se toca.
 *
 * La comprobación del sello NO se quita. Sigue siendo la que decide si hay que
 * regenerar; lo único que cambia es que ahora actúa en vez de quejarse.
 *
 * Devuelve { prompt, regenerado, motivo }. `regenerado` es para que la
 * interfaz pueda decirlo, no para decidir nada.
 */
function zdPromptVigenteDe_(ticket) {
  const id = zdClaveTicket_(ticket);
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2)
    return { prompt: "", regenerado: false, motivo: "no existe la hoja " + ZD.HOJA_CONVER };

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cP = h.indexOf("PROMPT AUDITORIA (copiar y pegar)");
  const cV = h.indexOf("Prompt solo viaje");
  const cA = h.indexOf("Audiencia");
  const cS = h.indexOf("Version reglas");
  if (cP < 0)
    return { prompt: "", regenerado: false, motivo: "la hoja no tiene la columna del prompt" };

  const n = zdFilaDeTicket_(sh, id);
  if (n < 0)
    return { prompt: "", regenerado: false, motivo: "el ticket no está en " + ZD.HOJA_CONVER };

  const guardado = String(sh.getRange(n, cP + 1).getValue() || "");
  if (guardado && audPromptAlDia_(guardado))
    return { prompt: guardado, regenerado: false, motivo: "" };

  // Caduco o vacío: se reconstruye desde la propia fila. zdTicketDeFila_ ya
  // sabe recuperar las señales guardadas y, si faltan, releer los turnos del
  // bloque formateado.
  const fila = sh.getRange(n, 1, 1, h.length).getValues()[0];
  const t = zdTicketDeFila_(h, fila, zdLeerHistorico_());
  if (!t)
    return { prompt: guardado, regenerado: false,
             motivo: "la fila no tiene canal ni conversación: no se puede rearmar" };

  const nuevo = zdPromptAuditoria_(t);
  if (!nuevo)
    return { prompt: "", regenerado: false,
             motivo: "este canal no genera prompt (las llamadas no se auditan)" };

  sh.getRange(n, cP + 1).setValue(zdRecortar_(nuevo));
  if (cV >= 0) sh.getRange(n, cV + 1).setValue(t.promptMarketplace || "");
  if (cS >= 0) sh.getRange(n, cS + 1).setValue(AUD_VERSION_REGLAS);
  if (cA >= 0 && !String(fila[cA] || "").trim() && t.audiencia)
    sh.getRange(n, cA + 1).setValue(t.audiencia);

  Logger.log("Prompt de %s regenerado con [%s]%s.", id, AUD_VERSION_REGLAS,
             t.senalesReconstruidas ? " (señales releídas del bloque)" : "");
  return { prompt: nuevo, regenerado: true,
           motivo: guardado ? "el guardado era de una versión anterior" : "no había prompt guardado",
           senalesReconstruidas: !!t.senalesReconstruidas };
}

/**
 * Vuelve a sacar los turnos del bloque formateado que quedó en la hoja.
 *
 * Es la red de seguridad para las filas viejas, que no tienen la columna
 * "Señales". El formato lo escribe zdFormatearBloque_, así que se lee con la
 * misma forma: "[3] (agente) Nombre — 10:42" y debajo el texto.
 *
 * Si el bloque venía truncado, los últimos turnos no están y las señales de
 * cierre saldrían mal. Por eso devuelve vacío ante un bloque truncado: mejor un
 * "desconocido" honesto que un "cerró el solicitante" inventado.
 */
function zdTurnosDeBloque_(bloque) {
  const texto = String(bloque || "");
  if (!texto || texto.indexOf("TRUNCADO") >= 0) return [];

  const i = texto.indexOf("=== TURNOS EN ORDEN ===");
  if (i < 0) return [];

  const lineas = texto.slice(i).split("\n").slice(1);
  const turnos = [];
  let actual = null;
  lineas.forEach(l => {
    const m = /^\[(\d+)\]\s*\(([^)]*)\)\s*(.*?)\s+—\s*(.*)$/.exec(l);
    if (m) {
      if (actual) turnos.push(actual);
      actual = { tipo: m[2].trim(), quien: m[3].trim(), hora: m[4].trim(), texto: "" };
      return;
    }
    if (actual) actual.texto += (actual.texto ? "\n" : "") + l;
  });
  if (actual) turnos.push(actual);

  return turnos.map(x => ({ tipo: x.tipo, quien: x.quien, hora: x.hora, texto: x.texto.trim() }))
               .filter(x => x.tipo);
}

/** Busca la hoja con los datos del extractor. */
function zdEncontrarInbox_(ss) {
  const porNombre = ss.getSheetByName(ZD.HOJA_INBOX);
  if (porNombre) return porNombre;

  const hojas = ss.getSheets();
  for (let i = 0; i < hojas.length; i++) {
    const sh = hojas[i];
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) continue;

    const fila1 = sh.getRange(1, 1, 1, Math.min(sh.getLastColumn(), 40))
      .getValues()[0].map(h => String(h).trim().toLowerCase());
    if (fila1.indexOf("ticket_id") >= 0 && fila1.indexOf("comments") >= 0) return sh;

    const a1 = String(sh.getRange(1, 1).getValue() || "");
    if (a1.length > 200 && a1.indexOf("ticket_id") >= 0 && a1.indexOf("comments") >= 0) return sh;
  }
  return null;
}

/** Devuelve las filas del extractor, venga como hoja importada o como CSV pegado. */
function zdLeerInbox_() {
  const ss = histGetSpreadsheet_(true);
  const sh = zdEncontrarInbox_(ss);
  if (!sh) throw new Error(
    'No encontré los datos del extractor. Importa el CSV al Sheet con Archivo ▸ Importar ' +
    '(opción "Insertar hojas nuevas") o crea una hoja llamada "' + ZD.HOJA_INBOX + '".');

  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();

  // Caso a) hoja importada: fila 1 = encabezados, una fila por comentario
  if (lastCol >= 5 && lastRow >= 2) {
    const vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = vals[0].map(h => String(h).trim());
    return vals.slice(1).map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] === undefined || r[i] === null) ? "" : String(r[i]); });
      return o;
    }).filter(o => String(o.ticket_id || "").trim());
  }

  // Caso b) CSV completo pegado en A1
  return zdParseCSV_(String(sh.getRange(1, 1).getValue() || ""));
}

// ============================================================
//  CRUCE CON EL HISTÓRICO (Journey Id, Rider Id, fecha de solved)
// ============================================================

/** Lee la hoja Historico y devuelve un índice: ticket → datos del viaje. */
function zdLeerHistorico_() {
  // HIST viene de Historico.gs; si por algo no está, se usa el nombre por defecto
  const nombreHoja = (typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico";
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(nombreHoja);
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('AVISO: no encontré la hoja "%s" con datos. Las columnas de viaje quedarán vacías.', nombreHoja);
    return {};
  }

  const vals    = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const headers = vals[0].map(h => String(h).trim());
  const col     = nombre => headers.indexOf(nombre);

  const cTicket  = col("Ticket Number");
  const cJourney = col("Journey Id");
  const cJDate   = col("Fecha del viaje");
  const cEstado  = col("Estado auditoría");
  const cRider   = col("Rider Id");
  const cSolved  = col("Solved At Utc Dt");
  const cSemana  = col("Semana de Solved At Utc Dt");
  const cAgente  = col("Assignee FullName");
  const cGrupo   = col("Group Name");
  const cTag1    = col("ES Output Tags 1st Level v2");
  const cTag2    = col("ES Output Tags 2nd Level v2");
  const cTag3    = col("ES Output Tags 3rd Level v2");
  const cAud     = col("Auditable");
  const cMotivo  = col("Motivo no auditable");
  const cAudien  = col("Audiencia");

  if (cTicket < 0) throw new Error('La hoja "' + HIST.SHEET_NAME + '" no tiene la columna "Ticket Number".');

  const mapa = {};
  vals.slice(1).forEach(r => {
    const id = zdClaveTicket_(r[cTicket]);
    if (!id) return;
    mapa[id] = {
      journey: cJourney >= 0 ? String(r[cJourney] || "").trim() : "",
      // Fecha de creación del VIAJE. Las herramientas de marketplace la exigen
      // junto al journey_id: sus tablas están particionadas por fecha.
      journeyDate: cJDate >= 0 ? zdFechaViajeISO_(r[cJDate])    : "",
      // Estado de auditoría. Es la única fuente de verdad sobre qué ya se auditó.
      estadoAud:   cEstado >= 0 ? String(r[cEstado] || "").trim() : "",
      rider:   cRider   >= 0 ? String(r[cRider]   || "").trim() : "",
      solved:  cSolved  >= 0 ? zdValorFecha_(r[cSolved])        : "",
      semana:  cSemana  >= 0 ? String(r[cSemana]  || "").trim() : "",
      agente:  cAgente  >= 0 ? String(r[cAgente]  || "").trim() : "",
      grupo:   cGrupo   >= 0 ? String(r[cGrupo]   || "").trim() : "",
      // Las output tags de Tableau. Con ellas C23 deja de ser no concluyente:
      // se puede juzgar si la clasificación corresponde al caso.
      tags: [cTag1, cTag2, cTag3].map(c => c >= 0 ? String(r[c] || "").trim() : "")
              .filter(Boolean),
      auditable: cAud    >= 0 ? String(r[cAud]    || "").trim() : "",
      motivo:    cMotivo >= 0 ? String(r[cMotivo] || "").trim() : "",
      audiencia: cAudien >= 0 ? String(r[cAudien] || "").trim() : "",
    };
  });
  return mapa;
}

/**
 * Señales que se calculan del texto, sin depender de ninguna integración.
 *
 * Existen para sacar criterios de "no concluyente" sin inventar datos: en vez
 * de pedirle al agente que adivine el estado de Zendesk o si se usó una macro,
 * se le entregan hechos verificables y él juzga sobre eso.
 *
 *   cerroElAgente     la última palabra la tuvo quien atiende, no el cliente
 *   invitaAyuda       alguno de los dos últimos mensajes del agente ofrece
 *                     seguir ayudando
 *   repiteMensaje     dos mensajes del agente casi idénticos: macro reenviada
 *                     sin editar
 */
/**
 * Formas de dejar la puerta abierta al final de un ticket.
 *
 * La lista se amplió tras un falso positivo real: "Si necesitas información
 * adicional, tienes todos los detalles en nuestro Centro de Ayuda" no estaba
 * contemplada y el cierre se marcó como abandono. Derivar al Centro de Ayuda
 * SÍ es dejar una vía abierta; que no sea la fórmula de manual no lo convierte
 * en un cierre en seco.
 *
 * Aun así, esta lista nunca va a estar completa: el idioma tiene más formas de
 * ofrecer ayuda que las que quepan acá. Por eso el criterio C21 está escrito
 * para que un "no" de esta señal NO baste para reprobar a nadie.
 */
const ZD_INVITACION = [
  "quedo atent", "quedamos atent", "cualquier otra consulta", "cualquier duda",
  "no dudes en", "no dude en", "estare atent", "estaremos atent",
  "puedes escribirnos", "puede escribirnos", "vuelve a escribirnos",
  "estamos para ayudarte", "estoy para ayudarte", "algo mas en lo que",
  "en que mas puedo", "sigo atent",
  // Derivaciones y ofrecimientos indirectos
  "informacion adicional", "mas informacion", "centro de ayuda", "help center",
  "si necesitas", "si necesita", "si requieres", "si requiere",
  "si tienes alguna", "si tiene alguna", "si te surge", "ante cualquier",
  "con gusto te", "con gusto le", "estamos atentos", "seguimos atentos",
  "puedes contactarnos", "puede contactarnos", "volver a contactarnos",
  "escribenos", "escribanos", "contactanos",
];

/** Texto sin acentos, sin puntuación y en minúsculas, para comparar. */
function zdTextoPlano_(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Frases con las que un solicitante da por terminado el caso.
 *
 * Sirven para una excepción concreta de C21: si el último mensaje del hilo es
 * el cliente diciendo "gracias" o "ya se resolvió", el caso NO quedó
 * abandonado — el solicitante no está esperando nada. Cerrarlo ahí es lo
 * correcto, y marcarlo como incumplimiento crítico era un falso positivo.
 */
const ZD_CIERRE_CLIENTE = [
  "gracias", "muchas gracias", "mil gracias", "te agradezco", "le agradezco",
  "ya se resolvio", "ya esta resuelto", "ya quedo", "ya quedo resuelto",
  "se resolvio", "quedo solucionado", "ya lo solucione", "ya se soluciono",
  "todo bien", "todo bn", "todo ok", "todo listo", "ya esta", "listo",
  "perfecto", "excelente", "de acuerdo", "entendido", "vale",
  "saludos", "slds", "un saludo", "buen dia", "que estes bien",
];

/**
 * Señales de que el cliente NO dio el caso por cerrado, aunque diga "gracias".
 * "Gracias, pero sigo sin poder pedir" es lo contrario de un cierre.
 */
const ZD_SIGUE_ABIERTO = [
  "pero ", "sigo ", "sigue ", "aun ", "todavia", "no funciona", "no puedo",
  "no me deja", "no ha", "no he", "necesito", "podrias", "podria",
  "me ayudas", "cuando", "sin embargo", "el problema",
  // Frases de ESPERA. Un mensaje puede decir "gracias" y estar pidiendo algo:
  // "Mi direccion es X, gracias, quedo atento al cambio" es una solicitud con
  // una cortesia dentro, no un cierre. Sin estas frases el detector lo tomaba
  // por resuelto, que es el error contrario al que vino a arreglar.
  "quedo atent", "quedo a la espera", "a la espera", "quedamos atent",
  "espero tu", "espero su", "espero respuesta", "espero una", "esperando",
  "por favor", "solicito", "requiero", "agradeceria", "me confirm",
  "mi direccion", "mi reserva", "adjunto",
];

/**
 * Frases con las que el agente cierra el hilo porque el caso se está
 * atendiendo en OTRO ticket.
 *
 * Existe por un falso positivo doble. Un ticket terminó con "el caso se
 * gestiona en el #74971510" y la auditoría emitió no_cumple en C19 (evita
 * terminar sin atender) Y en C27 (contestó todas las dudas), los dos
 * CRÍTICOS: dos -100 por un mismo hecho.
 *
 * Y el hecho no era ese. Derivar al ticket donde el caso sí se está
 * atendiendo ES atender la solicitud: cambia el canal, no se abandona a
 * nadie. Lo que de verdad faltó fue la TAG: un cierre por duplicado se
 * etiqueta "Duplicado", y no se hizo. O sea un solo defecto, y en C23.
 *
 * Exigirle al evaluador que compruebe que el otro ticket dio respuesta es
 * pedirle una evidencia que por construcción no está en esta auditoría: la
 * conversación de ese otro ticket no se le entrega.
 */
const ZD_DERIVA_TICKET = [
  "se gestiona en", "se esta gestionando en", "se atiende en", "se esta atendiendo en",
  "ya fue atendido en", "ya se respondio en", "ya respondimos en",
  "en el ticket", "en la solicitud", "en el caso", "otro ticket", "otra solicitud",
  "misma solicitud", "mismo caso", "duplicado", "ya tienes un caso", "caso abierto",
  "seguimiento en", "continuamos en", "continuaremos en", "responderemos en",
  "se dara respuesta en", "daremos respuesta en", "sera atendido en",
];

/** Tamaño máximo de un mensaje para considerarlo un cierre de cortesía. */
const ZD_CIERRE_MAX_CHARS = 180;

/**
 * ¿Este texto del solicitante es un cierre de cortesía?
 *
 * Tres condiciones, y las tres hacen falta:
 *  1. es corto — un cierre no viene con un párrafo de contexto;
 *  2. contiene una frase de cierre;
 *  3. NO tiene pregunta ni ninguna señal de que el asunto sigue abierto.
 *
 * La tercera es la que evita el falso positivo obvio: "gracias, pero sigue
 * sin funcionar" contiene "gracias" y no es un cierre de nada.
 */
function zdEsCierreDeCortesia_(texto) {
  const t = zdTextoPlano_(texto || "");
  if (!t) return false;
  if (t.length > ZD_CIERRE_MAX_CHARS) return false;
  if (String(texto).indexOf("?") >= 0 || String(texto).indexOf("¿") >= 0) return false;
  if (ZD_SIGUE_ABIERTO.some(f => t.indexOf(f) >= 0)) return false;
  return ZD_CIERRE_CLIENTE.some(f => t.indexOf(f) >= 0);
}

/**
 * ¿El agente cerró derivando a otro ticket? Devuelve el número o "".
 *
 * Hacen falta las DOS cosas: una frase de derivación y un número de ticket
 * que no sea el que se está auditando. Solo con el número no basta — un
 * agente puede mencionar el ticket propio como referencia — y solo con la
 * frase tampoco, porque sin identificar el otro caso la derivación no se
 * puede comprobar y no merece el beneficio de la duda.
 */
function zdTicketDerivado_(texto, ticketPropio) {
  const t = zdTextoPlano_(texto || "");
  if (!t) return "";
  if (!ZD_DERIVA_TICKET.some(f => t.indexOf(f) >= 0)) return "";

  const propio = String(ticketPropio || "").replace(/\D/g, "");
  const nums = String(texto).match(/\d{6,10}/g) || [];
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== propio) return nums[i];
  }
  return "";
}

function zdSenales_(t) {
  const turnos = (t.turnos || []).filter(x => x.texto && String(x.texto).trim());
  const agente = turnos.filter(x => x.tipo === "agente");
  const norm = zdTextoPlano_;

  const ultimo = turnos.length ? turnos[turnos.length - 1] : null;
  const cerroElAgente = !!ultimo && (ultimo.tipo === "agente" || ultimo.tipo === "bot");

  // El cliente cerró el hilo, pero para agradecer o decir que ya está resuelto.
  // Se calcula acá, en código, y no se deja a la interpretación del evaluador:
  // de esta señal depende un veredicto CRÍTICO.
  const clienteDioPorCerrado = !!ultimo && ultimo.tipo === "cliente" &&
                               zdEsCierreDeCortesia_(ultimo.texto);

  // El agente cerró remitiendo a otro ticket. Se mira su ULTIMO mensaje: es el
  // que cierra. Si lo hubiera dicho al principio y luego siguiera atendiendo,
  // no seria un cierre por derivacion.
  const ultimoAgente = agente.length ? agente[agente.length - 1] : null;
  const ticketDerivado = ultimoAgente
    ? zdTicketDerivado_(ultimoAgente.texto, t.ticket) : "";

  const ultimos = agente.slice(-2).map(x => norm(x.texto)).join(" ");
  const invitaAyuda = ZD_INVITACION.some(f => ultimos.indexOf(norm(f)) >= 0);

  // Dos mensajes largos del agente casi iguales: los primeros 200 caracteres
  // normalizados coinciden. Los mensajes cortos ("gracias", "un momento") se
  // repiten con naturalidad y no cuentan.
  const largos = agente.map(x => norm(x.texto)).filter(s => s.length > 200);
  const vistos = {};
  let repiteMensaje = false;
  largos.forEach(s => {
    const clave = s.slice(0, 200);
    if (vistos[clave]) repiteMensaje = true;
    vistos[clave] = true;
  });

  return {
    cerroElAgente: cerroElAgente,
    quienCerro: ultimo ? ultimo.tipo : "",
    clienteDioPorCerrado: clienteDioPorCerrado,
    ultimoTextoCliente: (!!ultimo && ultimo.tipo === "cliente")
      ? String(ultimo.texto || "").slice(0, 200) : "",
    ticketDerivado: ticketDerivado,
    derivaAOtroTicket: !!ticketDerivado,
    invitaAyuda: invitaAyuda,
    repiteMensaje: repiteMensaje,
    mensajesLargosAgente: largos.length,
  };
}

/**
 * Normaliza la fecha del viaje a ISO: "2026-08-04 23:56:15".
 *
 * Tableau la entrega como "4/8/2026 23:56:15" — DÍA primero. Si se la pasamos
 * así al agente, "4/8" se puede leer como 8 de abril y la consulta se va a
 * otra partición: devuelve vacío y nosotros lo leemos como "no hay datos".
 * Por eso se convierte acá, una sola vez, en vez de confiar en que el modelo
 * adivine la convención.
 *
 * Acepta también un Date (si Sheets ya lo interpretó) y algo que ya venga en
 * ISO, que se deja tal cual.
 */
function zdFechaViajeISO_(v) {
  if (v === null || v === undefined || v === "") return "";

  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    const p = n => (n < 10 ? "0" : "") + n;
    return v.getFullYear() + "-" + p(v.getMonth() + 1) + "-" + p(v.getDate()) +
           " " + p(v.getHours()) + ":" + p(v.getMinutes()) + ":" + p(v.getSeconds());
  }

  const s = String(v).trim();
  if (!s) return "";

  // Ya viene en ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})([ T](\d{2}:\d{2}(:\d{2})?))?/);
  if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3] + (iso[5] ? " " + iso[5] : "");

  // D/M/AAAA con hora opcional. El día va primero: es lo que manda Tableau.
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const p = n => (String(n).length < 2 ? "0" : "") + n;
    const fecha = dmy[3] + "-" + p(dmy[2]) + "-" + p(dmy[1]);
    return dmy[4] ? fecha + " " + p(dmy[4]) + ":" + dmy[5] + ":" + (dmy[6] || "00") : fecha;
  }

  return s;   // formato desconocido: se pasa tal cual y que se vea
}

/**
 * Número de fila de un ticket en una hoja, buscando SOLO en la primera
 * columna. Después el que llama lee esa fila y nada más.
 *
 * Existe para no traerse hojas enteras: en Conversaciones cada fila carga la
 * conversación y dos prompts de hasta 45.000 caracteres, y leerlas todas para
 * quedarse con una es lo que colgaba la pestaña de revisión.
 *
 * Devuelve el número de fila (1-based, contando la cabecera) o -1.
 */
function zdFilaDeTicket_(sh, ticket) {
  if (!sh || sh.getLastRow() < 2) return -1;
  const col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < col.length; i++)
    if (zdClaveTicket_(col[i][0]) === ticket) return i + 2;
  return -1;
}

/** Normaliza el número de ticket venga como texto o como número. */
function zdClaveTicket_(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(Math.round(v));
  return String(v).trim().replace(/\.0+$/, "");
}

/** Una celda de fecha puede venir como Date o como texto. */
function zdValorFecha_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return Utilities.formatDate(v, "UTC", "yyyy-MM-dd'T'HH:mm:ss'Z'");
  }
  return String(v).trim();
}

/**
 * Agrega Journey Id, Rider Id y fecha de solved a cada ticket.
 *
 * La fecha se resuelve por orden de confianza, porque hoy la vista de
 * Tableau NO expone "Solved At Utc Dt" (solo la semana):
 *   1. Solved At Utc Dt del histórico  → fuente "historico"
 *   2. ticket_updated_at del extractor → fuente "zendesk_updated_at" (aproximada)
 *   3. Semana del histórico            → fuente "semana" (solo referencia)
 * La columna "Fuente fecha" deja constancia de cuál se usó.
 */
function zdEnriquecerConHistorico_(tickets, mapa) {
  mapa = mapa || {};
  tickets.forEach(t => {
    const h = mapa[zdClaveTicket_(t.ticket)];

    t.journeyId     = h ? h.journey     : "";
    t.grupoZendesk  = h ? h.grupo       : "";
    t.outputTags    = h ? (h.tags || []) : [];
    t.journeyDate   = h ? h.journeyDate : "";
    t.estadoAud     = h ? h.estadoAud   : "";
    t.riderId       = h ? h.rider     : "";
    t.semanaSolved  = h ? h.semana    : "";
    t.agenteHist    = h ? h.agente    : "";
    t.auditableHist = h ? h.auditable : "";
    t.motivoHist    = h ? h.motivo    : "";

    // La audiencia sale del histórico si ya está calculada; si no, del propio
    // Group Name. Nunca queda vacía: un ticket sin audiencia se auditaría con
    // una matriz al azar, y eso es peor que auditarlo con la de B2B.
    t.audiencia = (h && h.audiencia && AUD_AUDIENCIAS[h.audiencia])
      ? h.audiencia
      : audAudienciaDeGrupo_(t.grupoZendesk, null);

    if (h && h.solved)      { t.fechaSolved = h.solved;      t.fuenteFecha = "historico"; }
    else if (t.actualizado) { t.fechaSolved = t.actualizado; t.fuenteFecha = "zendesk_updated_at (aproximada)"; }
    else if (h && h.semana) { t.fechaSolved = h.semana;      t.fuenteFecha = "semana del historico (referencial)"; }
    else                    { t.fechaSolved = "";            t.fuenteFecha = ""; }

    if (!h) t.banderas.push("no_esta_en_historico");
    else if (!h.journey) t.banderas.push("sin_journey_id");
    // Sin fecha de creación del viaje el agente no puede consultar NADA del
    // viaje: sus tablas están particionadas por fecha. La bandera lo hace
    // visible en la hoja en vez de que aparezca como "no hay datos".
    else if (!h.journeyDate) t.banderas.push("sin_journey_created_at");

    // Verificación cruzada: Tableau dice que hubo agente humano, pero la
    // conversación real no tiene ni un turno de agente (lo resolvió el bot).
    // Manda la conversación: es la evidencia directa.
    if (t.auditableHist === "SI" && t.metricas.turnosAgente === 0)
      t.banderas.push("contradice_historico_sin_turnos_de_agente");

    t.senales = zdSenales_(t);
    t.promptMarketplace = t.journeyId ? zdPromptMarketplace_(t) : "";
  });
  return tickets;
}

/**
 * Prompt 1 (extractor de datos del viaje) ya relleno para este ticket.
 *
 * En aeropuerto se inserta un bloque extra sobre la semántica de las horas.
 * Va en ESTE prompt además del de auditoría porque es el que consulta el
 * sistema: si la consulta ya vuelve con la línea de tiempo bien etiquetada,
 * el evaluador no tiene ocasión de interpretarla mal.
 */
function zdPromptMarketplace_(t) {
  const aud = (t && t.audiencia) || AUD_AUDIENCIA_DEFECTO;
  const plantilla = (aud === "aeropuerto")
    ? ZD_PROMPT_MARKETPLACE.replace("{{BLOQUE_AUDIENCIA}}", ZD_BLOQUE_AEROPUERTO)
    : ZD_PROMPT_MARKETPLACE.replace("{{BLOQUE_AUDIENCIA}}\n", "").replace("{{BLOQUE_AUDIENCIA}}", "");

  return plantilla
    .replace(/{{JOURNEY_ID}}/g,   t.journeyId)
    .replace(/{{JOURNEY_DATE}}/g, t.journeyDate || "(NO DISPONIBLE)")
    .replace(/{{RIDER_ID}}/g,     t.riderId || "(no disponible)")
    .replace(/{{FECHA_SOLVED}}/g, t.fechaSolved || "(no disponible)")
    .replace(/{{TICKET}}/g,       t.ticket);
}

/**
 * Lo que hay que decirle al extractor cuando el viaje es de aeropuerto.
 *
 * Sale de la definición que dio el equipo de marketplace: en estos viajes
 * `startAt` es la hora programada de llegada AL AEROPUERTO, no la de
 * recogida. Sin esta advertencia, la línea de tiempo vuelve con `startAt`
 * etiquetado como inicio del viaje y todo lo que se construya encima queda
 * mal — fue el origen de un crítico falso.
 */
const ZD_BLOQUE_AEROPUERTO = [
  "CONTEXTO DE AEROPUERTO — leelo antes de construir ninguna hora:",
  "En los viajes de aeropuerto, startAt es la hora PROGRAMADA DE LLEGADA AL",
  "AEROPUERTO, es decir la hora limite de FINALIZACION del viaje. NO es la hora",
  "de recogida del pasajero ni el inicio del viaje.",
  "",
  "Construye la linea de tiempo completa en hora local de Chile e identifica,",
  "cada uno con su etiqueta y sin mezclarlos:",
  "  - hora programada de llegada al aeropuerto  (startAt)",
  "  - hora en que el conductor llego al punto de recogida  (JourneyDriverArrived)",
  "  - hora en que se recogio al pasajero  (JourneyRiderPickup)",
  "  - hora real de fin del viaje  (JourneyFinished)",
  "  - diferencia entre el fin real y la llegada programada, en minutos, con",
  "    signo: negativa = llego antes, positiva = llego con retraso",
  "",
  "El indicador de servicio correcto es esa ultima diferencia. Que el conductor",
  "llegue al pickup antes o despues de startAt no dice nada: son horas distintas.",
  "",
  "Si de los eventos no puedes determinar con seguridad cual es cual, dilo en",
  '"campos_no_disponibles" en vez de elegir una interpretacion.',
  "",
].join("\n");

const ZD_PROMPT_MARKETPLACE = [
  "Necesito los datos operativos de un viaje para una auditoria de calidad del ticket {{TICKET}}.",
  "",
  "journey_id: {{JOURNEY_ID}}",
  "journey_creation_date: {{JOURNEY_DATE}}",
  "rider_id: {{RIDER_ID}}",
  "fecha de solved del ticket (UTC): {{FECHA_SOLVED}}",
  "",
  "Usa journey_creation_date como fecha del viaje en toda consulta que la pida.",
  "NO uses la fecha de solved del ticket para eso: es la fecha en que se cerro",
  "el caso, no la del viaje, y puede diferir en dias.",
  "",
  "Esa fecha viene del campo Start At Local, en HORA LOCAL DE CHILE",
  "(America/Santiago) y corresponde al INICIO del viaje. Dos consecuencias:",
  "- si la consulta particionada por fecha vuelve vacia, reintenta con el dia",
  "  anterior y con el siguiente antes de concluir que no hay datos: un viaje",
  "  que arranca de noche en Santiago cae en el dia siguiente en UTC;",
  "- para un viaje reservado, el inicio puede caer en un dia distinto al de la",
  "  creacion. Si el journey_id no aparece, prueba tambien el dia anterior.",
  "Di explicitamente en que fecha lo encontraste.",
  "",
  "Si journey_creation_date dice NO DISPONIBLE, no adivines una fecha ni hagas",
  "consultas a ciegas: devuelve el json con todo en null y dilo en",
  '"campos_no_disponibles".',
  "",
  "{{BLOQUE_AUDIENCIA}}",
  "Devuelve EXACTAMENTE un bloque json con este esquema y nada mas, sin introduccion",
  "ni resumen posterior:",
  "",
  "{",
  '  "journey_id": "",',
  '  "estado_journey": "",',
  '  "tipo_precio": "",',
  '  "precio_cobrado_rider": null,',
  '  "moneda": "",',
  '  "precio_estimado": null,',
  '  "descuentos": [{"tipo": "", "monto": null, "motivo": ""}],',
  '  "ajustes_posteriores": [{"tipo": "", "monto": null, "fecha": "", "origen": "", "autor": ""}],',
  '  "pickup": {"hora_asignacion_conductor": "", "hora_llegada_conductor": "",',
  '             "hora_inicio_viaje": "", "espera_en_pickup_min": null,',
  '             "distancia_conductor_a_pickup_m": null},',
  '  "trayecto": {"distancia_km": null, "duracion_min": null, "hora_fin": ""},',
  // Solo se rellena en viajes de aeropuerto; en el resto queda en null y no
  // molesta. Tener la linea de tiempo ya etiquetada en el json es lo que evita
  // que despues alguien compare las horas equivocadas.
  '  "aeropuerto": {"hora_programada_llegada": "", "hora_llegada_conductor": "",',
  '                 "hora_recogida": "", "hora_fin_real": "",',
  '                 "diferencia_fin_vs_programada_min": null, "llego_a_tiempo": null},',
  '  "cancelacion": {"hubo": false, "quien": "", "hora": "", "penalizacion_aplicada": null},',
  '  "no_show": {"hubo": false, "evidencia": ""},',
  '  "incidencias": [],',
  '  "historial_rider": {"reembolsos_ultimos_90d": null, "monto_reembolsado_90d": null},',
  '  "campos_no_disponibles": []',
  "}",
  "",
  "Reglas obligatorias:",
  '- Si un dato no lo puedes obtener, ponlo en null y agrega su nombre a "campos_no_disponibles".',
  "  No lo estimes ni lo infieras.",
  "- No agregues campos que no esten en el esquema.",
  "- Montos como numero, sin simbolo de moneda ni separador de miles.",
  "- Horas en ISO 8601 UTC.",
].join("\n");

/** Diagnóstico: qué trae el extractor y qué criterios quedan sin poder evaluarse. */
function zdDiagnostico() {
  const rows = zdLeerInbox_();
  const tickets = zdNormalizar_(rows);

  Logger.log("Columnas del extractor: %s", Object.keys(rows[0] || {}).join(", "));
  Logger.log("Filas (comentarios): %s | Tickets: %s", rows.length, tickets.length);

  const porCanal = {};
  tickets.forEach(t => { porCanal[t.canal] = (porCanal[t.canal] || 0) + 1; });
  Logger.log("Canal: %s", JSON.stringify(porCanal));

  const banderas = {};
  tickets.forEach(t => t.banderas.forEach(b => { banderas[b] = (banderas[b] || 0) + 1; }));
  Logger.log("Banderas: %s", JSON.stringify(banderas));

  ZD_CAMPOS_FALTANTES.forEach(f => {
    if (!(f.campo in (rows[0] || {}))) Logger.log("FALTA %s → afecta %s", f.campo, f.afecta.join(", "));
  });
  return tickets;
}

/** Campos que el extractor no entrega y los criterios que dependen de ellos. */
const ZD_CAMPOS_FALTANTES = [
  { campo: "public",            afecta: ["C26", "C09", "C36"], nota: "sin visibilidad no se distingue comentario público de nota interna" },
  { campo: "assignee_mail",     afecta: ["C03", "C37"],        nota: "sin el asignado no hay contra qué comparar el nombre de la presentación" },
  { campo: "group_name",        afecta: ["C37"],               nota: "sin grupo no se verifica la derivación" },
  { campo: "macro_ids",         afecta: ["C04", "C22"],        nota: "sin macros aplicadas solo se puede inferir del texto" },
  { campo: "status_history",    afecta: ["C21"],               nota: "solo se ve el estado final, no las transiciones" },
  { campo: "solved_at",         afecta: ["C28"],               nota: "sin solved_at real se usa ticket_updated_at como aproximación" },
];

// ============================================================
//  PARSEO
// ============================================================
function zdParseCSV_(csvText) {
  const text = String(csvText).replace(/^\uFEFF/, "");
  const primera = text.split(/\r?\n/)[0] || "";
  const delim = (primera.split(";").length > primera.split(",").length) ? ";" : ",";

  const rows = Utilities.parseCsv(text, delim);
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] === undefined || r[i] === null) ? "" : String(r[i]); });
    return o;
  }).filter(o => String(o.ticket_id || "").trim());
}

/** Limpia entidades HTML y espacios que mete Zendesk. */
function zdLimpiar_(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================
//  CANAL
// ============================================================
const ZD_TAGS_LLAMADA = ["amazon_connect", "llamadas", "creado_solo_telefono", "answered_call",
                         "llamada_contestada_por_agente"];

function zdDetectarCanal_(tags, comentarios) {
  const t = tags.map(x => x.toLowerCase());
  if (ZD_TAGS_LLAMADA.some(x => t.indexOf(x) >= 0)) return "llamada";
  if (t.indexOf("chat") >= 0) return "chat";
  // Respaldo: si algún comentario es una transcripción, es chat
  if (comentarios.some(c => zdEsTranscripcion_(c.texto))) return "chat";
  if (t.indexOf("tickets") >= 0) return "ticket";
  return "ticket";
}

const ZD_RE_TURNO = /^\((\d{1,2}:\d{2}:\d{2})\)\s+([^:\n]{1,60}?):\s?/;

function zdEsTranscripcion_(texto) {
  return ZD_RE_TURNO.test(String(texto || "").trim());
}

/** Explota "(HH:MM:SS) Nombre: mensaje" en turnos individuales. */
function zdExplotarTranscripcion_(texto) {
  const lineas = String(texto || "").split(/\n/);
  const turnos = [];
  let actual = null;

  lineas.forEach(linea => {
    const m = linea.match(ZD_RE_TURNO);
    if (m) {
      if (actual) turnos.push(actual);
      actual = { hora: m[1], quien: m[2].trim(), texto: linea.slice(m[0].length) };
    } else if (actual) {
      actual.texto += "\n" + linea;      // continuación del mismo mensaje
    }
  });
  if (actual) turnos.push(actual);
  turnos.forEach(t => { t.texto = zdLimpiar_(t.texto); });
  return turnos;
}

// ============================================================
//  QUIÉN HABLA
// ============================================================
function zdDominio_(mail) {
  const m = String(mail || "").toLowerCase();
  const i = m.indexOf("@");
  return i < 0 ? "" : m.slice(i + 1);
}

function zdEsBot_(nombre) {
  const n = String(nombre || "").toLowerCase().trim();
  return ZD.BOTS.some(b => n === b || n.indexOf(b) >= 0);
}

/** Clasifica el autor de un comentario (canal ticket). */
function zdClasificarComentario_(row) {
  const rol  = String(row.author_role || "").trim().toLowerCase();
  const mail = String(row.author_mail || "").trim().toLowerCase();
  const dom  = zdDominio_(mail);

  if (String(row.author_id || "").trim() === "-1") return { tipo: "transcripcion", etiqueta: "transcripción de chat" };
  if (ZD.CUENTAS_SISTEMA.indexOf(mail) >= 0)       return { tipo: "sistema",       etiqueta: "instrucción del sistema al agente" };
  if (rol === "end-user")                          return { tipo: "cliente",       etiqueta: "cliente" };
  if (ZD.DOMINIOS_AGENTE.indexOf(dom) >= 0) {
    const quien = (dom === ZD.DOMINIO_BPO)      ? "agente (BPO)"
                : (dom === "external.cabify.com") ? "agente (externo)"
                :                                   "agente (interno)";
    return { tipo: "agente", etiqueta: quien, esBpo: dom === ZD.DOMINIO_BPO };
  }
  if (rol === "agent" || rol === "admin")          return { tipo: "agente",        etiqueta: "agente" };
  return { tipo: "desconocido", etiqueta: "autor no identificado" };
}

/** Clasifica un turno de transcripción de chat. */
function zdClasificarTurno_(nombre, nombreCliente) {
  if (zdEsBot_(nombre)) return { tipo: "bot", etiqueta: nombre };
  if (nombreCliente && zdNombresIguales_(nombre, nombreCliente)) return { tipo: "cliente", etiqueta: nombre };
  return { tipo: "agente", etiqueta: nombre };
}

function zdNombresIguales_(a, b) {
  const n = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) === n(b);
}

// ============================================================
//  NORMALIZACIÓN
// ============================================================
function zdNormalizar_(rows) {
  const porTicket = {};
  const orden = [];

  rows.forEach(r => {
    const id = String(r.ticket_id).trim();
    if (!porTicket[id]) {
      porTicket[id] = {
        ticket:        id,
        status:        String(r.status || "").trim(),
        tags:          String(r.tags || "").split(",").map(s => s.trim()).filter(Boolean),
        contactReason: String(r.contact_reason || "").trim(),
        creado:        String(r.ticket_created_at || "").trim(),
        actualizado:   String(r.ticket_updated_at || "").trim(),
        comentariosRaw: [],
      };
      orden.push(id);
    }
    porTicket[id].comentariosRaw.push({
      fecha:  String(r.comments_added_at || "").trim(),
      mail:   String(r.author_mail || "").trim(),
      rol:    String(r.author_role || "").trim(),
      id:     String(r.author_id || "").trim(),
      texto:  zdLimpiar_(r.comments),
      _row:   r,
    });
  });

  return orden.map(id => zdArmarTicket_(porTicket[id]));
}

function zdArmarTicket_(t) {
  t.comentariosRaw.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  t.canal = zdDetectarCanal_(t.tags, t.comentariosRaw);

  const turnos   = [];
  const banderas = [];
  let idCorrupto = false;
  let nombreCliente = "";

  // El encabezado del chat viene como "Conversation with <cliente>"
  t.comentariosRaw.forEach(c => {
    const m = c.texto.match(/^Conversation with\s+(.+)$/i);
    if (m) nombreCliente = m[1].trim();
  });

  t.comentariosRaw.forEach(c => {
    if (/e\+\d+/i.test(c.id) || /^\d{5,}0{6,}$/.test(c.id)) idCorrupto = true;
    const cls = zdClasificarComentario_(c._row);

    if (cls.tipo === "transcripcion") {
      const sub = zdExplotarTranscripcion_(c.texto);
      if (!sub.length) { if (c.texto) turnos.push({ fecha: c.fecha, tipo: "desconocido", quien: "?", texto: c.texto }); return; }
      if (!nombreCliente) nombreCliente = sub[0].quien;
      sub.forEach(s => {
        const q = zdClasificarTurno_(s.quien, nombreCliente);
        turnos.push({ fecha: c.fecha, hora: s.hora, tipo: q.tipo, quien: s.quien, texto: s.texto });
      });
      return;
    }

    if (!c.texto) { banderas.push("comentario_vacio"); return; }
    turnos.push({ fecha: c.fecha, tipo: cls.tipo, quien: cls.etiqueta + (c.mail ? " <" + c.mail + ">" : ""), texto: c.texto });
  });

  t.turnos   = turnos;
  t.metricas = zdMetricas_(t);

  // ── Banderas ──
  banderas.push("sin_campo_visibilidad");   // el extractor no trae public: nota interna vs público es inferido
  if (idCorrupto) banderas.push("author_id_corrupto");
  if (t.canal === "llamada") banderas.push("llamada_sin_transcripcion");
  if (t.metricas.turnosAgente === 0) banderas.push("sin_intervencion_de_agente");
  if (t.metricas.ultimoTurno === "cliente") banderas.push("cliente_habla_ultimo");
  if (t.metricas.preguntasTrasUltimaRespuesta > 0) banderas.push("preguntas_sin_responder");
  if (turnos.some(x => x.tipo === "sistema")) banderas.push("instruccion_interna_presente");
  if (turnos.some(x => x.tipo === "bot")) banderas.push("participa_bot");

  t.banderas = banderas.filter((b, i) => banderas.indexOf(b) === i);
  return t;
}

function zdMetricas_(t) {
  const turnos = t.turnos;
  const cuenta = tipo => turnos.filter(x => x.tipo === tipo).length;

  const primerCliente = turnos.filter(x => x.tipo === "cliente")[0];
  const primerAgente  = turnos.filter(x => x.tipo === "agente")[0];
  let horas = null;
  if (primerCliente && primerAgente && primerCliente.fecha && primerAgente.fecha) {
    const d = (new Date(primerAgente.fecha) - new Date(primerCliente.fecha)) / 3600000;
    if (!isNaN(d) && d >= 0) horas = Math.round(d * 10) / 10;
  }

  // Preguntas del cliente posteriores a la ÚLTIMA respuesta del agente.
  // Es una pista de abandono, no un veredicto: no detecta preguntas que
  // quedaron sin responder en medio del hilo.
  let idxUltAgente = -1;
  turnos.forEach((x, i) => { if (x.tipo === "agente") idxUltAgente = i; });
  const colgadas = turnos.slice(idxUltAgente + 1)
    .filter(x => x.tipo === "cliente" && x.texto.indexOf("?") >= 0).length;

  const ultimo = turnos.length ? turnos[turnos.length - 1].tipo : "";

  const m = {
    turnos:        turnos.length,
    turnosCliente: cuenta("cliente"),
    turnosAgente:  cuenta("agente"),
    turnosBot:     cuenta("bot"),
    turnosSistema: cuenta("sistema"),
    primeraRespuestaHoras: horas,
    ultimoTurno:   ultimo,
    preguntasTrasUltimaRespuesta: colgadas,
  };

  // En chat los tiempos que importan (primera respuesta, retoma) están en
  // la transcripción, no en la fecha del comentario: todos los turnos de
  // una transcripción comparten el mismo timestamp.
  if (t.canal === "chat") {
    const todos = zdSegundosTranscripcion_(turnos);
    // Un mismo ticket puede arrastrar turnos de una sesión de chat anterior
    // (p. ej. un "closed_message" de la madrugada). Se mide la última sesión.
    const seg = zdUltimaSesion_(todos);
    if (todos.length > seg.length) m.chatMultisesion = true;
    if (seg.length) {
      const primCli = seg.filter(x => x.tipo === "cliente")[0];
      const primAg  = seg.filter(x => x.tipo === "agente")[0];
      m.chatDuracionMin = Math.round((seg[seg.length - 1].s - seg[0].s) / 6) / 10;
      m.chatPrimeraRespuestaAgenteSeg = (primCli && primAg && primAg.s >= primCli.s)
        ? primAg.s - primCli.s : null;

      // Mayor espera del cliente hasta la siguiente intervención del agente
      let peor = null;
      seg.forEach((x, i) => {
        if (x.tipo !== "cliente") return;
        for (let j = i + 1; j < seg.length; j++) {
          if (seg[j].tipo === "agente") { const d = seg[j].s - x.s; if (peor === null || d > peor) peor = d; break; }
        }
      });
      m.chatMayorEsperaSeg = peor;
    }
  }
  return m;
}

/** Marcadores del sistema que no son conversación y no deben contar tiempos. */
const ZD_RE_MARCADOR = /^\s*(closed_message|<chat\s*(finalizado|ended)>|chat\s*(finalizado|ended))\s*$/i;

/** Convierte las horas "HH:MM:SS" de la transcripción a segundos corridos. */
function zdSegundosTranscripcion_(turnos) {
  const out = [];
  let base = 0, prev = -1;
  turnos.forEach(x => {
    if (!x.hora) return;
    if (ZD_RE_MARCADOR.test(x.texto || "")) return;    // closed_message, <chat finalizado>
    const p = x.hora.split(":");
    let s = (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
    if (prev >= 0 && s + base < prev) base += 86400;   // cruzó la medianoche
    s += base;
    prev = s;
    out.push({ tipo: x.tipo, s: s });
  });
  return out;
}

/** Corta la secuencia en la última sesión: un hueco de más de 2 h la separa. */
function zdUltimaSesion_(seg) {
  if (seg.length < 2) return seg;
  let inicio = 0;
  for (let i = 1; i < seg.length; i++) {
    if (seg[i].s - seg[i - 1].s > 7200) inicio = i;
  }
  return seg.slice(inicio);
}

// ============================================================
//  SALIDA
// ============================================================
function zdFormatearBloque_(t) {
  const L = [];
  L.push("TICKET: " + t.ticket);
  L.push("CANAL DETECTADO: " + t.canal);
  L.push("ESTADO FINAL: " + t.status);
  L.push("");
  L.push("--- DATOS DEL VIAJE (para consultar el sistema interno) ---");
  L.push("JOURNEY ID: " + (t.journeyId || "(el ticket no tiene viaje asociado)"));
  L.push("RIDER ID: "   + (t.riderId   || "(no disponible)"));
  L.push("FECHA SOLVED: " + (t.fechaSolved || "(no disponible)") +
         (t.fuenteFecha ? "   [fuente: " + t.fuenteFecha + "]" : ""));
  if (t.semanaSolved) L.push("SEMANA DE SOLVED: " + t.semanaSolved);
  if (t.agenteHist)   L.push("AGENTE ASIGNADO (segun Tableau): " + t.agenteHist);
  L.push("-----------------------------------------------------------");
  L.push("");
  L.push("CREADO: " + t.creado + "   ULTIMA ACTUALIZACION: " + t.actualizado);
  L.push("MOTIVO (contact_reason): " + t.contactReason);
  L.push("TAGS: " + t.tags.join(", "));
  L.push("METRICAS: " + JSON.stringify(t.metricas));
  L.push("BANDERAS: " + t.banderas.join(", "));
  L.push("");
  L.push("ADVERTENCIA: el extractor no entrega el campo de visibilidad. " +
         "El tipo de cada turno es inferido por rol y dominio de correo, no confirmado. " +
         "No emitas veredictos que dependan de distinguir nota interna de mensaje publico: " +
         "para esos criterios usa no_concluyente.");
  L.push("");
  L.push("=== TURNOS EN ORDEN ===");
  t.turnos.forEach((x, i) => {
    const marca = x.hora ? x.hora : (x.fecha || "");
    L.push("[" + (i + 1) + "] (" + x.tipo + ") " + x.quien + " — " + marca);
    L.push(x.texto || "(vacío)");
    L.push("");
  });
  return L.join("\n");
}

const ZD_HEADERS_CONVER = [
  // "Version reglas" va en el lado LIGERO a propósito. Es el sello con el que
  // se generó el prompt de esa fila. Antes había que leer el prompt entero
  // —16.000 caracteres por fila— solo para saber si estaba al día, y eso
  // colgaba la consola entera al abrirla. Un dato de 20 caracteres en una
  // columna ligera responde lo mismo sin leer nada pesado.
  "Ticket Number", "Audiencia", "Version reglas", "Canal",
  "Journey Id", "Fecha del viaje", "Rider Id",
  "Fecha solved", "Fuente fecha", "Semana solved",
  "Estado", "Creado", "Actualizado", "Motivo",
  "Turnos", "Turnos cliente", "Turnos agente", "Turnos bot",
  "1a respuesta (h)", "Ultimo turno", "Preguntas tras ultima resp.",
  "Chat: 1a resp (s)", "Chat: mayor espera (s)", "Chat: duracion (min)",
  "Banderas", "Auditable", "Estado auditoría", "Señales",
  "PROMPT AUDITORIA (copiar y pegar)", "Prompt solo viaje", "Conversacion",
];

/** Una fila de Conversaciones a partir del ticket normalizado. */
function zdFilaConversacion_(t) {
  const m = t.metricas;
  const num = v => (v === undefined || v === null) ? "" : v;
  const prompt = zdPromptAuditoria_(t);
  return [
    t.ticket,
    // Con qué matriz se auditó este ticket. Va en la hoja porque la consola,
    // la revisión y el recálculo de la nota la necesitan meses después, cuando
    // ya nadie se acuerda de qué grupo de Zendesk venía.
    t.audiencia || AUD_AUDIENCIA_DEFECTO,
    // El sello de las reglas con las que se generó el prompt de esta fila.
    // Vacío si no hay prompt (las llamadas no se auditan).
    prompt ? AUD_VERSION_REGLAS : "",
    t.canal,
    t.journeyId || "", t.journeyDate || "", t.riderId || "",
    t.fechaSolved || "", t.fuenteFecha || "", t.semanaSolved || "",
    t.status, t.creado, t.actualizado, t.contactReason,
    m.turnos, m.turnosCliente, m.turnosAgente, m.turnosBot,
    num(m.primeraRespuestaHoras), m.ultimoTurno, m.preguntasTrasUltimaRespuesta,
    num(m.chatPrimeraRespuestaAgenteSeg), num(m.chatMayorEsperaSeg), num(m.chatDuracionMin),
    // La bandera de truncado se calcula AL ESCRIBIR. Detectarla despues obliga
    // a leer la columna de la conversacion —hasta 45.000 caracteres por fila— y
    // eso cuelga cualquier panel que lo intente. Una marca en una columna
    // ligera cuesta lo mismo de escribir y nada de leer.
    (t.banderas.concat(zdBloqueTruncado_(t) ? ["conversacion_truncada"] : [])).join(", "),
    zdAuditable_(t),
    t.estadoAud || "",
    // Las señales se GUARDAN, no se recalculan. Se computan mientras existen los
    // turnos del extractor; después la fila ya no los tiene, y sin esta columna
    // regenerar el prompt producía "cierre_del_hilo: desconocido".
    JSON.stringify(t.senales || {}),
    zdRecortar_(prompt),
    t.promptMarketplace || "",
    zdRecortar_(zdFormatearBloque_(t)),
  ];
}

/**
 * Escribe Conversaciones ACUMULANDO, no reemplazando.
 *
 * Tres reglas, en este orden:
 *   1. Ticket que no estaba  -> se agrega.
 *   2. Ticket ya AUDITADO    -> no se toca. La conversación queda congelada
 *                               tal como estaba cuando se emitió el veredicto,
 *                               porque es la evidencia que lo respalda.
 *   3. Ticket sin auditar    -> se actualiza con los datos frescos.
 *
 * Las filas que no vienen en esta carga se conservan intactas. Así el
 * extractor puede traer registros repetidos sin que pase nada.
 *
 * El estado de auditoría se lee del Historico, que es la única fuente de
 * verdad sobre qué ya se auditó.
 */
function zdEscribirConversaciones_(tickets) {
  const ss = histGetSpreadsheet_(true);
  let sh = ss.getSheetByName(ZD.HOJA_CONVER);
  const existia = !!sh;
  if (!sh) sh = ss.insertSheet(ZD.HOJA_CONVER);

  const headers = ZD_HEADERS_CONVER;
  const previas = {};   // ticket -> fila
  const orden   = [];   // tickets en el orden en que ya estaban

  // --- 1. Leer lo que ya hay, mapeando POR NOMBRE de columna ---------------
  // Mapear por nombre y no por posición es lo que permite agregar columnas
  // nuevas sin descuadrar las filas viejas.
  if (existia && sh.getLastRow() >= 2 && sh.getLastColumn() >= 1) {
    const todo = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    const hv   = todo[0].map(h => String(h || "").trim());
    const cT   = hv.indexOf("Ticket Number");
    if (cT >= 0) {
      const idx = headers.map(h => hv.indexOf(h));   // -1 = columna nueva
      todo.slice(1).forEach(f => {
        const k = zdClaveTicket_(f[cT]);
        if (!k) return;
        if (!(k in previas)) orden.push(k);
        previas[k] = idx.map(i => (i >= 0 ? f[i] : ""));
      });
    }
  }
  const antes = orden.length;

  // --- 2. Mezclar con lo que trae esta carga -------------------------------
  const automaticos = (typeof HIST_ESTADOS_AUTOMATICOS !== "undefined")
    ? HIST_ESTADOS_AUTOMATICOS : ["", "Pendiente", "No aplica"];

  let nuevos = 0, actualizados = 0, congelados = 0;
  tickets.forEach(t => {
    const k = zdClaveTicket_(t.ticket);
    if (!k) return;
    const yaAuditado = automaticos.indexOf(String(t.estadoAud || "").trim()) < 0;

    if (!(k in previas)) {
      previas[k] = zdFilaConversacion_(t); orden.push(k); nuevos++;
    } else if (yaAuditado) {
      congelados++;                         // regla 2: no se toca
    } else {
      previas[k] = zdFilaConversacion_(t); actualizados++;
    }
  });
  const intactos = antes - actualizados - congelados;

  // --- 3. Escribir la hoja completa ----------------------------------------
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  sh.setFrozenRows(1);

  const filas = orden.map(k => previas[k]);
  if (filas.length) {
    sh.getRange(2, 1, filas.length, headers.length).setValues(filas);
    // IDs siempre como texto, para que no se conviertan en número ni en fecha
    [1, 3, 5].forEach(c => sh.getRange(2, c, filas.length, 1).setNumberFormat("@"));
  }

  Logger.log("Conversaciones: %s filas | nuevos %s | actualizados %s | congelados (ya auditados) %s | intactos %s",
             filas.length, nuevos, actualizados, congelados, intactos);
  return { total: filas.length, nuevos: nuevos, actualizados: actualizados,
           congelados: congelados, intactos: intactos };
}

/** Ninguna celda de Sheets aguanta más de 50.000 caracteres. */
/** ¿El bloque formateado de este ticket no cabe en una celda? */
function zdBloqueTruncado_(t) {
  try { return String(zdFormatearBloque_(t) || "").length > ZD.MAX_CHARS_CELDA; }
  catch (e) { return false; }
}

function zdRecortar_(s) {
  const txt = String(s || "");
  return txt.length > ZD.MAX_CHARS_CELDA
    ? txt.slice(0, ZD.MAX_CHARS_CELDA) + "\n[...TRUNCADO: pega la conversación completa desde el bloque original...]"
    : txt;
}

/**
 * Prompt completo de auditoría. Vive en Auditoria.gs; si ese archivo no
 * está en el proyecto, la columna queda vacía en vez de romper la carga.
 */
function zdPromptAuditoria_(t) {
  if (typeof audPromptAuditoria_ !== "function") return "";
  try { return audPromptAuditoria_(t); }
  catch (e) { Logger.log("No se pudo armar el prompt de %s: %s", t.ticket, e.message); return ""; }
}

/**
 * Si el ticket se puede auditar, y si no, por qué.
 * Combina el alcance del histórico (Tableau) con lo que muestra la
 * conversación real de Zendesk. Ante desacuerdo manda la conversación.
 */
/**
 * ¿Se puede auditar esta conversación?
 *
 * OJO CON LA DIFERENCIA ENTRE "NO" Y EL RESTO, que costó 191 tickets invisibles:
 *
 *   "NO (…)"              lo impide LA CONVERSACIÓN misma. Es permanente: una
 *                         llamada sin transcripción no va a dejar de serlo, y un
 *                         hilo sin ni un turno de agente tampoco.
 *   "FUERA DE ALCANCE"    lo dice el HISTÓRICO, y el histórico cambia. Es
 *                         informativo: la consola lo vuelve a consultar en vivo.
 *   "PARCIAL"             se puede auditar, con menos datos.
 *
 * Las dos versiones anteriores mezclaban las dos cosas en un "NO". Resultado:
 * un ticket de aeropuerto sin viaje entraba como
 * "NO (sin viaje asociado)" —porque el histórico aún lo evaluaba con la regla
 * de B2B— y se quedaba así PARA SIEMPRE, aunque después se corrigiera el
 * histórico. Nada recalculaba esta celda.
 *
 * Y peor: el "PARCIAL (sin viaje asociado)" se emitía para todas las
 * audiencias. En aeropuerto no tener viaje es lo normal, no una carencia.
 */
function zdAuditable_(t) {
  if (t.canal === "llamada")         return "NO (llamada sin transcripcion)";
  if (t.metricas && t.metricas.turnosAgente === 0)
                                     return "NO (sin intervencion de agente humano)";

  // Lo que dice el histórico se anota, pero NO como un "NO": es un dato que
  // puede cambiar y la consola lo consulta en vivo.
  if (t.auditableHist === "NO")      return "FUERA DE ALCANCE (" + (t.motivoHist || "segun el historico") + ")";

  // "sin viaje" solo es una carencia donde el viaje hace falta. En aeropuerto
  // la mitad de los tickets son preguntas sobre el servicio y nunca lo tuvieron.
  if (!t.journeyId) {
    const alcance = (typeof audAlcanceDe_ === "function")
      ? audAlcanceDe_(t.audiencia || AUD_AUDIENCIA_DEFECTO) : { EXIGIR_JOURNEY: true };
    return alcance.EXIGIR_JOURNEY ? "PARCIAL (sin viaje asociado)" : "SI";
  }
  return "SI";
}

/**
 * Recalcula la columna "Auditable" de Conversaciones.
 *
 * Hace falta porque esa celda se escribió una vez, al ingerir, con el veredicto
 * que daba el histórico en ese momento. Si el histórico se corrige después
 * —y se corrigió: los tickets de aeropuerto se habían evaluado con el alcance
 * de B2B— la celda se queda con el valor viejo y el ticket no aparece nunca.
 *
 * Lee solo columnas ligeras: Ticket, Canal, Turnos agente y Auditable. Nunca
 * la conversación ni los prompts.
 */
function zdRecalcularAuditable() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2) { Logger.log("No hay filas en Conversaciones."); return { filas: 0 }; }

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const i = n => h.indexOf(n);
  const cT = i("Ticket Number"), cC = i("Canal"), cTA = i("Turnos agente"),
        cJ = i("Journey Id"), cAu = i("Auditable"), cAud = i("Audiencia");
  if (cT < 0 || cAu < 0) throw new Error("Conversaciones no tiene Ticket Number o Auditable.");

  const n = sh.getLastRow() - 1;
  const leer = k => k >= 0 ? sh.getRange(2, k + 1, n, 1).getValues().map(f => f[0]) : new Array(n).fill("");
  const tks = leer(cT), canales = leer(cC), turnos = leer(cTA),
        journeys = leer(cJ), actual = leer(cAu), audsCol = leer(cAud);

  // El histórico, en vivo: es la fuente de verdad del alcance.
  const hist = zdLeerHistorico_();

  const nuevos = [];
  let cambios = 0, aSi = 0;
  for (let k = 0; k < n; k++) {
    const id = zdClaveTicket_(tks[k]);
    const hh = id ? hist[id] : null;
    const t = {
      canal: String(canales[k] || "").trim() || "ticket",
      metricas: { turnosAgente: Number(turnos[k] || 0) },
      journeyId: String(journeys[k] || "").trim() || (hh ? hh.journey : ""),
      auditableHist: hh ? hh.auditable : "",
      motivoHist: hh ? hh.motivo : "",
      audiencia: (String(audsCol[k] || "").trim() || (hh && hh.audiencia) || "").trim() ||
                 AUD_AUDIENCIA_DEFECTO,
    };
    const v = zdAuditable_(t);
    const antes = String(actual[k] || "").trim();
    if (v !== antes) {
      cambios++;
      if (v.indexOf("NO") !== 0 && antes.indexOf("NO") === 0) aSi++;
    }
    nuevos.push([v]);
  }

  sh.getRange(2, cAu + 1, n, 1).setValues(nuevos);
  SpreadsheetApp.flush();

  const cuenta = {};
  nuevos.forEach(f => {
    const k = String(f[0]).split(" (")[0];
    cuenta[k] = (cuenta[k] || 0) + 1;
  });
  Logger.log("Auditable recalculado en %s filas; %s cambiaron.", n, cambios);
  Logger.log("%s dejaron de estar bloqueadas por un valor viejo.", aSi);
  Logger.log("Reparto: %s", Object.keys(cuenta).map(k => k + ": " + cuenta[k]).join(" | "));
  return { filas: n, cambios: cambios, desbloqueados: aSi, reparto: cuenta };
}
