/**
 * ============================================================
 *  Auditoria.gs — Matriz de criterios y armado del prompt
 * ============================================================
 *  Tercer archivo del proyecto, junto a Historico.gs y Zendesk.gs.
 *
 *  Contiene la Matriz Global de Auditoría (37 criterios) y arma,
 *  para cada ticket, el prompt completo que se pega en el agente
 *  de marketplace: instrucciones + criterios del canal + claves
 *  del viaje + conversación normalizada.
 *
 *  Regla de fondo: el agente emite VEREDICTOS, no notas.
 *  La aritmética (100 - suma de descuentos, crítico -> 0) la hace
 *  el código, para que la nota sea reproducible y defendible.
 *
 *  Canales:
 *    ticket -> 24 criterios      chat -> 29 criterios
 *  (37 totales, menos 6 de rentadora/Fleets que no aplican a c4b,
 *   menos los que no corresponden al canal)
 * ============================================================
 */

/**
 * id | criterio | critico | descuento | ticket | chat | fleets
 * Los de fleets no aplican a c4b y quedan fuera de los dos canales.
 */
const AUD_CRITERIOS = [
  ["C01", "Saluda al usuario por su nombre y ofrece ayuda",                                    false,  -2,   true,  true,  false],
  ["C02", "Contesta dentro de los tiempos establecidos",                                       false,  -3,   false, true,  false],
  ["C03", "Se presenta cumpliendo requisitos minimos (solo el nombre registrado en Zendesk)",   false,  -2,   true,  true,  false],
  ["C04", "Emplea macro de despedida, mensaje de cierre y firma correcta",                          false,  -3,   true,  true,  false],
  ["C05", "Se dirige al usuario por su nombre al menos dos veces durante la interaccion",       false,  -2,   false, true,  false],
  ["C06", "Empatia: se pone en el lugar del usuario y usa frases de cortesia",                  false,  -3,   true,  true,  false],
  ["C07", "Trato al usuario: evita sarcasmo, descortesia y vocabulario inadecuado",             true,   -100, true,  true,  false],
  ["C08", "Postura institucional: sin comentarios negativos de la compania, procesos o terceros", true,  -100, true,  true,  false],
  ["C09", "Lee e interpreta correctamente la solicitud del usuario",                            true,   -100, true,  true,  false],
  ["C10", "Ortografia y redaccion: sin errores de tipeo ni ortograficos",                       false,  -4,   true,  true,  false],
  ["C11", "Estilo: sin negrillas, mayusculas sostenidas ni signos de mas",                      false,  -3,   true,  true,  false],
  ["C12", "Tono y ritmo de voz, no interrumpe al cliente",                                      false,  -3,   false, false, false],
  ["C13", "Evita muletillas y modismos, mantiene un solo estilo (o tutea o ustea)",             false,  -4,   true,  true,  false],
  ["C14", "Argumentacion sustentada en los procedimientos e informacion clara",                 false,  -4,   true,  true,  false],
  ["C15", "Lenguaje sencillo, sin jerga tecnica interna",                                       false,  -4,   true,  true,  false],
  ["C16", "Solicita tiempos de espera solo cuando es necesario",                                false,  -3,   false, true,  false],
  ["C17", "Retoma dentro de los tiempos establecidos (chat: no mas de 4 minutos)",              false,  -3.5, false, true,  false],
  ["C18", "No evade la retoma dejando que el usuario finalice la comunicacion",                 true,   0,    false, true,  false],
  ["C19", "Evita terminar la conversacion sin atender la solicitud",                            true,   -100, true,  true,  false],
  ["C20", "Realiza las consultas necesarias en las herramientas antes de preguntar al usuario", false,  -3,   true,  true,  false],
  ["C21", "Utiliza adecuadamente los estados de Zendesk (abierto, pendiente, resuelto)",        true,   -100, true,  true,  false],
  ["C22", "Utiliza adecuadamente las macros: precision, integridad y personalizacion",          true,   -100, true,  true,  false],
  ["C23", "Selecciona la tag correcta conforme al nivel correspondiente",                       true,   -100, true,  true,  false],
  ["C24", "Valida protocolos de seguridad e informa que la llamada es grabada",                 true,   0,    false, false, false],
  ["C25", "Ejecuta en los aplicativos las modificaciones solicitadas por el usuario",           true,   -100, true,  true,  false],
  ["C26", "Registra las notas requeridas en los aplicativos (Admin y Remedios)",                true,   -100, true,  true,  false],
  ["C27", "Contesto todas las dudas o preguntas del cliente",                                   true,   -100, true,  true,  false],
  ["C28", "Informa correctamente los plazos de resolucion o tiempos de respuesta",              true,   -100, true,  true,  false],
  ["C29", "La respuesta corresponde con el proceso indicado en los procedimientos",             true,   -100, true,  true,  false],
  ["C30", "Revisa la documentacion de la rentadora y actualiza los aplicativos",                true,   -100, true,  true,  true],
  ["C31", "Ejecuta correctamente el tipo de solicitud de la rentadora",                         true,   -100, true,  true,  true],
  ["C32", "Completa la actualizacion de datos y company email de la rentadora",                 true,   -100, true,  true,  true],
  ["C33", "Activacion de Tariff y Productos correctamente",                                     true,   -100, true,  true,  true],
  ["C34", "Validacion de duplicados y bloqueados",                                              true,   -100, true,  true,  true],
  ["C35", "Vehiculo y/o conductor cargado correctamente",                                       true,   -100, true,  true,  true],
  ["C36", "Evita suministrar informacion confidencial",                                         true,   -100, true,  true,  false],
  ["C37", "Realiza la derivacion correcta al area correspondiente",                             true,   -100, true,  true,  false],
  // Solo aeropuerto. En la matriz de B2B el trato a terceros va dentro de C08;
  // en la de aeropuerto es un item propio (4.4) que se reprueba por separado.
  // Se declara aca y se excluye de B2B en AUD_MATRIZ.
  ["C38", "Trato a terceros: evita desmeritar o hablar mal de terceros u otras marcas",         true,   -100, true,  true,  false],
];

/**
 * ============================================================
 *  LA MISMA MATRIZ, DISTINTA AUDIENCIA
 * ============================================================
 * AUD_CRITERIOS de arriba es el REGISTRO de todos los criterios que existen.
 * Qué pide cada audiencia sale de acá.
 *
 * Las dos matrices (B2B y aeropuerto) resultaron ser casi la misma: mismos
 * ítems, mismos pesos, misma estructura. Solo cambian dos cosas, y están las
 * dos escritas abajo. Por eso NO hay dos tablas de criterios: una segunda
 * copia con 30 filas idénticas y 2 distintas es una trampa — nadie ve cuál de
 * las 30 se desincronizó.
 *
 *   excluye : ids que esa audiencia no evalúa.
 *   ajustes : cambia la aplicabilidad o el peso de un id concreto.
 *   fuera   : criterios que hoy no se pueden verificar y SALEN del
 *             denominador (no ensucian la cobertura).
 *   sin_integracion : criterios que hoy no se pueden verificar pero se
 *             QUEDAN dentro: siempre no_concluyente, y el ticket va a
 *             revisión humana con ese motivo escrito.
 *
 * La diferencia entre `fuera` y `sin_integracion` es a quién le toca el
 * trabajo: `fuera` dice "esto no se audita hoy y la nota no lo considera";
 * `sin_integracion` dice "esto se audita a mano". La segunda es más honesta
 * y más cara: conviene usarla solo donde de verdad haya alguien que lo mire.
 */
const AUD_MATRIZ = {
  b2b: {
    excluye: ["C38"],              // en B2B los terceros van dentro de C08
    ajustes: {},
    fuera: {
      C26: "no hay integracion con Admin ni Remedios: no se puede ver si la nota se registro",
    },
    sin_integracion: {},
  },

  aeropuerto: {
    excluye: [],
    ajustes: {
      // Aeropuerto sí mide el tiempo de primera respuesta en ticket (1 hora,
      // 24 h desde el reopen). En B2B este ítem es solo de chat.
      C02: { ticket: true },
    },
    fuera: {},
    // Los críticos que no se pueden comprobar no se sacan de la matriz: se
    // marcan no_concluyente y los resuelve una persona. Un -100 mal puesto
    // cuesta mucho más que uno que llega tarde.
    sin_integracion: {
      C26: "no hay integracion con Admin ni Remedios: la nota de la gestion se revisa a mano",
    },
  },
};


/**
 * Detalle mecánico de los criterios que en la matriz tienen un umbral o una
 * regla literal. Sin esto el evaluador interpreta el título del criterio y
 * emite fundamentos equivocados: la primera version decia que la firma iba
 * "en minusculas" y el agente concluyo que el NOMBRE PROPIO debia ir en
 * minuscula, cuando la regla aplica al cargo.
 */
/**
 * Criterios que HOY no se pueden verificar con los datos disponibles.
 *
 * Por qué existe esta lista en vez de dejarlos en "no concluyente":
 * un criterio crítico que nunca se puede comprobar deja TODOS los tickets en
 * "Requiere revisión (crítico sin evaluar)". Una alarma que suena siempre no
 * informa nada — la gente aprende a ignorarla, y de paso tapa las alarmas que
 * sí importan.
 *
 * Declararlos fuera de alcance es más honesto: la nota queda limpia, la
 * cobertura refleja lo que de verdad se evaluó, y el motivo queda escrito para
 * que nadie confunda "no se pudo verificar" con "se cumplió".
 *
 * Es reversible: en cuanto haya integración, se borra la línea y vuelve a
 * evaluarse. Sacar un criterio de acá NO requiere tocar nada más.
 */
/**
 * Compatibilidad: la forma vieja de consultar los criterios fuera de alcance
 * de B2B. Se conserva porque hay código y pruebas que la leen directo.
 * Lo nuevo usa audFueraDeAlcance_(audiencia).
 */
// "b2b" literal a propósito, no AUD_AUDIENCIA_DEFECTO: esta línea se evalúa
// al CARGAR el archivo, y el orden de carga entre archivos .gs no está
// garantizado. Una constante que dependa de otro archivo en tiempo de carga
// falla con un "no está definido" que no dice nada. Dentro de las funciones
// sí se usa la constante, porque para entonces ya cargó todo.
const AUD_FUERA_DE_ALCANCE = AUD_MATRIZ.b2b.fuera;

/** Configuración de matriz de una audiencia (con caída a la por defecto). */
function audMatrizDe_(audiencia) {
  return AUD_MATRIZ[audiencia] || AUD_MATRIZ[AUD_AUDIENCIA_DEFECTO];
}

/** Criterios que esa audiencia no evalúa y salen del denominador. */
function audFueraDeAlcance_(audiencia) {
  return audMatrizDe_(audiencia).fuera || {};
}

/**
 * Criterios que esa audiencia evalúa a mano: se quedan en el denominador,
 * salen siempre no_concluyente y mandan el ticket a revisión.
 */
function audSinIntegracion_(audiencia) {
  return audMatrizDe_(audiencia).sin_integracion || {};
}

/**
 * Sello de versión de las reglas. Va estampado en cada prompt generado.
 *
 * Existe por un caso concreto: el agente justificó un no_cumple citando una regla
 * de C04 que yo ya había borrado. El código estaba bien; lo que estaba viejo era
 * el prompt guardado en la hoja. Sin este sello no había forma de distinguir "la
 * regla no sirve" de "la regla no llegó", y se pierde un ciclo entero discutiendo
 * la primera cuando el problema era la segunda.
 *
 * Sube el sello cada vez que cambien AUD_REGLAS o los bloques del preámbulo, y
 * corre audRevisarPrompts() para ver cuántos prompts están al día.
 */
const AUD_VERSION_REGLAS = "reglas-2026-09-08-c";

/**
 * La cláusula del cierre por duplicado. Vive en una constante porque la
 * necesitan DOS reglas de C23 —la general y la de aeropuerto— y una audiencia
 * que sobrescribe una regla reemplaza el texto entero: si esto estuviera
 * escrito dentro de la regla general, aeropuerto lo habría perdido en
 * silencio. Y de esta cláusula depende que un cierre por derivación se
 * reproche en un solo criterio en vez de en tres.
 */
const AUD_CLAUSULA_DUPLICADO =
  "SI el bloque DATOS VERIFICADOS dice cierre_por_derivacion_a_otro_ticket: SI, la tag " +
  "de primer nivel tiene que ser 'Duplicado'. Si no lo es, ESE es el incumplimiento del " +
  "caso: no_cumple aca, citando las tags que quedaron puestas. Y al reves: si la tag ya " +
  "dice Duplicado, por este motivo cumple.";

