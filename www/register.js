let db_real = null;
window.escolaridadActivaId = null;
let temporizadorBuscador = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await inicializarBaseDatos();
        await controlarFlujoInicial();
        await renderizarListadoCriterios();
    } catch (e) {
        console.error("Fallo secuencial de arranque:", e);
    }
});

async function mostrarNotificacion(mensaje) {
    try {
        const { Toast } = Capacitor.Plugins;
        if (Toast) {
            await Toast.show({ text: mensaje, duration: 'short', position: 'bottom' });
        } else {
            console.log("Toast local:", mensaje);
        }
    } catch (e) {
        console.log("Notificación falló, fallback:", mensaje);
    }
};

async function inicializarBaseDatos() {
    try {
        const SQLite = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.CapacitorSQLite : null;
        const dbName = "apoyo_docente_app";

        if (!SQLite) {
            db_real = {
                query: async function() { return { values: [] }; },
                execute: async function() { return { changes: { lastId: 1 } }; }
            };
            console.warn("Entorno Web: Simulación activa.");
            await crearTablasSiNoExisten();
            return;
        }

        let consistencia = { result: false };
        try { consistencia = await SQLite.checkConnectionsConsistency(); } catch (e) {}
        let estaConectado = { result: false };
        try { estaConectado = await SQLite.isConnection({ database: dbName }); } catch (e) {}
        
        if (!(consistencia.result && estaConectado.result)) {
            if (estaConectado.result) {
                try { await SQLite.closeConnection({ database: dbName }); } catch(e) {}
            }
            await SQLite.createConnection({ database: dbName, version: 1, encrypted: false, mode: "no-encryption", readOnly: false });
        }
        let verificacionFinal = await SQLite.isDBOpen({ database: dbName });
        if (!verificacionFinal.result) {
            await SQLite.open({ database: dbName });
        }
        db_real = {
            query: async function({ statement, values }) {
                return await SQLite.query({ database: dbName, statement: statement, values: values || [] });
            },
            execute: async function({ statement, values }) {
                if (values && values.length > 0) {
                    return await SQLite.run({ database: dbName, statement: statement, values: values });
                }
                return await SQLite.execute({ database: dbName, statements: statement });
            }
        };
        await crearTablasSiNoExisten();
        mostrarNotificacion(`Bienvenido al Sistema de Apoyo Docente`);
    } catch (error) {
        console.error(error);
        throw error;
    }
};

async function crearTablasSiNoExisten() {
    try {
        await db_real.execute({ statement: `PRAGMA foreign_keys = ON;` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS estudiantes (id_cedula INTEGER PRIMARY KEY, nombre TEXT NOT NULL, apellido TEXT NOT NULL, fecha_nacimiento TEXT, genero TEXT CHECK(genero IN ('M', 'F')) NOT NULL);` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS cursos (id INTEGER PRIMARY KEY AUTOINCREMENT, cursoseccion TEXT NOT NULL UNIQUE);` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS escolaridades (id INTEGER PRIMARY KEY AUTOINCREMENT, escolaridad TEXT NOT NULL, profesor TEXT NOT NULL, area TEXT NOT NULL, peic TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL);` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS nomina (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiantes_id INTEGER, cursoseccion_id INTEGER, escolaridades_id INTEGER, condicion_acadm TEXT CHECK(condicion_acadm IN ('Regular', 'Repitiente')) DEFAULT 'Regular' NOT NULL, UNIQUE (estudiantes_id, cursoseccion_id, escolaridades_id), FOREIGN KEY (estudiantes_id) REFERENCES estudiantes(id_cedula) ON DELETE CASCADE, FOREIGN KEY (cursoseccion_id) REFERENCES cursos(id) ON DELETE CASCADE, FOREIGN KEY (escolaridades_id) REFERENCES escolaridades(id) ON DELETE CASCADE);` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS sesiones (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT DEFAULT CURRENT_TIMESTAMP, nombre TEXT NOT NULL);` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, participantes_id INTEGER NOT NULL, sesion_id INTEGER NOT NULL, asistencia TEXT DEFAULT 'false' CHECK(asistencia IN ('false', 'true')), calificacion REAL DEFAULT 12 CHECK(calificacion >= 0 AND calificacion <= 20), tipo_evaluacion TEXT CHECK(tipo_evaluacion IN ('Sumativa', 'Formativa')), FOREIGN KEY (participantes_id) REFERENCES nomina(id) ON DELETE CASCADE, FOREIGN KEY (sesion_id) REFERENCES sesiones(id) ON DELETE CASCADE);` });
        await db_real.execute({ statement: `CREATE TABLE IF NOT EXISTS criterios_evaluacion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_criterio TEXT NOT NULL, descripcion TEXT, puntos_aporte REAL NOT NULL CHECK(puntos_aporte > 0 AND puntos_aporte <= 8));` });
        
        // Datos iniciales de prueba estructurados
        const checkCursos = await db_real.query({ statement: "SELECT COUNT(*) as total FROM cursos;" });
        if(!checkCursos.values || checkCursos.values[0].total === 0) {
            await db_real.execute({ statement: "INSERT INTO cursos (cursoseccion) VALUES ('1ER AÑO A'), ('2DO AÑO B');" });
        }
    } catch (error) {
        console.error("Fallo inicialización de tablas", error);
    }
};

