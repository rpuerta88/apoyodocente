// Captura de errores global para debugging en caliente en el APK

window.onerror = function(mensaje, fuente, linea, columna, error) {
    const errorTexto = `🔴 Error en App: ${mensaje}\nLínea: ${linea} en ${fuente.split('/').pop()}`;
    console.error(errorTexto, error);
    // Intentamos enviarlo como alerta nativa si Capacitor ya cargó
    if (window.Capacitor?.Plugins?.Toast) {
        window.Capacitor.Plugins.Toast.show({ text: errorTexto, duration: 'long' });
    } else {
        alert(errorTexto); // Fallback para el navegador o arranque temprano
    }
    return false;
};

// 1. VARIABLES GLOBALES Y ORQUESTRACIÓN DEL INICIO
let db_real = null;
//~ window.escolaridadActivaId = null;
//~ window.lapsoActivoId = null; // Necesario para amarrar las sesiones al momento escolar real

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await AppDB.inicializar();
        //~ await AppEscolaridad.controlarFlujoInicial(); 
    } catch (e) {
        alert(`Fallo en la carga inicial: ${e.message}`);
        console.error("Fallo secuencial de arranque:", e);
    }
});

// Función auxiliar global para alertas nativas en Android

async function mostrarNotificacion(mensaje) {
    try {
        const { Toast } = Capacitor.Plugins;
        if (Toast) {
            await Toast.show({ text: mensaje, duration: 'short', position: 'bottom' });
        } else {
            console.log("Fallback (Navegador):", mensaje);
        }
    } catch (e) {
        console.error("Error al mostrar notificación:", e);
    }
}

