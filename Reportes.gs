/**
 * ============================================================
 *  Reportes.gs — Paso 4: resultados por periodo
 * ============================================================
 *
 *  Las tres primeras pestañas trabajan ticket a ticket. Esta mira el
 *  conjunto: en un periodo, cómo salió cada agente, cada output tag y
 *  cada audiencia. Sirve para decidir a quién retroalimentar y qué tipo
 *  de caso está costando más.
 *
 *  DE DÓNDE SALE CADA NÚMERO
 *  -------------------------
 *  · La nota, el estado, el agente y las tags salen del Historico.
 *  · La nota CORREGIDA sale de Revisiones, cuando alguien ya revisó.
 *  · El periodo se filtra por "Fecha auditoría", no por la fecha del
 *    ticket: lo que se está midiendo es el trabajo de auditoría hecho en
 *    ese mes, no los tickets resueltos en ese mes.
 *
 *  LA NOTA QUE SE REPORTA es la corregida si existe, y la del modelo si
 *  no. Las dos se devuelven por separado además, junto con cuántas están
 *  sin revisar: un promedio hecho solo de notas del modelo no es lo mismo
 *  que uno ya validado por una persona, y quien lo lee tiene que poder
 *  distinguirlos.
 *
 *  POR QUÉ SE INSISTE TANTO CON EL TAMAÑO DE LA MUESTRA
 *  ----------------------------------------------------
 *  La pauta son 4 auditorías por agente al mes. Con cuatro casos, una
 *  nota baja puede ser un mal día o un ticket raro, no un patrón. Si esta
 *  pantalla ordenara por promedio a secas, el primero de la lista sería
 *  casi siempre quien tuvo mala suerte, y las conversaciones de feedback
 *  se irían con la persona equivocada.
 *
 *  Por eso: el n va SIEMPRE al lado del promedio, con menos de
 *  RES.MIN_MUESTRA casos la fila queda marcada como muestra corta, y el
 *  orden por defecto no es por nota sino por críticos y por volumen.
 *  Cuando haya varios meses acumulados, la tendencia dirá más que
 *  cualquier promedio de un mes suelto.
 * ============================================================
 */

const RES = {
  TZ: "America/Santiago",
  // Bajo esto, un promedio no significa nada todavía. No oculta la fila:
  // la marca, que es distinto. Esconder datos por pocos hace que la gente
  // deje de confiar en la pantalla.
  MIN_MUESTRA: 3,
  // Cuántos criterios se pintan en la tabla de la pauta. Es un corte de
  // LECTURA, no de análisis: el cálculo sigue siendo sobre todos, y lo que
  // queda fuera se dice en una línea debajo de la tabla.
  TOP_CRITERIOS: 10,
  // Para entrar en esa tabla, un criterio tiene que haberse podido CONCLUIR en
  // más de este porcentaje de las auditorías donde aplicaba. Un criterio
  // concluido en 2 de 30 casos puede salir al 100% de fallo, y ese 100% es el
  // de dos casos: ordenar por él pondría arriba lo que menos se sabe.
  MIN_CONCLUIDO: 50,
};

// ============================================================
//  PUNTO DE ENTRADA DE LA INTERFAZ
// ============================================================

/**
 * El resumen del periodo. Todos los parámetros son opcionales.
 *
 *   resResumen()                                  → mes en curso, todas
 *   resResumen({ audiencia: "aeropuerto" })       → mes en curso, aeropuerto
 *   resResumen({ desde: "2026-07-01", hasta: "2026-07-31" })
 */