document.getElementById('input-estudiantes').addEventListener('change', async function(evento) {
    const archivo = evento.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = async function(e) {
        try {
            const listaEstudiantes = JSON.parse(e.target.result);
            if (!Array.isArray(listaEstudiantes) || listaEstudiantes.length === 0) throw new Error("JSON Inválido.");
            await insertarEstudiantesLote(listaEstudiantes);
        } catch (error) {
            mostrarNotificacion("Error: Estructura JSON no válida");
        }
    };
    lector.readAsText(archivo);
});

async function insertarEstudiantesLote(estudiantes) {
    try {
        await db_real.execute({ statement: "BEGIN TRANSACTION;" });
        const sql = `INSERT OR IGNORE INTO estudiantes (id_cedula, nombre, apellido, fecha_nacimiento, genero) VALUES (?, ?, ?, ?, ?);`;
        for (const alumno of estudiantes) {
            await db_real.execute({ statement: sql, values: [parseInt(alumno.id_cedula), alumno.nombre.toUpperCase().trim(), alumno.apellido.toUpperCase().trim(), alumno.fecha_nacimiento, alumno.genero.toUpperCase().trim()] });
        }
        await db_real.execute({ statement: "COMMIT;" });
        mostrarNotificacion("Estudiantes importados.");
    } catch (error) {
        await db_real.execute({ statement: "ROLLBACK;" });
    }
};

async function verificarEscolaridadVigente() {
    try {
        const sql = `SELECT id FROM escolaridades WHERE date('now', 'localtime') BETWEEN date(fecha_inicio) AND date(fecha_cierre) LIMIT 1;`;
        const resultado = await db_real.query({ statement: sql });
        if (resultado.values && resultado.values.length > 0) {
            return resultado.values[0].id;
        }
        return null;
    } catch (error) { return null; }
}

async function controlarFlujoInicial() {
    const escolaridadId = await verificarEscolaridadVigente();
    if (escolaridadId) {
        window.escolaridadActivaId = escolaridadId;
        await cargarSelectoresCursos();
    } else {
        document.getElementById('modal-escolaridad').className = "modal-visible";
    }
};

