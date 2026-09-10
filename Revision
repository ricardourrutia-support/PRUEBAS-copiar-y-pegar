/**
 * ============================================================
 *  REVISIÓN HUMANA DE LAS AUDITORÍAS DEL AGENTE
 * ============================================================
 *
 * Para qué sirve
 * --------------
 * El agente emite veredictos. Esta app se los muestra a una persona que
 * sabe auditar, para que diga si están bien o mal, criterio por criterio.
 * De ahí salen dos cosas:
 *
 *   1. Un número honesto de cuánto acierta el modelo.
 *   2. La lista de qué criterios falla, que es lo que permite corregir
 *      las reglas en vez de adivinar.
 *
 * Hojas que escribe
 * -----------------
 *   Revisiones  — una fila por ticket revisado
 *   Desacuerdos — una fila por criterio en el que la persona discrepa
 *
 * Ninguna de las dos se toca desde ningún otro script. Son de la persona
 * que revisa.
 *
 * Cómo se publica
 * ---------------
 *   1. Pega este archivo y Revision.html en el proyecto de Apps Script.
 *   2. Ejecuta revSetup() una vez.
 *   3. Implementar ▸ Nueva implementación ▸ Aplicación web.
 *      Ejecutar como: yo.  Acceso: cualquiera de la organización.
 *
 * OJO si ya tienes un doGet en el proyecto (el dashboard de CSAT/NPS):
 * dos doGet no pueden convivir. Deja el tuyo y desde él llama a
 * revServirApp() cuando el parámetro lo pida. Ejemplo al final del archivo.
 */

const REV = {
  HOJA_REVISIONES:  "Revisiones",
  HOJA_DESACUERDOS: "Desacuerdos",
  TZ:               "America/Santiago",
  TITULO:           "Revisión de auditorías — Cabify Chile",
  // Modo de revisión con el que se guarda cada registro. "abierta" = la
  // persona ve el veredicto del agente desde el principio.
  MODO: "abierta",
};

/** Veredicto que la persona puede dar sobre la auditoría completa. */
const REV_VEREDICTOS_TICKET = ["correcta", "parcial", "incorrecta"];

/** Por qué se equivocó el modelo. Es lo que dice qué hay que arreglar. */
const REV_TIPOS_ERROR = [
  "regla",      // la instrucción estaba mal escrita o era ambigua
  "dato",       // le faltó información para poder concluir
  "criterio",   // tenía todo y aun así juzgó mal
];

// ============================================================
//  ENTRADAS
// ============================================================

/** Ejecutar una vez: crea las dos hojas. */
function revSetup() {
  const ss = histGetSpreadsheet_(true);
  revHojaRevisiones_(ss);
  revHojaDesacuerdos_(ss);
  Logger.log("Listo. Hojas '%s' y '%s' creadas.\nAhora publica la app: Implementar ▸ Nueva implementación ▸ Aplicación web.",
             REV.HOJA_REVISIONES, REV.HOJA_DESACUERDOS);
  return ss.getUrl();
}

/*
 * La revisión NO se sirve sola: es la pestaña 3 de la consola.
 * El doGet vive en Consola.gs y Revision.html se incluye desde Consola.html.
 */

// ============================================================
//  LECTURA — lo que consume la interfaz
// ============================================================

/**
 * Lista de tickets que YA tienen veredicto del agente, con su estado de
 * revisión humana. Es lo que llena el panel de la izquierda.
 */
function revListaTickets(audiencia) {
  const ss = histGetSpreadsheet_(true);
  const ver = revLeerVeredictos_(ss);
  const rev = revLeerRevisiones_(ss);
  const hist = revLeerHistorico_(ss);
  const filtro = String(audiencia || "").trim();

  const out = [];
  Object.keys(ver).forEach(t => {
    const v = ver[t];
    const r = rev[t];
    const h = hist[t] || {};
    // Un ticket auditado antes de que existiera la columna no tiene audiencia
    // escrita. Cae en la por defecto, que es con la que efectivamente se
    // auditó: no es una suposición, es lo que pasó.
    const aud = h.audiencia || AUD_AUDIENCIA_DEFECTO;
    if (filtro && aud !== filtro) return;
    out.push({
      ticket: t,
      canal: v.canal,
      audiencia: aud,
      audienciaNombre: audNombreAudiencia_(aud),
      criterios: v.filas.length,
      incumplidos: v.filas.filter(f => f.veredicto === "no_cumple").length,
      noConcluyentes: v.filas.filter(f => f.veredicto === "no_concluyente").length,
      notaModelo: h.nota === undefined ? "" : h.nota,
      estadoModelo: h.estado || "",
      agente: h.agente || "",
      revisado: !!r,
      veredictoRevisor: r ? r.veredicto : "",
      desacuerdos: r ? r.desacuerdos : 0,
      revisor: r ? r.revisor : "",
      fechaRevision: r ? r.fecha : "",
    });
  });

  out.sort((a, b) => (a.revisado === b.revisado)
    ? String(b.ticket).localeCompare(String(a.ticket))
    : (a.revisado ? 1 : -1));   // primero lo que falta revisar
  return out;
}