function resResumen(op) {
  op = op || {};
  const rango = resRango_(op);
  const filas = resFilas_(rango, op);
  const top = resTopCriterios_(resPorCriterio_(filas));

  return {
    periodo:  rango,
    filtro:   { audiencia: String(op.audiencia || "") },
    minMuestra: RES.MIN_MUESTRA,
    total:    filas.length,
    kpis:     resKpis_(filas),
    porAgente:    resAgrupar_(filas, f => f.agente || "(sin asignar)"),
    porTag3:      resAgrupar_(filas, f => f.tag3 || "(sin tag de 3er nivel)"),
    porAudiencia: resAgrupar_(filas, f => audNombreAudiencia_(f.audiencia)),
    porCriterio:  resCriteriosPublico_(top.filas),
    criteriosFuera: top.fuera,
    porSemana:    resPorSemana_(filas),
    audiencias:   resAudienciasConDatos_(),
    periodos:     resPeriodosDisponibles_(),
    generado:     Utilities.formatDate(new Date(), RES.TZ, "yyyy-MM-dd HH:mm"),
  };
}

/**
 * El detalle de un grupo (un agente, una tag): los tickets que lo componen.
 * Se pide aparte, al hacer clic, para no traer cientos de filas que casi
 * nunca se abren.
 */
function resDetalle(op, campo, valor) {
  op = op || {};
  const rango = resRango_(op);
  const filas = resFilas_(rango, op);

  // El detalle de un criterio no se agrupa por una propiedad del ticket: son
  // los tickets donde ese criterio salió no_cumple, y eso vive en Veredictos.
  if (String(campo) === "criterio") {
    const c = resPorCriterio_(filas).filter(x => x.clave === valor)[0];
    if (!c) return [];
    const dentro = {};
    c.tickets.forEach(t => { dentro[t] = true; });
    return filas.filter(f => dentro[f.ticket]).sort((a, b) => a.nota - b.nota).map(f => ({
      ticket: f.ticket, fecha: f.fecha, agente: f.agente,
      audiencia: audNombreAudiencia_(f.audiencia),
      nota: f.nota, fuenteNota: f.fuenteNota,
      notaModelo: f.notaModelo, notaCorregida: f.notaCorregida,
      estado: f.estado, revisado: f.revisado,
      tag1: f.tag1, tag2: f.tag2, tag3: f.tag3, motivo: f.motivo,
    }));
  }

  const clave = {
    agente:    f => f.agente || "(sin asignar)",
    tag3:      f => f.tag3   || "(sin tag de 3er nivel)",
    audiencia: f => audNombreAudiencia_(f.audiencia),
  }[String(campo || "agente")] || (f => f.agente);

  return filas
    .filter(f => clave(f) === valor)
    .sort((a, b) => a.nota - b.nota)         // lo peor primero: es lo que se mira
    .map(f => ({
      ticket: f.ticket, fecha: f.fecha, agente: f.agente,
      audiencia: audNombreAudiencia_(f.audiencia),
      nota: f.nota, fuenteNota: f.fuenteNota,
      notaModelo: f.notaModelo, notaCorregida: f.notaCorregida,
      estado: f.estado, revisado: f.revisado,
      tag1: f.tag1, tag2: f.tag2, tag3: f.tag3,
      motivo: f.motivo,
    }));
}

// ============================================================
//  PERIODO
// ============================================================

/** Fecha de hoy en la zona horaria del reporte, como yyyy-MM-dd. */
function resHoy_() {
  return Utilities.formatDate(new Date(), RES.TZ, "yyyy-MM-dd");
}

/**
 * Normaliza cualquier cosa que traiga la celda a "yyyy-MM-dd".
 *
 * Sheets a veces devuelve la fecha como Date y a veces como texto, según
 * cómo quedó formateada la celda. Comparar cadenas de formatos distintos
 * es la manera silenciosa de que un mes salga vacío.
 */
function resFecha_(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v))
    return Utilities.formatDate(v, RES.TZ, "yyyy-MM-dd");

  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);          // dd/mm/yyyy
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  return "";
}

