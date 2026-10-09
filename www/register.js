// Captura de errores global para debugging en el APK
window.onerror = function (mensaje, fuente, linea, columna, error) {
    const errorTexto = `Error en App: ${mensaje}\nLínea: ${linea} en ${fuente ? fuente.split('/').pop() : 'unknown'}`;
    console.error(errorTexto, error);
    
    if (window.Capacitor?.Plugins?.Toast) {
        window.Capacitor.Plugins.Toast.show({ text: errorTexto, duration: 'long' });
    } else {
        alert(errorTexto);
    }
    return false;
};

// 1. VARIABLES GLOBALES Y ORQUESTACIÓN DEL INICIO
let db_real = null;
// Variable global para inyectar automáticamente como FK en los siguientes registros
window.escolaridadActivaId = null;


document.addEventListener('DOMContentLoaded', async () => {
    try {
        await AppDB.inicializar();
        await AppEscolaridad.controlar();
    } catch (e) {
        alert(`Fallo en la carga inicial: ${e.message}`);
        console.error("Fallo secuencial de arranque:", e);
    }
});

// Función auxiliar global para alertas nativas en Android
async function mostrarNotificacion(mensaje) {
    try {
        const Toast = window.Capacitor?.Plugins?.Toast;
        if (Toast) {
            await Toast.show({ text: mensaje, duration: 'short', position: 'bottom' });
        } else {
            console.log("Fallback (Navegador):", mensaje);
        }
    } catch (e) {
        alert(`${e}`);
        console.error("Error al mostrar notificación:", e);
    }
}