/**
 * Las audiencias que tienen al menos un ticket auditado, para el selector
 * de la pestaña. Igual que en el paso 2: no se ofrecen filtros vacíos.
 */
function revAudiencias() {
  const ss = histGetSpreadsheet_(true);
  const ver = revLeerVeredictos_(ss);
  const hist = revLeerHistorico_(ss);
  const cuenta = {};
  Object.keys(ver).forEach(t => {
    const a = (hist[t] && hist[t].audiencia) || AUD_AUDIENCIA_DEFECTO;
    cuenta[a] = (cuenta[a] || 0) + 1;
  });
  return audAudiencias_().filter(k => cuenta[k])
    .map(k => ({ clave: k, nombre: audNombreAudiencia_(k), auditados: cuenta[k] }));
}

/**
 * Lo que la pestaña de revisión necesita para UN ticket.
 *
 * Deliberadamente NO trae la conversación ni el json del viaje. Lo que se
 * revisa acá es el trabajo del agente: qué dictaminó en cada criterio, con qué
 * cita lo respalda y qué nota salió de eso. La conversación se pide aparte,
 * con revConversacionDe(), solo si la persona quiere leerla — son 45.000
 * caracteres que en la mayoría de las revisiones nadie abre.
 */
function revCargarTicket(ticket) {
  const t = zdClaveTicket_(ticket);
  const ss = histGetSpreadsheet_(true);

  const ver = revVeredictosDe_(ss, t);
  if (!ver) throw new Error("El ticket " + t + " no tiene veredictos del agente.");

  const hist = revHistoricoDe_(ss, t);
  const prev = revLeerRevisionCompleta_(ss, t);

  // La nota se recalcula acá en vez de leerla: es aritmética pura sobre datos
  // que ya tenemos, y así el techo y la cobertura salen siempre coherentes con
  // los veredictos que se están mostrando.
  const audiencia = hist.audiencia || AUD_AUDIENCIA_DEFECTO;
  const calc = audCalcularNota_(ver.canal, ver.filas.map(f => ({
    id: f.criterioId, veredicto: f.veredicto, cita: f.cita,
    autor: f.autor, fuente: f.fuente, confianza: f.confianza,
  })), audiencia);

  return {
    ticket: t,
    canal: ver.canal,
    audiencia: audiencia,
    audienciaNombre: audNombreAudiencia_(audiencia),
    criterios: ver.filas,
    puntaje: {
      nota: calc.nota, techo: calc.techo, estado: calc.estado,
      cobertura: calc.cobertura, aplicables: calc.aplicables, evaluados: calc.evaluados,
      criticos: calc.criticosIncumplidos, porConfirmar: calc.criticosPorConfirmar,
      noConcluyentes: calc.noConcluyentes, avisos: calc.avisos,
    },
    notaEnHistorico: hist.nota === undefined ? null : hist.nota,
    agente: hist.agente || "",
    revision: prev.revision,
    desacuerdos: prev.desacuerdos,
    tiposError: REV_TIPOS_ERROR,
  };
}

/** La conversación, solo cuando la persona la pide. */
function revConversacionDe(ticket) {
  const ss = histGetSpreadsheet_(true);
  const c = revLeerConversacion_(ss, zdClaveTicket_(ticket));
  return {
    conversacion: c.conversacion || "(no está la conversación en la hoja Conversaciones)",
    metadatos: c.metadatos || {},
  };
}

/** El json del viaje que devolvió el agente, solo cuando se pide. */
function revViajeDe(ticket) {
  const ss = histGetSpreadsheet_(true);
  return { viaje: revLeerViaje_(ss, zdClaveTicket_(ticket)) || "(no se guardó el json del viaje)" };
}