/** El rango a usar: lo que pidieron, o el mes en curso. */
function resRango_(op) {
  const hoy = resHoy_();
  let desde = resFecha_(op.desde);
  let hasta = resFecha_(op.hasta);

  if (!desde && !hasta) {
    desde = hoy.slice(0, 8) + "01";
    hasta = hoy;
    return { desde: desde, hasta: hasta, etiqueta: "Mes en curso", mes: hoy.slice(0, 7) };
  }
  if (!desde) desde = "0000-01-01";
  if (!hasta) hasta = "9999-12-31";
  if (desde > hasta) { const x = desde; desde = hasta; hasta = x; }

  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
  return {
    desde: desde, hasta: hasta, mes: mismoMes ? desde.slice(0, 7) : "",
    etiqueta: mismoMes ? desde.slice(0, 7) : desde + " a " + hasta,
  };
}

/** Los meses que de verdad tienen auditorías, del más nuevo al más viejo. */
function resPeriodosDisponibles_() {
  const filas = resFilas_({ desde: "0000-01-01", hasta: "9999-12-31" }, {});
  const meses = {};
  filas.forEach(f => { if (f.fecha) meses[f.fecha.slice(0, 7)] = (meses[f.fecha.slice(0, 7)] || 0) + 1; });
  return Object.keys(meses).sort().reverse().slice(0, 24)
    .map(m => ({ mes: m, auditorias: meses[m] }));
}

/** Audiencias que tienen al menos una auditoría, para el selector. */
function resAudienciasConDatos_() {
  const filas = resFilas_({ desde: "0000-01-01", hasta: "9999-12-31" }, {});
  const cuenta = {};
  filas.forEach(f => { cuenta[f.audiencia] = (cuenta[f.audiencia] || 0) + 1; });
  return audAudiencias_().filter(k => cuenta[k])
    .map(k => ({ clave: k, nombre: audNombreAudiencia_(k), auditorias: cuenta[k] }));
}

// ============================================================
//  LECTURA
// ============================================================

/**
 * Las auditorías del periodo, ya cruzadas con la revisión humana.
 *
 * Lee el Historico completo UNA vez (es la hoja ligera: no tiene
 * conversaciones ni prompts) y Revisiones completo. Con 5.000 tickets son
 * dos lecturas, no 5.000.
 */
function resFilas_(rango, op) {
  const ss = histGetSpreadsheet_(true);
  const nombre = (typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico";
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];

  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = vals[0].map(x => String(x || "").trim());
  const c = n => h.indexOf(n);

  const cT = c("Ticket Number");
  if (cT < 0) return [];
  const cNota = c("Resultado"), cEst = c("Estado auditoría"), cFec = c("Fecha auditoría"),
        cAge = c("Assignee FullName"), cAud = c("Audiencia"), cMot = c("Motivo"),
        cT1 = c("ES Output Tags 1st Level v2"), cT2 = c("ES Output Tags 2nd Level v2"),
        cT3 = c("ES Output Tags 3rd Level v2"), cGr = c("Group Name");

  const revisiones = resLeerRevisiones_(ss);
  const filtroAud = String((op || {}).audiencia || "").trim();
  const val = (r, i) => i >= 0 ? String(r[i] === null || r[i] === undefined ? "" : r[i]).trim() : "";

  const out = [];
  vals.slice(1).forEach(r => {
    const ticket = zdClaveTicket_(r[cT]);
    if (!ticket) return;

    // Sin fecha de auditoría el ticket no se auditó: no entra a ningún periodo.
    const fecha = resFecha_(cFec >= 0 ? r[cFec] : "");
    if (!fecha || fecha < rango.desde || fecha > rango.hasta) return;

    const bruto = cNota >= 0 ? r[cNota] : "";
    const notaModelo = (bruto === "" || bruto === null || bruto === undefined) ? null : Number(bruto);
    if (notaModelo === null || isNaN(notaModelo)) return;   // sin nota no hay nada que promediar

    const audiencia = (val(r, cAud) || AUD_AUDIENCIA_DEFECTO);
    if (filtroAud && audiencia !== filtroAud) return;

    const rev = revisiones[ticket];
    const notaCorregida = rev && rev.nota !== null ? rev.nota : null;

    out.push({
      ticket: ticket,
      fecha: fecha,
      agente: val(r, cAge),
      audiencia: audiencia,
      grupo: val(r, cGr),
      tag1: val(r, cT1), tag2: val(r, cT2), tag3: val(r, cT3),
      estado: val(r, cEst),
      motivo: val(r, cMot),
      notaModelo: notaModelo,
      notaCorregida: notaCorregida,
      // La nota que cuenta: la de la persona si la hay.
      nota: notaCorregida === null ? notaModelo : notaCorregida,
      fuenteNota: notaCorregida === null ? "modelo" : "revision",
      revisado: !!rev,
      veredictoRevisor: rev ? rev.veredicto : "",
      critico: /crítico|critico/i.test(val(r, cEst)) && !/sin evaluar|por confirmar/i.test(val(r, cEst)),
      requiereRevision: /^Requiere/i.test(val(r, cEst)),
    });
  });
  return out;
}