// 2. MÓDULO DE BASE DE DATOS (Conexión y Estructura)
const AppDB = {
    dbName: "apoyo_docente_app",
    
    inicializar: async function() {
        try {
            // Mantenemos SQLite dentro del try principal para que cubra todo el flujo
            const SQLite = window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.CapacitorSQLite : null;
            
            if (!SQLite) {
                mostrarNotificacion("Persiste problema de plugin");
                throw new Error("El componente CapacitorSQLite no está inyectado en el APK.");
            }

            // Comprobación de consistencia nativa
            let consistencia;
            try {
                consistencia = await SQLite.checkConnectionsConsistency();
            } catch (e) {
                console.warn("Inconsistencia nativa detectada, procediendo a restaurar:", e);
                consistencia = { result: false };
                mostrarNotificacion("no tuvo consistencia nativa");
            }

            // Comprobar si la conexión ya existe en memoria nativa
            let estaConectado;
            try {
                estaConectado = await SQLite.isConnection({ database: this.dbName });
            } catch (e) {
                estaConectado = { result: false };
                mostrarNotificacion("no está conectada");
            }

            // Manejo dinámico del pool de conexiones nativas
            if (consistencia.result && estaConectado.result) {
                console.log("La conexión ya existía de forma consistente.");
            } else {
                if (estaConectado.result) {
                    try {
                        await SQLite.closeConnection({ database: this.dbName });
                    } catch(e) {
                        console.warn("No se pudo cerrar la conexión huérfana:", e);
                    }
                }

                // Creamos la conexión limpia
                await SQLite.createConnection({
                    database: this.dbName,
                    version: 1,
                    encrypted: false,
                    mode: "no-encryption",
                    readOnly: false
                });
            }

            // Validamos la apertura efectiva de la BD
            let verificacionFinal = await SQLite.isDBOpen({ database: this.dbName });
            if (!verificacionFinal.result) {
                await SQLite.open({ database: this.dbName });
            }

            // --- CORRECCIÓN CRÍTICA DE UBICACIÓN ---
            // Definimos el puente de abstracción AQUÍ ADENTRO, donde 'SQLite' sí existe
            db_real = {
                query: async function({ statement, values }) {
                    return await SQLite.query({ database: AppDB.dbName, statement, values: values || [] });
                },
                execute: async function({ statement, values }) {
                    if (values && values.length > 0) {
                        return await SQLite.run({ database: AppDB.dbName, statement, values });
                    }
                    return await SQLite.execute({ database: AppDB.dbName, statements: statement });
                }
            };

            mostrarNotificacion("Inicialización exitosa");
            
            // Forzar activación de claves foráneas y mandar a construir las tablas
            await db_real.execute({ statement: "PRAGMA foreign_keys = ON;" });
            await this.crearTablas();

        } catch (error) {
            alert("revisar la lógica de inicialización");
            console.error("Error crítico en inicialización de base de datos:", error);
            throw error;
        }
    }, // <-- Aquí cierra la función inicializar correctamente

    crearTablas: async function() {
        try {
            const ddl = `
            CREATE TABLE IF NOT EXISTS estudiantes (id_cedula INTEGER PRIMARY KEY, nombre TEXT NOT NULL, apellido TEXT NOT NULL, fecha_nacimiento TEXT, genero TEXT CHECK(genero IN ('M', 'F')) NOT NULL);
            CREATE TABLE IF NOT EXISTS cursos (id INTEGER PRIMARY KEY AUTOINCREMENT, cursoseccion TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS escolaridades (id INTEGER PRIMARY KEY AUTOINCREMENT, escolaridad TEXT NOT NULL, profesor TEXT NOT NULL, area TEXT NOT NULL, peic TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS lapso (id INTEGER PRIMARY KEY AUTOINCREMENT, momento TEXT NOT NULL, proyecto_aprendizaje TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL, lapsoescolar_id INTEGER, FOREIGN KEY (lapsoescolar_id) REFERENCES escolaridades (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_lapso_escolaridad_fk ON lapso (lapsoescolar_id);
            CREATE TABLE IF NOT EXISTS catedra (id INTEGER PRIMARY KEY AUTOINCREMENT, tema_central TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS temario (id INTEGER PRIMARY KEY AUTOINCREMENT, tema_generador TEXT NOT NULL, catedra_id INTEGER, FOREIGN KEY (catedra_id) REFERENCES catedra (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_temario_catedra_fk ON temario (catedra_id);
            CREATE TABLE IF NOT EXISTS sesiones (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT DEFAULT CURRENT_TIMESTAMP, nombre TEXT NOT NULL, temario_id INTEGER, lapso_id INTEGER, FOREIGN KEY (temario_id) REFERENCES temario(id) ON DELETE CASCADE, FOREIGN KEY (lapso_id) REFERENCES lapso (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_sesiones_temario_fk ON sesiones (temario_id);
            CREATE INDEX IF NOT EXISTS idx_sesiones_lapso_fk ON sesiones (lapso_id);
            CREATE TABLE IF NOT EXISTS nomina (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiantes_id INTEGER, cursoseccion_id INTEGER, escolaridades_id INTEGER, condicion_acadm TEXT CHECK(condicion_acadm IN ('Regular', 'Repitiente')) DEFAULT 'Regular' NOT NULL, UNIQUE (estudiantes_id, cursoseccion_id, escolaridades_id), FOREIGN KEY (estudiantes_id) REFERENCES estudiantes (id_cedula) ON DELETE CASCADE, FOREIGN KEY (cursoseccion_id) REFERENCES cursos (id) ON DELETE CASCADE, FOREIGN KEY (escolaridades_id) REFERENCES escolaridades (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_nomina_estudiantes_fk ON nomina (estudiantes_id);
            CREATE INDEX IF NOT EXISTS idx_nomina_cursoseccion_fk ON nomina (cursoseccion_id);
            CREATE INDEX IF NOT EXISTS idx_nomina_escolaridades_fk ON nomina (escolaridades_id);
            CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, participantes_id INTEGER NOT NULL, sesion_id INTEGER NOT NULL, asistencia TEXT DEFAULT 'true' CHECK(asistencia IN ('false', 'true')), calificacion REAL CHECK(calificacion >= 1 AND calificacion <= 20), tipo_evaluacion TEXT CHECK(tipo_evaluacion IN ('Sumativa', 'Formativa')), instrumento TEXT NOT NULL, FOREIGN KEY (participantes_id) REFERENCES nomina (id) ON DELETE CASCADE, FOREIGN KEY (sesion_id) REFERENCES sesiones (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_registros_participantes_fk ON registros (participantes_id);
            CREATE INDEX IF NOT EXISTS idx_registros_sesion_fk ON registros (sesion_id);
            CREATE TABLE IF NOT EXISTS criterios_evaluacion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_criterio TEXT NOT NULL, descripcion TEXT, puntos_aporte REAL NOT NULL CHECK(puntos_aporte > 0 AND puntos_aporte <= 20));
            CREATE TABLE IF NOT EXISTS calificacion (id INTEGER PRIMARY KEY AUTOINCREMENT, registro_id INTEGER NOT NULL, criterio_id INTEGER NOT NULL, valoracion INTEGER, UNIQUE (registro_id, criterio_id), FOREIGN KEY (registro_id) REFERENCES registros (id) ON DELETE CASCADE, FOREIGN KEY (criterio_id) REFERENCES criterios_evaluacion (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_calificacion_registro_fk ON calificacion (registro_id);
            CREATE INDEX IF NOT EXISTS idx_calificacion_criterio_fk ON calificacion (criterio_id);
            `;
            
            await db_real.execute({ statement: ddl });
            alert("Estructura de la base de datos lista");
        } catch (error) {
            console.error("Fallo al inicializar las tablas:", error);
            alert("Falla al construir base de datos");
            throw error;
        }
    }
};

/* GESTION DE ESCOLARIDAD, PLANES DE CATEDRA, NOMINAS Y CURSOS */