/** Números agregados para la cabecera. */
function revResumen() {
  const ss = histGetSpreadsheet_(true);
  const ver = revLeerVeredictos_(ss);
  const rev = revLeerRevisiones_(ss);
  const des = revLeerDesacuerdosTodos_(ss);

  const totalConVeredicto = Object.keys(ver).length;
  const revisados = Object.keys(rev);
  const porVeredicto = { correcta: 0, parcial: 0, incorrecta: 0 };
  let criteriosRevisados = 0;

  revisados.forEach(t => {
    const r = rev[t];
    if (porVeredicto[r.veredicto] !== undefined) porVeredicto[r.veredicto]++;
    criteriosRevisados += r.criterios || 0;
  });

  // Ranking de criterios que más falla el modelo
  const porCriterio = {};
  des.forEach(d => {
    if (!porCriterio[d.criterioId]) porCriterio[d.criterioId] =
      { id: d.criterioId, texto: d.criterio, n: 0, regla: 0, dato: 0, criterio: 0 };
    const p = porCriterio[d.criterioId];
    p.n++;
    if (p[d.tipoError] !== undefined) p[d.tipoError]++;
  });
  const ranking = Object.keys(porCriterio).map(k => porCriterio[k])
    .sort((a, b) => b.n - a.n).slice(0, 10);

  const acuerdoCriterios = criteriosRevisados
    ? Math.round((criteriosRevisados - des.length) / criteriosRevisados * 100) : null;

  return {
    totalConVeredicto: totalConVeredicto,
    revisados: revisados.length,
    pendientes: totalConVeredicto - revisados.length,
    porVeredicto: porVeredicto,
    criteriosRevisados: criteriosRevisados,
    desacuerdos: des.length,
    acuerdoCriterios: acuerdoCriterios,
    ranking: ranking,
    modo: REV.MODO,
  };
}

// ============================================================
//  ESCRITURA
// ============================================================

/**
 * Guarda una revisión. Reemplaza la anterior de ese ticket si existía,
 * así se puede corregir sin duplicar.
 *
 * payload = {
 *   ticket, canal, veredicto: "correcta|parcial|incorrecta",
 *   observaciones: "",
 *   desacuerdos: [{criterioId, veredictoRevisor, tipoError, comentario}]
 * }
 */