/** Revisiones humanas indexadas por ticket. */
function resLeerRevisiones_(ss) {
  const out = {};
  const nombre = (typeof REV !== "undefined" && REV.HOJA_REVISIONES) ? REV.HOJA_REVISIONES : "Revisiones";
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return out;

  const vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = vals[0].map(x => String(x || "").trim());
  const cT = h.indexOf("Ticket Number"), cN = h.indexOf("Nota corregida"),
        cV = h.indexOf("Veredicto revisor"), cF = h.indexOf("Fecha revisión");
  if (cT < 0) return out;

  vals.slice(1).forEach(r => {
    const t = zdClaveTicket_(r[cT]);
    if (!t) return;
    const bruto = cN >= 0 ? r[cN] : "";
    const n = (bruto === "" || bruto === null) ? null : Number(bruto);
    // Si hay más de una revisión del mismo ticket gana la última escrita.
    out[t] = {
      nota: (n === null || isNaN(n)) ? null : n,
      veredicto: cV >= 0 ? String(r[cV] || "") : "",
      fecha: cF >= 0 ? String(r[cF] || "") : "",
    };
  });
  return out;
}

// ============================================================
//  POR CRITERIO DE LA PAUTA
// ============================================================

/**
 * Qué ítems de la pauta fallan más.
 *
 * Es la pregunta que cierra el círculo: por agente se sabe A QUIÉN
 * retroalimentar, por tag QUÉ tipo de caso cuesta, y por criterio QUÉ del
 * estándar no se está cumpliendo. Lo último es lo que se lleva a una
 * capacitación.
 *
 * Tres decisiones que cambian lo que se ve:
 *
 * 1. LOS NO CONCLUYENTES VAN APARTE, no sumados a los fallos. Un criterio con
 *    muchos no_concluyente no dice que los agentes lo incumplan: dice que la
 *    auditoría no puede verlo. Eso no se arregla capacitando a nadie, se
 *    arregla con una integración o con una regla mejor escrita. Mezclarlos
 *    mandaría a formar gente por una carencia del instrumento.
 *
 * 2. EL DENOMINADOR EXCLUYE LOS no_aplica. Un criterio que solo aplica a chat
 *    no se puede comparar con uno de todos los canales usando el total de
 *    auditorías: saldría artificialmente bien.
 *
 * 3. Los CRÍTICOS van primero aunque fallen menos. Un crítico incumplido deja
 *    la nota en 0; un -2 repetido cuesta puntos. No son la misma urgencia y
 *    ordenarlos por frecuencia los pondría en el mismo plano.
 *
 * Lee de Veredictos solo cuatro columnas. Nunca la cita, que es texto largo y
 * con 6.000 filas cuelga la pantalla.
 */