async function guardarNuevaEscolaridad(evento) {
    evento.preventDefault();
    const boton = document.getElementById('btn-activar-escolaridad');
    if (boton) {
        boton.disabled = true;
        boton.textContent = "Procesando...";
    }
    const datos = [
        document.getElementById('esc-nombre').value.trim(), 
        document.getElementById('esc-profesor').value.toUpperCase().trim(), 
        document.getElementById('esc-area').value.trim(), 
        document.getElementById('esc-peic').value.trim(), 
        document.getElementById('esc-inicio').value, 
        document.getElementById('esc-cierre').value
    ];
    const sql = `INSERT INTO escolaridades (escolaridad, profesor, area, peic, fecha_inicio, fecha_cierre) VALUES (?, ?, ?, ?, ?, ?);`;
    try {
        const resultado = await db_real.execute({ statement: sql, values: datos });
        window.escolaridadActivaId = resultado.changes.lastId || 1;
        document.getElementById('modal-escolaridad').className = "modal-oculto";
        await cargarSelectoresCursos();
        mostrarNotificacion("Escolaridad creada con éxito.");
    } catch (e) {
        console.error(e);
        mostrarNotificacion("Error al registrar el año escolar.");
        if (boton) {
            boton.disabled = false;
            boton.textContent = "Activar Escolaridad";
        }
    }
};

async function cargarSelectoresCursos() {
    const selNomina = document.getElementById('select-curso');
    const selDiario = document.getElementById('diario-curso');
    const selEstad = document.getElementById('select-estadisticas-curso');
    const selEscolaridad = document.getElementById('select-escolaridad');
    
    try {
        const sql = `SELECT id, cursoseccion FROM cursos ORDER BY cursoseccion ASC;`;
        const resultado = await db_real.query({ statement: sql });
        const lista = resultado.values || [];
        
        let opciones = '<option value="">Seleccione Curso-Sección...</option>';
        lista.forEach(c => opciones += `<option value="${c.id}">${c.cursoseccion}</option>`);
        
        if(selNomina) selNomina.innerHTML = opciones;
        if(selDiario) selDiario.innerHTML = opciones;
        if(selEstad) selEstad.innerHTML = opciones;

        if(selEscolaridad && window.escolaridadActivaId) {
            selEscolaridad.innerHTML = `<option value="${window.escolaridadActivaId}">Escolaridad Vigente Activa</option>`;
        }
    } catch (error) { console.error(error); }
};

async function actualizarVistaEstudiantes() {
    cursoId = document.getElementById('select-curso').value;
    const escolaridadId = document.getElementById('select-escolaridad').value;
    const contenedor = document.getElementById('contenedor-lista-estudiantes');
    const boton = document.getElementById('btn-guardar-nomina');
    contenedor.innerHTML = "";
    boton.style.display = "none";
    if (cursoId && escolaridadId) {
        const sql = `SELECT id_cedula, nombre, apellido FROM estudiantes WHERE id_cedula NOT IN (SELECT estudiantes_id FROM nomina WHERE cursoseccion_id = ? AND escolaridades_id = ?) ORDER BY apellido ASC;`;
        const resultado = await db_real.query({ statement: sql, values: [parseInt(cursoId), parseInt(escolaridadId)] });
        const estudiantes = resultado.values || [];
        if (estudiantes.length === 0) {
            contenedor.innerHTML = "No hay estudiantes disponibles para inscribir.";
            return;
        }
        boton.style.display = "block";
        estudiantes.forEach(al => {
            contenedor.innerHTML += `<input type="checkbox" name="estudiantes_seleccionados" value="${al.id_cedula}"> `;
        });
    }
};

document.getElementById('select-curso').addEventListener('change', actualizarVistaEstudiantes);
document.getElementById('select-escolaridad').addEventListener('change', actualizarVistaEstudiantes);
// Colocar junto a los otros addEventListener existentes en tu código:
document.getElementById('form-escolaridad').addEventListener('submit', guardarNuevaEscolaridad);