const AppEscolaridad = {
    
    // 1. CONTROL DE ACTUALIDAD: Valida las fechas del sistema contra SQLite
    controlarFlujoInicial: async function() {
        try {
            const hoyISO = new Date().toISOString().split('T')[0]; // Formato "YYYY-MM-DD"
            
            // Consultamos si existe alguna escolaridad cuyo rango cubra el día de hoy
            const query = `
                SELECT id FROM escolaridades 
                WHERE ? >= fecha_inicio AND ? <= fecha_cierre 
                LIMIT 1;
            `;
            
            const resultado = await db_real.query({
                statement: query,
                values: [hoyISO, hoyISO]
            });

            if (resultado.values && resultado.values.length > 0) {
                // ¡Excelente! Hay una escolaridad vigente
                window.escolaridadActivaId = resultado.values[0].id;
                console.log(`Escolaridad activa detectada e inyectada globalmente. ID: ${window.escolaridadActivaId}`);
                mostrarNotificacion("Escolaridad vigente cargada automáticamente");
            } else {
                // No hay períodos vigentes para el día de hoy (o la tabla está vacía)
                window.escolaridadActivaId = null;
                this.abrirModalObligatorio();
            }

            // Escuchar el envío del formulario una sola vez
            document.getElementById('formEscolaridad').onsubmit = async (e) => {
                e.preventDefault();
                await this.guardar();
            };

        } catch (error) {
            console.error("Error al controlar el flujo de escolaridad:", error);
        }
    },

    // 2. DISPARADORES VISUALES DEL MODAL
    abrirModalObligatorio: function() {
        document.getElementById('modalTitulo').innerText = "Configuración Obligatoria";
        document.getElementById('modalMensaje').style.display = "block";
        document.getElementById('btnCerrarModal').style.display = "none"; // No puede cerrarlo sin guardar
        document.getElementById('modalEscolaridad').style.display = "flex";
    },

    abrirParaEditar: async function() {
        // Si no hay ID activo, buscamos el último registro creado como fallback
        let idParaEditar = window.escolaridadActivaId;
        
        if (!idParaEditar) {
            const res = await db_real.query({ statement: "SELECT id FROM escolaridades ORDER BY id DESC LIMIT 1;" });
            if (res.values && res.values.length > 0) {
                idParaEditar = res.values[0].id;
            }
        }

        if (!idParaEditar) {
            this.abrirModalObligatorio();
            return;
        }

        try {
            // Buscamos los datos actuales para rellenar los inputs del formulario
            const resData = await db_real.query({
                statement: "SELECT * FROM escolaridades WHERE id = ?;",
                values: [idParaEditar]
            });

            if (resData.values && resData.values.length > 0) {
                const esc = resData.values[0];
                document.getElementById('escolaridad_id').value = esc.id;
                document.getElementById('esc_nombre').value = esc.escolaridad;
                document.getElementById('esc_profesor').value = esc.profesor;
                document.getElementById('esc_area').value = esc.area;
                document.getElementById('esc_peic').value = esc.peic;
                document.getElementById('esc_inicio').value = esc.fecha_inicio;
                document.getElementById('esc_cierre').value = esc.fecha_cierre;

                document.getElementById('modalTitulo').innerText = "Editar Escolaridad";
                document.getElementById('modalMensaje').style.display = "none";
                document.getElementById('btnCerrarModal').style.display = "inline-block"; // Permite cancelar la edición
                document.getElementById('modalEscolaridad').style.display = "flex";
            }
        } catch (error) {
            console.error("Error al cargar datos para edición:", error);
        }
    },

    cerrarModal: function() {
        document.getElementById('formEscolaridad').reset();
        document.getElementById('escolaridad_id').value = "";
        document.getElementById('modalEscolaridad').style.display = "none";
    },

    // 3. PROCESAMIENTO DE OPERACIONES (INSERT / UPDATE) EN SQLITE
    guardar: async function() {
        try {
            const id = document.getElementById('escolaridad_id').value;
            const escolaridad = document.getElementById('esc_nombre').value;
            const profesor = document.getElementById('esc_profesor').value;
            const area = document.getElementById('esc_area').value;
            const peic = document.getElementById('esc_peic').value;
            const inicio = document.getElementById('esc_inicio').value;
            const cierre = document.getElementById('esc_cierre').value;

            if (id) {
                // Operación: ACTUALIZAR REGISTRO EXISTENTE (UPDATE)
                const sqlUpdate = `UPDATE escolaridades SET escolaridad = ?, profesor = ?, area = ?, peic = ?, fecha_inicio = ?, fecha_cierre = ? WHERE id = ?;`;
                await db_real.execute({
                    statement: sqlUpdate,
                    values: [escolaridad, profesor, area, peic, inicio, cierre, parseInt(id)]
                });
                mostrarNotificacion("Escolaridad actualizada con éxito");
            } else {
                // Operación: CREAR NUEVO REGISTRO (INSERT)
                const sqlInsert = `INSERT INTO escolaridades (escolaridad, profesor, area, peic, fecha_inicio, fecha_cierre) VALUES (?, ?, ?, ?, ?, ?);`;
                await db_real.execute({
                    statement: sqlInsert,
                    values: [escolaridad, profesor, area, peic, inicio, cierre]
                });
                mostrarNotificacion("Nueva escolaridad registrada con éxito");
            }

            this.cerrarModal();
            // Re-evaluamos el estado de la App para actualizar las variables globales de FK en caliente
            await this.controlarFlujoInicial();

        } catch (error) {
            console.error("Error al guardar la escolaridad en SQLite:", error);
            alert("Error crítico al procesar la base de datos.");
        }
    }
};