const AUD_REGLAS = {
  C01: "Saludo apropiado + ofrecimiento de ayuda. EVALUA EL PRIMER MENSAJE DEL AGENTE COMPLETO, no su primera linea: el saludo, la presentacion y el ofrecimiento pueden ir en lineas o parrafos separados del mismo mensaje. 'Hola, Maritza.' arriba y 'Mi nombre es Luis de Cabify y estoy aqui para ayudarte' mas abajo CUMPLE. Que esten repartidos no es incumplimiento. Si el nombre no esta disponible en el aplicativo (B2B suele mostrar nickname o empresa), indagar amablemente tampoco lo es.",
  C03: "Solo el nombre de quien atiende segun figura en Zendesk, sin apellidos ni cargo. En reapertura atendida por la misma persona no se repite la presentacion.",
  C04: "El cierre correcto es: una despedida, el nombre de quien atiende y el cargo. Ejemplo REAL que CUMPLE, calcado de un caso auditado:\n        'Un saludo.'\n        'Daniel Gonzalez'\n        'CCO Associate'\n      LA FIRMA OCUPA VARIAS LINEAS Y ESO ES LO CORRECTO.\n      EL CARGO NO SE VERIFICA. Ni su capitalizacion, ni su redaccion, ni si coincide con el que uso otra persona en el mismo hilo, ni si es el que figura en Zendesk — no tienes acceso al perfil de nadie y no vas a poder comprobarlo nunca. 'CCO Associate', 'Cco Associate', 'cco associate', 'Ejecutiva de Atencion Cabify Aeropuerto' y cualquier otra denominacion son TODAS correctas para este criterio.\n      Queda PROHIBIDO emitir no_cumple, y tambien mencionarlo como duda, sobre el cargo. En particular queda prohibido el razonamiento 'si ese no es su cargo registrado es incumplimiento': es una condicional que no puedes resolver, y dejarla escrita ensucia la auditoria con una acusacion que nadie puede verificar ni desmentir. Que dos personas del mismo hilo firmen con cargos distintos es normal: atienden equipos distintos.\n      Si tu unica objecion tiene que ver con el cargo, el veredicto es CUMPLE y no se menciona.\n      Solo hay tres defectos reales: (a) no aparece la despedida, (b) no aparece el NOMBRE de quien atiende, (c) el NOMBRE viene en MAYUSCULAS SOSTENIDAS ('DANIEL GONZALEZ'). Que falte el cargo es un hallazgo, no un incumplimiento.\n      Antes de marcar no_cumple cita el bloque ENTERO del final; si tu cita es una linea suelta o solo el nombre y el cargo sin mirar la despedida que va arriba, la lectura esta incompleta y el veredicto es no_concluyente.",
  C05: "Al menos dos veces a lo largo de la interaccion, excluyendo el saludo inicial. Mismo nombre, sin diminutivos.",
  C14: "Antes de decir que un dato del agente no cuadra con el sistema, aplica la REGLA DE LAS DOS CIFRAS del bloque de reglas generales, incluida la parte de retarificaciones encadenadas. Un reembolso normal tiene DOS importes legitimos: el cobro original (el 'precio original' de la PRIMERA retarificacion) y el precio final correcto (el resultado de la ULTIMA). Los valores de en medio no son precios finales de nada. Si el importe que el agente llama correcto coincide con el precio final del viaje, CUMPLE, aunque no coincida con el resultado de una retarificacion intermedia.\n      CUANDO se ejecuto la retarificacion NO es materia de este criterio. Que el ajuste sea anterior o posterior a la apertura del ticket no invalida nada: informar de un ajuste ya hecho es correcto. Antes de escribir cualquier frase con 'anterior', 'posterior', 'antes' o 'despues', aplica la REGLA DE LAS DOS FECHAS; y aunque las fechas te den, no uses la cronologia como motivo de un no_cumple de importes.",
  C09: "Este criterio mide si el agente ENTENDIO lo que el usuario pidio: si respondio a la " +
       "solicitud que le hicieron y no a otra. Nada mas.\n" +
       "      NO es este criterio el que juzga si el agente verifico el dato en los sistemas " +
       "(eso es C20), ni si la gestion siguio el procedimiento (C29), ni si ejecuto la " +
       "modificacion (C25). Un agente que leyo bien la solicitud y despues gestiono mal " +
       "CUMPLE C09 y falla en el criterio que corresponda.\n" +
       "      Esta distincion importa porque C09 es CRITICO: usarlo como cajon de sastre para " +
       "cualquier fallo de gestion manda la nota a 0 por el motivo equivocado, y la persona " +
       "que revisa no puede saber que se le esta reprochando. Si tu fundamento empieza por " +
       "'no valido', 'no contrasto' o 'no consulto', el criterio no es C09.\n" +
       "      Que el agente acepte la version del usuario sin comprobarla NO es incumplir C09: " +
       "la entendio perfectamente. Es, como mucho, C20 o C29.\n" +
       "      PEDIR UN DATO NECESARIO PARA PODER EJECUTAR TAMPOCO ES INCUMPLIR C09. Un agente que " +
       "responde 'para actualizar tu direccion, indicanos tu numero de reserva' demostro que " +
       "entendio exactamente lo que le pidieron: por eso sabe que dato le falta. Pedirlo es " +
       "avanzar, no evadir. Si crees que ese dato ya estaba en los sistemas y no hacia falta " +
       "preguntarlo, ese es C20, no C09.\n" +
       "      Y si el hilo termina con el solicitante diciendo que ya se resolvio por otra via, " +
       "eso no reabre nada contra el agente: no prueba que no entendiera, prueba que el usuario " +
       "encontro otro camino.",
  C10: "Un solo error de tipeo u ortografia ya afecta el item. Los errores gramaticales (tildes, puntuacion, mayusculas) afectan a partir de SEIS hallazgos en la interaccion.",
  C11: "Negrillas, mayusculas sostenidas y signos de admiracion o interrogacion cuando no corresponde. NO es afectable si son palabras o frases que resaltan algo importante de la gestion. Las opciones de menu o los textos enlatados de un bot no son redaccion del agente.",
  C13: "Muletillas: afecta a partir de TRES repeticiones de la misma palabra. No alternar entre tutear y ustear en el mismo mensaje ni en la interaccion.",
  C17: "Chat: la espera no debe exceder 3 min 59 s. Afecta si supera los 4 minutos.",
  C20: "Consultar y validar en las herramientas antes de preguntarle al usuario algo que ya esta en los sistemas internos. Para emitir no_cumple tienes que poder decir EN QUE sistema estaba ese dato y como se llega a el; si no, va no_concluyente. Pedir un dato que identifica el caso (numero de reserva, numero de ticket) no es incumplimiento: es lo que permite buscar.",
  C22: "No se ve que macro se uso, y no hace falta: se juzga el RESULTADO. Que el mensaje largo responda a lo que pregunto el solicitante, que este adaptado al caso y no generico, y que NO se haya reenviado dos veces casi identico. El bloque DATOS VERIFICADOS te dice si hubo repeticion de un mensaje largo del agente: si dice que si, es incumplimiento con esa evidencia. Si dice que no y el contenido responde a la consulta, cumple. Solo va no_concluyente si el mensaje es ambiguo respecto de la consulta.",
  C23: AUD_CLAUSULA_DUPLICADO + "\n" +
       "      Las output tags de los tres niveles van en el bloque DATOS VERIFICADOS. Compara si describen lo que realmente paso en la conversacion. No hace falta ninguna integracion para esto: es coherencia entre la tag y el caso. Incluye no usar tag comodin cuando no corresponde. Si el motivo no tiene tag, al menos el nivel 1 debe estar bien. OJO: hay varios diccionarios de tags (B2B, ADQ, SSEE, Private); un prefijo que no reconozcas no prueba que la tag este mal. Solo va no_concluyente si no llegaron tags.",
  C19: "Mide que el caso no se abandone: que el agente no corte dejando la solicitud sin " +
       "atender por nadie.\n" +
       "      DERIVAR A OTRO TICKET NO ES ABANDONAR. Si el agente cierra este hilo diciendo " +
       "que el caso se gestiona en otro ticket Y lo identifica, la solicitud quedo atendida: " +
       "cambio de expediente, no se quedo sin respuesta. El bloque DATOS VERIFICADOS te lo " +
       "dice calculado en cierre_por_derivacion_a_otro_ticket. Si dice SI, C19 CUMPLE.\n" +
       "      QUEDA PROHIBIDO exigir que conste la respuesta del OTRO ticket. Su conversacion " +
       "no esta en esta auditoria y nunca lo va a estar: pedir esa evidencia es reprobar por " +
       "algo que no se puede probar ni desmentir, y C19 es CRITICO.\n" +
       "      Lo que si puede fallar en un cierre por derivacion es la ETIQUETA, y eso se " +
       "juzga en C23. Un mismo hecho no se reprocha en varios criterios: si el defecto es la " +
       "tag, el no_cumple va SOLO en C23.",
  C27: "Respuesta a cada punto del usuario, con la misma excepcion que C19: si el hilo se " +
       "cerro derivando a otro ticket identificado, las dudas quedan para ese expediente y " +
       "C27 CUMPLE. No exijas ver la respuesta que se dio alla.\n" +
       "      Tampoco cuentes como duda sin contestar una pregunta que el propio usuario " +
       "retiro (porque lo resolvio por otra via o dijo que ya estaba listo).",
  C21: "No se ve el historial de estados de Zendesk, asi que se evalua por el CIERRE, que es lo que este criterio protege: que el caso no quede abandonado con el solicitante ESPERANDO. Decide SOLO con esta tabla, mirando cierre_del_hilo en DATOS VERIFICADOS:\n" +
       "        cerro el agente (o el bot)  -> CUMPLE. Siempre. Con ofrecimiento de ayuda o sin el.\n" +
       "        cerro el solicitante Y el_solicitante_dio_el_caso_por_cerrado dice SI  -> CUMPLE.\n" +
       "            Agradecio o dijo que ya estaba resuelto: no quedaba esperando nada y el agente\n" +
       "            podia cerrar el ticket. Responder a un 'gracias' no es obligatorio.\n" +
       "        cerro el solicitante Y el_solicitante_dio_el_caso_por_cerrado dice no  -> NO CUMPLE.\n" +
       "            La cita es su ultimo mensaje sin responder.\n" +
       "        DESCONOCIDO                 -> no_concluyente. No lo deduzcas leyendo el final del bloque, que puede venir truncado.\n" +
       "      Esa senal la calcula el codigo, no la interpretes tu: si dice SI, el veredicto es CUMPLE aunque a ti te parezca que faltaba una respuesta de cortesia.\n" +
       "      QUEDA PROHIBIDO emitir no_cumple porque falte el ofrecimiento de ayuda. Ese es un criterio CRITICO: reprobarlo por una formula de cortesia ausente es exactamente el falso positivo que este sistema no puede permitirse. Si el agente cerro y el ofrecimiento no aparece, el veredicto es CUMPLE y, si quieres, lo mencionas como hallazgo.\n" +
       "      Ademas, 'ofrecimiento_de_ayuda_al_final: no' significa que no lo detecto una lista de frases, no que el agente haya cerrado en seco. Derivar al Centro de Ayuda, decir 'si necesitas informacion adicional' o cualquier variante equivalente ES dejar una via abierta.",
  C26: "Se evaluan DOS notas: Admin siempre que el procedimiento lo indique, y Remedios solo si se hizo una gestion en Remedios (ajuste de trayecto, reembolso, saldo, modificacion de journey).",
  C25: "Igual que C14: para afirmar que una modificacion no se ejecuto, cita el dato del sistema que lo demuestre, no la ausencia de una mencion.",
  C28: "Los plazos se juzgan contra lo que dice el procedimiento, no contra tu expectativa. Si el procedimiento no fija un plazo para ese caso, no hay incumplimiento.",
  C29: "El proceso ejecutado debe seguir la operativa: reembolsos, penalizaciones, retarificaciones y montos segun procedimiento.",
};

/**
 * Reglas que solo valen para una audiencia. Se aplican ENCIMA de AUD_REGLAS:
 * lo que no se redefina acá se hereda tal cual. Las reglas de B2B costaron
 * varias rondas de calibración (C04, C21, C14…) y son las mismas frases de
 * cortesía y los mismos cierres; heredarlas es lo correcto.
 */
const AUD_REGLAS_POR_AUDIENCIA = {
  aeropuerto: {
    C02: "Aeropuerto SI mide tiempos en ticket: 1 hora para la primera respuesta, " +
         "maximo 24 horas desde el reopen, y 1 hora para responder una solicitud de " +
         "informacion al usuario siempre que el agente este en turno. Si en el bloque de " +
         "la conversacion no aparecen las horas de cada turno, va no_concluyente: no " +
         "estimes el tiempo transcurrido.",
    C23: AUD_CLAUSULA_DUPLICADO + "\n" +
         "      Las tres tags vienen en DATOS VERIFICADOS y ademas hay un bloque " +
         "VERIFICACION DE OUTPUT TAGS con el catalogo oficial. Usalo asi:\n" +
         "        combinacion EXACTA en el catalogo -> la clasificacion es valida; juzga solo " +
         "si describe lo que paso. Si otra tag hermana lo describe mejor, es un hallazgo, y " +
         "no_cumple solo si la puesta es claramente ajena al caso.\n" +
         "        el nivel 3 aparece en OTRA rama -> es la forma tipica del error de nivel. " +
         "Revisalo, y si el caso encaja en la otra rama, no_cumple citando las dos.\n" +
         "        el catalogo no la reconoce -> no_concluyente. NUNCA no_cumple. El catalogo " +
         "es parcial y hay tags en uso que no estan en el (RRSS, Informacion insuficiente, " +
         "Avianca, Coronavirus). C23 es CRITICO y dejaria la nota en 0 por una carencia del " +
         "documento, no del agente.\n" +
         "        no llegaron tags -> no_concluyente.",
    C04: "Hereda la regla general, y con mas razon: en esta audiencia los tickets los " +
         "cierran ejecutivos de aeropuerto, que firman como 'Ejecutiva/Ejecutivo de Atencion " +
         "Cabify Aeropuerto'. Ese cargo es el ESPERADO aqui. Que en el mismo hilo aparezca " +
         "otro cargo antes (un ejecutivo de la central o el bot atienden primero y despues " +
         "derivan) es el flujo normal, NO una inconsistencia. Nada relativo al cargo se " +
         "evalua ni se menciona.",
    C20: "Hereda la regla general con dos datos de esta audiencia, y los dos apuntan a lo " +
         "mismo: PEDIR EL NUMERO O CODIGO DE RESERVA ES CORRECTO.\n" +
         "      Primero, el rider_id de aeropuerto es una cuenta de servicio compartida por " +
         "todos los tickets: no identifica a una persona y no sirve para buscar el caso.\n" +
         "      Segundo, las reservas de aeropuerto se hacen a menudo desde OTRO correo (una " +
         "agencia, un hotel, un acompanante, la empresa). El correo desde el que escribe quien " +
         "reclama no tiene por que ser el de la reserva, asi que el codigo de reserva es lo que " +
         "permite validar de que viaje se habla y que le corresponde a quien pregunta.\n" +
         "      Por eso, QUE HAYA UN journey_id ADJUNTO AL TICKET NO CONVIERTE LA PREGUNTA EN " +
         "INNECESARIA: un journey adjunto no acredita que sea el viaje del solicitante. Queda " +
         "prohibido emitir no_cumple con el razonamiento 'no verifico si el journey ya estaba " +
         "en el ticket antes de preguntar'.\n" +
         "      Y si el viaje no se encontro en el sistema, con mas razon: no hay dato con el " +
         "que sostener nada. Eso es no_concluyente, nunca no_cumple.",
    C09: "Lo mismo que en la regla general —mide si entendio la solicitud, no si la " +
         "verifico— y dos advertencias propias de esta audiencia.\n" +
         "      Una: si tu fundamento se apoya en horas del viaje, aplica el bloque RESERVAS " +
         "DE AEROPUERTO. startAt es la hora programada de llegada al aeropuerto, no la " +
         "recogida. Un no_cumple de C09 sostenido en una comparacion de horas mal leida es " +
         "un -100 falso.\n" +
         "      Dos: pedir el numero o codigo de reserva NUNCA es incumplir C09, aunque el " +
         "ticket traiga un journey_id adjunto. Aca las reservas se hacen a menudo desde otro " +
         "correo, asi que ese codigo es lo que valida de que viaje se habla; ver la regla de " +
         "C20. El agente que lo pide entendio la solicitud: por eso sabe que le falta.",
    C38: "Terceros son otras marcas, aerolineas, concesionarios del aeropuerto, " +
         "autoridades y proveedores. Desmeritarlos o hablar mal de ellos es el " +
         "incumplimiento. Explicar de forma neutra que algo depende de un tercero NO lo es.",
  },
};