async function procesarGuardadoNomina() {
    const cursoId = document.getElementById('select-curso').value;
    const escolaridadId = document.getElementById('select-escolaridad').value;
    const checkboxes = document.querySelectorAll('input[name="estudiantes_seleccionados"]:checked');
    if (checkboxes.length === 0) return mostrarNotificacion("Seleccione alumnos.");
    try {
        await db_real.execute({ statement: "BEGIN TRANSACTION;" });
        const sql = `INSERT INTO nomina (estudiantes_id, cursoseccion_id, escolaridades_id, condicion_acadm) VALUES (?, ?, ?, 'Regular');`;
        for (const cb of checkboxes) {
            await db_real.execute({ statement: sql, values: [parseInt(cb.value), parseInt(cursoId), parseInt(escolaridadId)] });
        }
        await db_real.execute({ statement: "COMMIT;" });
        mostrarNotificacion("Inscripción masiva procesada.");
        await actualizarVistaEstudiantes();
    } catch (error) {
    await db_real.execute({ statement: "ROLLBACK;" });
}
};

async function obtenerCriteriosNeuro() {
    try {
        const sql = `SELECT id, nombre_criterio, puntos_aporte FROM criterios_evaluacion;`;
        const res = await db_real.query({ statement: sql });
        return res.values || [];
    } catch (e) { return []; }
};

async function cargarEstudiantesInscritos() {
    const cursoId = document.getElementById('diario-curso').value;
    if (!cursoId || !window.escolaridadActivaId) return;
    try {
        const sql = `SELECT n.id AS nomina_id, e.id_cedula, e.apellido, e.nombre FROM nomina n INNER JOIN estudiantes e ON n.estudiantes_id = e.id_cedula WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ? ORDER BY e.apellido ASC;`;
        const res = await db_real.query({ statement: sql, values: [parseInt(cursoId), parseInt(window.escolaridadActivaId)] });
        await inyectarEstudiantesEnPantalla(res.values || []);
    } catch (error) { console.error(error); }
};

async function inyectarEstudiantesEnPantalla(estudiantes) {
    const contenedor = document.getElementById('tabla-asistencia-notas');
    const boton = document.getElementById('btn-guardar-diario');
    contenedor.innerHTML = "";
    if (estudiantes.length === 0) {
        contenedor.innerHTML = "🔍 No hay alumnos inscritos en esta sección.";
        boton.style.display = "none";
        return;
    }
    boton.style.display = "block";
    const criterios = await obtenerCriteriosNeuro();
    estudiantes.forEach(alumno => {
        const item = document.createElement('div');
        item.className = "tarjeta-alumno-neuro";
        item.setAttribute('data-nomina-id', alumno.nomina_id);
        let botonesHTML = criterios.map(crit => `<button type="button" class="btn-criterio" data-puntos="${crit.puntos_aporte}" onclick="alternarCriterio(this, ${alumno.nomina_id})"> ${crit.nombre_criterio} (+${crit.puntos_aporte.toFixed(1)}) </button>`).join('');
        item.innerHTML = `${alumno.apellido}, ${alumno.nombre} CI: ${alumno.id_cedula} 12.0 Hitos Neurocognitivos Adicionales ${botonesHTML || 'No hay hitos configurados.'}`;
        contenedor.appendChild(item);
    });
};

// Lógica de switches e incremento adaptativo en caliente
function evaluarBaseDopaminergica(checkbox) {
    const tarjeta = checkbox.closest('.tarjeta-alumno-neuro');
    const nominaId = tarjeta.getAttribute('data-nomina-id');
    const visualNota = document.getElementById(`nota-visual-${nominaId}`);
    const botones = tarjeta.querySelectorAll('.btn-criterio');
    if (!checkbox.checked) {
        visualNota.textContent = "0.0";
        visualNota.classList.add('ausente');
        botones.forEach(b => { b.classList.remove('activo'); b.disabled = true; });
    } else {
        visualNota.classList.remove('ausente');
        let nota = 12.0;
        tarjeta.querySelectorAll('.btn-criterio.activo').forEach(act => {
            nota += parseFloat(act.getAttribute('data-puntos'));
        });
        visualNota.textContent = Math.min(nota, 20.0).toFixed(1);
        botones.forEach(b => b.disabled = false);
    }
};
// Suma modular reactiva
function alternarCriterio(boton, nominaId) {
    if(boton.disabled) return;
    boton.classList.toggle('activo');
    const tarjeta = boton.closest('.tarjeta-alumno-neuro');
    const visualNota = document.getElementById(`nota-visual-${nominaId}`);
    let nota = 12.0;
    tarjeta.querySelectorAll('.btn-criterio.activo').forEach(act => {
        nota += parseFloat(act.getAttribute('data-puntos'));
    });
visualNota.textContent = Math.min(nota, 20.0).toFixed(1);
};