// 2. MÓDULO DE BASE DE DATOS (Conexión y Estructura)
const AppDB = {
    dbName: "apoyo_docente_app",
    inicializar: async function() {
        try {
            const SQLite = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.CapacitorSQLite : null;
            if (!SQLite) {
                mostrarNotificacion(`Persiste problema de plugin`)
                throw new Error("El componente CapacitorSQLite no está inyectado en el APK.");
            }
            // Consistencia nativa de conexiones
            let consistencia;
            try {
                consistencia = await SQLite.checkConnectionsConsistency();
            } catch (e) {
                console.warn("Inconsistencia nativa detectada, procediendo a restaurar conexiones:", e);
                consistencia = { result: false };
                mostrarNotificacion(`no tuvo consistencia`)
            }
                    // 2. Comprobar si la conexión ya está activa en la memoria nativa
            let estaConectado;
            try {
                estaConectado = await SQLite.isConnection({ database: this.dbName });
            } catch (e) {
                estaConectado = { result: false };
                mostrarNotificacion(`no está conectada`)
            }
            // 3. Flujo inteligente de conexión basado en el estado real
            if (consistencia.result && estaConectado.result) {
            console.log("La conexión ya existía de forma consistente en memoria nativa.");
            } else {
            // Si existía una conexión muerta o corrupta en el pool nativo, la cerramos primero
                if (estaConectado.result) {
                    try {
                        await SQLite.closeConnection({ database: this.dbName });
                    } catch(e) {
                        console.warn("No se pudo cerrar la conexión huérfana (operación segura):", e);
                    }
                }
                // Creamos la conexión de forma limpia
                await SQLite.createConnection({
                    database: this.dbName,
                    version: 1,
                    encrypted: false,
                    mode: "no-encryption",
                    readOnly: false
                });
                let verificacionFinal = await SQLite.isDBOpen({ database: this.dbName });
                if (!verificacionFinal.result) {
                    await SQLite.open({ database: this.dbName });
                }
            }
            } catch (error) {
            alert(`revisar la lógica de inicialización`);
            console.error("Error crítico en inicialización de base de datos:", error);
            throw error;
            // Puertos de abstracción limpios para consultas y ejecuciones
            db_real = {
                query: async function({ statement, values }) {
                    return await SQLite.query({ database: this.dbName, statement, values: values || [] });
                },
                execute: async function({ statement, values }) {
                    if (values && values.length > 0) {
                        return await SQLite.run({ database: this.dbName, statement, values });
                    }
                    return await SQLite.execute({ database: this.dbName, statements: statement });
                }
            };
            // Forzar activación de claves foráneas y validar tablas
            await db_real.execute({ statement: `PRAGMA foreign_keys = ON;` });
            await this.crearTablas();

        }
    },

    crearTablas: async function() {
        try {
            // Estructura DDL real extraída fielmente de tu schemaSAAD.sql
            const ddl = `CREATE TABLE IF NOT EXISTS estudiantes (id_cedula INTEGER PRIMARY KEY, nombre TEXT NOT NULL, apellido TEXT NOT NULL, fecha_nacimiento TEXT, genero TEXT CHECK(genero IN ('M', 'F')) NOT NULL); CREATE TABLE IF NOT EXISTS cursos (id INTEGER PRIMARY KEY AUTOINCREMENT, cursoseccion TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS escolaridades (id INTEGER PRIMARY KEY AUTOINCREMENT, escolaridad TEXT NOT NULL, profesor TEXT NOT NULL, area TEXT NOT NULL, peic TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL); CREATE TABLE IF NOT EXISTS lapso (id INTEGER PRIMARY KEY AUTOINCREMENT, momento TEXT NOT NULL, proyecto_aprendizaje TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL, lapsoescolar_id INTEGER, FOREIGN KEY (lapsoescolar_id) REFERENCES escolaridades(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_lapso_escolaridad_fk ON lapso (lapsoescolar_id); CREATE TABLE IF NOT EXISTS catedra (id INTEGER PRIMARY KEY AUTOINCREMENT, tema_central TEXT NOT NULL); CREATE TABLE IF NOT EXISTS temario (id INTEGER PRIMARY KEY AUTOINCREMENT, tema_generador TEXT NOT NULL, catedra_id INTEGER, FOREIGN KEY (catedra_id) REFERENCES catedra(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_temario_catedra_fk ON temario (catedra_id); CREATE TABLE IF NOT EXISTS sesiones (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT DEFAULT CURRENT_TIMESTAMP, nombre TEXT NOT NULL, temario_id INTEGER, lapso_id INTEGER, FOREIGN KEY (temario_id) REFERENCES temario(id) ON DELETE CASCADE, FOREIGN KEY (lapso_id) REFERENCES lapso(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_sesiones_temario_fk ON sesiones (temario_id); CREATE INDEX IF NOT EXISTS idx_sesiones_lapso_fk ON sesiones (lapso_id); CREATE TABLE IF NOT EXISTS nomina (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiantes_id INTEGER, cursoseccion_id INTEGER, escolaridades_id INTEGER, condicion_acadm TEXT CHECK(condicion_acadm IN ('Regular', 'Repitiente')) DEFAULT 'Regular' NOT NULL, UNIQUE (estudiantes_id, cursoseccion_id, escolaridades_id), FOREIGN KEY (estudiantes_id) REFERENCES estudiantes(id_cedula) ON DELETE CASCADE, FOREIGN KEY (cursoseccion_id) REFERENCES cursos(id) ON DELETE CASCADE, FOREIGN KEY (escolaridades_id) REFERENCES escolaridades(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_nomina_estudiantes_fk ON nomina (estudiantes_id); CREATE INDEX IF NOT EXISTS idx_nomina_cursoseccion_fk ON nomina (cursoseccion_id); CREATE INDEX IF NOT EXISTS idx_nomina_escolaridades_fk ON nomina (escolaridades_id); CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, participantes_id INTEGER NOT NULL, sesion_id INTEGER NOT NULL, asistencia TEXT DEFAULT 'true' CHECK(asistencia IN ('false', 'true')), calificacion REAL CHECK(calificacion >= 1 AND calificacion <= 20), tipo_evaluacion TEXT CHECK(tipo_evaluacion IN ('Sumativa', 'Formativa')), instrumento TEXT NOT NULL, FOREIGN KEY (participantes_id) REFERENCES nomina(id) ON DELETE CASCADE, FOREIGN KEY (sesion_id) REFERENCES sesiones(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_registros_participantes_fk ON registros (participantes_id); CREATE INDEX IF NOT EXISTS idx_registros_sesion_fk ON registros (sesion_id); CREATE TABLE IF NOT EXISTS criterios_evaluacion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_criterio TEXT NOT NULL, descripcion TEXT, puntos_aporte REAL NOT NULL CHECK(puntos_aporte > 0 AND puntos_aporte <= 8)); CREATE TABLE IF NOT EXISTS calificacion (id INTEGER PRIMARY KEY AUTOINCREMENT, registro_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, valoracion INTEGER, UNIQUE (registro_id, criterio_id), FOREIGN KEY (registro_id) REFERENCES registros(id) ON DELETE CASCADE, FOREIGN KEY (criterio_id) REFERENCES criterios_evaluacion(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_calificacion_registro_fk ON calificacion (registro_id); CREATE INDEX IF NOT EXISTS idx_calificacion_criterio_fk ON calificacion (criterio_id);`;
            await db_real.execute({ statement: ddl });
            alert(`Estructura de la base de datos lista`);
        } catch (error) {
            console.error("Fallo al inicializar las tablas:", error);
            alert(`Falla al construir base de datos`);
            throw error;
        }
    }
};

