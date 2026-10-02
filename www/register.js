// 1. VARIABLES GLOBALES Y ORQUESTRACIÓN DEL INICIO
let db_real = null;
window.escolaridadActivaId = null;
let temporizadorBuscador = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Inicialización secuencial limpia
        await AppDB.inicializar();
        await controlarFlujoInicial();
    } catch (e) {
        console.error("Fallo secuencial de arranque:", e);
        mostrarNotificacion("Revisa la secuencia de inicio");
    }
});

// Función auxiliar global para alertas rápidas
async function mostrarNotificacion(mensaje) {
    try {
        const { Toast } = Capacitor.Plugins;
        if (Toast) {
            await Toast.show({ text: mensaje, duration: 'short', position: 'bottom' });
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
            const estructuraTablas = `PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS estudiantes (id_cedula INTEGER PRIMARY KEY, nombre TEXT NOT NULL, apellido TEXT NOT NULL, fecha_nacimiento TEXT, genero TEXT CHECK(genero IN ('M', 'F')) NOT NULL); CREATE TABLE IF NOT EXISTS cursos (id INTEGER PRIMARY KEY AUTOINCREMENT, cursoseccion TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS escolaridades (id INTEGER PRIMARY KEY AUTOINCREMENT, escolaridad TEXT NOT NULL, profesor TEXT NOT NULL, area TEXT NOT NULL, peic TEXT NOT NULL, fecha_inicio TEXT NOT NULL, fecha_cierre TEXT NOT NULL); CREATE TABLE IF NOT EXISTS nomina (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiantes_id INTEGER, cursoseccion_id INTEGER, escolaridades_id INTEGER, condicion_acadm TEXT CHECK(condicion_acadm IN ('Regular', 'Repitiente')) DEFAULT 'Regular' NOT NULL, UNIQUE (estudiantes_id, cursoseccion_id, escolaridades_id), FOREIGN KEY (estudiantes_id) REFERENCES estudiantes(id_cedula) ON DELETE CASCADE, FOREIGN KEY (cursoseccion_id) REFERENCES cursos(id) ON DELETE CASCADE, FOREIGN KEY (escolaridades_id) REFERENCES escolaridades(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS sesiones (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT DEFAULT CURRENT_TIMESTAMP, nombre TEXT NOT NULL); CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, participantes_id INTEGER NOT NULL, sesion_id INTEGER NOT NULL, asistencia TEXT DEFAULT 'false' CHECK(asistencia IN ('false', 'true')), calificacion REAL DEFAULT 12 CHECK(calificacion >= 0 AND calificacion <= 20), tipo_evaluacion TEXT CHECK(tipo_evaluacion IN ('Sumativa', 'Formativa')), FOREIGN KEY (participantes_id) REFERENCES nomina(id) ON DELETE CASCADE, FOREIGN KEY (sesion_id) REFERENCES sesiones(id) ON DELETE CASCADE); CREATE TABLE IF NOT EXISTS criterios_evaluacion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_criterio TEXT NOT NULL, descripcion TEXT, puntos_aporte REAL NOT NULL CHECK(puntos_aporte > 0 AND puntos_aporte <= 8));`;
            // Ejecutamos toda la estructura física de golpe
            await db_real.execute({ statement: estructuraTablas });
            console.log("Las tablas están listas para trabajar");

            // Verificación defensiva de datos iniciales
            const checkCursos = await db_real.query({ statement: "SELECT COUNT(*) as total FROM cursos;" });
            
            if (checkCursos && checkCursos.values && checkCursos.values.length > 0) {
                const totalCursos = checkCursos.values[0].total || checkCursos.values[0]["COUNT(*)"] || 0;
                if (totalCursos === 0) {
                    await db_real.execute({
                        statement: "INSERT INTO cursos (cursoseccion) VALUES ('1ER AÑO A'), ('2DO AÑO B');"
                    });
                    console.log("Datos semilla de 'cursos' insertados con éxito.");
                }
            }
        } catch (error) {
            console.error("Fallo crítico en inicialización de tablas SQL:", error);
            throw error;
        }
    }
};

// =============================================================================
// [PRÓXIMO BLOQUE] 3. MÓDULO DE CONTROL DE FLUJO Y MATRÍCULA
// =============================================================================