async function guardarControlDiarioLote() {
    const sesionId = document.getElementById('diario-sesion').value;
    if (!sesionId) return mostrarNotificacion("Falta seleccionar la sesión.");
    const filas = document.querySelectorAll('.tarjeta-alumno-neuro');
    try {
        await db_real.execute({ statement: "BEGIN TRANSACTION;" });
        const sql = `INSERT INTO registros (participantes_id, sesion_id, asistencia, calificacion, tipo_evaluacion) VALUES (?, ?, ?, ?, 'Formativa');`;
        for (const fila of filas) {
            const nominaId = parseInt(fila.getAttribute('data-nomina-id'));
            const presente = fila.querySelector('.check-asistencia').checked ? 'true' : 'false';
            const nota = parseFloat(document.getElementById(`nota-visual-${nominaId}`).textContent);
            await db_real.execute({ statement: sql, values: [nominaId, parseInt(sesionId), presente, nota] });
        }
        await db_real.execute({ statement: "COMMIT;" });
        mostrarNotificacion("Control diario guardado.");
        document.getElementById('tabla-asistencia-notas').innerHTML = "";
        document.getElementById('btn-guardar-diario').style.display = "none";
    } catch (e) {
await db_real.execute({ statement: "ROLLBACK;" });
console.error(e);
}
};

function manejadorBuscadorConDebounce(valorInput) {
    clearTimeout(temporizadorBuscador);
    if (valorInput.trim() === "") { return cargarEstudiantesInscritos(); }
    temporizadorBuscador = setTimeout(async () => {
        const cursoId = document.getElementById('diario-curso').value;
        if (!cursoId) return;
        const termino = `%${valorInput.trim().toUpperCase()}%`;
        const sql = `SELECT n.id AS nomina_id, e.id_cedula, e.apellido, e.nombre FROM nomina n INNER JOIN estudiantes e ON n.estudiantes_id = e.id_cedula WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ? AND (e.id_cedula LIKE ? OR e.apellido LIKE ? OR e.nombre LIKE ?) ORDER BY e.apellido ASC;`;
        const res = await db_real.query({ statement: sql, values: [parseInt(cursoId), parseInt(window.escolaridadActivaId), termino, termino, termino] });
        await inyectarEstudiantesEnPantalla(res.values || []);
    }, 250);
};

function abrirModalCriterio(id = null, nombre = '', descripcion = '', puntos = '') {
    document.getElementById('form-crud-criterio').reset();
    document.getElementById('criterio-id-edicion').value = id || "";
    document.getElementById('modal-titulo-accion').textContent = id ? "⚙️ Editar Criterio" : "🧠 Nuevo Criterio Neurocognitivo";
    if (id) {
        document.getElementById('crit-nombre').value = nombre;
        document.getElementById('crit-descripcion').value = descripcion;
        document.getElementById('crit-puntos').value = puntos;
    }
    document.getElementById('modal-crud-criterio').className = "modal-visible";
};

function cerrarModalCriterio() { document.getElementById('modal-crud-criterio').className = "modal-oculto"; }