/** Texto de la regla mecánica de un criterio, si tiene. */
function audReglaDe_(id, audiencia) {
  const propias = AUD_REGLAS_POR_AUDIENCIA[audiencia || AUD_AUDIENCIA_DEFECTO] || {};
  if (propias[id]) return propias[id];
  return AUD_REGLAS[id] || "";
}

const AUD_IDX = { ID: 0, TEXTO: 1, CRITICO: 2, DESCUENTO: 3, TICKET: 4, CHAT: 5, FLEETS: 6 };

/**
 * Criterios que aplican a un canal y a una audiencia (excluye siempre los de
 * rentadora/Fleets). Devuelve COPIAS de las filas cuando la audiencia ajusta
 * algo: nadie debe poder mutar AUD_CRITERIOS sin querer.
 *
 * `audiencia` es opcional y cae en la por defecto. Así todo el código que ya
 * existía sigue llamando igual y sigue obteniendo la matriz de B2B.
 */
function audCriteriosDeCanal_(canal, audiencia) {
  const col = (canal === "chat") ? AUD_IDX.CHAT : AUD_IDX.TICKET;
  const m   = audMatrizDe_(audiencia || AUD_AUDIENCIA_DEFECTO);
  const excluidos = {};
  (m.excluye || []).forEach(id => { excluidos[id] = true; });
  const ajustes = m.ajustes || {};

  return AUD_CRITERIOS
    .filter(c => !c[AUD_IDX.FLEETS] && !excluidos[c[AUD_IDX.ID]])
    .map(c => {
      const a = ajustes[c[AUD_IDX.ID]];
      if (!a) return c;
      const f = c.slice();
      if (a.ticket    !== undefined) f[AUD_IDX.TICKET]    = a.ticket;
      if (a.chat      !== undefined) f[AUD_IDX.CHAT]      = a.chat;
      if (a.critico   !== undefined) f[AUD_IDX.CRITICO]   = a.critico;
      if (a.descuento !== undefined) f[AUD_IDX.DESCUENTO] = a.descuento;
      return f;
    })
    .filter(c => c[col]);
}

/** Los criterios en texto plano, con su regla mecánica, para el prompt. */
function audCriteriosTexto_(canal, audiencia) {
  const sinInt = audSinIntegracion_(audiencia || AUD_AUDIENCIA_DEFECTO);
  return audCriteriosDeCanal_(canal, audiencia).map(c => {
    const id = c[AUD_IDX.ID];
    const linea = id + ";" + c[AUD_IDX.TEXTO] + ";" +
      (c[AUD_IDX.CRITICO] ? "CRITICO" : "no critico") + ";" + c[AUD_IDX.DESCUENTO];
    // Si el criterio se revisa a mano, hay que decírselo al evaluador en el
    // mismo renglón. Pedirle que evalúe algo que no puede ver es la receta
    // exacta del falso positivo que este sistema no se puede permitir.
    if (sinInt[id])
      return linea + "\n      regla: NO LO EVALUES. Responde SIEMPRE no_concluyente con fuente sin_datos. " +
             "Motivo: " + sinInt[id] + ". Lo revisa una persona.";
    const regla = audReglaDe_(id, audiencia);
    return regla ? linea + "\n      regla: " + regla : linea;
  }).join("\n");
}

/** Resumen del alcance por canal, para el encabezado del prompt. */
function audResumenCanal_(canal, audiencia) {
  const cs = audCriteriosDeCanal_(canal, audiencia);
  const criticos = cs.filter(c => c[AUD_IDX.CRITICO]).length;
  return cs.length + " criterios (" + criticos + " criticos que dejan la nota en 0)";
}

/**
 * Audiencia de un ticket que ya está en las hojas.
 *
 * Existe para que la consola y la revisión no tengan que arrastrar la
 * audiencia por seis funciones: la sacan del dato, que es donde vive.
 * Mira primero Conversaciones (que es lo que se auditó) y después el
 * Historico. Si no aparece en ninguna, cae en la audiencia por defecto,
 * que es como se comportaba el proyecto entero antes de esto.
 */