/**
 * ¿Esta afectación marca un crítico?
 *
 * La hoja la escribe audEscribirVeredictos_ como "CRITICO" o "no critico", sin
 * acento. Pero el acento no se comprueba: si algún día una fila llega como
 * "CRÍTICO" —una versión anterior, una corrección a mano, otra hoja— un
 * /critico/i no la reconocería y el criterio se pintaría como no crítico, al
 * fondo de la tabla y con un descuento en puntos que no existe. Es el error
 * que más importa evitar acá, así que se normaliza el acento antes de mirar.
 *
 * El orden es a propósito: primero se descarta "no critico", porque contiene
 * la palabra completa y un test de subcadena lo daría por crítico.
 */
function resEsCritico_(valor) {
  const v = String(valor || "")
    .toLowerCase()
    .replace(/[áàâä]/g, "a").replace(/[éèêë]/g, "e").replace(/[íìîï]/g, "i")
    .replace(/[óòôö]/g, "o").replace(/[úùûü]/g, "u")
    .trim();
  if (!v) return false;
  if (v.indexOf("no critico") === 0 || v.indexOf("no_critico") === 0) return false;
  return v.indexOf("critico") >= 0;
}

function resPorCriterio_(filas) {
  if (!filas.length) return [];

  const enPeriodo = {};
  filas.forEach(f => { enPeriodo[f.ticket] = f; });

  const ss = histGetSpreadsheet_(true);
  const nombre = (typeof AUD !== "undefined" && AUD.HOJA_VEREDICTOS) ? AUD.HOJA_VEREDICTOS : "Veredictos";
  const sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cT = h.indexOf("Ticket Number"), cId = h.indexOf("criterio_id"),
        cV = h.indexOf("Veredicto"), cAf = h.indexOf("Afectacion"),
        cTx = h.indexOf("Criterio"), cD = h.indexOf("Descuento");
  if (cT < 0 || cId < 0 || cV < 0) return [];

  const n = sh.getLastRow() - 1;
  const col = k => k >= 0 ? sh.getRange(2, k + 1, n, 1).getValues().map(f => f[0]) : new Array(n).fill("");
  const tks = col(cT), ids = col(cId), vers = col(cV),
        afs = col(cAf), txts = col(cTx), descs = col(cD);

  const g = {};
  for (let i = 0; i < n; i++) {
    const t = zdClaveTicket_(tks[i]);
    if (!t || !enPeriodo[t]) continue;
    const id = String(ids[i] || "").trim();
    if (!id) continue;

    if (!g[id]) g[id] = {
      clave: id, texto: String(txts[i] || "").trim(),
      critico: resEsCritico_(afs[i]),
      descuento: Math.abs(Number(descs[i] || 0)) || 0,
      noCumple: 0, cumple: 0, noConcluyente: 0, noAplica: 0,
      tickets: [], ticketsFallo: [],
    };
    const c = g[id];
    const v = String(vers[i] || "").trim().toLowerCase();
    c.tickets.push(t);
    if (v === "no_cumple")           { c.noCumple++; c.ticketsFallo.push(t); }
    else if (v === "cumple")          c.cumple++;
    else if (v === "no_aplica")       c.noAplica++;
    else                              c.noConcluyente++;
  }

  return Object.keys(g).map(id => {
    const c = g[id];
    // Los no_aplica salen del denominador: si no, un criterio de chat parece
    // cumplirse siempre solo porque no aplica a los tickets.
    const base = c.noCumple + c.cumple + c.noConcluyente;
    const evaluados = c.noCumple + c.cumple;
    return {
      clave: c.clave,
      texto: c.texto,
      critico: c.critico,
      descuento: c.descuento,
      n: base,
      noCumple: c.noCumple,
      cumple: c.cumple,
      noConcluyente: c.noConcluyente,
      noAplica: c.noAplica,
      // Sobre lo que SÍ se pudo concluir. Es la cifra que mide desempeño.
      pctFallo: evaluados ? Math.round(c.noCumple / evaluados * 100) : null,
      // Sobre todo lo aplicable. Es la cifra que mide si el criterio se puede
      // evaluar: alta significa que el instrumento no ve, no que la gente falle.
      pctSinConcluir: base ? Math.round(c.noConcluyente / base * 100) : 0,
      evaluados: evaluados,
      pctConcluido: base ? Math.round(evaluados / base * 100) : 0,
      puntosPerdidos: c.critico ? null : c.noCumple * c.descuento,
      muestraCorta: base < RES.MIN_MUESTRA,
      tickets: c.ticketsFallo,
    };
  }).sort((a, b) => {
    // Críticos con fallos primero: un crítico deja la nota en 0.
    const ca = a.critico && a.noCumple ? 1 : 0, cb = b.critico && b.noCumple ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (a.noCumple !== b.noCumple) return b.noCumple - a.noCumple;
    return (b.puntosPerdidos || 0) - (a.puntosPerdidos || 0);
  });
}