async function guardarCriterioFormulario(evento) {
    evento.preventDefault();
    const id = document.getElementById('criterio-id-edicion').value;
    const nombre = document.getElementById('crit-nombre').value.trim();
    const desc = document.getElementById('crit-descripcion').value.trim();
    const pts = parseFloat(document.getElementById('crit-puntos').value);
    try {
        if (id) {
            await db_real.execute({
            statement: `UPDATE criterios_evaluacion SET nombre_criterio=?, descripcion=?, puntos_aporte=? WHERE id=?;`,
            values: [nombre, desc, pts, parseInt(id)]});
        } else {
            await db_real.execute({
            statement: `INSERT INTO criterios_evaluacion (nombre_criterio, descripcion, puntos_aporte) VALUES (?, ?, ?);`,
            values: [nombre, desc, pts]});
        }
        cerrarModalCriterio();
        await renderizarListadoCriterios();
        mostrarNotificacion("Criterio procesado.");
    } catch (e) { console.error(e); }
};

async function renderizarListadoCriterios() {
    const contenedor = document.getElementById('lista-criterios-dinamica');
    if (!contenedor) return;
    contenedor.innerHTML = "";
    try {
    const res = await db_real.query({ statement: `SELECT id, nombre_criterio, descripcion, puntos_aporte FROM criterios_evaluacion ORDER BY nombre_criterio ASC;`});
    (res.values || []).forEach(crit => {
        const div = document.createElement('div');
        div.className = "tarjeta-criterio";
        div.innerHTML = `<div class="info-crit"> <h4>${crit.nombre_criterio}</h4> <p style="margin:4px 0; font-size:12px; color:#546e7a;">${crit.descripcion || ''}</p> </div>  <div class="puntos-badge" style="background:#e8f5e9; padding:5px 8px; border-radius:6px; font-weight:bold; color:#2e7d32;"> +${crit.puntos_aporte.toFixed(1)} </div>  <div class="acciones-crit">  <button class="btn-icono btn-editar" id="edit-crit-${crit.id}" style="background:none;border:none;cursor:pointer;font-size:16px;">✏️</button>  <button class="btn-icono btn-eliminar" onclick="eliminarCriterio(${crit.id})" style="background:none;border:none;cursor:pointer;font-size:16px;">🗑️</button>  </div>`;
        contenedor.appendChild(div);
        document.getElementById(`edit-crit-${crit.id}`).addEventListener('click', () => {
            abrirModalCriterio(crit.id, crit.nombre_criterio, crit.descripcion, crit.puntos_aporte);
        });
    });
    } catch (e) { console.error(e); }
};

async function eliminarCriterio(id) {
    if (!confirm("¿Desea eliminar el criterio?")) return;
    try {
        await db_real.execute({ statement: `DELETE FROM criterios_evaluacion WHERE id=?;, values: [parseInt(id)]` });
        await renderizarListadoCriterios();
        mostrarNotificacion("Criterio eliminado.");
    } catch(e) { console.error(e); }
};