function audAudienciaDeTicket_(ticket) {
  const id = zdClaveTicket_(ticket);
  const ss = histGetSpreadsheet_(true);

  const buscar = (nombreHoja) => {
    const sh = ss.getSheetByName(nombreHoja);
    if (!sh || sh.getLastRow() < 2) return "";
    const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
    const cA = h.indexOf("Audiencia");
    const cT = h.indexOf("Ticket Number");
    if (cA < 0 || cT < 0) return "";
    const ids = sh.getRange(2, cT + 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (zdClaveTicket_(ids[i][0]) !== id) continue;
      return String(sh.getRange(i + 2, cA + 1).getValue() || "").trim();
    }
    return "";
  };

  const deConver = buscar(typeof ZD !== "undefined" ? ZD.HOJA_CONVER : "Conversaciones");
  if (deConver && AUD_AUDIENCIAS[deConver]) return deConver;

  const deHist = buscar((typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico");
  if (deHist && AUD_AUDIENCIAS[deHist]) return deHist;

  return AUD_AUDIENCIA_DEFECTO;
}

/**
 * ============================================================
 *  RESERVAS DE AEROPUERTO — la semántica de las horas
 * ============================================================
 * Este bloque existe por un crítico falso concreto. La auditoría de un
 * traslado a aeropuerto emitió C09 (critico, -100) razonando así:
 *
 *   "el conductor llego al pickup a las 08:06 local, 13 min antes de la hora
 *    programada 08:19"
 *
 * Esos 08:19 salían de `startAt`. En los viajes de aeropuerto ese campo no es
 * la hora de recogida: es la hora PROGRAMADA DE LLEGADA AL AEROPUERTO, o sea
 * el límite en el que el viaje tiene que haber terminado. Con ese dato mal
 * leído, la conclusión sobre puntualidad no significa nada — y encima tapó lo
 * que sí importaba: el viaje terminó a las 10:02, muy por encima de esa hora.
 *
 * Lo que NO se hace acá, a propósito: dar por cierta una semántica que no se
 * puede comprobar desde el código. El bloque declara de dónde viene la
 * definición, obliga al evaluador a decir qué lectura usó, y le prohíbe
 * emitir un crítico basado en horas cuando las dos lecturas dan resultados
 * distintos. Un no_concluyente honesto cuesta muchísimo menos que un -100
 * construido sobre un campo mal interpretado.
 */
function audBloqueAeropuerto_(L, audiencia, t) {
  if (audiencia !== "aeropuerto") return;
  // Con un ticket concreto y sin viaje asociado no hay horas que leer y el
  // bloque solo seria ruido. En un lote (sin `t`) va siempre: alguno de los
  // tickets del lote tendra viaje.
  if (t && !String(t.journeyId || "").trim()) return;

  L.push("=== RESERVAS DE AEROPUERTO: COMO SE LEEN LAS HORAS ===");
  L.push("Esto lo define el equipo que opera la audiencia. Es la definicion vigente:");
  L.push("");
  L.push("  startAt  =  hora PROGRAMADA DE LLEGADA AL AEROPUERTO.");
  L.push("             Es el LIMITE en que el viaje debe haber TERMINADO.");
  L.push("             NO es la hora de recogida del pasajero. NO es el inicio del viaje.");
  L.push("");
  L.push("  La recogida real es JourneyRiderPickup.");
  L.push("  La llegada del conductor al punto de recogida es JourneyDriverArrived.");
  L.push("  El fin real del viaje es JourneyFinished.");
  L.push("");
  L.push("QUEDA PROHIBIDO comparar JourneyDriverArrived o JourneyRiderPickup contra");
  L.push("startAt para concluir que el conductor llego 'antes' o 'con retraso'. Esas dos");
  L.push("horas no se miden contra startAt: se estarian comparando cosas distintas, y de");
  L.push("ahi salio un critico falso que hubo que revertir.");
  L.push("");
  L.push("La pregunta de puntualidad que SI corresponde es una sola:");
  L.push("  ¿JourneyFinished quedo antes o despues de startAt?");
  L.push("     antes o a la hora -> el traslado llego a tiempo al aeropuerto.");
  L.push("     despues           -> llego con retraso. Di de cuanto y trata el retraso");
  L.push("                          como el hecho relevante del caso.");
  L.push("");
  L.push("Antes de usar cualquier hora en una cita, escribe la linea de tiempo:");
  L.push("  llegada programada al aeropuerto (startAt) | llegada del conductor |");
  L.push("  recogida | fin del viaje | diferencia fin vs programada.");
  L.push("");
  L.push("Y di explicitamente que lectura de startAt estas usando. Si los datos que te");
  L.push("devolvio el sistema no permiten distinguir si startAt es la llegada al");
  L.push("aeropuerto o la recogida, o si las dos lecturas te llevan a veredictos");
  L.push("distintos, el veredicto es no_concluyente y lo dices. NO emitas un CRITICO");
  L.push("apoyado en horas que no puedes interpretar sin ambiguedad.");
  L.push("");
}

/** Cómo se nombra la audiencia dentro del prompt. */
function audEtiquetaAudiencia_(clave) {
  return clave === "aeropuerto" ? "aeropuerto (Aeropuerto Local, Chile)"
                                : "c4b_atencion (B2B Chile)";
}

/**
 * Escribe en el prompt los dos bloques de criterios que hoy no se pueden
 * verificar. Son distintos y el evaluador tiene que tratarlos distinto:
 *  · FUERA DE ALCANCE  → no_aplica, salen de la nota y de la cobertura.
 *  · REVISION MANUAL   → no_concluyente, se quedan y los mira una persona.
 */
function audBloqueAlcance_(L, audiencia) {
  const fuera = audFueraDeAlcance_(audiencia);
  const ids = Object.keys(fuera);
  if (ids.length) {
    L.push("=== FUERA DE ALCANCE ===");
    L.push("Estos criterios NO se evaluan hoy. Devuelvelos como 'no_aplica' con la");
    L.push("razon en la cita, sin analizarlos:");
    ids.forEach(id => L.push("  " + id + ": " + fuera[id]));
    L.push("");
  }

  const sinInt = audSinIntegracion_(audiencia);
  const idsSI = Object.keys(sinInt);
  if (idsSI.length) {
    L.push("=== REVISION MANUAL ===");
    L.push("Estos criterios NO los puedes verificar con lo que tienes. Devuelvelos");
    L.push("SIEMPRE como 'no_concluyente', fuente sin_datos, con la razon en la cita.");
    L.push("No los deduzcas ni los des por cumplidos: los revisa una persona.");
    idsSI.forEach(id => L.push("  " + id + ": " + sinInt[id]));
    L.push("");
  }
}

/**
 * Arma el prompt completo de auditoría para un ticket ya normalizado.
 * Es lo que se pega tal cual en el agente de marketplace.
 */
function audPromptAuditoria_(t) {
  const canal = t.canal;
  if (canal === "llamada") return "";

  const aud = t.audiencia || AUD_AUDIENCIA_DEFECTO;
  const L = [];
  L.push("[" + AUD_VERSION_REGLAS + "]");
  L.push("Eres auditor de calidad de atencion al cliente de Cabify. Audita UNA interaccion");
  L.push("de canal " + canal.toUpperCase() + ", audiencia " + audEtiquetaAudiencia_(aud) +
         ", contra los criterios listados.");
  L.push("");
  L.push("PASO 1. Consulta en el sistema los datos del viaje con estas claves:");
  L.push("   journey_id: " + (t.journeyId || "(sin viaje asociado)"));
  L.push("   journey_creation_date: " + (t.journeyDate || "(NO DISPONIBLE)"));
  L.push("   rider_id: "   + (t.riderId   || "(no disponible)"));
  L.push("   fecha de solved del ticket (UTC): " + (t.fechaSolved || "(no disponible)") +
         (t.fuenteFecha ? "  [fuente: " + t.fuenteFecha + "]" : ""));
  L.push("");
  L.push("   Las herramientas de viaje exigen journey_creation_date junto al journey_id:");
  L.push("   sus tablas estan particionadas por fecha. NO uses la fecha de solved para eso,");
  L.push("   es la fecha en que se cerro el caso y puede diferir en dias.");
  L.push("   Esa fecha sale de Start At Local, en hora local de Chile (America/Santiago).");
  if (aud === "aeropuerto") {
    // Para aeropuerto, Start At NO es el inicio del viaje. Decirle que sí lo es
    // es lo que produjo un critico falso: el evaluador comparo la llegada del
    // conductor contra esa hora y concluyo "llego 13 minutos antes de lo
    // programado" sobre un dato que significa otra cosa.
    L.push("   OJO: en viajes de aeropuerto ese campo NO es la hora de recogida. Lee el");
    L.push("   bloque RESERVAS DE AEROPUERTO antes de sacar cualquier conclusion de horas.");
  } else {
    L.push("   Corresponde al INICIO del viaje.");
  }
  L.push("   Si la consulta vuelve vacia, reintenta con el dia");
  L.push("   anterior y el siguiente antes de concluir que no hay datos — de noche en");
  L.push("   Santiago la fecha UTC ya es la del dia siguiente. Di en que fecha lo hallaste.");
  L.push("   Si journey_creation_date dice NO DISPONIBLE, no adivines ni consultes a ciegas:");
  L.push("   marca no_concluyente todo criterio que dependa del viaje y sigue con la");
  L.push("   conversacion, que si puedes evaluar.");
  L.push("");
  L.push("   Necesito: tipo de precio, precio cobrado al rider, precio estimado, descuentos,");
  L.push("   retarificaciones o reembolsos posteriores, estado del viaje, horas de asignacion,");
  L.push("   llegada al pickup e inicio, espera en el pickup, cancelacion y penalizacion.");
  L.push("   Si un dato no existe, dilo explicitamente. No lo estimes ni lo infieras.");
  L.push("   La ausencia de los modifiers happy_path/happy_price NO implica que hubo");
  L.push("   diferencia de precio: comparala solo contra el estimado.");
  L.push("");
  L.push("PASO 2. Audita la conversacion cruzandola con esos datos.");
  L.push("");
  audBloqueAeropuerto_(L, aud, t);
  audBloqueAlcance_(L, aud);
  L.push("=== CRITERIOS APLICABLES (" + audResumenCanal_(canal, aud) + ") ===");
  L.push("id;criterio;afectacion;descuento");
  L.push(audCriteriosTexto_(canal, aud));
  L.push("");
  L.push("=== REGLA DE LAS DOS CIFRAS ===");
  L.push("Para afirmar que un importe, una fecha o un dato que dio el agente NO cuadra");
  L.push("con el sistema, tienes que escribir en la cita LAS DOS cifras, una al lado de");
  L.push("la otra, y su diferencia:");
  L.push('   "el agente dijo X; el sistema dice Y; difieren en Z"');
  L.push("Si al escribirlas resulta que coinciden, el veredicto es CUMPLE.");
  L.push("Si no puedes poner la cifra del sistema porque no la tienes, es no_concluyente,");
  L.push("nunca no_cumple. Una acusacion sin las dos cifras es un falso positivo.");
  L.push("");
  L.push("LAS RETARIFICACIONES SE ENCADENAN. Esto es lo que mas falsos positivos");
  L.push("produce, asi que leelo dos veces.");
  L.push("");
  L.push("Un viaje puede tener VARIAS retarificaciones, una tras otra. El precio");
  L.push("original de cada una es el resultado de la anterior. Ejemplo real:");
  L.push("");
  L.push("   accion 1 (editar trayecto)          32.047 -> 29.706");
  L.push("   accion 2 (aplicar precio estimado)  29.706 -> 28.238");
  L.push("");
  L.push("Aca hay TRES cifras y solo dos sirven:");
  L.push("   cobro original  = 32.047  (el original de la PRIMERA)");
  L.push("   precio final    = 28.238  (el resultado de la ULTIMA)");
  L.push("   29.706          = INTERMEDIO. No es un precio final de nada.");
  L.push("");
  L.push("Reglas obligatorias antes de comparar cualquier importe:");
  L.push("1. Ordena las retarificaciones por fecha y hora, de la mas antigua a la");
  L.push("   mas nueva. Toma el resultado de la ULTIMA como precio final.");
  L.push("2. Una cifra que aparece como 'precio original' de una retarificacion");
  L.push("   posterior es, por definicion, un valor INTERMEDIO. Nunca la uses como");
  L.push("   precio final.");
  L.push("3. COMPRUEBA CONTRA EL PRECIO FINAL DEL VIAJE. El sistema declara un");
  L.push("   priceTotal / precio final. Si la cifra que calculaste como final no");
  L.push("   coincide con esa, leiste mal la cadena: vuelve a leerla. NO reportes");
  L.push("   una discrepancia con el agente basandote en tu propia lectura mala.");
  L.push("4. Si solo puedes ver una de las retarificaciones y hay señales de que hubo");
  L.push("   mas, es no_concluyente, no no_cumple.");
  L.push("");
  L.push("OJO con los reembolsos, que es donde mas se falla. Un reembolso normal tiene");
  L.push("DOS importes distintos y los dos son legitimos:");
  L.push("   1. el cobro original, que se devuelve al cliente");
  L.push("   2. el precio final correcto, que se cobra en su lugar");
  L.push('Cuando el agente dice "reembolse 31.671 y cobre 25.506 por el valor correcto",');
  L.push("no esta anunciando un cobro EXTRA de 25.506: esta diciendo que el precio que");
  L.push("queda es 25.506. Si el precio final del sistema es 25.506, CUMPLE.");
  L.push("Antes de marcar no_cumple por un importe, comprueba si la cifra que crees");
  L.push("sobrante es en realidad el precio final tras retarificacion.");
  L.push("");
  L.push("=== REGLA DE LAS DOS FECHAS ===");
  L.push("La misma disciplina, aplicada al tiempo. Para afirmar que algo ocurrio");
  L.push("ANTES o DESPUES de otra cosa tienes que escribir en la cita LAS DOS marcas");
  L.push("de tiempo completas, una al lado de la otra, y decir cual es mayor:");
  L.push('   "la retarificacion es 18/05/2026 18:18:44; el ticket se creo el');
  L.push('    18/05/2026 16:44; la retarificacion es POSTERIOR en 1h 34m"');
  L.push("Sin las dos fechas escritas no hay veredicto temporal: es no_concluyente.");
  L.push("El formato es dd/mm/aaaa y la hora va en 24h. 18/05 es 18 de mayo, no 5 de");
  L.push("noviembre; 18:18 es la tarde, no la madrugada. Compara primero el dia, y solo");
  L.push("si coincide, la hora.");
  L.push("");
  L.push("Y aunque las fechas te den, EL ORDEN NO ES UN CRITERIO. Que una retarificacion");
  L.push("sea anterior o posterior a la apertura del ticket no prueba nada por si sola:");
  L.push("un agente puede informar de un ajuste que ya estaba hecho, y eso es correcto.");
  L.push("Lo que se audita es si la CIFRA que dijo el agente coincide con la del sistema,");
  L.push("no cuando se ejecuto. Nunca uses la cronologia como razon de un no_cumple de");
  L.push("importes, ni digas que 'no hay retarificacion posterior al ticket' como si eso");
  L.push("desmintiera al agente.");
  L.push("");
  L.push("=== REGLAS DE VEREDICTO, NO NEGOCIABLES ===");
  L.push("1. Veredictos permitidos: cumple | no_cumple | no_aplica | no_concluyente.");
  L.push("2. Todo 'no_cumple' exige una CITA TEXTUAL LITERAL de la conversacion o un dato");
  L.push("   concreto del viaje. Sin cita verificable el veredicto es 'no_concluyente'.");
  L.push("3. No inventes citas. Si no puedes copiar el texto exacto, es no_concluyente.");
  L.push("4. Ante duda razonable el veredicto es 'cumple'. Un criterio critico deja la nota");
  L.push("   en 0: el costo de un falso positivo es una persona injustamente evaluada.");
  L.push("5. Si el procedimiento no prohibe la conducta, no es incumplimiento: va a hallazgos.");
  L.push("6. Se juzga a quien intervino, no al agente asignado. Si respondio un bot (ABI,");
  L.push("   Help Support) eso tambien es atencion: evaluala e indicalo en autor_evaluado.");
  L.push("7. El extractor NO entrega la visibilidad de cada mensaje. No emitas veredictos que");
  L.push("   dependan de distinguir nota interna de mensaje publico: usa no_concluyente.");
  L.push("8. EL VEREDICTO QUE ESCRIBES EN LA COLUMNA ES EL QUE VALE. Si al razonar decides");
  L.push("   rebajarlo, escribe el rebajado en la columna. No pongas 'no_cumple' y luego");
  L.push("   expliques en la cita que lo rebajas a no_concluyente: el sistema lee la columna,");
  L.push("   no la cita, y el resultado seria un incumplimiento que tu mismo descartaste.");
  L.push("9. Coherencia entre veredicto y fuente: 'no_cumple' con fuente 'sin_datos' es una");
  L.push("   contradiccion. Si no tuviste el dato, no puedes afirmar el incumplimiento; el");
  L.push("   veredicto es no_concluyente.");
  L.push("10. NO calcules la nota, el puntaje ni el promedio. Tu salida son veredictos.");
  L.push("   La aritmetica la hace otro sistema.");
  L.push("");
  L.push("=== SALIDA ===");
  L.push("Primero un unico bloque csv con separador ';' y esta cabecera exacta:");
  L.push("");
  L.push("criterio_id;veredicto;autor_evaluado;cita;fuente;confianza");
  L.push("");
  L.push("- una fila por cada criterio de la lista, en orden, sin omitir ninguno");
  L.push("- cita: texto literal, o vacio si el veredicto es 'cumple'");
  L.push("- fuente: conversacion | viaje | procedimiento | sin_datos");
  L.push("- confianza: alta | media | baja");
  L.push("- si la cita contiene ';' reemplazalo por ','");
  L.push("");
  L.push("Despues un unico bloque json:");
  L.push('{ "ticket": "' + t.ticket + '", "datos_del_viaje": { }, "hallazgos": [], "datos_que_faltaron": [] }');
  L.push("");
  L.push("Nada de texto fuera de esos dos bloques.");
  L.push("");
  L.push("=== DATOS VERIFICADOS ===");
  L.push("Calculados del propio hilo o traidos del sistema. Son HECHOS: usalos como");
  L.push("evidencia, no los pongas en duda y no los recalcules.");
  L.push(audDatosVerificados_(t));
  L.push("");
  // El procedimiento vigente, si Confluence está conectado y hay uno que aplique.
  // Mientras CONF_MAPA esté vacío esto devuelve "" y el prompt queda idéntico al
  // de antes: la integración se puede llenar de a poco sin romper nada.
  const proc = audBloqueProcedimiento_(t);
  if (proc) { L.push(proc); L.push(""); }
  // La verificación de las output tags contra el catálogo oficial, si la
  // audiencia lo usa y está sincronizado. Mismo trato que el procedimiento:
  // si no está, el prompt sale exactamente como antes.
  const tg = audBloqueTags_(t);
  if (tg) { L.push(tg); L.push(""); }
  const pt = audBloquePautas_(t);
  if (pt) { L.push(pt); L.push(""); }
  L.push("=== INTERACCION A AUDITAR ===");
  L.push(audCuerpoInteraccion_(t));
  return L.join("\n");
}

/**
 * El procedimiento vigente para este ticket, si Confluence.gs está en el proyecto
 * y hay alguno mapeado. Si el archivo no está, o el mapa está vacío, devuelve ""
 * y el prompt sale exactamente como antes.
 *
 * Va envuelto en try porque un fallo de Confluence no puede impedir auditar la
 * conversación, que es lo que sí tenemos delante.
 */
function audBloqueProcedimiento_(t) {
  if (typeof confBloquePrompt_ !== "function") return "";
  try { return confBloquePrompt_(t) || ""; }
  catch (e) {
    Logger.log("AVISO: no pude adjuntar el procedimiento (%s). Se audita sin él.", e.message);
    return "";
  }
}

/** El catálogo de output tags, si Tags.gs está en el proyecto. Mismo criterio. */
function audBloqueTags_(t) {
  if (typeof tagsBloquePrompt_ !== "function") return "";
  try { return tagsBloquePrompt_(t) || ""; }
  catch (e) {
    Logger.log("AVISO: no pude adjuntar el catálogo de tags (%s). Se audita sin él.", e.message);
    return "";
  }
}

/** Las pautas de respuesta, si la audiencia las tiene encendidas. */
function audBloquePautas_(t) {
  if (typeof tagsPautasPrompt_ !== "function") return "";
  try { return tagsPautasPrompt_(t) || ""; }
  catch (e) {
    Logger.log("AVISO: no pude adjuntar las pautas de respuesta (%s). Se audita sin ellas.", e.message);
    return "";
  }
}

/**
 * Hechos que no hay que inferir. Sacan a C21, C22 y C23 del limbo del
 * "no concluyente" sin inventar nada: se calculan del texto o vienen del
 * histórico, y el agente los usa como evidencia en vez de adivinar.
 */
function audDatosVerificados_(t) {
  const s = t.senales || {};
  const L = [];

  // Si no sabemos quién cerró, hay que DECIRLO. La versión anterior imprimía
  // "desconocido (la ultima palabra la tuvo el solicitante)": juntaba una
  // ignorancia con una afirmación, y el agente se quedaba con la afirmación y
  // reprobaba C21. No saber y saber que fue mal no son lo mismo.
  if (!s.quienCerro) {
    L.push("cierre_del_hilo: DESCONOCIDO  (no se pudo determinar quien tuvo la ultima palabra; " +
           "no lo infieras: los criterios que dependan de esto van no_concluyente)");
    L.push("ofrecimiento_de_ayuda_al_final: desconocido");
  } else {
    L.push("cierre_del_hilo: " + s.quienCerro +
           (s.cerroElAgente ? "  (la ultima palabra la tuvo quien atiende)"
                            : "  (la ultima palabra la tuvo el solicitante)"));
    // Un "no" acá es "no lo detecto una lista de frases", no "el agente cerro en
    // seco". Sin esa aclaracion el modelo lo leia como acusacion y reprobaba C21,
    // que es critico, por una formula de cortesia ausente.
    L.push("ofrecimiento_de_ayuda_al_final: " + (s.invitaAyuda ? "si" : "no") +
           (s.invitaAyuda ? "" : "   (NO detectado por lista de frases; NO es evidencia de incumplimiento " +
                                 "y por si solo no justifica ningun no_cumple)"));

    // Cuando cierra el solicitante hay que distinguir dos cosas muy distintas:
    // que se quedara esperando, o que agradeciera. La primera es el
    // incumplimiento que C21 persigue; la segunda es un caso resuelto.
    if (!s.cerroElAgente) {
      L.push("el_solicitante_dio_el_caso_por_cerrado: " +
             (s.clienteDioPorCerrado ? "SI" : "no") +
             (s.clienteDioPorCerrado
               ? "   (su ultimo mensaje es un agradecimiento o un 'ya se resolvio': " +
                 "NO quedo esperando nada, y C21 CUMPLE)"
               : "   (su ultimo mensaje no parece un cierre de cortesia)"));
      if (s.ultimoTextoCliente)
        L.push("ultimo_mensaje_del_solicitante: \"" + s.ultimoTextoCliente + "\"");
    }
  }
  L.push("mensaje_largo_del_agente_repetido: " + (s.repiteMensaje ? "SI, hay dos casi identicos" : "no") +
         "   (mensajes largos del agente: " + (s.mensajesLargosAgente || 0) + ")");

  const tags = t.outputTags || [];
  L.push("output_tags: " + (tags.length ? tags.join(" > ") : "(no llegaron)"));

  // Cierre por derivación a otro ticket, cruzado con la tag. Este cruce se
  // hace acá, en código, porque de él dependen TRES criterios criticos: sin
  // el cruce, la auditoria reprochaba C19 y C27 (dos -100) cuando el unico
  // defecto real estaba en C23 (uno).
  if (s.derivaAOtroTicket) {
    const n1 = String(tags[0] || "");
    const esDuplicado = /duplicad/i.test(n1);
    L.push("cierre_por_derivacion_a_otro_ticket: SI, al ticket " + s.ticketDerivado);
    L.push("   La solicitud SI quedo atendida: se atiende en ese otro ticket. Eso NO es");
    L.push("   terminar sin atender (C19) ni dejar dudas sin contestar (C27): esos dos");
    L.push("   CUMPLEN. No pidas ver la respuesta del otro ticket, no la tienes.");
    L.push("   tag_de_primer_nivel: " + (n1 || "(vacia)"));
    if (esDuplicado) {
      L.push("   La tag es la que corresponde a un cierre por duplicado. C23 CUMPLE por");
      L.push("   este motivo (juzga aparte si los niveles 2 y 3 encajan).");
    } else {
      L.push("   UN CIERRE POR DUPLICADO SE ETIQUETA 'Duplicado' Y ESTA NO LO ESTA.");
      L.push("   Ese es el UNICO incumplimiento del caso y va en C23, con la tag como cita.");
      L.push("   No lo repartas en otros criterios: un defecto, un criterio.");
    }
  }
  if (t.grupoZendesk) L.push("grupo_zendesk: " + t.grupoZendesk);
  if (t.agenteHist)   L.push("agente_asignado: " + t.agenteHist);

  return L.join("\n");
}

/**
 * El cuerpo de la interacción, venga de donde venga:
 *  - objeto normalizado por zdNormalizar_ (tiene turnos y metricas)
 *  - fila ya renderizada de la hoja Conversaciones (tiene .conversacion)
 * Sin esto, auditar leyendo desde la hoja revienta al formatear.
 */
function audCuerpoInteraccion_(t) {
  if (t && typeof t.conversacion === "string" && t.conversacion.trim()) return t.conversacion;
  // Solo se puede formatear si el objeto trae los turnos. Una fila leída de la
  // hoja no los tiene: antes esto reventaba con "cannot read 'join'", que no
  // le dice nada a nadie.
  if (t && Array.isArray(t.turnos) && Array.isArray(t.tags)) return zdFormatearBloque_(t);
  return "(no hay conversacion disponible para este ticket: el prompt se armo sin ella)";
}

/** Comprueba que la matriz cuadre con lo esperado. Ejecutar para verificar. */
function audVerificarMatriz() {
  const salida = {};
  Logger.log("Criterios en el registro: %s", AUD_CRITERIOS.length);

  audAudiencias_().forEach(a => {
    const t = audCriteriosDeCanal_("ticket", a);
    const c = audCriteriosDeCanal_("chat", a);
    const critT = t.filter(x => x[AUD_IDX.CRITICO]).length;
    const sumaNoCritT = t.filter(x => !x[AUD_IDX.CRITICO])
                         .reduce((x0, x) => x0 + x[AUD_IDX.DESCUENTO], 0);
    const sumaNoCritC = c.filter(x => !x[AUD_IDX.CRITICO])
                         .reduce((x0, x) => x0 + x[AUD_IDX.DESCUENTO], 0);

    Logger.log("");
    Logger.log("== %s ==", audNombreAudiencia_(a));
    Logger.log("  ticket: %s criterios (%s criticos, %s no criticos que suman %s)",
               t.length, critT, t.length - critT, sumaNoCritT);
    Logger.log("  chat:   %s criterios (%s criticos, no criticos suman %s)",
               c.length, c.filter(x => x[AUD_IDX.CRITICO]).length, sumaNoCritC);
    Logger.log("  nota minima sin ningun critico incumplido: ticket %s | chat %s",
               100 + sumaNoCritT, 100 + sumaNoCritC);

    const fuera  = Object.keys(audFueraDeAlcance_(a));
    const manual = Object.keys(audSinIntegracion_(a));
    Logger.log("  fuera de alcance: %s", fuera.join(", ")  || "ninguno");
    Logger.log("  checklist manual: %s", manual.join(", ") || "ninguno");

    salida[a] = { ticket: t.length, chat: c.length, criticosTicket: critT,
                  fuera: fuera, manual: manual };
  });

  return salida;
}

// ============================================================
//  INGESTA DE VEREDICTOS Y CÁLCULO DE LA NOTA
// ============================================================
const AUD = {
  HOJA_INBOX:      "Inbox Auditoria",   // donde pegas la respuesta del agente
  HOJA_VEREDICTOS: "Veredictos",        // un renglón por ticket y criterio
  HOJA_VIAJES:     "Viajes",            // los datos del sistema, uno por ticket
  AUDITOR:         "marketplace-agent (automatico)",
  VERSION_MATRIZ:  "matriz-global-2026-08",
  TZ:              "America/Santiago",
};

const AUD_VEREDICTOS_VALIDOS = ["cumple", "no_cumple", "no_aplica", "no_concluyente"];

/**
 * ESTA ES LA FUNCIÓN QUE HAY QUE EJECUTAR después de pegar la respuesta.
 *
 * En la hoja "Inbox Auditoria":
 *   A1: Ticket    B1: 74128059      (opcional si el CSV trae columna ticket_id)
 *   fila 3 hacia abajo: pega el CSV que devolvió el agente
 *
 * Escribe la hoja Veredictos y actualiza las columnas de auditoría del histórico.
 */
function audIngestarVeredictos() {
  const pegado = audLeerPegado_();
  const lote   = pegado.veredictos;
  const viajes = pegado.viajes || {};
  const resultados = [];

  Object.keys(lote).forEach(ticket => {
    const veredictos = lote[ticket];
    const canal = audDetectarCanalTicket_(ticket, veredictos);
    const r = audCalcularNota_(canal, veredictos);
    r.ticket = ticket;
    r.canal  = canal;

    audEscribirVeredictos_(ticket, canal, veredictos, r);
    if (viajes[ticket]) { audEscribirViaje_(ticket, viajes[ticket]); r.viajeGuardado = true; }
    audEscribirEnHistorico_(ticket, r);
    resultados.push(r);

    Logger.log("%s [%s] nota=%s (en riesgo %s) techo=%s | criticos: %s | por confirmar: %s | no concluyentes: %s | %s",
      ticket, canal, r.nota, r.notaEnRiesgo, r.techo,
      r.criticosIncumplidos.join(",") || "ninguno",
      r.criticosPorConfirmar.join(",") || "ninguno",
      r.noConcluyentes.join(",") || "ninguno",
      r.estado);
    r.avisos.forEach(a => Logger.log("   AVISO %s: %s", ticket, a));
  });

  const conViaje = resultados.filter(x => x.viajeGuardado).length;
  if (conViaje) Logger.log("Datos del viaje guardados para %s de %s tickets.", conViaje, resultados.length);
  else Logger.log("AVISO: no llegó el JSON del viaje. Pega también ese bloque para no perder los datos del sistema.");

  if (!resultados.length) throw new Error('No encontré veredictos. Pega el CSV del agente en la hoja "' + AUD.HOJA_INBOX + '" desde la fila 3.');
  SpreadsheetApp.flush();
  return resultados;
}

/**
 * Lee lo pegado en la hoja Inbox Auditoria y devuelve { ticket: [veredictos] }.
 * Tolera que Sheets haya separado el CSV en columnas o lo haya dejado en una sola.
 */
function audLeerPegado_() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(AUD.HOJA_INBOX);
  if (!sh) throw new Error('No existe la hoja "' + AUD.HOJA_INBOX + '". Créala, pon el número de ticket en B1 y pega el CSV desde la fila 3.');

  const lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
  if (lastRow < 2) throw new Error("La hoja " + AUD.HOJA_INBOX + " está vacía.");

  const vals = sh.getRange(1, 1, lastRow, lastCol).getValues();

  // Ticket declarado a mano (celda B1, o la que esté al lado de una etiqueta "Ticket")
  let ticketDeclarado = "";
  vals.forEach(fila => {
    for (let j = 0; j < fila.length - 1; j++) {
      if (String(fila[j]).trim().toLowerCase().replace(":", "") === "ticket") {
        ticketDeclarado = zdClaveTicket_(fila[j + 1]);
      }
    }
  });

  // Reconstruye las líneas. Se acepta la respuesta COMPLETA del agente pegada
  // tal cual: prosa, ```fences```, el CSV y el JSON, todo junto. Lo que no
  // calce con el contrato simplemente se ignora.
  const lineas = vals.map(fila => {
    const celdas = fila.map(v => (v === null || v === undefined) ? "" : String(v));
    while (celdas.length && celdas[celdas.length - 1] === "") celdas.pop();
    return celdas.length <= 1 ? (celdas[0] || "") : celdas.join(";");
  })
  .map(l => l.replace(/^\s*```+\s*\w*\s*$/, ""))   // fences de markdown
  .filter(l => l.trim());

  return audParsearRespuesta_(lineas, ticketDeclarado, AUD.HOJA_INBOX);
}

/**
 * Convierte la respuesta del agente (venga de una pegada o de la API) en
 * { veredictos: {ticket: [...]}, viajes: {ticket: {...}} }.
 * Tolera prosa, fences de markdown y texto suelto alrededor.
 */
function audParsearRespuesta_(lineas, ticketDeclarado, origen) {
  const iCab = lineas.findIndex(l => l.toLowerCase().indexOf("criterio_id") >= 0);
  if (iCab < 0) throw new Error('No encontré la cabecera "criterio_id" en ' + (origen || "la respuesta") +
    ". Hace falta el bloque CSV completo, con su primera línea.");

  const cab = lineas[iCab].split(";").map(h => h.trim().toLowerCase());
  const col = n => cab.indexOf(n);
  const cId = col("criterio_id"), cVer = col("veredicto");
  if (cId < 0 || cVer < 0) throw new Error("El CSV debe traer al menos criterio_id y veredicto.");

  const cTicket = col("ticket_id") >= 0 ? col("ticket_id") : col("ticket");
  const cAutor  = col("autor_evaluado"), cCita = col("cita"),
        cFuente = col("fuente"), cConf = col("confianza");

  const lote = {};
  lineas.slice(iCab + 1).forEach(linea => {
    const p = linea.split(";");
    const q = audAlinearFila_(p, cab.length, cCita);
    const id = String(q[cId] || "").trim().toUpperCase();
    if (!/^C\d{2}$/.test(id)) return;                      // ignora basura y líneas sueltas

    const ticket = cTicket >= 0 ? zdClaveTicket_(q[cTicket]) : ticketDeclarado;
    if (!ticket) throw new Error("No sé a qué ticket corresponden estos veredictos. Pon el número en B1 (con la etiqueta Ticket en A1) o pide una columna ticket_id en el CSV.");

    const fila = {
      id:        id,
      veredicto: String(q[cVer] || "").trim().toLowerCase(),
      autor:     cAutor  >= 0 ? String(q[cAutor]  || "").trim() : "",
      cita:      cCita   >= 0 ? String(q[cCita]   || "").trim() : "",
      fuente:    cFuente >= 0 ? String(q[cFuente] || "").trim() : "",
      confianza: cConf   >= 0 ? String(q[cConf]   || "").trim() : "",
    };
    audSanearFila_(fila);

    if (!lote[ticket]) lote[ticket] = [];
    lote[ticket].push(fila);
  });
  return { veredictos: lote, viajes: audExtraerJson_(lineas.slice(iCab)) };
}

/**
 * Devuelve la fila con EXACTAMENTE las columnas de la cabecera.
 *
 * La cita es el único campo de texto libre del contrato. Cuando el agente mete
 * un ";" dentro de ella —pese a que el prompt se lo prohíbe— la fila trae más
 * campos de los declarados y todo lo que va detrás se corre una casilla. Así fue
 * como terminó guardada una frase entera en "fuente" y la palabra "viaje" en
 * "confianza".
 *
 * La corrección es estructural, no un parche: los campos ANTERIORES a la cita se
 * leen desde el principio y los POSTERIORES desde el final. La cita es todo lo
 * que queda en medio. Con eso, sobren los ";" que sobren, fuente y confianza
 * siempre caen en su sitio.
 */
function audAlinearFila_(p, nCols, cCita) {
  if (cCita < 0 || p.length <= nCols) return p;
  const cola = nCols - cCita - 1;                       // columnas después de la cita
  return p.slice(0, cCita)
          .concat([p.slice(cCita, p.length - cola).join(",")])
          .concat(cola ? p.slice(p.length - cola) : []);
}

/** minúsculas, sin tildes y con "_" en vez de espacios: para comparar etiquetas. */
function audEtiqueta_(v) {
  return String(v == null ? "" : v).trim().toLowerCase()
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u")
    .replace(/\s+/g, "_");
}

// Las cuatro primeras son las que el contrato le pide al agente. "revision_humana"
// no se la pedimos a él: la pone revGuardar cuando quien revisa corrige un
// veredicto. Si faltara de esta lista, la corrección de la persona se degradaría
// a no_concluyente y su palabra valdría menos que la del modelo.
const AUD_FUENTES_VALIDAS    = ["conversacion", "viaje", "procedimiento", "sin_datos", "revision_humana"];
const AUD_CONFIANZAS_VALIDAS = ["alta", "media", "baja"];

/**
 * Última defensa antes de guardar: si "fuente" o "confianza" no son uno de los
 * valores del contrato, la fila viene rota y no se puede confiar en su veredicto.
 * En vez de persistir basura —y penalizar a una persona con ella— la fila se
 * degrada a no_concluyente y se deja dicho por qué, sin perder el texto original.
 */
function audSanearFila_(v) {
  const f = audEtiqueta_(v.fuente), c = audEtiqueta_(v.confianza);
  const malaFuente = f && AUD_FUENTES_VALIDAS.indexOf(f) < 0;
  const malaConf   = c && AUD_CONFIANZAS_VALIDAS.indexOf(c) < 0;
  if (!malaFuente && !malaConf) {
    v.fuente = f; v.confianza = c;
    return v;
  }
  const roto = [];
  if (malaFuente) roto.push('fuente="' + v.fuente + '"');
  if (malaConf)   roto.push('confianza="' + v.confianza + '"');
  v.cita = (v.cita ? v.cita + " " : "") + "[fila mal formada: " + roto.join(", ") + "]";
  v.fuente    = malaFuente ? "" : f;
  v.confianza = malaConf   ? "" : c;
  v.veredicto = "no_concluyente";
  v.aviso = v.id + ": la respuesta llegó con las columnas corridas (" + roto.join(", ") +
            "). No se guarda ese veredicto: pasa a no_concluyente.";
  return v;
}

/**
 * Busca el bloque JSON dentro de lo pegado y devuelve { ticket: datos }.
 * Acepta un objeto suelto o un array de objetos (un lote). Si no lo puede
 * leer, avisa y sigue: los veredictos se cargan igual.
 */
function audExtraerJson_(lineas) {
  const texto = lineas.join("\n");
  const inicio = texto.search(/[\[{]\s*\n?\s*[\[{"]/);
  if (inicio < 0) return {};

  // Corta el bloque balanceando llaves y corchetes, ignorando lo que va en strings
  let prof = 0, enStr = false, escape = false, fin = -1;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { enStr = !enStr; continue; }
    if (enStr) continue;
    if (c === "{" || c === "[") prof++;
    else if (c === "}" || c === "]") { prof--; if (prof === 0) { fin = i + 1; break; } }
  }
  if (fin < 0) return {};

  let datos;
  try { datos = JSON.parse(texto.slice(inicio, fin)); }
  catch (e) { Logger.log("AVISO: no pude leer el JSON del viaje (%s). Los veredictos se cargan igual.", e.message); return {}; }

  const lista = (Object.prototype.toString.call(datos) === "[object Array]") ? datos : [datos];
  const mapa = {};
  lista.forEach(o => {
    if (!o || typeof o !== "object") return;
    const tk = zdClaveTicket_(o.ticket || o.ticket_id || (o.datos_del_viaje && o.datos_del_viaje.ticket));
    if (tk) mapa[tk] = o;
  });
  return mapa;
}

/** Canal del ticket: primero la hoja Conversaciones, si no se deduce de los criterios. */
function audDetectarCanalTicket_(ticket, veredictos) {
  try {
    const ss = histGetSpreadsheet_(true);
    const sh = ss.getSheetByName(ZD.HOJA_CONVER);
    if (sh && sh.getLastRow() > 1) {
      const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      const f = vals.filter(r => zdClaveTicket_(r[0]) === zdClaveTicket_(ticket))[0];
      if (f && f[1]) return String(f[1]).trim();
    }
  } catch (e) { /* seguimos con la deducción */ }

  // C16 y C17 sólo existen en canal chat
  const ids = veredictos.map(v => v.id);
  return (ids.indexOf("C16") >= 0 || ids.indexOf("C17") >= 0) ? "chat" : "ticket";
}

/**
 * LA NOTA. Aquí y en ningún otro lado.
 *   nota  = 100 - suma de descuentos no críticos incumplidos
 *   nota  = 0 si hay al menos un criterio crítico incumplido
 *   techo = 100 - suma de descuentos no críticos que NO se pudieron evaluar
 *           (un 100 con techo 96 no es un 100 limpio)
 * Los criterios "no_aplica" no restan ni bajan el techo.
 */
function audCalcularNota_(canal, veredictos, audiencia) {
  const aud = audiencia || AUD_AUDIENCIA_DEFECTO;
  const fueraMap = audFueraDeAlcance_(aud);
  const sinIntMap = audSinIntegracion_(aud);
  const aplicables = audCriteriosDeCanal_(canal, aud);
  const porId = {};
  aplicables.forEach(c => { porId[c[AUD_IDX.ID]] = c; });

  const dado = {};
  const avisos = [];

  veredictos.forEach(v => {
    // Vale tanto para lo que acaba de llegar como para lo ya guardado antes de
    // que existiera audSanearFila_: una fila corrida no penaliza a nadie.
    const fMal = v.fuente    && AUD_FUENTES_VALIDAS.indexOf(audEtiqueta_(v.fuente)) < 0;
    const cMal = v.confianza && AUD_CONFIANZAS_VALIDAS.indexOf(audEtiqueta_(v.confianza)) < 0;
    if (fMal || cMal) {
      avisos.push(v.id + ": fila mal formada (" +
        (fMal ? 'fuente="' + v.fuente + '"' : "") + (fMal && cMal ? ", " : "") +
        (cMal ? 'confianza="' + v.confianza + '"' : "") +
        "): se trata como no_concluyente");
      v.veredicto = "no_concluyente";
    }
    if (v.aviso) avisos.push(v.aviso);
    if (AUD_VEREDICTOS_VALIDOS.indexOf(v.veredicto) < 0) {
      avisos.push("veredicto no reconocido en " + v.id + ": '" + v.veredicto + "' (se trata como no_concluyente)");
      v.veredicto = "no_concluyente";
    }
    if (!porId[v.id]) {
      avisos.push(v.id + " no aplica al canal " + canal + " y viene en la respuesta: se ignora");
      return;
    }
    if (dado[v.id]) avisos.push(v.id + " viene repetido: se usa el último");
    dado[v.id] = v;
  });

  aplicables.forEach(c => {
    const id = c[AUD_IDX.ID];
    if (fueraMap[id] || sinIntMap[id]) return;
    if (!dado[id]) avisos.push("falta el veredicto de " + id + ": se cuenta como no_concluyente");
  });

  const criticosIncumplidos = [], noCriticosIncumplidos = [], noConcluyentes = [],
        criticosSinEvaluar = [], sinCita = [], criticosPorConfirmar = [],
        sinIntegracion = [], confianzaBaja = [], sinDatos = [];
  let descuento = 0, techoPerdido = 0, evaluados = 0;

  // SOLO los declarados fuera de alcance salen del denominador. Los no_aplica
  // se quedan dentro a propósito: si el agente empieza a marcar no_aplica para
  // esquivar criterios, tiene que verse como cobertura baja. Sacarlos también
  // haría invisible justo lo que queremos vigilar.
  const fueraDeAlcance = [];
  const evaluables = aplicables.filter(c => {
    if (!fueraMap[c[AUD_IDX.ID]]) return true;
    fueraDeAlcance.push(c[AUD_IDX.ID]);
    return false;
  });

  evaluables.forEach(c => {
    const id = c[AUD_IDX.ID], critico = c[AUD_IDX.CRITICO], peso = c[AUD_IDX.DESCUENTO];
    const v = dado[id];
    const veredicto = v ? v.veredicto : "no_concluyente";

    // Criterio declarado "sin integración": no lo puede ver nadie desde acá.
    // Se queda en el denominador (la cobertura tiene que reflejar que NO se
    // evaluó) pero no baja la nota ni el techo, y va a revisión humana.
    // Lo que diga el evaluador de estos ítems no se toma en cuenta: si algo
    // no se puede verificar, un "cumple" tampoco es verificable.
    // La excepción es el veredicto de una PERSONA: el checklist manual existe
    // justamente para que alguien lo mire, así que cuando lo miró, su veredicto
    // vale como cualquier otro y el criterio sale de la lista de pendientes.
    if (sinIntMap[id] && !(v && audEtiqueta_(v.fuente) === "revision_humana")) {
      sinIntegracion.push(id);
      if (v && v.veredicto !== "no_concluyente")
        avisos.push(id + " se revisa a mano y llegó del agente como '" + v.veredicto + "': se ignora");
      return;
    }

    if (veredicto === "no_aplica") return;

    if (veredicto === "no_cumple") {
      // Un incumplimiento cuya fuente es "sin_datos" es una contradiccion:
      // se esta afirmando una falta sin el dato que la probaria. Llego un caso
      // asi, con la cita diciendo literalmente "veredicto rebajado a
      // no_concluyente" mientras la columna decia no_cumple. El sistema lee la
      // columna, asi que el descargo del propio evaluador se perdia.
      //
      // Se resuelve aca y no solo en el prompt porque una contradiccion
      // detectable no deberia depender de que el modelo se acuerde de la regla.
      if (audEtiqueta_(v.fuente) === "sin_datos") {
        sinDatos.push(id);
        noConcluyentes.push(id);
        if (critico) criticosSinEvaluar.push(id); else techoPerdido += Math.abs(peso);
        return;
      }

      // Sin cita textual no se penaliza: pasa a no concluyente (regla del piloto)
      if (!v.cita) {
        sinCita.push(id);
        noConcluyentes.push(id);
        if (critico) criticosSinEvaluar.push(id); else techoPerdido += Math.abs(peso);
        return;
      }
      const conf = String(v.confianza || "").toLowerCase();

      // Un critico solo deja la nota en 0 si el veredicto viene con confianza
      // alta. Con confianza media o baja queda "por confirmar": se reporta la
      // nota en riesgo y el ticket va a revision humana, pero no se sanciona.
      if (critico) {
        evaluados++;
        if (conf && conf !== "alta") criticosPorConfirmar.push(id);
        else criticosIncumplidos.push(id);
        return;
      }

      // Un NO critico con confianza BAJA tampoco penaliza. Hasta ahora la
      // confianza solo modulaba los criticos, y por eso un hallazgo en el que
      // el propio evaluador escribia "sin acceso para confirmarlo" restaba
      // puntos igual. Descontar sobre algo que quien evalua declara que no
      // pudo verificar no se puede defender delante de la persona auditada.
      //
      // No desaparece: pasa a no_concluyente, con lo que baja el techo y baja
      // la cobertura. Es la misma mecanica que un no_cumple sin cita. Así que
      // el hueco se ve, en vez de convertirse en un descuento silencioso.
      if (conf === "baja") {
        confianzaBaja.push(id);
        noConcluyentes.push(id);
        techoPerdido += Math.abs(peso);
        return;
      }

      evaluados++;
      noCriticosIncumplidos.push(id);
      descuento += Math.abs(peso);
      return;
    }

    if (veredicto === "cumple") { evaluados++; return; }

    // no_concluyente
    noConcluyentes.push(id);
    if (critico) criticosSinEvaluar.push(id); else techoPerdido += Math.abs(peso);
  });

  const nota  = criticosIncumplidos.length ? 0 : Math.max(0, 100 - descuento);
  const techo = Math.max(0, 100 - techoPerdido);
  // Si se confirman los criticos dudosos, la nota se va a 0
  const notaEnRiesgo = criticosPorConfirmar.length ? 0 : nota;

  // Ningún -100 se da por cerrado sin que lo confirme una persona.
  let estado = "Auditado";
  if (criticosIncumplidos.length)        estado = "Requiere revisión (crítico)";
  else if (criticosPorConfirmar.length)  estado = "Requiere revisión (crítico por confirmar)";
  else if (criticosSinEvaluar.length)    estado = "Requiere revisión (crítico sin evaluar)";
  else if (sinIntegracion.length)        estado = "Requiere checklist manual";
  else if (noConcluyentes.length)        estado = "Auditado con reservas";

  if (criticosPorConfirmar.length)
    avisos.push("critico incumplido con confianza no alta en " + criticosPorConfirmar.join(",") +
                ": no baja la nota hasta que lo confirme una persona (nota en riesgo: 0)");

  if (sinCita.length)
    avisos.push("no_cumple sin cita textual en " + sinCita.join(",") + ": no penaliza, pasa a no concluyente");

  if (confianzaBaja.length)
    avisos.push("no_cumple con confianza baja en " + confianzaBaja.join(",") +
                ": no penaliza, pasa a no concluyente (baja el techo y la cobertura)");

  if (sinDatos.length)
    avisos.push("no_cumple con fuente 'sin_datos' en " + sinDatos.join(",") +
                ": contradiccion (no hay dato que pruebe la falta), pasa a no concluyente");

  if (sinIntegracion.length)
    avisos.push("pendiente de checklist manual: " + sinIntegracion.join(",") +
                " (" + sinIntegracion.map(id => sinIntMap[id]).join("; ") + ")");

  return {
    audiencia: aud,
    nota: nota, techo: techo, estado: estado, notaEnRiesgo: notaEnRiesgo,
    sinIntegracion: sinIntegracion,
    criticosIncumplidos: criticosIncumplidos,
    criticosPorConfirmar: criticosPorConfirmar,
    confianzaBaja: confianzaBaja,
    sinDatos: sinDatos,
    noCriticosIncumplidos: noCriticosIncumplidos,
    noConcluyentes: noConcluyentes,
    criticosSinEvaluar: criticosSinEvaluar,
    aplicables: evaluables.length,
    aplicablesDelCanal: aplicables.length,
    fueraDeAlcance: fueraDeAlcance,
    evaluados: evaluados,
    cobertura: evaluables.length ? Math.round(evaluados / evaluables.length * 100) : 100,
    descuento: descuento,
    avisos: avisos,
    autores: [...new Set(veredictos.map(v => v.autor).filter(Boolean))],
  };
}

/** Escribe (o reemplaza) los veredictos de un ticket en la hoja Veredictos. */
function audEscribirVeredictos_(ticket, canal, veredictos, resumen) {
  const ss = histGetSpreadsheet_(true);
  let sh = ss.getSheetByName(AUD.HOJA_VEREDICTOS);

  // "Version reglas" va al final y es nueva. Sin ella no había forma de saber
  // con qué versión de las reglas se emitió un veredicto guardado, y eso es
  // justo lo que hace falta para poder decir "estas auditorías son de antes de
  // los arreglos, conviene rehacerlas". Las filas viejas la tendrán vacía, que
  // es la respuesta honesta: no se sabe.
  const headers = ["Ticket Number", "Canal", "criterio_id", "Criterio", "Afectacion", "Descuento",
                   "Veredicto", "Autor evaluado", "Cita", "Fuente", "Confianza",
                   "Fecha ingesta", "Version matriz", "Version reglas"];
  if (!sh) {
    sh = ss.insertSheet(AUD.HOJA_VEREDICTOS);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  }

  // Borra los veredictos previos de este ticket (una reauditoría reemplaza, no duplica)
  if (sh.getLastRow() > 1) {
    const col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = col.length - 1; i >= 0; i--) {
      if (zdClaveTicket_(col[i][0]) === zdClaveTicket_(ticket)) sh.deleteRow(i + 2);
    }
  }

  const porId = {};
  audCriteriosDeCanal_(canal, (resumen && resumen.audiencia) || AUD_AUDIENCIA_DEFECTO)
    .forEach(c => { porId[c[AUD_IDX.ID]] = c; });
  const fecha = Utilities.formatDate(new Date(), AUD.TZ, "yyyy-MM-dd HH:mm");

  const filas = veredictos.map(v => {
    const c = porId[v.id];
    return [ticket, canal, v.id,
            c ? c[AUD_IDX.TEXTO] : "(no aplica a este canal)",
            c ? (c[AUD_IDX.CRITICO] ? "CRITICO" : "no critico") : "",
            c ? c[AUD_IDX.DESCUENTO] : "",
            v.veredicto, v.autor, v.cita, v.fuente, v.confianza,
            fecha, AUD.VERSION_MATRIZ, AUD_VERSION_REGLAS];
  });

  if (filas.length) {
    sh.getRange(sh.getLastRow() + 1, 1, filas.length, headers.length).setValues(filas);
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).setNumberFormat("@");
  }
  return filas.length;
}

/** Vuelca el resultado en las columnas de auditoría del histórico. */
function audEscribirEnHistorico_(ticket, r) {
  const nombreHoja = (typeof HIST !== "undefined" && HIST.SHEET_NAME) ? HIST.SHEET_NAME : "Historico";
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(nombreHoja);
  if (!sh || sh.getLastRow() < 2) { Logger.log("No hay hoja %s: no escribo el resultado.", nombreHoja); return false; }

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const col = n => headers.indexOf(n) + 1;
  const cTicket = col("Ticket Number");
  if (!cTicket) return false;

  const ids = sh.getRange(2, cTicket, sh.getLastRow() - 1, 1).getValues();
  let fila = -1;
  for (let i = 0; i < ids.length; i++) {
    if (zdClaveTicket_(ids[i][0]) === zdClaveTicket_(ticket)) { fila = i + 2; break; }
  }
  if (fila < 0) { Logger.log("El ticket %s no está en el histórico: no escribo el resultado.", ticket); return false; }

  const partes = [];
  if (r.criticosIncumplidos.length)   partes.push("Críticos incumplidos: " + r.criticosIncumplidos.join(", "));
  if (r.criticosPorConfirmar.length)  partes.push("Críticos POR CONFIRMAR: " + r.criticosPorConfirmar.join(", "));
  if (r.noCriticosIncumplidos.length) partes.push("Incumplimientos: " + r.noCriticosIncumplidos.join(", "));
  const motivo = partes.length ? partes.join(" | ") : "Sin incumplimientos";

  const notas = (r.criticosPorConfirmar.length ? "NOTA EN RIESGO " + r.notaEnRiesgo + " | " : "") +
                "techo " + r.techo + " | cobertura " + r.cobertura + "% (" + r.evaluados + "/" + r.aplicables + ")" +
                (r.noConcluyentes.length ? " | no concluyentes: " + r.noConcluyentes.join(",") : "") +
                (r.criticosSinEvaluar.length ? " | CRITICOS SIN EVALUAR: " + r.criticosSinEvaluar.join(",") : "") +
                (r.autores.length ? " | evaluado: " + r.autores.join(", ") : "");

  const escribir = (nombre, valor) => { const c = col(nombre); if (c) sh.getRange(fila, c).setValue(valor); };
  escribir("Estado auditoría", r.estado);
  escribir("Resultado",        r.nota);
  escribir("Motivo",           motivo);
  escribir("Auditor",          AUD.AUDITOR);
  escribir("Fecha auditoría",  Utilities.formatDate(new Date(), AUD.TZ, "yyyy-MM-dd"));
  escribir("Notas",            notas);
  return true;
}

// ============================================================
//  LOTES — auditar varios tickets en una sola pegada
// ============================================================
/**
 * Cuántos tickets caben en una conversación con el agente.
 *
 * El límite real no es el contexto: es la contaminación entre tickets.
 * Con muchas interacciones seguidas el evaluador arrastra el criterio del
 * ticket anterior — si en el primero encontró un C27 caído, lo empieza a
 * buscar en los siguientes — y las citas se mezclan. Cinco es un lote que
 * todavía se puede revisar a mano si algo sale raro.
 *
 * Un lote es SIEMPRE de un solo canal: los criterios son distintos.
 */
const AUD_LOTE = {
  MAX_TICKETS: 5,
  MAX_CHARS:   38000,   // margen bajo el tope de 50.000 de una celda
  HOJA:        "Lotes",
};

/**
 * Arma los lotes con los tickets auditables que todavía no tienen veredicto
 * y los deja en la hoja "Lotes", uno por fila, listos para copiar y pegar.
 *
 *   audArmarLotes()                          -> los pendientes, de a 5
 *   audArmarLotes({maxTickets: 3})           -> lotes más chicos
 *   audArmarLotes({incluirAuditados: true})  -> también los ya auditados
 */
function audArmarLotes(opciones) {
  const op = opciones || {};
  const maxTickets = op.maxTickets || AUD_LOTE.MAX_TICKETS;

  const tickets = audTicketsDeConversaciones_();
  if (!tickets.length) throw new Error('No hay filas en "' + ZD.HOJA_CONVER + '". Ejecuta zdIngestar() primero.');

  const yaAuditados = op.incluirAuditados ? {} : audTicketsConVeredicto_();
  const candidatos = tickets.filter(t =>
    audConversacionAuditable_(t.auditable) && !yaAuditados[zdClaveTicket_(t.ticket)]);

  if (!candidatos.length) throw new Error("No quedan tickets auditables sin veredicto. Usa {incluirAuditados:true} para rearmarlos.");

  // Un lote nunca mezcla canales NI audiencias: el preámbulo lleva la matriz
  // adentro, y dos matrices distintas en el mismo prompt es pedirle al
  // evaluador que adivine cuál aplica a cada ticket.
  const porGrupo = {};
  candidatos.forEach(t => {
    const clave = (t.audiencia || AUD_AUDIENCIA_DEFECTO) + "|" + t.canal;
    (porGrupo[clave] = porGrupo[clave] || []).push(t);
  });

  const lotes = [];
  Object.keys(porGrupo).forEach(clave => {
    const audiencia = clave.split("|")[0];
    const canal     = clave.split("|")[1];
    let actual = [];
    let chars = audPreambuloLote_(canal, 0, audiencia).length;

    porGrupo[clave].forEach(t => {
      const bloque = audBloqueDeLote_(t);
      const cabe = actual.length < maxTickets && (chars + bloque.length) < AUD_LOTE.MAX_CHARS;
      if (!cabe && actual.length) {
        lotes.push({ canal: canal, audiencia: audiencia, tickets: actual });
        actual = []; chars = audPreambuloLote_(canal, 0, audiencia).length;
      }
      actual.push({ t: t, bloque: bloque });
      chars += bloque.length;
    });
    if (actual.length) lotes.push({ canal: canal, audiencia: audiencia, tickets: actual });
  });

  audEscribirLotes_(lotes);
  lotes.forEach((l, i) => Logger.log("Lote %s [%s/%s] %s tickets: %s",
    i + 1, l.audiencia, l.canal, l.tickets.length, l.tickets.map(x => x.t.ticket).join(", ")));
  Logger.log('Listo: %s lotes en la hoja "%s". Copia la celda PROMPT de cada fila.', lotes.length, AUD_LOTE.HOJA);
  return lotes.map(l => ({ canal: l.canal, audiencia: l.audiencia, tickets: l.tickets.map(x => x.t.ticket) }));
}

/** Lee la hoja Conversaciones y devuelve lo necesario para armar lotes. */
/**
 * El prompt tal como está guardado en la hoja Conversaciones.
 *
 * Es la ÚNICA versión completa: la generó zdEnriquecerConHistorico_ con los
 * turnos, las señales del hilo, las output tags y la fecha del viaje a mano.
 * Reconstruirlo desde una fila de la hoja no funciona, porque la fila no
 * guarda los turnos — y sin turnos las señales salen vacías y el prompt dice
 * "cierre_del_hilo=desconocido" aunque el hilo lo haya cerrado el agente.
 *
 * Esto devuelve el prompt TAL COMO ESTÁ GUARDADO, aunque sea de una versión
 * anterior de las reglas. Para auditar no se usa: para eso está
 * zdPromptVigenteDe_, que lo regenera solo si hace falta. Este se queda para
 * inspeccionar y para audRevisarPrompts().
 */
function audPromptGuardado_(ticket) {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2) return "";

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cP = h.indexOf("PROMPT AUDITORIA (copiar y pegar)");
  if (cP < 0) return "";

  const n = zdFilaDeTicket_(sh, zdClaveTicket_(ticket));
  if (n < 0) return "";
  return String(sh.getRange(n, cP + 1).getValue() || "");
}

/** ¿Este prompt se generó con las reglas actuales? */
function audPromptAlDia_(prompt) {
  return String(prompt || "").indexOf("[" + AUD_VERSION_REGLAS + "]") >= 0;
}

/**
 * Responde de una sola vez la pregunta que más ciclos hace perder:
 * ¿el agente está leyendo las reglas que acabo de escribir, o unas viejas?
 *
 * Ya no hace falta correr nada después: los prompts caducos se regeneran solos
 * cuando se audita ese ticket (ver zdPromptVigenteDe_). Esto sirve para ver de
 * un golpe cuántos hay pendientes, y zdRefrescarPrompts() para adelantarlos
 * todos de una vez si prefieres dejarlo hecho antes de una tanda grande.
 */
function audRevisarPrompts() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2) { Logger.log("No hay nada en %s todavía.", ZD.HOJA_CONVER); return null; }

  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x || "").trim());
  const cT = h.indexOf("Ticket Number") + 1, cP = h.indexOf("PROMPT AUDITORIA (copiar y pegar)") + 1;
  if (!cP) throw new Error("No encuentro la columna del prompt en " + ZD.HOJA_CONVER + ".");

  const total = sh.getLastRow() - 1;
  let alDia = 0, viejos = 0, vacios = 0;
  const ejemplos = [];

  // Por tramos: cada prompt puede pesar decenas de miles de caracteres y leer
  // la columna entera de una vez se atraganta.
  for (let inicio = 2; inicio <= sh.getLastRow(); inicio += 50) {
    const n = Math.min(50, sh.getLastRow() - inicio + 1);
    const tks = sh.getRange(inicio, cT, n, 1).getValues();
    const ps  = sh.getRange(inicio, cP, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      const p = String(ps[i][0] || "");
      if (!p.trim()) { vacios++; continue; }
      if (audPromptAlDia_(p)) { alDia++; continue; }
      viejos++;
      if (ejemplos.length < 5) ejemplos.push(zdClaveTicket_(tks[i][0]));
    }
  }

  Logger.log("Sello esperado: [%s]", AUD_VERSION_REGLAS);
  Logger.log("Prompts al día: %s de %s   |   desactualizados: %s   |   sin prompt: %s",
             alDia, total, viejos, vacios);
  if (viejos) {
    Logger.log("Ejemplos desactualizados: %s", ejemplos.join(", "));
    Logger.log("→ Corre zdRefrescarPrompts() ANTES de volver a auditar.");
  } else if (alDia) {
    Logger.log("→ Todo al día. Si el agente sigue citando una regla vieja, el problema ya no es el prompt.");
  }
  return { version: AUD_VERSION_REGLAS, total: total, alDia: alDia, viejos: viejos, vacios: vacios, ejemplos: ejemplos };
}

function audTicketsDeConversaciones_() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(ZD.HOJA_CONVER);
  if (!sh || sh.getLastRow() < 2) return [];

  const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const c = n => H.indexOf(n);

  // Solo las columnas ligeras. La conversación y los prompts no se traen acá:
  // pesan hasta 45.000 caracteres por fila y el prompt se pide por ticket con
  // audPromptGuardado_ cuando de verdad se necesita.
  const corte = (typeof conCorteLigero_ === "function") ? conCorteLigero_(H) : H.length + 1;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, corte - 1).getValues();

  return vals.map(r => ({
    ticket:     zdClaveTicket_(r[c("Ticket Number")]),
    canal:      String(r[c("Canal")] || "").trim(),
    auditable:  String(r[c("Auditable")] || "").trim(),
    journeyId:  c("Journey Id")   >= 0 ? String(r[c("Journey Id")]   || "") : "",
    riderId:    c("Rider Id")     >= 0 ? String(r[c("Rider Id")]     || "") : "",
    fechaSolved:c("Fecha solved") >= 0 ? String(r[c("Fecha solved")] || "") : "",
    fuenteFecha:c("Fuente fecha") >= 0 ? String(r[c("Fuente fecha")] || "") : "",
  })).filter(t => t.ticket);
}

/** Tickets que ya tienen veredicto cargado. */
function audTicketsConVeredicto_() {
  const ss = histGetSpreadsheet_(true);
  const sh = ss.getSheetByName(AUD.HOJA_VEREDICTOS);
  const mapa = {};
  if (!sh || sh.getLastRow() < 2) return mapa;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .forEach(r => { const k = zdClaveTicket_(r[0]); if (k) mapa[k] = true; });
  return mapa;
}

/** Encabezado común del lote: instrucciones, criterios y contrato de salida. */
function audPreambuloLote_(canal, n, audiencia) {
  const aud = audiencia || AUD_AUDIENCIA_DEFECTO;
  const L = [];
  L.push("[" + AUD_VERSION_REGLAS + "]");
  L.push("Eres auditor de calidad de atencion al cliente de Cabify. Vas a auditar " +
         (n ? n + " interacciones" : "varias interacciones") + " de canal " + canal.toUpperCase() +
         ", audiencia " + audEtiquetaAudiencia_(aud) + ", contra los criterios listados.");
  L.push("");
  L.push("IMPORTANTE: cada interaccion se audita POR SEPARADO y desde cero.");
  L.push("Lo que encuentres en una NO es indicio de nada en las otras. No compares");
  L.push("interacciones entre si, no reutilices veredictos y no arrastres criterios.");
  L.push("Cada cita tiene que salir de la interaccion que estas evaluando en ese momento.");
  L.push("");
  L.push("PASO 1. Para cada ticket, consulta en el sistema los datos del viaje con las");
  L.push("claves que vienen en su bloque (journey_id, rider_id, fecha de solved).");
  L.push("Necesito: tipo de precio, precio cobrado al rider, descuentos, ajustes o");
  L.push("reembolsos posteriores, estado del viaje, horas de asignacion, llegada al");
  L.push("pickup e inicio, espera en el pickup, cancelacion y penalizacion.");
  L.push("Si un dato no existe, dilo explicitamente. No lo estimes ni lo infieras.");
  L.push("");
  L.push("PASO 2. Audita cada conversacion cruzandola con los datos de SU viaje.");
  L.push("");
  audBloqueAeropuerto_(L, aud);
  audBloqueAlcance_(L, aud);
  L.push("=== CRITERIOS APLICABLES (" + audResumenCanal_(canal, aud) + ") ===");
  L.push("id;criterio;afectacion;descuento");
  L.push(audCriteriosTexto_(canal, aud));
  L.push("");
  L.push("=== REGLA DE LAS DOS CIFRAS ===");
  L.push("Para afirmar que un importe, una fecha o un dato que dio el agente NO cuadra");
  L.push("con el sistema, tienes que escribir en la cita LAS DOS cifras, una al lado de");
  L.push("la otra, y su diferencia:");
  L.push('   "el agente dijo X; el sistema dice Y; difieren en Z"');
  L.push("Si al escribirlas resulta que coinciden, el veredicto es CUMPLE.");
  L.push("Si no puedes poner la cifra del sistema porque no la tienes, es no_concluyente,");
  L.push("nunca no_cumple. Una acusacion sin las dos cifras es un falso positivo.");
  L.push("");
  L.push("LAS RETARIFICACIONES SE ENCADENAN. Esto es lo que mas falsos positivos");
  L.push("produce, asi que leelo dos veces.");
  L.push("");
  L.push("Un viaje puede tener VARIAS retarificaciones, una tras otra. El precio");
  L.push("original de cada una es el resultado de la anterior. Ejemplo real:");
  L.push("");
  L.push("   accion 1 (editar trayecto)          32.047 -> 29.706");
  L.push("   accion 2 (aplicar precio estimado)  29.706 -> 28.238");
  L.push("");
  L.push("Aca hay TRES cifras y solo dos sirven:");
  L.push("   cobro original  = 32.047  (el original de la PRIMERA)");
  L.push("   precio final    = 28.238  (el resultado de la ULTIMA)");
  L.push("   29.706          = INTERMEDIO. No es un precio final de nada.");
  L.push("");
  L.push("Reglas obligatorias antes de comparar cualquier importe:");
  L.push("1. Ordena las retarificaciones por fecha y hora, de la mas antigua a la");
  L.push("   mas nueva. Toma el resultado de la ULTIMA como precio final.");
  L.push("2. Una cifra que aparece como 'precio original' de una retarificacion");
  L.push("   posterior es, por definicion, un valor INTERMEDIO. Nunca la uses como");
  L.push("   precio final.");
  L.push("3. COMPRUEBA CONTRA EL PRECIO FINAL DEL VIAJE. El sistema declara un");
  L.push("   priceTotal / precio final. Si la cifra que calculaste como final no");
  L.push("   coincide con esa, leiste mal la cadena: vuelve a leerla. NO reportes");
  L.push("   una discrepancia con el agente basandote en tu propia lectura mala.");
  L.push("4. Si solo puedes ver una de las retarificaciones y hay señales de que hubo");
  L.push("   mas, es no_concluyente, no no_cumple.");
  L.push("");
  L.push("OJO con los reembolsos, que es donde mas se falla. Un reembolso normal tiene");
  L.push("DOS importes distintos y los dos son legitimos:");
  L.push("   1. el cobro original, que se devuelve al cliente");
  L.push("   2. el precio final correcto, que se cobra en su lugar");
  L.push('Cuando el agente dice "reembolse 31.671 y cobre 25.506 por el valor correcto",');
  L.push("no esta anunciando un cobro EXTRA de 25.506: esta diciendo que el precio que");
  L.push("queda es 25.506. Si el precio final del sistema es 25.506, CUMPLE.");
  L.push("Antes de marcar no_cumple por un importe, comprueba si la cifra que crees");
  L.push("sobrante es en realidad el precio final tras retarificacion.");
  L.push("");
  L.push("=== REGLA DE LAS DOS FECHAS ===");
  L.push("La misma disciplina, aplicada al tiempo. Para afirmar que algo ocurrio");
  L.push("ANTES o DESPUES de otra cosa tienes que escribir en la cita LAS DOS marcas");
  L.push("de tiempo completas, una al lado de la otra, y decir cual es mayor:");
  L.push('   "la retarificacion es 18/05/2026 18:18:44; el ticket se creo el');
  L.push('    18/05/2026 16:44; la retarificacion es POSTERIOR en 1h 34m"');
  L.push("Sin las dos fechas escritas no hay veredicto temporal: es no_concluyente.");
  L.push("El formato es dd/mm/aaaa y la hora va en 24h. 18/05 es 18 de mayo, no 5 de");
  L.push("noviembre; 18:18 es la tarde, no la madrugada. Compara primero el dia, y solo");
  L.push("si coincide, la hora.");
  L.push("");
  L.push("Y aunque las fechas te den, EL ORDEN NO ES UN CRITERIO. Que una retarificacion");
  L.push("sea anterior o posterior a la apertura del ticket no prueba nada por si sola:");
  L.push("un agente puede informar de un ajuste que ya estaba hecho, y eso es correcto.");
  L.push("Lo que se audita es si la CIFRA que dijo el agente coincide con la del sistema,");
  L.push("no cuando se ejecuto. Nunca uses la cronologia como razon de un no_cumple de");
  L.push("importes, ni digas que 'no hay retarificacion posterior al ticket' como si eso");
  L.push("desmintiera al agente.");
  L.push("");
  L.push("=== REGLAS DE VEREDICTO, NO NEGOCIABLES ===");
  L.push("1. Veredictos permitidos: cumple | no_cumple | no_aplica | no_concluyente.");
  L.push("2. Todo 'no_cumple' exige una CITA TEXTUAL LITERAL de esa conversacion o un");
  L.push("   dato concreto de ese viaje. Sin cita verificable es 'no_concluyente'.");
  L.push("3. No inventes citas. Si no puedes copiar el texto exacto, es no_concluyente.");
  L.push("4. Ante duda razonable el veredicto es 'cumple'. Un criterio critico deja la");
  L.push("   nota en 0: el costo de un falso positivo es una persona mal evaluada.");
  L.push("5. Si el procedimiento no prohibe la conducta, no es incumplimiento: va a hallazgos.");
  L.push("6. Se juzga a quien intervino, no al agente asignado. Si respondio un bot (ABI,");
  L.push("   Help Support) eso tambien es atencion: evaluala e indicalo en autor_evaluado.");
  L.push("7. El extractor NO entrega la visibilidad de cada mensaje. No emitas veredictos");
  L.push("   que dependan de distinguir nota interna de mensaje publico: no_concluyente.");
  L.push("8. NO calcules notas, puntajes ni promedios. Tu salida son veredictos.");
  L.push("");
  L.push("=== SALIDA ===");
  L.push("UN SOLO bloque csv con separador ';' para TODOS los tickets, con esta cabecera:");
  L.push("");
  L.push("ticket_id;criterio_id;veredicto;autor_evaluado;cita;fuente;confianza");
  L.push("");
  L.push("- una fila por cada criterio de CADA ticket, sin omitir ninguno");
  L.push("- ticket_id: el numero del ticket al que pertenece esa fila");
  L.push("- cita: texto literal, o vacio si el veredicto es 'cumple'");
  L.push("- fuente: conversacion | viaje | procedimiento | sin_datos");
  L.push("- confianza: alta | media | baja");
  L.push("- si la cita contiene ';' reemplazalo por ','");
  L.push("");
  L.push("Despues un unico bloque json con un objeto por ticket:");
  L.push('[{ "ticket": "", "datos_del_viaje": {}, "hallazgos": [], "datos_que_faltaron": [] }]');
  L.push("");
  L.push("Nada de texto fuera de esos dos bloques.");
  return L.join("\n");
}

/** Bloque de una interacción dentro del lote. */
function audBloqueDeLote_(t) {
  const L = [];
  L.push("");
  L.push("################################################################");
  L.push("### INTERACCION A AUDITAR — TICKET " + t.ticket);
  L.push("################################################################");
  L.push("CLAVES DEL VIAJE PARA ESTE TICKET:");
  L.push("   journey_id: " + (t.journeyId || "(sin viaje asociado)"));
  L.push("   rider_id: "   + (t.riderId   || "(no disponible)"));
  L.push("   fecha de solved (UTC): " + (t.fechaSolved || "(no disponible)") +
         (t.fuenteFecha ? "  [fuente: " + t.fuenteFecha + "]" : ""));
  L.push("");
  L.push(audCuerpoInteraccion_(t));
  return L.join("\n");
}

function audEscribirLotes_(lotes) {
  const ss = histGetSpreadsheet_(true);
  let sh = ss.getSheetByName(AUD_LOTE.HOJA);
  if (!sh) sh = ss.insertSheet(AUD_LOTE.HOJA);
  sh.clear();

  const headers = ["Lote", "Audiencia", "Canal", "Tickets", "Cuantos", "Caracteres", "PROMPT (copiar y pegar)"];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  sh.setFrozenRows(1);

  const filas = lotes.map((l, i) => {
    const prompt = audPreambuloLote_(l.canal, l.tickets.length, l.audiencia) +
                   l.tickets.map(x => x.bloque).join("\n");
    return [i + 1, l.audiencia || AUD_AUDIENCIA_DEFECTO, l.canal,
            l.tickets.map(x => x.t.ticket).join(", "),
            l.tickets.length, prompt.length, zdRecortar_(prompt)];
  });
  if (filas.length) sh.getRange(2, 1, filas.length, headers.length).setValues(filas);
  return filas.length;
}

/** Parsea una respuesta que llega como texto plano (API). */
function audParsearTexto_(texto, ticketDeclarado) {
  const lineas = String(texto || "").split(/\r?\n/)
    .map(l => l.replace(/^\s*```+\s*\w*\s*$/, ""))
    .filter(l => l.trim());
  return audParsearRespuesta_(lineas, ticketDeclarado, "la respuesta del agente");
}

// ============================================================
//  HOJA VIAJES — los datos del sistema, guardados
// ============================================================
/**
 * El JSON que devuelve el agente es la única evidencia de lo que decía el
 * sistema al momento de auditar: precios, descuentos, ajustes, tiempos de
 * pickup. Sin esto, mañana no se puede reconstruir por qué un C25 o un C29
 * quedaron como quedaron. Se guarda una fila por ticket.
 */
const AUD_VIAJE_COLUMNAS = [
  ["Ticket Number",        o => o.ticket || ""],
  ["Journey Id",           o => audRuta_(o, "datos_del_viaje.journey_id")],
  ["Estado journey",       o => audRuta_(o, "datos_del_viaje.estado_journey")],
  ["Tipo de precio",       o => audRuta_(o, "datos_del_viaje.tipo_precio") ||
                                audRuta_(o, "datos_del_viaje.tipo_precio_inicial")],
  ["Precio cobrado",       o => audRuta_(o, "datos_del_viaje.precio_cobrado_rider") ||
                                audRuta_(o, "datos_del_viaje.precio_cobrado_rider_final")],
  ["Precio estimado",      o => audRuta_(o, "datos_del_viaje.precio_estimado")],
  ["Moneda",               o => audRuta_(o, "datos_del_viaje.moneda")],
  ["Descuentos",           o => audLista_(audRuta_(o, "datos_del_viaje.descuentos"))],
  ["Ajustes posteriores",  o => audLista_(audRuta_(o, "datos_del_viaje.ajustes_posteriores"))],
  ["Espera pickup (min)",  o => audRuta_(o, "datos_del_viaje.pickup.espera_en_pickup_min")],
  ["Distancia (km)",       o => audRuta_(o, "datos_del_viaje.trayecto.distancia_km")],
  ["Duracion (min)",       o => audRuta_(o, "datos_del_viaje.trayecto.duracion_min")],
  ["Hubo cancelacion",     o => audBool_(audRuta_(o, "datos_del_viaje.cancelacion.hubo"))],
  ["Hubo no show",         o => audBool_(audRuta_(o, "datos_del_viaje.no_show.hubo"))],
  ["Incidencias",          o => audLista_(audRuta_(o, "datos_del_viaje.incidencias"))],
  ["Hallazgos",            o => audLista_(o.hallazgos)],
  ["Datos que faltaron",   o => audLista_(o.datos_que_faltaron ||
                                audRuta_(o, "datos_del_viaje.campos_no_disponibles"))],
  ["Fecha ingesta",        o => Utilities.formatDate(new Date(), AUD.TZ, "yyyy-MM-dd HH:mm")],
  ["JSON completo",        o => zdRecortar_(JSON.stringify(o))],

  // Aeropuerto. Vacías en las demás audiencias.
  //
  // Van AL FINAL, no junto a las otras horas, por una razón práctica: las
  // columnas nuevas insertadas en medio descuadran las filas que ya estaban
  // escritas. Añadirlas al final deja intacto lo anterior y las nuevas se
  // rellenan a medida que se reaudita.
  //
  // Y van en columnas propias, separadas de las horas de pickup, porque
  // mezclarlas en un solo "horas del viaje" es exactamente lo que llevó a
  // comparar magnitudes distintas y emitir un crítico falso.
  ["Aerop: llegada programada",     o => audRuta_(o, "datos_del_viaje.aeropuerto.hora_programada_llegada")],
  ["Aerop: fin real",              o => audRuta_(o, "datos_del_viaje.aeropuerto.hora_fin_real")],
  ["Aerop: dif fin vs prog (min)", o => audRuta_(o, "datos_del_viaje.aeropuerto.diferencia_fin_vs_programada_min")],
  ["Aerop: llego a tiempo",        o => audBool_(audRuta_(o, "datos_del_viaje.aeropuerto.llego_a_tiempo"))],
];

/** Lee una ruta tipo "a.b.c" sin reventar si falta un tramo. */
function audRuta_(obj, ruta) {
  const partes = ruta.split(".");
  let v = obj;
  for (let i = 0; i < partes.length; i++) {
    if (v === null || v === undefined || typeof v !== "object") return "";
    v = v[partes[i]];
  }
  return (v === null || v === undefined) ? "" : v;
}

function audBool_(v) { return v === true ? "SI" : v === false ? "NO" : ""; }

/** Aplana una lista de textos u objetos a una celda legible. */
function audLista_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) !== "[object Array]") return String(v);
  if (!v.length) return "";
  return v.map(x => (x && typeof x === "object") ? JSON.stringify(x) : String(x)).join("\n• ");
}