/**
 * Los criterios que se pintan: los TOP_CRITERIOS con más % de fallo.
 *
 * El corte es de lectura, no de análisis: el cálculo se hace sobre todos los
 * criterios y esto solo elige cuáles se muestran. Una tabla de treinta filas
 * se ojea y no se lee; diez con lo peor arriba se leen.
 *
 * Dos detalles que evitan que el recorte engañe:
 *
 * · Solo entran criterios CON al menos un incumplimiento. Un criterio al 0%
 *   no pertenece a un "top de fallos" ni ocupando el décimo puesto.
 *
 * · UN CRÍTICO CON FALLOS NUNCA SE CAE DE LA LISTA, aunque su porcentaje lo
 *   deje fuera del top. Ordenar por porcentaje es lo que se pidió y tiene
 *   sentido, pero un crítico que falla el 4% de las veces deja la nota en 0
 *   en ese 4%: esconderlo detrás de un -2 que falla el 30% sería mostrar lo
 *   frecuente en vez de lo grave. Se marcan con `fueraDelTop` para poder
 *   decir en la pantalla por qué están ahí.
 *
 * Lo que quedó fuera se devuelve contado, para que la tabla pueda decir "10
 * de 24" y nadie crea que la pauta tiene diez criterios.
 */
function resTopCriterios_(criterios) {
  const conFallo = criterios.filter(c => c.noCumple > 0);
  const medibles   = conFallo.filter(c => resCriterioMedible_(c));
  const sinMuestra = conFallo.filter(c => !resCriterioMedible_(c));

  const orden = medibles.slice().sort((a, b) => {
    if (b.pctFallo !== a.pctFallo) return b.pctFallo - a.pctFallo;
    // A igual porcentaje, primero el que afecta a más auditorías: 8 de 10
    // pesa más que 4 de 5, aunque las dos sean el 80%.
    if (b.noCumple !== a.noCumple) return b.noCumple - a.noCumple;
    return (b.puntosPerdidos || 0) - (a.puntosPerdidos || 0);
  });

  const top = orden.slice(0, RES.TOP_CRITERIOS);
  const dentro = {};
  top.forEach(c => { dentro[c.clave] = true; });

  // Los críticos MEDIBLES que el corte dejaría fuera se reincorporan al final.
  // Los que no son medibles no: si el dato no da para medirlos, ponerlos en una
  // tabla ordenada por porcentaje sería darle rango de hallazgo a un ruido.
  // Se nombran en el pie, que es donde corresponde decir "esto no se sabe aún".
  const criticosFuera = orden.filter(c => c.critico && !dentro[c.clave])
                             .map(c => Object.assign({}, c, { fueraDelTop: true }));

  return {
    filas: top.concat(criticosFuera),
    fuera: {
      // Cuántos criterios con incumplimientos no se están viendo por el tope.
      ocultos: Math.max(0, orden.length - top.length - criticosFuera.length),
      conFallo: conFallo.length,
      medibles: medibles.length,
      evaluados: criterios.length,
      tope: RES.TOP_CRITERIOS,
      criticosRescatados: criticosFuera.length,
      // Los que no entran porque todavía no hay con qué medirlos.
      sinMuestra: sinMuestra.length,
      criticosSinMuestra: sinMuestra.filter(c => c.critico).map(c => c.clave),
      minMuestra: RES.MIN_MUESTRA,
      minConcluido: RES.MIN_CONCLUIDO,
    },
  };
}