// 3. MÓDULO DE GESTIÓN DE ESCOLARIDAD Y LAPSOS
/*
const AppEscolaridad = {
    verificarEstadoActivo: async function() {
        try {
            // Buscamos si hoy hay una escolaridad vigente
            const sqlEscolaridad = `SELECT id FROM escolaridades WHERE date('now', 'localtime') BETWEEN date(fecha_inicio) AND date(fecha_cierre) LIMIT 1;`;
            const resEsc = await db_real.query({ statement: sqlEscolaridad });

            if (resEsc?.values?.length > 0) {
                window.escolaridadActivaId = resEsc.values[0].id;

                // Buscamos si hoy hay un lapso (momento) vigente amarrado a esa escolaridad
                const sqlLapso = `SELECT id FROM lapso WHERE lapsoescolar_id = ? AND date('now', 'localtime') BETWEEN date(fecha_inicio) AND date(fecha_cierre) LIMIT 1;`;
                const resLapso = await db_real.query({ statement: sqlLapso, values: [window.escolaridadActivaId] });
                
                if (resLapso?.values?.length > 0) {
                    window.lapsoActivoId = resLapso.values[0].id;
                }
                return true;
            }
            return false;
        } catch (error) {
            console.error("Error al verificar vigencia temporal:", error);
            return false;
        }
    },

    controlarFlujoInicial: async function() {
        const tieneEscolaridadActiva = await this.verificarEstadoActivo();
        
        if (tieneEscolaridadActiva) {
    // Si todo está vigente, refrescamos la interfaz gráfica reactivamente
        await AppUI.cargarSelectoresCursos();
        await AppUI.cargarSelectoresTemarios();
        } else {
    // Si no hay año activo, forzamos la configuración inicial abriendo el modal
        const modal = document.getElementById('modal-escolaridad');
        if (modal) modal.className = "modal-visible";
        }
    },
    guardar: async function(evento) {
        evento.preventDefault();
        const boton = document.getElementById('btn-activar-escolaridad');
        if (boton) { boton.disabled = true; boton.textContent = "Procesando..."; }
        const datos = [
            document.getElementById('esc-nombre').value.trim(),
            document.getElementById('esc-profesor').value.toUpperCase().trim(),
            document.getElementById('esc-area').value.trim(),
            document.getElementById('esc-peic').value.trim(),
            document.getElementById('esc-inicio').value,
            document.getElementById('esc-cierre').value
        ];
        if (datos.includes("")) {
            mostrarNotificacion(`Por favor rellene todos los campos.`);
        if (boton) { boton.disabled = false; boton.textContent = "Activar Escolaridad"; }
        return;
        }
        try {
            const sql = `INSERT INTO escolaridades (escolaridad, profesor, area, peic, fecha_inicio, fecha_cierre) VALUES (?, ?, ?, ?, ?, ?);`;
            const resultado = await db_real.execute({ statement: sql, values: datos });
            window.escolaridadActivaId = resultado.changes?.lastId || 1;
            const modal = document.getElementById('modal-escolaridad');
            if (modal) modal.className = "modal-oculto";
            await AppUI.cargarSelectoresCursos();
            mostrarNotificacion(`Año escolar guardado con éxito.`);
        } catch (error) {
            console.error("Error al registrar escolaridad:", error);
            mostrarNotificacion(`Fallo de persistencia en escolaridad.`);
        if (boton) { boton.disabled = false; boton.textContent = "Activar Escolaridad"; }
        }
    }
};

// 4. MÓDULO DE GESTIÓN DE CURSOS
const AppCursos = {
    abrirModal: function() {
        const modal = document.getElementById('modal-curso');
        if (modal) { document.getElementById('form-curso').reset(); modal.className = "modal-visible"; }
    },
    cerrarModal: function() {
        const modal = document.getElementById('modal-curso');
        if (modal) modal.className = "modal-oculto";
    },
    guardar: async function(evento) {
        evento.preventDefault();
        const inputCurso = document.getElementById('txt-nuevo-curso');
        const cursoTexto = inputCurso.value.trim().toUpperCase();
        if (cursoTexto === "") {
            mostrarNotificacion(`El nombre del curso no puede estar vacío.`);
        return;
        }
        const sql = `INSERT INTO cursos (cursoseccion) VALUES (?);`;
        try {
            await db_real.execute({ statement: sql, values: [cursoTexto] });
        mostrarNotificacion(`Curso "${cursoTexto}" registrado.`);
        this.cerrarModal();
        await AppUI.cargarSelectoresCursos();
        } catch (error) {
            if (error.message?.includes("UNIQUE constraint failed")) {
                mostrarNotificacion(`Error: Ese curso o sección ya existe.`);
            } else {
                mostrarNotificacion(`No se pudo guardar el curso.`);
            }
        }
    }
};

// 4B. MÓDULO DE GESTIÓN DE ESTUDIANTES Y MATRÍCULA
const AppEstudiantes = {
    abrirModal: function() {
        const cursoId = document.getElementById('diario-curso').value;
        if (!cursoId) {
            mostrarNotificacion("⚠️ Seleccione primero un Curso en el panel diario.");
            return;
        }
        const modal = document.getElementById('modal-estudiante');
        if (modal) { document.getElementById('form-estudiante').reset(); modal.className = "modal-visible"; }
    },
    cerrarModal: function() {
        const modal = document.getElementById('modal-estudiante');
        if (modal) modal.className = "modal-oculto";
    },
    guardar: async function(evento) {
        evento.preventDefault();
        if (!window.escolaridadActivaId) {
            mostrarNotificacion("No hay una escolaridad activa.");
            return;
        }
        
        const cursoId = parseInt(document.getElementById('diario-curso').value);
        const cedula = parseInt(document.getElementById('est-cedula').value);
        const nombre = document.getElementById('est-nombre').value.trim().toUpperCase();
        const apellido = document.getElementById('est-apellido').value.trim().toUpperCase();
        const nacimiento = document.getElementById('est-nacimiento').value;
        const genero = document.getElementById('est-genero').value;

        try {
            // 1. Inserción defensiva del Estudiante (Si ya existe, se omite o actualiza de acuerdo al flujo)
            const sqlEstudiante = `INSERT OR IGNORE INTO estudiantes (id_cedula, nombre, apellido, fecha_nacimiento, genero) VALUES (?, ?, ?, ?, ?);`;
            await db_real.execute({ statement: sqlEstudiante, values: [cedula, nombre, apellido, nacimiento, genero] });

            // 2. Insertar en la nómina amarrándolo al curso y año escolar correspondiente
            const sqlNomina = `INSERT INTO nomina (estudiantes_id, cursoseccion_id, escolaridades_id, condicion_acadm) VALUES (?, ?, ?, 'Regular');`;
            await db_real.execute({ statement: sqlNomina, values: [cedula, cursoId, window.escolaridadActivaId] });

            mostrarNotificacion(`Estudiante matriculado con éxito.`);
            this.cerrarModal();
            
            // Refrescar reactivamente la lista en pantalla
            await AppUI.renderizarMallaEstudiantes();
        } catch (error) {
            console.error("Fallo al matricular estudiante:", error);
            if (error.message?.includes("UNIQUE constraint failed")) {
                mostrarNotificacion("Este alumno ya pertenece a la nómina de este curso.");
            } else {
                mostrarNotificacion("Error de consistencia al guardar.");
            }
        }
    }
};
window.AppEstudiantes = AppEstudiantes;

// 5. MÓDULO DE INTERFAZ GRÁFICA Y CONTROL DE SESIONES (Sincronizado)
const AppUI = {
    cargarSelectoresCursos: async function() {
        try {
        if (!db_real) return;
        const sql = `SELECT * FROM cursos ORDER BY cursoseccion ASC;`;
        const resultado = await db_real.query({ statement: sql });
        const selectores = [
            document.getElementById('diario-curso')
            ];
        selectores.forEach(select => {
            if (!select) return;
            select.innerHTML = `<option value="">Seleccione Curso...</option>`;
            if (resultado?.values?.length > 0) {
                resultado.values.forEach(curso => {
                const option = document.createElement('option');
                option.value = curso.id;
                option.textContent = curso.cursoseccion;
                select.appendChild(option);
                });
            }
        });
        } catch (error) {
        console.error("Error cargando selectores de cursos:", error);
        }
    },
    abrirModalTemario: async function() {
// Validación neuroeducativa preventiva antes de abrir el formulario de clase
        if (!window.lapsoActivoId) {
            mostrarNotificacion("⚠️ No puedes registrar sesiones si no hay un Lapso/Momento activo para la fecha de hoy.");
        return;
        }
        const modal = document.getElementById('modal-temario');
        if (modal) {
            document.getElementById('form-temario').reset();
// Sincronizar dinámicamente el selector de temas generadores del temario disponible
        await this.cargarOpcionesTemasGeneradores();
        modal.className = "modal-visible";
        }
    },
    cerrarModalTemario: function() {
        const modal = document.getElementById('modal-temario');
        if (modal) modal.className = "modal-oculto";
    },
    cargarOpcionesTemasGeneradores: async function() {
        const selectTemarioFK = document.getElementById('select-temario-id');
        if (!selectTemarioFK) return;
        try {
// Traemos los temas generadores planificados en el temario general
            const sql = `SELECT id, tema_generador FROM temario ORDER BY id DESC;`;
            const resultado = await db_real.query({ statement: sql });
            selectTemarioFK.innerHTML = 'Seleccione Propósito/Tema...';
            if (resultado?.values?.length > 0) {
                resultado.values.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.tema_generador;
                    selectTemarioFK.appendChild(opt);
                });
            }
        } catch (e) {
            console.error("Error al cargar temario conceptual:", e);
            }
    },
    guardarTemario: async function(evento) {
        evento.preventDefault();
        const tituloSesion = document.getElementById('txt-nuevo-tema').value.trim().toUpperCase();
        const temarioId = document.getElementById('select-temario-id').value;
        if (tituloSesion === "" || !temarioId) {
            mostrarNotificacion("Falta ingresar el nombre de la sesión o seleccionar su propósito.");
            return;
        }
// CONTROL CLAVE: Respetamos escrupulosamente las claves foráneas del DDL real
        const sql = `INSERT INTO sesiones (nombre, temario_id, lapso_id) VALUES (?, ?, ?);`;
        const valores = [tituloSesion, parseInt(temarioId), window.lapsoActivoId];
        try {
            await db_real.execute({ statement: sql, values: valores });
            mostrarNotificacion(`Sesión de clase "${tituloSesion}" agendada.`);
            this.cerrarModalTemario();
            await this.cargarSelectoresTemarios();
        } catch (error) {
            console.error("Error físico de inserción en sesiones:", error);
            mostrarNotificacion("Error de claves relacionales en SQLite.");
            }
    },
    cargarSelectoresTemarios: async function() {
    try {
        const selectDiario = document.getElementById('diario-sesion');
        if (!selectDiario) return;
        const sql = `SELECT * FROM sesiones ORDER BY id DESC;`;
        const resultado = await db_real.query({ statement: sql });
        selectDiario.innerHTML = 'Seleccione Tema de Clase...';
        if (resultado?.values?.length > 0) {
            resultado.values.forEach(sesion => {
                const option = document.createElement('option');
                option.value = sesion.id;
// Limpieza visual de la fecha nativa de SQLite
                const soloFecha = sesion.fecha ? sesion.fecha.split(' ')[0] : 'Hoy';
                option.textContent = `${soloFecha} - ${sesion.nombre}`;
                selectDiario.appendChild(option);
            });
        }
    } catch (error) {
        console.error("Error al mapear el selector diario de sesiones:", error);
        }
    },
        // (Añadir dentro de AppUI)



        renderizarMallaEstudiantes: async function() {
        const contenedor = document.getElementById('contenedor-estudiantes-dinamico');
        const cursoId = document.getElementById('diario-curso').value;
        const sesionId = document.getElementById('diario-sesion').value;
        const btnAlumno = document.getElementById('btn-abrir-estudiante');

        // Estado inicial de bloqueo defensivo
        if (!cursoId) {
            if (btnAlumno) btnAlumno.disabled = true;
            contenedor.innerHTML = '<div class="estado-vacio"><p>Seleccione un curso para ver los alumnos.</p></div>';
            return;
        }
        
        if (btnAlumno) btnAlumno.disabled = false; // Habilitar matrícula rápido

        if (!sesionId) {
            contenedor.innerHTML = '<div class="estado-vacio"><p>Seleccione la Sesión o Clase de Hoy para activar el registro en caliente.</p></div>';
            return;
        }

        try {
            // Extraer la nómina real inscrita en el curso
            const sqlNomina = `SELECT n.id AS nomina_id, e.id_cedula, e.nombre, e.apellido FROM nomina n INNER JOIN estudiantes e ON e.id_cedula = n.estudiantes_id WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ? ORDER BY e.apellido ASC, e.nombre ASC;`;
            const alumnos = await db_real.query({ statement: sqlNomina, values: [parseInt(cursoId), window.escolaridadActivaId] });

            if (!alumnos?.values || alumnos.values.length === 0) {
                contenedor.innerHTML = '<div class="estado-vacio"><p>No hay estudiantes matriculados en este curso todavía.</p></div>';
                return;
            }

            // Extraer criterios de evaluación activos para el aula
            const criterios = await db_real.query({ statement: `SELECT id, nombre_criterio, puntos_aporte FROM criterios_evaluacion;` });

            let htmlAcumulado = "";

            for (let alumno of alumnos.values) {
                // Verificar si ya existe un registro de asistencia/evaluación para este alumno en esta clase
                const sqlVerificarReg = `SELECT id, asistencia FROM registros WHERE participantes_id = ? AND sesion_id = ? LIMIT 1;`;
                const resReg = await db_real.query({ statement: sqlVerificarReg, values: [alumno.nomina_id, parseInt(sesionId)] });
                
                let registroId = null;
                let asistenciaValor = "true";

                if (resReg?.values?.length > 0) {
                    registroId = resReg.values[0].id;
                    asistenciaValor = resReg.values[0].asistencia;
                } else {
                    // Creación automática e implícita del registro "en frío" para asegurar persistencia limpia
                    const sqlInsReg = `INSERT INTO registros (participantes_id, sesion_id, asistencia, instrumento) VALUES (?, ?, 'true', 'Feedback Aula');`;
                    const resIns = await db_real.execute({ statement: sqlInsReg, values: [alumno.nomina_id, parseInt(sesionId)] });
                    registroId = resIns.changes?.lastId || 1;
                }

                const checkAtendido = asistenciaValor === "true" ? "checked" : "";

                htmlAcumulado += `
                    <div class="tarjeta-estudiante" id="tarjeta-aluno-${alumno.nomina_id}">
                        <div class="info-alumno">
                            <h4>${alumno.apellido}, ${alumno.nombre}</h4>
                            <p>C.I: ${alumno.id_cedula} | Nómina Nro: ${alumno.nomina_id}</p>
                        </div>
                        <div class="controles-evaluacion">
                            <!-- Toggle de Asistencia en vivo -->
                            <label class="switch-asistencia">
                                <input type="checkbox" ${checkAtendido} onchange="AppUI.actualizarAsistenciaInSitu(${registroId}, this.checked)">
                                <span>Presente</span>
                            </label>
                `;

                // Pintar dinámicamente selectores interactivos para cada criterio neurocognitivo
                if (criterios?.values && criterios.values.length > 0) {
                    for (let crit of criterios.values) {
                        // Buscar valoración existente si la hay
                        const sqlVal = `SELECT valoracion FROM calificacion WHERE registro_id = ? AND criterio_id = ? LIMIT 1;`;
                        const resVal = await db_real.query({ statement: sqlVal, values: [registroId, crit.id] });
                        const vActual = resVal?.values?.length > 0 ? resVal.values[0].valoracion : 0;
                        
                        // 1. Genera las opciones fuera del template literal principal
                        const opcionesHTML = Array.from({ length: crit.puntos_aporte }, (_, i) => i + 1)
                          .map(num => `<option value="${num}" ${vActual === num ? 'selected' : ''}>${num} Pts</option>`)
                          .join('');

                        // 2. Luego, simplemente inserta la variable en tu HTML acumulado
                        htmlAcumulado += `
                          <div class="criterio-fila">
                              <label>${crit.nombre_criterio} (Max: ${crit.puntos_aporte}pts)</label>
                              <select class="selector-valoracion" onchange="AppUI.guardarNotaInSitu(${registroId}, ${crit.id}, this.value)">
                                  <option value="0">Sin valorar</option>
                                      ${opcionesHTML}
                              </select>
                          </div>
                        `;
                        
                    }
                }

                htmlAcumulado += `</div></div>`;
            }

            contenedor.innerHTML = htmlAcumulado;

        } catch (error) {
            console.error("Error al procesar la neuroaula interactiva:", error);
            contenedor.innerHTML = '<div class="estado-vacio"><p>Error al cargar el panel interactivo.</p></div>';
        }
    },


    actualizarAsistenciaInSitu: async function(registroId, estaPresente) {
        const valor = estaPresente ? "true" : "false";
        const sql = `UPDATE registros SET asistencia = ? WHERE id = ?;`;
        try {
            await db_real.execute({ statement: sql, values: [valor, registroId] });
            console.log(`Asistencia actualizada en vivo para el registro ${registroId}: ${valor}`);
        } catch (e) {
            console.error("Error actualizando asistencia:", e);
            mostrarNotificacion("No se pudo salvar la asistencia.");
        }
    },

    guardarNotaInSitu: async function(registroId, criterioId, valor) {
        const puntos = parseInt(valor);
        try {
            if (puntos === 0) {
                // Si el docente lo vuelve a poner a cero, limpiamos la base de datos
                const sqlDel = `DELETE FROM calificacion WHERE registro_id = ? AND criterio_id = ?;`;
                await db_real.execute({ statement: sqlDel, values: [registroId, criterioId] });
            } else {
                // Inserción reactiva con "INSERT OR REPLACE" para evitar violaciones UNIQUE
                const sqlUpsert = `INSERT OR REPLACE INTO calificacion (registro_id, criterio_id, valoracion) VALUES (?, ?, ?);`;
                await db_real.execute({ statement: sqlUpsert, values: [registroId, criterioId, puntos] });
            }
            console.log(`Calificación salvada in situ: Registro ${registroId}, Criterio ${criterioId} -> ${puntos}pts`);
        } catch (e) {
            console.error("Fallo de guardado en caliente de notas:", e);
            mostrarNotificacion("Fallo al guardar la nota.");
        }
    }

};

// 6. ENLACES Y LISTENERS DE EVENTOS (MAPEADO DINÁMICO DE INTERFAZ)
// Exposición limpia de los controladores al objeto Window (para tus onclick HTML)
window.AppCursos = AppCursos;
window.AppUI = AppUI;
window.AppEscolaridad = AppEscolaridad;

// Adjuntar los Listeners de manera segura previniendo colisiones de carga
const adjuntarEvento = (idElemento, evento, funcion) => {
const el = document.getElementById(idElemento);
if (el) el.addEventListener(evento, funcion);
};

adjuntarEvento('form-escolaridad', 'submit', (e) => AppEscolaridad.guardar(e));
adjuntarEvento('form-curso', 'submit', (e) => AppCursos.guardar(e));
adjuntarEvento('form-temario', 'submit', (e) => AppUI.guardarTemario(e));
// (Añadir al final del archivo junto a los demás listeners)
adjuntarEvento('form-estudiante', 'submit', (e) => AppEstudiantes.guardar(e));

// Listeners reactivos para cambios de selectores en caliente
const selectCursoDiario = document.getElementById('diario-curso');
if (selectCursoDiario) {
    selectCursoDiario.addEventListener('change', () => AppUI.renderizarMallaEstudiantes());
}

const selectSesionDiario = document.getElementById('diario-sesion');
if (selectSesionDiario) {
    selectSesionDiario.addEventListener('change', () => AppUI.renderizarMallaEstudiantes());
}

*/