function revGuardar(payload) {
  const t = zdClaveTicket_(payload && payload.ticket);
  if (!t) throw new Error("Falta el número de ticket.");
  if (REV_VEREDICTOS_TICKET.indexOf(payload.veredicto) < 0)
    throw new Error("Veredicto no válido: " + payload.veredicto);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = histGetSpreadsheet_(true);
    // Los veredictos COMPLETOS de este ticket: acá hacen falta el criterio_id
    // y la cita para poder recalcular. La versión ligera que usa la lista solo
    // trae el veredicto y no sirve para esto.
    const ver = revVeredictosDe_(ss, t);
    if (!ver) throw new Error("El ticket " + t + " no tiene veredictos del agente.");

    const desac = (payload.desacuerdos || []).filter(d => d && d.criterioId);
    const porId = {};
    ver.filas.forEach(f => { porId[f.criterioId] = f; });

    // Un incumplimiento afirmado por una persona necesita que diga en qué se
    // basa. Es la misma exigencia que le hacemos al agente.
    const sinFundamento = desac.filter(d =>
      d.veredictoRevisor === "no_cumple" && !String(d.comentario || "").trim());
    if (sinFundamento.length)
      throw new Error("Marcaste no_cumple sin explicar en qué te basas: " +
                      sinFundamento.map(d => d.criterioId).join(", "));

    // --- nota corregida: se recalcula con los veredictos de la persona ---
    //
    // OJO con la cita. El motor degrada a no_concluyente todo no_cumple que
    // llegue sin cita textual, porque un modelo no puede afirmar sin pruebas.
    // Una persona sí: su comentario ES la evidencia, y su juicio se da por
    // confiable. Si no hiciéramos esto, un revisor no podría corregir jamás
    // un criterio que el agente dejó pasar.
    const corregidos = ver.filas.map(f => {
      const d = desac.filter(x => x.criterioId === f.criterioId)[0];
      if (!d || !d.veredictoRevisor) {
        return { id: f.criterioId, veredicto: f.veredicto, cita: f.cita,
                 autor: f.autor, fuente: f.fuente, confianza: f.confianza };
      }
      return {
        id: f.criterioId,
        veredicto: d.veredictoRevisor,
        cita: String(d.comentario || "").trim() || f.cita,
        autor: f.autor,
        fuente: "revision_humana",
        confianza: "alta",
      };
    });
    // El histórico se lee UNA vez y sirve para dos cosas: la audiencia con la
    // que se recalcula y la nota previa que va al registro. Antes se leía
    // después del recálculo y hacía falta una segunda pasada solo para saber
    // con qué matriz puntuar.
    const hist = revLeerHistorico_(ss)[t] || {};
    const recalculo = audCalcularNota_(ver.canal, corregidos,
                                       hist.audiencia || AUD_AUDIENCIA_DEFECTO);

    const revisor = revUsuario_();
    const fecha   = Utilities.formatDate(new Date(), REV.TZ, "yyyy-MM-dd HH:mm");

    revBorrarFilas_(revHojaRevisiones_(ss), t);
    revBorrarFilas_(revHojaDesacuerdos_(ss), t);

    revHojaRevisiones_(ss).appendRow([
      t, ver.canal, revisor, fecha, REV.MODO,
      hist.nota === undefined ? "" : hist.nota,
      hist.estado || "",
      payload.veredicto,
      ver.filas.length,
      desac.length,
      recalculo.nota,
      recalculo.estado,
      String(payload.observaciones || "").slice(0, 40000),
    ]);

    if (desac.length) {
      const filas = desac.map(d => {
        const f = porId[d.criterioId] || {};
        return [t, d.criterioId, f.criterio || "", f.afectacion || "",
                f.veredicto || "", d.veredictoRevisor || "",
                d.tipoError || "", String(d.comentario || "").slice(0, 20000),
                revisor, fecha];
      });
      const sh = revHojaDesacuerdos_(ss);
      sh.getRange(sh.getLastRow() + 1, 1, filas.length, filas[0].length).setValues(filas);
    }

    revFormatoTexto_(revHojaRevisiones_(ss));
    revFormatoTexto_(revHojaDesacuerdos_(ss));

    return {
      ok: true, ticket: t,
      notaModelo: hist.nota === undefined ? null : hist.nota,
      notaCorregida: recalculo.nota,
      estadoCorregido: recalculo.estado,
      desacuerdos: desac.length,
    };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
//  BORRAR AUDITORÍAS PARA REHACERLAS
// ============================================================

/**
 * Borra la auditoría de un ticket y lo devuelve a la cola.
 *
 * Quita sus veredictos, el json del viaje, y limpia las columnas de auditoría
 * del histórico dejando el estado en "Pendiente". Con eso el ticket vuelve a
 * aparecer en el paso 2 y se puede auditar de nuevo con las reglas nuevas.
 *
 * La REVISIÓN HUMANA no se toca por defecto, y es a propósito: es el registro
 * de que el modelo se equivocó en tal criterio, y borrarlo sería perder
 * justamente la evidencia con la que mides si mejoró. Si quieres empezar de
 * cero de verdad, pasa tambienRevision = true.
 */
function revBorrarAuditoria(ticket, tambienRevision) {
  const t = zdClaveTicket_(ticket);
  if (!t) throw new Error("Falta el número de ticket.");

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = histGetSpreadsheet_(true);
    const out = { ticket: t, veredictos: 0, viaje: 0, revision: 0, desacuerdos: 0, historico: false };

    const shV = ss.getSheetByName(AUD.HOJA_VEREDICTOS);
    if (shV) out.veredictos = revBorrarFilas_(shV, t);

    const shJ = ss.getSheetByName(AUD.HOJA_VIAJES);
    if (shJ) out.viaje = revBorrarFilas_(shJ, t);

    if (tambienRevision) {
      const shR = ss.getSheetByName(REV.HOJA_REVISIONES);
      if (shR) out.revision = revBorrarFilas_(shR, t);
      const shD = ss.getSheetByName(REV.HOJA_DESACUERDOS);
      if (shD) out.desacuerdos = revBorrarFilas_(shD, t);
    }

    out.historico = revLimpiarHistorico_(ss, t);
    Logger.log("Auditoría borrada de %s: %s veredictos, viaje %s, revisión %s",
               t, out.veredictos, out.viaje, out.revision);
    return out;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Borra TODAS las auditorías. Es para cuando cambias las reglas de la matriz y
 * quieres rehacer la tanda completa. No borra ni las conversaciones ni el
 * histórico: solo los veredictos y las notas.
 */
function revBorrarTodasLasAuditorias(tambienRevisiones) {
  const ss = histGetSpreadsheet_(true);

  // Los tickets con veredicto, leyendo solo la primera columna. No se usa el
  // helper de Consola.gs a propósito: este archivo no debe depender de la
  // consola, solo de Zendesk.gs y Auditoria.gs.
  const shV0 = ss.getSheetByName(AUD.HOJA_VEREDICTOS);
  const vistos = {};
  if (shV0 && shV0.getLastRow() > 1) {
    shV0.getRange(2, 1, shV0.getLastRow() - 1, 1).getValues().forEach(r => {
      const k = zdClaveTicket_(r[0]);
      if (k) vistos[k] = true;
    });
  }
  const tickets = Object.keys(vistos);
  if (!tickets.length) return { tickets: 0 };

  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    // Vaciar las hojas de una vez es mucho más rápido que borrar fila a fila.
    revVaciarHoja_(ss.getSheetByName(AUD.HOJA_VEREDICTOS));
    revVaciarHoja_(ss.getSheetByName(AUD.HOJA_VIAJES));
    if (tambienRevisiones) {
      revVaciarHoja_(ss.getSheetByName(REV.HOJA_REVISIONES));
      revVaciarHoja_(ss.getSheetByName(REV.HOJA_DESACUERDOS));
    }
    tickets.forEach(t => revLimpiarHistorico_(ss, t));

    Logger.log("Borradas las auditorías de %s tickets%s", tickets.length,
               tambienRevisiones ? " (también las revisiones)" : "");
    // Lo que NO se toca, para que quede dicho: las conversaciones extraídas,
    // el histórico de tickets y la hoja "Respuestas". Esa última guarda lo que
    // dijo el agente palabra por palabra, y es la evidencia con la que se
    // puede reconstruir una nota que alguien discuta en tres meses. Borrarla
    // al "empezar de cero" sería tirar justo lo que no se puede recuperar.
    Logger.log("Intactas: Conversaciones, Historico y Respuestas (la evidencia literal).");
    return { tickets: tickets.length, revisiones: !!tambienRevisiones,
             intactas: ["Conversaciones", "Historico", "Respuestas"] };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Deja la hoja solo con su cabecera.
 *
 * OJO CON ESTO, que costó un error en producción:
 * Google Sheets NO permite que una hoja se quede sin filas MÓVILES — las que
 * no están congeladas. Todas nuestras hojas tienen la fila 1 congelada
 * (setFrozenRows(1)), así que si la hoja tiene exactamente tantas filas como
 * datos, un deleteRows(2, ultima-1) intenta borrar TODAS las móviles y
 * Sheets lanza "No puedes borrar todas las filas móviles".
 *
 * La solución es conservar SIEMPRE una fila móvil y vaciarle el contenido en
 * vez de borrarla. Queda una fila en blanco bajo la cabecera, que es
 * inofensiva: getLastRow() se calcula por contenido y devuelve 1, que es lo
 * que miran todos los lectores.
 */
function revVaciarHoja_(sh) {
  if (!sh) return 0;
  const ultima = sh.getLastRow();
  if (ultima < 2) return 0;
  const borradas = ultima - 1;

  // La primera fila que Sheets considera móvil. Se toma al menos la 2 porque
  // todas estas hojas tratan la 1 como cabecera, congelada o no.
  const primeraMovil = Math.max(sh.getFrozenRows(), 1) + 1;
  const maxFilas = sh.getMaxRows();

  // Se borra todo lo que hay POR DEBAJO de esa fila…
  if (maxFilas > primeraMovil) sh.deleteRows(primeraMovil + 1, maxFilas - primeraMovil);
  // …y a la que sobrevive se le quita el contenido.
  sh.getRange(primeraMovil, 1, 1, sh.getMaxColumns()).clearContent();

  return borradas;
}

/** Devuelve las columnas de auditoría del histórico a su estado inicial. */
function revLimpiarHistorico_(ss, ticket) {
  const nombre = (typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico";
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return false;

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const nFila = zdFilaDeTicket_(sh, ticket);
  if (nFila < 0) return false;

  const pendiente = (typeof HIST !== "undefined" && HIST.ESTADO_INICIAL) ? HIST.ESTADO_INICIAL : "Pendiente";
  const poner = (nombreCol, valor) => {
    const i = h.indexOf(nombreCol);
    if (i >= 0) sh.getRange(nFila, i + 1).setValue(valor);
  };

  poner("Estado auditoría", pendiente);   // vuelve a ser elegible
  ["Resultado", "Motivo", "Auditor", "Fecha auditoría", "Notas"].forEach(c => poner(c, ""));
  return true;
}

// ============================================================
//  LECTORES INTERNOS
// ============================================================

/**
 * Los veredictos de UN ticket.
 *
 * Localiza el bloque de filas de ese ticket leyendo solo la columna 1 y
 * después lee ese bloque. La hoja Veredictos crece 24 a 29 filas por cada
 * ticket auditado: traerla entera para mostrar uno es lo que se hacía antes.
 */
function revVeredictosDe_(ss, ticket) {
  const sh = ss.getSheetByName(AUD.HOJA_VEREDICTOS);
  if (!sh || sh.getLastRow() < 2) return null;

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const c = n => h.indexOf(n);
  if (c("Ticket Number") < 0) return null;

  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  let desde = -1, hasta = -1;
  for (let i = 0; i < ids.length; i++) {
    if (zdClaveTicket_(ids[i][0]) !== ticket) continue;
    if (desde < 0) desde = i;
    hasta = i;
  }
  if (desde < 0) return null;

  const vals = sh.getRange(desde + 2, 1, hasta - desde + 1, h.length).getValues();
  const filas = [];
  let canal = "ticket";
  vals.forEach(r => {
    if (zdClaveTicket_(r[c("Ticket Number")]) !== ticket) return;   // por si el bloque no es contiguo
    canal = String(r[c("Canal")] || canal);
    filas.push({
      criterioId:  String(r[c("criterio_id")] || "").trim(),
      criterio:    String(r[c("Criterio")]    || ""),
      afectacion:  String(r[c("Afectacion")]  || ""),
      descuento:   r[c("Descuento")],
      veredicto:   String(r[c("Veredicto")]   || "").trim().toLowerCase(),
      autor:       String(r[c("Autor evaluado")] || ""),
      cita:        String(r[c("Cita")]        || ""),
      fuente:      String(r[c("Fuente")]      || ""),
      confianza:   String(r[c("Confianza")]   || ""),
    });
  });
  return filas.length ? { canal: canal, filas: filas } : null;
}

/**
 * Resumen por ticket para la LISTA de la izquierda.
 * Lee solo tres columnas — ticket, canal y veredicto — y deja fuera las citas,
 * que son el grueso del peso de esta hoja y que la lista no muestra.
 */
function revLeerVeredictos_(ss) {
  const sh = ss.getSheetByName(AUD.HOJA_VEREDICTOS);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cT = h.indexOf("Ticket Number"), cC = h.indexOf("Canal"), cV = h.indexOf("Veredicto");
  if (cT < 0 || cV < 0) return out;

  const n = sh.getLastRow() - 1;
  const ids  = sh.getRange(2, cT + 1, n, 1).getValues();
  const vers = sh.getRange(2, cV + 1, n, 1).getValues();
  const cans = cC >= 0 ? sh.getRange(2, cC + 1, n, 1).getValues() : null;

  for (let i = 0; i < n; i++) {
    const t = zdClaveTicket_(ids[i][0]);
    if (!t) continue;
    if (!out[t]) out[t] = { canal: cans ? String(cans[i][0] || "ticket") : "ticket", filas: [] };
    out[t].filas.push({ veredicto: String(vers[i][0] || "").trim().toLowerCase() });
  }
  return out;
}

/**
 * La conversación de UN ticket.
 *
 * Se busca la fila leyendo solo la primera columna y después se lee esa fila
 * sola. Antes se traía la hoja entera, y como cada fila carga la conversación
 * completa y los dos prompts —hasta 45.000 caracteres cada uno— la llamada se
 * colgaba en cuanto había unos cuantos tickets extraídos.
 */
function revLeerConversacion_(ss, ticket) {
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2) return {};

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  if (h.indexOf("Ticket Number") < 0) return {};

  const nFila = zdFilaDeTicket_(sh, ticket);
  if (nFila < 0) return {};

  const fila = sh.getRange(nFila, 1, 1, sh.getLastColumn()).getValues()[0];
  const val = n => { const i = h.indexOf(n); return i >= 0 ? fila[i] : ""; };
  return {
    conversacion: String(val("Conversacion") || ""),
    metadatos: {
      canal: val("Canal"),
      journeyId: val("Journey Id"),
      journeyDate: val("Fecha del viaje"),
      riderId: val("Rider Id"),
      fechaSolved: val("Fecha solved"),
      motivo: val("Motivo"),
      turnos: val("Turnos"),
      banderas: val("Banderas"),
    },
  };
}

function revLeerViaje_(ss, ticket) {
  const sh = ss.getSheetByName(AUD.HOJA_VIAJES);
  if (!sh || sh.getLastRow() < 2) return "";
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cJ = h.indexOf("JSON");
  if (cJ < 0) return "";
  const nFila = zdFilaDeTicket_(sh, ticket);
  if (nFila < 0) return "";
  return String(sh.getRange(nFila, cJ + 1).getValue() || "");
}

function revLeerHistorico_(ss) {
  const nombre = (typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico";
  const sh = ss.getSheetByName(nombre);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = vals[0].map(x => String(x || "").trim());
  const cT = h.indexOf("Ticket Number");
  if (cT < 0) return out;
  const cRes = h.indexOf("Resultado"), cEst = h.indexOf("Estado auditoría"),
        cAge = h.indexOf("Assignee FullName"), cAud = h.indexOf("Audiencia");
  vals.slice(1).forEach(r => {
    const t = zdClaveTicket_(r[cT]);
    if (!t) return;
    const bruto = cRes >= 0 ? r[cRes] : "";
    const nota = (bruto === "" || bruto === null) ? undefined : Number(bruto);
    out[t] = {
      nota: isNaN(nota) ? undefined : nota,
      estado: cEst >= 0 ? String(r[cEst] || "") : "",
      agente: cAge >= 0 ? String(r[cAge] || "") : "",
      audiencia: cAud >= 0 ? String(r[cAud] || "") : "",
    };
  });
  return out;
}

function revLeerRevisiones_(ss) {
  const sh = ss.getSheetByName(REV.HOJA_REVISIONES);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = vals[0].map(x => String(x || "").trim());
  const c = n => h.indexOf(n);
  vals.slice(1).forEach(r => {
    const t = zdClaveTicket_(r[c("Ticket Number")]);
    if (!t) return;
    out[t] = {
      revisor:     String(r[c("Revisor")] || ""),
      fecha:       String(r[c("Fecha revisión")] || ""),
      veredicto:   String(r[c("Veredicto revisor")] || ""),
      criterios:   Number(r[c("Criterios revisados")]) || 0,
      desacuerdos: Number(r[c("En desacuerdo")]) || 0,
      observaciones: String(r[c("Observaciones")] || ""),
    };
  });
  return out;
}

function revLeerRevisionCompleta_(ss, ticket) {
  const rev = revLeerRevisiones_(ss)[ticket] || null;
  const des = revLeerDesacuerdosTodos_(ss).filter(d => d.ticket === ticket);
  return { revision: rev, desacuerdos: des };
}

/** Una fila del histórico, sin traerse las 500. */
function revHistoricoDe_(ss, ticket) {
  const nombre = (typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico";
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return {};
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const nFila = zdFilaDeTicket_(sh, ticket);
  if (nFila < 0) return {};

  const fila = sh.getRange(nFila, 1, 1, h.length).getValues()[0];
  const val = n => { const i = h.indexOf(n); return i >= 0 ? fila[i] : ""; };
  const bruto = val("Resultado");
  const nota = (bruto === "" || bruto === null) ? undefined : Number(bruto);
  return {
    nota: isNaN(nota) ? undefined : nota,
    estado: String(val("Estado auditoría") || ""),
    agente: String(val("Assignee FullName") || ""),
    // Con qué matriz se auditó. Sale de esta misma lectura para no volver a
    // recorrer la hoja: la pestaña de revisión se abre muchas veces al día.
    audiencia: String(val("Audiencia") || ""),
  };
}

// ============================================================
//  RENDIMIENTO
// ============================================================

/**
 * Cronometra cada pieza de la pestaña de revisión y lo deja en el registro.
 * Ejecútalo desde el editor con un número de ticket cuando algo vaya lento:
 * dice cuál es el paso caro en vez de tener que adivinarlo.
 */
function revDiagnosticoRendimiento(ticket) {
  const ss = histGetSpreadsheet_(true);
  const L = ["RENDIMIENTO DE LA PESTAÑA DE REVISIÓN", ""];
  const cronometrar = (nombre, fn) => {
    const t0 = Date.now();
    let r, err = null;
    try { r = fn(); } catch (e) { err = e.message; }
    const ms = Date.now() - t0;
    L.push("  " + (ms + " ms").padEnd(10) + nombre + (err ? "   ✗ " + err : ""));
    return r;
  };

  L.push("Tamaño de las hojas:");
  [[AUD.HOJA_VEREDICTOS, "Veredictos"], [ZD.HOJA_CONVER, "Conversaciones"],
   [REV.HOJA_REVISIONES, "Revisiones"], [REV.HOJA_DESACUERDOS, "Desacuerdos"]].forEach(p => {
    const sh = ss.getSheetByName(p[0]);
    L.push("  " + p[1] + ": " + (sh ? sh.getLastRow() + " filas × " + sh.getLastColumn() + " col" : "no existe"));
  });
  L.push("");

  const lista = cronometrar("revListaTickets()", () => revListaTickets());
  cronometrar("revResumen()", () => revResumen());

  const t = zdClaveTicket_(ticket) || (lista && lista.length ? lista[0].ticket : "");
  if (!t) { L.push("", "No hay ningún ticket con veredicto todavía."); Logger.log(L.join("\n")); return; }

  L.push("", "Ticket de prueba: " + t);
  cronometrar("revCargarTicket()", () => revCargarTicket(t));
  cronometrar("revConversacionDe()  [solo si se pide]", () => revConversacionDe(t));

  L.push("", "Referencia: cualquier cosa sobre 3.000 ms se siente lenta,",
             "y sobre 30.000 ms la interfaz parece colgada.");
  Logger.log(L.join("\n"));
}

function revLeerDesacuerdosTodos_(ss) {
  const sh = ss.getSheetByName(REV.HOJA_DESACUERDOS);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = vals[0].map(x => String(x || "").trim());
  const c = n => h.indexOf(n);
  return vals.slice(1).map(r => ({
    ticket:           zdClaveTicket_(r[c("Ticket Number")]),
    criterioId:       String(r[c("criterio_id")] || "").trim(),
    criterio:         String(r[c("Criterio")] || ""),
    afectacion:       String(r[c("Afectacion")] || ""),
    veredictoAgente:  String(r[c("Veredicto agente")] || ""),
    veredictoRevisor: String(r[c("Veredicto revisor")] || ""),
    tipoError:        String(r[c("Tipo de error")] || ""),
    comentario:       String(r[c("Comentario")] || ""),
  })).filter(d => d.ticket);
}

// ============================================================
//  HOJAS
// ============================================================

function revHojaRevisiones_(ss) {
  return revAsegurarHoja_(ss, REV.HOJA_REVISIONES, [
    "Ticket Number", "Canal", "Revisor", "Fecha revisión", "Modo",
    "Nota modelo", "Estado modelo", "Veredicto revisor",
    "Criterios revisados", "En desacuerdo",
    "Nota corregida", "Estado corregido", "Observaciones",
  ]);
}

function revHojaDesacuerdos_(ss) {
  return revAsegurarHoja_(ss, REV.HOJA_DESACUERDOS, [
    "Ticket Number", "criterio_id", "Criterio", "Afectacion",
    "Veredicto agente", "Veredicto revisor", "Tipo de error",
    "Comentario", "Revisor", "Fecha",
  ]);
}

function revAsegurarHoja_(ss, nombre, headers) {
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    sh = ss.insertSheet(nombre);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
    sh.setFrozenRows(1);
    return sh;
  }
  // Si la hoja existe pero le faltan columnas, se agregan al final sin tocar datos.
  const actuales = sh.getLastColumn()
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim())
    : [];
  const faltan = headers.filter(x => actuales.indexOf(x) < 0);
  if (faltan.length) {
    sh.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  }
  return sh;
}

function revBorrarFilas_(sh, ticket) {
  if (!sh || sh.getLastRow() < 2) return 0;
  const col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();

  const filas = [];
  for (let i = 0; i < col.length; i++)
    if (zdClaveTicket_(col[i][0]) === ticket) filas.push(i + 2);
  if (!filas.length) return 0;

  // Mismo límite de Sheets que en revVaciarHoja_: si este ticket es el único
  // que hay en la hoja, borrar sus filas la dejaría sin filas móviles y la
  // última llamada a deleteRow reventaría. Se vacía la hoja en su lugar, que
  // deja exactamente el mismo resultado.
  if (filas.length >= col.length) return revVaciarHoja_(sh);

  for (let i = filas.length - 1; i >= 0; i--) sh.deleteRow(filas[i]);
  return filas.length;
}

function revFormatoTexto_(sh) {
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).setNumberFormat("@");
}

/** Quién está revisando. Si la app no puede saberlo, queda anónimo. */
function revUsuario_() {
  try {
    const u = Session.getActiveUser().getEmail();
    if (u) return u;
  } catch (err) { /* sin permiso para leer el usuario */ }
  return "(sin identificar)";
}

// ============================================================
//  SI YA TIENES UN doGet EN EL PROYECTO
// ============================================================
/*
  Dos funciones doGet no pueden convivir. Borra la de arriba y en la tuya
  agrega una salida por parámetro:

  function doGet(e) {
    if (e && e.parameter && e.parameter.page === "revision") return revServirApp();
    ...lo que ya hacía tu dashboard...
  }

  La app de revisión queda entonces en   <url del web app>?page=revision
*/