/**
 * ¿Se puede ordenar este criterio por su % de fallo sin que engañe?
 *
 * Dos condiciones, y las dos son sobre el DENOMINADOR, no sobre el resultado:
 *
 * · Que se haya podido concluir en más de RES.MIN_CONCLUIDO% de las auditorías
 *   donde aplicaba. Un criterio que la auditoría solo pudo juzgar en 3 de 40
 *   casos y falló en 2 sale al 67%, y ese 67% es de tres casos. Puesto arriba
 *   de una tabla ordenada por porcentaje, parece el peor de la pauta.
 *
 * · Que haya al menos RES.MIN_MUESTRA veredictos concluyentes. Un 100% de 1 de
 *   1 no es un 100%.
 *
 * Lo que NO se hace es descartarlos del cálculo: siguen contados, y el pie de
 * la tabla dice cuántos quedaron fuera por esto. La diferencia entre "no falla"
 * y "todavía no se puede saber si falla" es justo la que no hay que borrar.
 */
function resCriterioMedible_(c) {
  return c.evaluados >= RES.MIN_MUESTRA && c.pctConcluido > RES.MIN_CONCLUIDO;
}

/**
 * Lo mismo, sin la lista de tickets.
 *
 * La pantalla no necesita los números: cuando alguien abre "ver tickets" se
 * pide el detalle aparte. Mandarlos igual serían miles de cadenas cruzando
 * a cada carga del panel, por nada.
 */
function resCriteriosPublico_(criterios) {
  return criterios.map(c => {
    const o = {};
    Object.keys(c).forEach(k => { if (k !== "tickets") o[k] = c[k]; });
    return o;
  });
}

// ============================================================
//  AGREGACIÓN
// ============================================================

function resPromedio_(nums) {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10;
}

function resMediana_(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 10) / 10;
}

/** Los indicadores de arriba. */
function resKpis_(filas) {
  const notas = filas.map(f => f.nota);
  const conCritico = filas.filter(f => f.nota === 0);
  const revisadas = filas.filter(f => f.revisado);
  return {
    auditorias:   filas.length,
    promedio:     resPromedio_(notas),
    mediana:      resMediana_(notas),
    minima:       notas.length ? Math.min.apply(null, notas) : null,
    enCero:       conCritico.length,
    pctCero:      filas.length ? Math.round(conCritico.length / filas.length * 100) : 0,
    revisadas:    revisadas.length,
    pctRevisadas: filas.length ? Math.round(revisadas.length / filas.length * 100) : 0,
    // Cuánto del promedio se apoya todavía solo en el modelo. Es el aviso
    // más importante de la pantalla: sin revisión humana detrás, estos
    // números son una estimación, no un resultado.
    sinRevisar:   filas.length - revisadas.length,
    pendientes:   filas.filter(f => f.requiereRevision && !f.revisado).length,
    agentes:      Object.keys(filas.reduce((a, f) => { if (f.agente) a[f.agente] = 1; return a; }, {})).length,
  };
}

/**
 * Agrupa por lo que devuelva `clave` y calcula las cifras de cada grupo.
 *
 * El orden por defecto NO es por nota: primero los que tienen auditorías en
 * cero (que es lo accionable), y a igualdad, los de más volumen. Ordenar por
 * promedio pondría arriba a quien tuvo dos casos malos de dos.
 */