function audEscribirViaje_(ticket, datos) {
  const ss = histGetSpreadsheet_(true);
  let sh = ss.getSheetByName(AUD.HOJA_VIAJES);
  const headers = AUD_VIAJE_COLUMNAS.map(c => c[0]);

  if (!sh) {
    sh = ss.insertSheet(AUD.HOJA_VIAJES);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    // La hoja existía con menos columnas: se completa la cabecera. Como las
    // columnas nuevas siempre se agregan al final de AUD_VIAJE_COLUMNAS, las
    // filas ya escritas no se descuadran.
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight("bold").setBackground("#1f2937").setFontColor("#ffffff");
  }

  const obj = datos;
  if (!obj.ticket) obj.ticket = ticket;
  const fila = AUD_VIAJE_COLUMNAS.map(c => { try { return c[1](obj); } catch (e) { return ""; } });

  // Reauditar reemplaza la fila del ticket, no la duplica
  let destino = -1;
  if (sh.getLastRow() > 1) {
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (zdClaveTicket_(ids[i][0]) === zdClaveTicket_(ticket)) { destino = i + 2; break; }
    }
  }
  if (destino < 0) destino = sh.getLastRow() + 1;

  sh.getRange(destino, 1, 1, headers.length).setValues([fila]);
  sh.getRange(destino, 1).setNumberFormat("@");
  return true;
}
