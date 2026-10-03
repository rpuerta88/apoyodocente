// 1. VARIABLES GLOBALES Y ORQUESTRACIÓN DEL INICIO
let db_real = null;
window.escolaridadActivaId = null;
let temporizadorBuscador = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await AppDB.inicializar();
        //~ await AppEscolaridad.controlarFlujoInicial(); 
    } catch (e) {
        mostrarNotificacion(`Fallo en la carga inicial: ${e.message}`);
        console.error("Fallo secuencial de arranque:", e);
    }
});

// Esta función ahora simplemente redirige al módulo correspondiente
async function controlarFlujoInicial() {
    await AppEscolaridad.controlarFlujoInicial();
}

//FUNCION AUXILIAR GLOBAL PARA ALERTAS RAPIDAS
async function mostrarNotificacion(mensaje) {
    try {
        const { Toast } = Capacitor.Plugins;
        if (Toast) {
            await Toast.show({ text: mensaje, duration: 'long', position: 'bottom' });
            console.log("Toast local:", mensaje);
        } else {
            console.log("Notificación fallback (Navegador):", mensaje);
        }
    } catch (e) {
        console.log("Notificación falló por completo:", mensaje);
    }
}

// 2. MÓDULO DE BASE DE DATOS (Conexión, Estructura y Semillas)
const AppDB = {
    dbName: "apoyo_docente_app",

    // Función principal de arranque del módulo
    inicializar: async function() {
        try {
            const SQLite = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.CapacitorSQLite : null;
            if (!SQLite) {
                throw new Error("El componente CapacitorSQLite no está inyectado en el APK.");
                mostrarNotificacion(`El componente CapacitorSQLite no está inyectado en el APK.`);
            }
            // Verificación defensiva de consistencia nativa
            let consistencia;
            try {
                await SQLite.checkConnectionsConsistency();
                consistencia = { result: true };
            } catch (e) {
                console.warn("Inconsistencia nativa detectada, procediendo a restaurar conexiones:", e);
                consistencia = { result: false };
            }

            // Comprobar si la conexión ya está activa en la memoria nativa
            let estaConectado;
            try {
                estaConectado = await SQLite.isConnection({ database: this.dbName });
            } catch (e) {
                estaConectado = { result: false };
            }

            // Flujo inteligente de conexión basado en el estado real
            if (consistencia.result && estaConectado.result) {
                console.log("La conexión ya existía de forma consistente en memoria nativa.");
            } else {
                if (estaConectado.result) {
                    try {
                        await SQLite.closeConnection({ database: this.dbName });
                    } catch(e) {
                        console.warn("No se pudo cerrar la conexión huérfana (operación no segura):", e);
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
            }

            // Abrir la base de datos ÚNICAMENTE si no se encuentra abierta ya
            let verificacionFinal = await SQLite.isDBOpen({ database: this.dbName });
            if (!verificacionFinal.result) {
                await SQLite.open({ database: this.dbName });
            }
            
            console.log("¡Bienvenido al sistema de apoyo docente!");

            // Asignación limpia del puente de consultas
            db_real = {
                query: async function({ statement, values }) {
                    return await SQLite.query({
                        database: AppDB.dbName,
                        statement: statement,
                        values: values || []
                    });
                },
                execute: async function({ statement, values }) {
                    if (values && values.length > 0) {
                        return await SQLite.run({
                            database: AppDB.dbName,
                            statement: statement,
                            values: values
                        });
                    }
                    return await SQLite.execute({
                        database: AppDB.dbName,
                        statements: statement
                    });
                }
            };

            // Crear la estructura física interna de datos
            await this.crearTablas();
            mostrarNotificacion("Base de datos iniciada satisfactoriamente");

        } catch (error) {
            console.error("Error crítico en el SQLite de Android:", error);
            const mensajeFinal = error.message || JSON.stringify(error);
            mostrarNotificacion(`Fallo nativo inicialización: ${mensajeFinal}`);
            throw error;
        }
    },

    // Sub-función interna encargada de la estructura DDL
    crearTablas: async function() {
        try {
            const estructuraTablas = `PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS estudiantes (id_cedula INTEGER PRIMARY KEY, nombre TEXT NOT NULL, apellido TEXT NOT NULL, fecha_nacimiento TEXT, genero TEXT CHECK(genero IN ('M', 'F')) NOT NULL); CREATE TABLE IF NOT EXISTS cursos (id INTEGER PRIMARY KEY AUTOINCREMENT, cursoseccion TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS escolaridades (id INTEGER PRIMARY KEY AUTOINCREMENT, escolaridad TEXT NOT NULL, profesor TEXT NOT NULL, area TEXT NOT NULL, peic TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL);  CREATE TABLE IF NOT EXISTS lapso (id INTEGER PRIMARY KEY AUTOINCREMENT, momento TEXT NOT NULL, proyecto_aprendizaje TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL, lapsoescolar_id INTEGER, FOREIGN KEY (lapsoescolar_id) REFERENCES escolaridades(id) ON DELETE CASCADE); CREATE INDEX idx_lapso_escolaridad_fk ON lapso (lapsoescolar_id); CREATE TABLE IF NOT EXISTS catedra (id INTEGER PRIMARY KEY AUTOINCREMENT, tema_central TEXT NOT NULL); CREATE TABLE IF NOT EXISTS temario (id INTEGER PRIMARY KEY AUTOINCREMENT, tema_generador TEXT NOT NULL, catedra_id INTEGER, FOREIGN KEY (catedra_id) REFERENCES catedra(id) ON DELETE CASCADE); CREATE INDEX idx_temario_catedra_fk ON temario (catedra_id); CREATE TABLE IF NOT EXISTS sesiones (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT DEFAULT CURRENT_TIMESTAMP, nombre TEXT NOT NULL, temario_id INTEGER, lapso_id INTEGER, FOREIGN KEY (temario_id) REFERENCES temario(id) ON DELETE CASCADE, FOREIGN KEY (lapso_id) REFERENCES lapso(id) ON DELETE CASCADE); CREATE INDEX idx_sesiones_temario_fk ON sesiones (temario_id); CREATE INDEX idx_sesiones_lapso_fk ON sesiones (lapso_id); CREATE TABLE IF NOT EXISTS nomina (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiantes_id INTEGER, cursoseccion_id INTEGER, escolaridades_id INTEGER, condicion_acadm TEXT CHECK(condicion_acadm IN ('Regular', 'Repitiente')) DEFAULT 'Regular' NOT NULL, UNIQUE (estudiantes_id, cursoseccion_id, escolaridades_id), FOREIGN KEY (estudiantes_id) REFERENCES estudiantes(id_cedula) ON DELETE CASCADE, FOREIGN KEY (cursoseccion_id) REFERENCES cursos(id) ON DELETE CASCADE, FOREIGN KEY (escolaridades_id) REFERENCES escolaridades(id) ON DELETE CASCADE); CREATE INDEX idx_nomina_estudiantes_fk ON nomina (estudiantes_id); CREATE INDEX idx_nomina_cursoseccion_fk ON nomina (cursoseccion_id); CREATE INDEX idx_nomina_escolaridades_fk ON nomina (escolaridades_id); CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, participantes_id INTEGER NOT NULL, sesion_id INTEGER NOT NULL, asistencia TEXT DEFAULT 'false' CHECK(asistencia IN ('false', 'true')), calificacion REAL DEFAULT 12 CHECK(calificacion >= 1 AND calificacion <= 20), tipo_evaluacion TEXT CHECK(tipo_evaluacion IN ('Sumativa', 'Formativa')), instrumento TEXT NOT NULL, FOREIGN KEY (participantes_id) REFERENCES nomina(id) ON DELETE CASCADE, FOREIGN KEY (sesion_id) REFERENCES sesiones(id) ON DELETE CASCADE); CREATE INDEX idx_registros_participantes_fk ON registros (participantes_id); CREATE INDEX idx_registros_sesion_fk ON registros (sesion_id); CREATE TABLE IF NOT EXISTS criterios_evaluacion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_criterio TEXT NOT NULL, descripcion TEXT, puntos_aporte REAL NOT NULL CHECK(puntos_aporte > 0 AND puntos_aporte <= 8));`;
            await db_real.execute({ statement: estructuraTablas });
            console.log("Las tablas están listas para trabajar");
            mostrarNotificacion(`Tablas Lista para Trabajar`);
        } catch (error) {
            console.error("Fallo crítico en inicialización de tablas SQL:", error);
            throw error;
        }
    }
};

// 3. MÓDULO DE GESTIÓN DE ESCOLARIDAD (Flujo, Validación y Registro)
const AppEscolaridad = {
    // Almacena en memoria el ID del año escolar activo para uso global
    activaId: null,
//Revisa de forma automatizada si hay un año escolar vigente según la fecha actual
    verificarVigente: async function() {
        try {
            // Consulta SQL adaptada para el SQLite nativo de Android
            const sql = `SELECT id FROM escolaridades WHERE date('now', 'localtime') BETWEEN date(fecha_inicio) AND date(fecha_cierre) LIMIT 1;`;
            const resultado = await db_real.query({ statement: sql });
            if (resultado && resultado.values && resultado.values.length > 0) {
                this.activaId = resultado.values[0].id;
                window.escolaridadActivaId = this.activaId; // Mantenemos compatibilidad global
                console.log("Escolaridad vigente localizada. ID:", this.activaId);
                return this.activaId;
            }
            console.log("No se encontraron registros de escolaridad vigentes para hoy.");
            return null;
        } catch (error) {
            console.error("Error al verificar escolaridad en SQLite:", error);
            return null;
        }
    },
//Orquesta las acciones iniciales de la App según el estado de la escolaridad
    controlarFlujoInicial: async function() {
        const idVigente = await this.verificarVigente();
        
        if (idVigente) {
            console.log("Flujo Automatizado: Cargando selectores operacionales...");
            await AppUI.cargarSelectoresCursos(); // <-- Corregido para usar el nuevo bloque
            await AppUI.cargarSelectoresTemarios(); // <-- Carga los temas previos
        } else {
            console.log("Flujo Automatizado: Activando modal de registro de escolaridad.");
            const modal = document.getElementById('modal-escolaridad');
            if (modal) modal.className = "modal-visible";
        }
    },
//Captura los datos en caliente del formulario e inyecta la nueva escolaridad en SQLite
    guardar: async function(evento) {
        evento.preventDefault();
        
        const boton = document.getElementById('btn-activar-escolaridad');
        if (boton) {
            boton.disabled = true;
            boton.textContent = "Procesando...";
        }
// Extracción y limpieza defensiva de la data para evitar ingresos huérfanos o vacíos
        const datos = [
            document.getElementById('esc-nombre').value.trim(),
            document.getElementById('esc-profesor').value.toUpperCase().trim(),
            document.getElementById('esc-area').value.trim(),
            document.getElementById('esc-peic').value.trim(),
            document.getElementById('esc-inicio').value,
            document.getElementById('esc-cierre').value
        ];
// Validación básica de carga cognitiva: Evitar campos vacíos en el guardado
        if (datos.includes("")) {
            mostrarNotificacion("Falta completar datos esenciales en el formulario.");
            if (boton) {
                boton.disabled = false;
                boton.textContent = "Activar Escolaridad";
            }
            return;
        }
        const sql = `INSERT INTO escolaridades (escolaridad, profesor, area, peic, fecha_inicio, fecha_cierre) VALUES (?, ?, ?, ?, ?, ?);`;

        try {
            const resultado = await db_real.execute({ statement: sql, values: datos });
            // Captura segura del ID recién generado en Android
            this.activaId = resultado.changes?.lastId || 1;
            window.escolaridadActivaId = this.activaId;

            // Ocultar formulario de forma segura
            const modal = document.getElementById('modal-escolaridad');
            if (modal) modal.className = "modal-oculto";
            await cargarSelectoresCursos();
            mostrarNotificacion("Año escolar activado y registrado con éxito.");
        } catch (error) {
            console.error("Error crítico al registrar el año escolar en SQLite:", error);
            mostrarNotificacion("Error de persistencia al registrar el año escolar.");
            if (boton) {
                boton.disabled = false;
                boton.textContent = "Activar Escolaridad";
            }
        }
    }
};

// 4. BLOQUE DE GESTIÓN DE CURSOS (Registro Dinámico "En Caliente")
const AppCursos = {
    abrirModal: function() {
        const modal = document.getElementById('modal-curso');
        if (modal) {
            document.getElementById('form-curso').reset();
            modal.className = "modal-visible";
        } else {
            console.warn("Defensa: El elemento 'modal-curso' no existe en el HTML.");
        }
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
            mostrarNotificacion(`Curso "${cursoTexto}" registrado con éxito.`);
            
            this.cerrarModal();
            
            // Actualización reactiva automática de todos los selectores de la app
            if (typeof cargarSelectoresCursos === 'function') {
                await cargarSelectoresCursos();
            }
        } catch (error) {
            console.error("Error al insertar curso en SQLite:", error);
            // Manejo defensivo si intentas meter un curso duplicado (por la restricción UNIQUE)
            if (error.message && error.message.includes("UNIQUE constraint failed")) {
                mostrarNotificacion(`Error: Ese curso o sección ya se encuentra registrado.`);
            } else {
                mostrarNotificacion(`No se pudo guardar el curso. Revisa los datos.`);
            }
        }
    }
};

// 5. MÓDULO DE INTERFAZ GRÁFICA (Selectores, Modales y Renderizado Dinámico)
const AppUI = {
//Consulta los cursos reales en SQLite y llena dinámicamente los selectores del HTML
    cargarSelectoresCursos: async function() {
        try {
            if (!db_real) return;

            const sql = "SELECT * FROM cursos ORDER BY cursoseccion ASC;";
            const resultado = await db_real.query({ statement: sql });

            // Identificamos todos los selectores de cursos presentes en tu HTML
            const selectores = [
                document.getElementById('select-curso'),
                document.getElementById('diario-curso'),
                document.getElementById('select-estadisticas-curso')
            ];

            selectores.forEach(select => {
                if (!select) return;
                
                // Limpiar opciones viejas dejando solo la por defecto
                select.innerHTML = '<option value="">Seleccione Curso...</option>';

                if (resultado && resultado.values && resultado.values.length > 0) {
                    resultado.values.forEach(curso => {
                        const option = document.createElement('option');
                        option.value = curso.id;
                        option.textContent = curso.cursoseccion;
                        select.appendChild(option);
                    });
                }
            });
            console.log("Selectores de cursos actualizados reactivamente desde SQLite.");
        } catch (error) {
            console.error("Error al cargar los selectores de cursos:", error);
        }
    },
//Muestra la ventana emergente para registrar una nueva Sesión de Clase (Temario)
    abrirModalTemario: function() {
        const modal = document.getElementById('modal-temario');
        if (modal) {
            document.getElementById('form-temario').reset();
            modal.className = "modal-visible";
        } else {
            console.warn("Defensa: El elemento 'modal-temario' no existe en el HTML.");
        }
    },
//Cierra el formulario emergente del temario
    cerrarModalTemario: function() {
        const modal = document.getElementById('modal-temario');
        if (modal) modal.className = "modal-oculto";
    },
//Guarda el nuevo tema de clase en la tabla 'sesiones' de SQLite
    guardarTemario: async function(evento) {
        evento.preventDefault();
        const inputTema = document.getElementById('txt-nuevo-tema');
        const temaTexto = inputTema.value.trim().toUpperCase();
        if (temaTexto === "") {
            mostrarNotificacion("El título del tema no puede estar vacío.");
            return;
        }

        const sql = `INSERT INTO sesiones (nombre) VALUES (?);`;

        try {
            await db_real.execute({ statement: sql, values: [temaTexto] });
            mostrarNotificacion(`Tema de clase "${temaTexto}" registrado con éxito.`);
            
            this.cerrarModalTemario();
            await this.cargarSelectoresTemarios(); // Actualiza el flujo del aula
        } catch (error) {
            console.error("Error al insertar el temario en SQLite:", error);
            mostrarNotificacion("Error al guardar el tema de clase.");
        }
    },
//Actualiza el selector de sesiones/temario en el panel diario
    cargarSelectoresTemarios: async function() {
        try {
            const selectTemario = document.getElementById('diario-sesion');
            if (!selectTemario) return;
            const sql = `SELECT * FROM sesiones ORDER BY id DESC;`;
            const resultado = await db_real.query({ statement: sql });

            selectTemario.innerHTML = '<option value="">Seleccione Tema de Clase...</option>';

            if (resultado && resultado.values && resultado.values.length > 0) {
                resultado.values.forEach(sesion => {
                    const option = document.createElement('option');
                    option.value = sesion.id;
                    option.textContent = `${sesion.fecha.split(' ')[0]} - ${sesion.nombre}`;
                    selectTemario.appendChild(option);
                });
            }
        } catch (error) {
            console.error("Error al cargar el selector de temarios:", error);
        }
    }
};

// Mapeo global para mantener vivas las llamadas de Capacitor y los disparadores nativos
window.cargarSelectoresCursos = AppUI.cargarSelectoresCursos;
window.AppUI = AppUI;

//PENDIENTE*** UBICAR LISTENER
// Vinculación del evento del formulario de escolaridad (Colócalo donde manejas tus listeners)
const formEscolaridad = document.getElementById('form-escolaridad');
if (formEscolaridad) {
    formEscolaridad.addEventListener('submit', (e) => AppEscolaridad.guardar(e));
}
// Listener para procesar el envío del nuevo curso
const formCurso = document.getElementById('form-curso');
if (formCurso) {
    formCurso.addEventListener('submit', (e) => AppCursos.guardar(e));
}
// Atajo global por si necesitas exponer la función al HTML (onclick="AppCursos.abrirModal()")
window.AppCursos = AppCursos;
const formTemario = document.getElementById('form-temario');
if (formTemario) {
    formTemario.addEventListener('submit', (e) => AppUI.guardarTemario(e));
}