function resAgrupar_(filas, clave) {
  const grupos = {};
  filas.forEach(f => {
    const k = clave(f) || "(sin dato)";
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push(f);
  });

  return Object.keys(grupos).map(k => {
    const g = grupos[k];
    const notas = g.map(f => f.nota);
    const enCero = g.filter(f => f.nota === 0).length;
    return {
      clave:      k,
      n:          g.length,
      promedio:   resPromedio_(notas),
      mediana:    resMediana_(notas),
      minima:     Math.min.apply(null, notas),
      maxima:     Math.max.apply(null, notas),
      enCero:     enCero,
      pctCero:    Math.round(enCero / g.length * 100),
      revisadas:  g.filter(f => f.revisado).length,
      pendientes: g.filter(f => f.requiereRevision && !f.revisado).length,
      // La marca que impide leer un promedio de dos casos como si fuera un dato.
      muestraCorta: g.length < RES.MIN_MUESTRA,
      tickets:    g.map(f => f.ticket),
    };
  }).sort((a, b) => (b.enCero - a.enCero) || (b.n - a.n) || (a.promedio - b.promedio));
}

/**
 * Serie por semana ISO, para ver la tendencia dentro del periodo.
 * Con un mes son 4 o 5 puntos: poco, pero es lo que permite distinguir
 * "empeoró" de "siempre fue así".
 */
function resPorSemana_(filas) {
  const sem = {};
  filas.forEach(f => {
    const k = resSemanaDe_(f.fecha);
    if (!sem[k]) sem[k] = [];
    sem[k].push(f.nota);
  });
  return Object.keys(sem).sort().map(k => ({
    semana: k, n: sem[k].length, promedio: resPromedio_(sem[k]),
    enCero: sem[k].filter(n => n === 0).length,
  }));
}

/** Lunes de la semana a la que pertenece una fecha yyyy-MM-dd. */
function resSemanaDe_(fecha) {
  const p = String(fecha).split("-");
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  const dia = (d.getDay() + 6) % 7;                 // lunes = 0
  d.setDate(d.getDate() - dia);
  const mm = ("0" + (d.getMonth() + 1)).slice(-2);
  const dd = ("0" + d.getDate()).slice(-2);
  return d.getFullYear() + "-" + mm + "-" + dd;
}

// ============================================================
//  EXPORTAR
// ============================================================

/**
 * Vuelca el detalle del periodo en una hoja, para llevárselo a un
 * dashboard o a una reunión. Reemplaza la hoja anterior: es una foto del
 * periodo, no un histórico acumulado (el histórico ya es el Historico).
 */
function resExportar(op) {
  op = op || {};
  const rango = resRango_(op);
  const filas = resFilas_(rango, op);
  const ss = histGetSpreadsheet_(true);
  const nombre = "Resultados " + rango.etiqueta;

  let sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre); else sh.clear();

  const headers = ["Ticket Number", "Fecha auditoría", "Audiencia", "Agente",
                   "Nota", "Fuente de la nota", "Nota modelo", "Nota corregida",
                   "Estado", "Revisado", "Tag 1", "Tag 2", "Tag 3", "Motivo"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  sh.setFrozenRows(1);

  if (filas.length) {
    sh.getRange(2, 1, filas.length, headers.length).setValues(filas.map(f => [
      f.ticket, f.fecha, audNombreAudiencia_(f.audiencia), f.agente,
      f.nota, f.fuenteNota, f.notaModelo,
      f.notaCorregida === null ? "" : f.notaCorregida,
      f.estado, f.revisado ? "SI" : "NO", f.tag1, f.tag2, f.tag3, f.motivo,
    ]));
    sh.getRange(2, 1, filas.length, 1).setNumberFormat("@");
  }
  Logger.log('Exportadas %s auditorías a la hoja "%s".', filas.length, nombre);
  return { hoja: nombre, filas: filas.length, url: ss.getUrl() };
}