async function cargarTableroAnalitico() {
    const cursoId = document.getElementById('select-estadisticas-curso').value;
    if (!cursoId || !window.escolaridadActivaId) return;
    try {
        const sqlGen = `SELECT COUNT(DISTINCT n.estudiantes_id) AS total_alumnos, ROUND(AVG(r.calificacion), 2) AS promedio_notas, ROUND((SUM(CASE WHEN r.asistencia = 'true' THEN 1 ELSE 0 END) * 100.0) / COUNT(r.id), 1) AS porcentaje_asistencia FROM nomina n INNER JOIN registros r ON n.id = r.participantes_id WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ?;`;
        const resGen = await db_real.query({ statement: sqlGen, values: [parseInt(cursoId), parseInt(window.escolaridadActivaId)] });
        const general = resGen.values[0];
    if (!general || general.total_alumnos === 0) {
        mostrarNotificacion("Sin registros evaluativos en este curso.");
        document.getElementById('metricas-rapidas').style.display = "none";
        document.getElementById('panel-alertas').style.display = "none";
        document.getElementById('panel-grafico-frecuencias').style.display = "none";
    return;
    }
    document.getElementById('metricas-rapidas').style.display = "flex";
    document.getElementById('txt-total-alumnos').textContent = general.total_alumnos;
    document.getElementById('txt-promedio-grupo').textContent = (general.promedio_notas || 0).toFixed(1);
    document.getElementById('txt-asistencia-grupo').textContent = `${general.porcentaje_asistencia || 0}%`;
    const sqlAlerta = `SELECT e.apellido, e.nombre, ROUND(AVG(r.calificacion), 2) AS promedio FROM nomina n INNER JOIN estudiantes e ON n.estudiantes_id = e.id_cedula INNER JOIN registros r ON n.id = r.participantes_id WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ? GROUP BY e.id_cedula HAVING promedio < 9.5;`;
    const resAlert = await db_real.query({ statement: sqlAlerta, values: [parseInt(cursoId), parseInt(window.escolaridadActivaId)] });
    const alertas = resAlert.values || [];
    const contAlertas = document.getElementById('lista-alertas-alumnos');
    document.getElementById('panel-alertas').style.display = "block";
    contAlertas.innerHTML = alertas.length === 0 ? "✅ Ninguno bajo riesgo." : "";
    alertas.forEach(al => contAlertas.innerHTML += `<div class="item-alerta-alumno" style="padding:4px 0;"><span>${al.apellido}, ${al.nombre}</span>: <strong style="color:red;">${al.promedio} pts</strong></div>`);
    const sqlDist = `SELECT COUNT(r.id) as total, SUM(CASE WHEN r.calificacion < 9.5 THEN 1 ELSE 0 END) AS insuficientes, SUM(CASE WHEN r.calificacion >= 9.5 AND r.calificacion <= 13.4 THEN 1 ELSE 0 END) AS base_dopamina, SUM(CASE WHEN r.calificacion >= 13.5 AND r.calificacion <= 17.4 THEN 1 ELSE 0 END) AS eficaces, SUM(CASE WHEN r.calificacion >= 17.5 THEN 1 ELSE 0 END) AS excelentes FROM nomina n INNER JOIN registros r ON n.id = r.participantes_id WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ?;`;
    const resDist = await db_real.query({ statement: sqlDist, values: [parseInt(cursoId), parseInt(window.escolaridadActivaId)] });
    const dist = resDist.values[0] || { excelentes: 0, eficaces: 0, base_dopamina: 0, insuficientes: 0, total: 1 };
    const totalReg = dist.total || 1;
    const pExc = ((dist.excelentes || 0) / totalReg * 100).toFixed(0);
    const pEfi = ((dist.eficaces || 0) / totalReg * 100).toFixed(0);
    const pDop = ((dist.base_dopamina || 0) / totalReg * 100).toFixed(0);
    const pIns = ((dist.insuficientes || 0) / totalReg * 100).toFixed(0);
    document.getElementById('panel-grafico-frecuencias').style.display = "block";
    document.getElementById('barras-distribucion').innerHTML =
    `<div class="barra-contenedor">
        <span class="etiqueta">Exc (18-20):</span>
        <div class="barra azul" style="width:${pExc}%">${dist.excelentes}
        </div>
     </div>
     <div class="barra-contenedor"><span class="etiqueta">Efi (14-17):</span>
         <div class="barra verde" style="width:${pEfi}%">${dist.eficaces}
         </div>
     </div>
     <div class="barra-contenedor"><span class="etiqueta">Dop (10-13):</span>
         <div class="barra amarilla" style="width:${pDop}%">${dist.base_dopamina}
         </div>
     </div>
     <div class="barra-contenedor"><span class="etiqueta">Ins (0-9):</span>
         <div class="barra roja" style="width:${pIns}%">${dist.insuficientes}
         </div>
     </div>`;
    } catch(e) { console.error(e); }
};

