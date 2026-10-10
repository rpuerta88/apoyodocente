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
// Variable global que quedará disponible para inyectarse como FK en la tabla 'sesiones'
window.temarioActivoId = null;
// Variable global que quedará disponible para inyectarse como FK en la tabla 'sesiones'
window.lapsoActivoId = null;
// Variable global que guardará el ID de la sesión vigente para los registros de asistencia y notas
window.sesionActivaId = null;
// Variable global que guardará el ID del criterio vigente para el registro de calificaciones
window.criterioActivoId = null;


document.addEventListener('DOMContentLoaded', async () => {
    try {
        await AppDB.inicializar();
        await AppEscolaridad.controlarFlujoInicial();
        await AppCursos.inicializar();
        await AppNominas.inicializar();
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
            CREATE TABLE IF NOT EXISTS nomina (id INTEGER PRIMARY KEY AUTOINCREMENT, estudiantes_id INTEGER, cursoseccion_id INTEGER, escolaridades_id INTEGER, condicion_acadm TEXT CHECK(condicion_acadm IN ('Regular', 'Repitiente')) DEFAULT 'Regular' NOT NULL, nota_final REAL CHECK(nota_final > 0 AND nota_final <= 20), UNIQUE (estudiantes_id, cursoseccion_id, escolaridades_id), FOREIGN KEY (estudiantes_id) REFERENCES estudiantes (id_cedula) ON DELETE CASCADE, FOREIGN KEY (cursoseccion_id) REFERENCES cursos (id) ON DELETE CASCADE, FOREIGN KEY (escolaridades_id) REFERENCES escolaridades (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_nomina_estudiantes_fk ON nomina (estudiantes_id);
            CREATE INDEX IF NOT EXISTS idx_nomina_cursoseccion_fk ON nomina (cursoseccion_id);
            CREATE INDEX IF NOT EXISTS idx_nomina_escolaridades_fk ON nomina (escolaridades_id);
            CREATE TABLE IF NOT EXISTS registros (id INTEGER PRIMARY KEY AUTOINCREMENT, participantes_id INTEGER NOT NULL, sesion_id INTEGER NOT NULL, asistencia TEXT DEFAULT 'true' CHECK(asistencia IN ('false', 'true')), calificacion REAL CHECK(calificacion >= 1 AND calificacion <= 20), tipo_evaluacion TEXT CHECK(tipo_evaluacion IN ('Sumativa', 'Formativa')), instrumento TEXT NOT NULL, FOREIGN KEY (participantes_id) REFERENCES nomina (id) ON DELETE CASCADE, FOREIGN KEY (sesion_id) REFERENCES sesiones (id) ON DELETE CASCADE);
            CREATE INDEX IF NOT EXISTS idx_registros_participantes_fk ON registros (participantes_id);
            CREATE INDEX IF NOT EXISTS idx_registros_sesion_fk ON registros (sesion_id);
            CREATE TABLE IF NOT EXISTS criterios_evaluacion (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_criterio TEXT NOT NULL, descripcion TEXT);
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

/* GESTION DE NAVEGACION */
const AppNavegacion = {
    
    cambiarPantalla: function(pantallaObjetivo) {
        // 1. Obtener las vistas
        const vistaAdmin = document.getElementById('pantalla-admin');
        const vistaDocente = document.getElementById('pantalla-docente');
        
        // 2. Obtener los botones de la barra
        const btnAdmin = document.getElementById('tab-admin');
        const btnDocente = document.getElementById('tab-docente');

        if (pantallaObjetivo === 'admin') {
            // Mostrar Administración, ocultar Docente
            vistaAdmin.style.display = 'block';
            vistaDocente.style.display = 'none';
            
            // Alternar clases de estado visual activo
            btnAdmin.classList.add('activo');
            btnDocente.classList.remove('activo');
            
            mostrarNotificacion("Panel Administrativo");
        } else if (pantallaObjetivo === 'docente') {
            // Mostrar Docente, ocultar Administración
            vistaAdmin.style.display = 'none';
            vistaDocente.style.display = 'block';
            
            btnAdmin.classList.remove('activo');
            btnDocente.classList.add('activo');
            
            mostrarNotificacion("Panel de Práctica Diaria");
            
            // Aquí ejecutaremos en el futuro la recarga de los selectores diarios
            // AppDocente.actualizarSelectores();
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

const AppCursos = {
    
    inicializar: async function() {
        // Escuchar el evento de envío del formulario
        const form = document.getElementById('formCursos');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                await this.registrarCurso();
            };
        }
        // Renderizar la lista de cursos existentes
        await this.cargarListaCursos();
    },

    // 1. LEER CURSOS DESDE SQLITE Y RENDERIZAR INTERFAZ
    cargarListaCursos: async function() {
        const listaUL = document.getElementById('listaCursosActivos');
        if (!listaUL) return;

        try {
            // Consulta limpia a la tabla de cursos
            const resultado = await db_real.query({
                statement: "SELECT * FROM cursos ORDER BY cursoseccion ASC;"
            });

            listaUL.innerHTML = ""; // Limpiamos la lista visual

            if (!resultado.values || resultado.values.length === 0) {
                listaUL.innerHTML = `<li class="lista-vacia">No hay cursos registrados en el sistema.</li>`;
                return;
            }

            // Mapeamos los registros a elementos de lista interactivos
            resultado.values.forEach(curso => {
                const li = document.createElement('li');
                li.className = 'item-curso';
                li.innerHTML = `
                    <span class="curso-texto">▪️ ${curso.cursoseccion}</span>
                    <button type="button" class="btn-eliminar-item" onclick="AppCursos.eliminarCurso(${curso.id}, '${curso.cursoseccion}')" aria-label="Eliminar curso">
                        🗑️
                    </button>
                `;
                listaUL.appendChild(li);
            });

        } catch (error) {
            console.error("Error al cargar la lista de cursos desde SQLite:", error);
        }
    },

    // 2. INSERTAR NUEVO CURSO (Con validación de duplicados nativa)
    registrarCurso: async function() {
        const inputCurso = document.getElementById('curso_seccion');
        // Normalizamos a mayúsculas para mantener consistencia en la BD
        const valorCurso = inputCurso.value.trim().toUpperCase(); 

        if (!valorCurso) return;

        try {
            const sqlInsert = "INSERT INTO cursos (cursoseccion) VALUES (?);";
            await db_real.execute({
                statement: sqlInsert,
                values: [valorCurso]
            });

            mostrarNotificacion(`Curso "${valorCurso}" agregado`);
            inputCurso.value = ""; // Limpiar campo
            await this.cargarListaCursos(); // Refrescar lista en pantalla

        } catch (error) {
            // Captura el error UNIQUE de SQLite si intentan meter el mismo curso
            if (error.message && error.message.includes("UNIQUE")) {
                alert(`El curso "${valorCurso}" ya se encuentra registrado.`);
            } else {
                console.error("Error al registrar curso:", error);
                alert("No se pudo guardar el curso.");
            }
        }
    },

    // 3. ELIMINAR CURSO (Control interactivo con confirmación)
    eliminarCurso: async function(id, nombreCurso) {
        // Cuadro de diálogo nativo del dispositivo
        const confirmar = confirm(`¿Está seguro de eliminar "${nombreCurso}"?\n⚠️ Esto removerá las nóminas, asistencias y notas asociadas a esta sección.`);
        
        if (!confirmar) return;

        try {
            const sqlDelete = "DELETE FROM cursos WHERE id = ?;";
            await db_real.execute({
                statement: sqlDelete,
                values: [parseInt(id)]
            });

            mostrarNotificacion(`Curso "${nombreCurso}" eliminado`);
            await this.cargarListaCursos(); // Refrescar lista

        } catch (error) {
            console.error("Error al eliminar curso:", error);
            alert("Error al intentar eliminar el registro.");
        }
    }
};

const AppPlanificacion = {

    abrirModal: async function() {
        document.getElementById('formPlanificacion').reset();
        document.getElementById('grupo_nuevo_tema_central').style.display = 'none';
        document.getElementById('modalPlanificacion').style.display = 'flex';

        // 1. Cargar las cátedras existentes en el selector antes de mostrar el formulario
        await this.cargarSelectorCatedras();

        document.getElementById('formPlanificacion').onsubmit = async (e) => {
            e.preventDefault();
            await this.guardarPlanificacion();
        };
    },

    cerrarModal: function() {
        document.getElementById('modalPlanificacion').style.display = 'none';
    },

    // Muestra u oculta el campo de texto según la opción del selector
    evaluarSeleccionCatedra: function() {
        const select = document.getElementById('plan_select_catedra');
        const grupoNuevo = document.getElementById('grupo_nuevo_tema_central');
        const inputNuevo = document.getElementById('plan_tema_central');

        if (select.value === "NUEVO") {
            grupoNuevo.style.display = 'flex';
            inputNuevo.required = true;
        } else {
            grupoNuevo.style.display = 'none';
            inputNuevo.required = false;
        }
    },

    // Busca en SQLite los temas centrales ya registrados
    cargarSelectorCatedras: async function() {
        const select = document.getElementById('plan_select_catedra');
        if (!select) return;

        try {
            const resultado = await db_real.query({
                statement: "SELECT * FROM catedra ORDER BY id ASC;"
            });

            // Limpiar opciones viejas manteniendo las dos iniciales básicas
            select.innerHTML = `
                <option value="" disabled selected>Seleccione un tema central...</option>
                <option value="NUEVO">➕ [ Registrar Nuevo Tema Central ]</option>
            `;

            if (resultado.values && resultado.values.length > 0) {
                resultado.values.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat.id;
                    opt.textContent = cat.tema_central;
                    select.appendChild(opt);
                });
            }
        } catch (error) {
            console.error("Error al poblar selector de cátedras:", error);
        }
    },

    // Guarda aplicando la lógica relacional pura (Uno a Muchos)
    guardarPlanificacion: async function() {
        const selectCatedra = document.getElementById('plan_select_catedra').value;
        const temaGenerador = document.getElementById('plan_tema_generador').value.trim();
        let catedraID = null;

        try {
            if (selectCatedra === "NUEVO") {
                const nuevoTemaCentral = document.getElementById('plan_tema_central').value.trim();
                if (!nuevoTemaCentral) return;

                // Insertar el nuevo Tema Central
                await db_real.execute({
                    statement: "INSERT INTO catedra (tema_central) VALUES (?);",
                    values: [nuevoTemaCentral]
                });

                // Recuperar el ID asignado
                const resID = await db_real.query({ statement: "SELECT id FROM catedra ORDER BY id DESC LIMIT 1;" });
                catedraID = resID.values[0].id;
            } else {
                // Si seleccionó uno existente, tomamos su ID directamente del select
                catedraID = parseInt(selectCatedra);
            }

            // Insertar el subtema amarrado al ID definitivo (Nuevo o Viejo)
            await db_real.execute({
                statement: "INSERT INTO temario (tema_generador, catedra_id) VALUES (?, ?);",
                values: [temaGenerador, catedraID]
            });

            // Dejar el ID del temario disponible para la sesión de clases
            const resTemarioID = await db_real.query({ statement: "SELECT id FROM temario ORDER BY id DESC LIMIT 1;" });
            window.temarioActivoId = resTemarioID.values[0].id;

            mostrarNotificacion("Contenido enlazado correctamente");
            this.cerrarModal();

        } catch (error) {
            console.error("Fallo en la transacción de planificación:", error);
            alert("Error al procesar la planificación.");
        }
    }
};

const AppEstudiantes = {

    // ==========================================
    // OPCIÓN 1: PROCESAMIENTO MASIVO DESDE CSV
    // ==========================================
    importarCSV: function(inputElement) {
        const archivo = inputElement.files[0];
        if (!archivo) return;

        const lector = new FileReader();
        
        lector.onload = async (evento) => {
            const contenidoTexto = evento.target.result;
            // Dividir por líneas lógicas contemplando saltos de Windows/Linux
            const lineas = contenidoTexto.split(/\r?\n/);
            
            let registrosInsertados = 0;
            let erroresContados = 0;

            mostrarNotificacion("Procesando archivo masivo...");

            for (let i = 0; i < lineas.length; i++) {
                const linea = lineas[i].trim();
                // Omitir líneas vacías o la cabecera típica del CSV
                if (!linea || linea.toLowerCase().includes("cedula") || linea.toLowerCase().includes("nombre")) {
                    continue;
                }

                // Detectar si el delimitador es coma o punto y coma
                const delimitador = linea.includes(";") ? ";" : ",";
                const columnas = linea.split(delimitador);

                // Validamos que tenga la cantidad mínima de columnas requeridas por el Schema
                if (columnas.length >= 5) {
                    const cedula = parseInt(columnas[0].trim());
                    const nombre = columnas[1].trim().toUpperCase();
                    const apellido = columnas[2].trim().toUpperCase();
                    const fechaNac = columnas[3].trim(); // Formato esperado YYYY-MM-DD
                    const genero = columnas[4].trim().toUpperCase(); // 'M' o 'F'

                    if (isNaN(cedula) || !nombre || !apellido || (genero !== 'M' && genero !== 'F')) {
                        erroresContados++;
                        continue;
                    }

                    try {
                        // INSERT OR IGNORE evita colisiones de Cédulas duplicadas
                        const queryInsert = `
                            INSERT OR IGNORE INTO estudiantes (id_cedula, nombre, apellido, fecha_nacimiento, genero)
                            VALUES (?, ?, ?, ?, ?);
                        `;
                        await db_real.execute({
                            statement: queryInsert,
                            values: [cedula, nombre, apellido, fechaNac, genero]
                        });
                        registrosInsertados++;
                    } catch (error) {
                        console.error(`Error en línea ${i}:`, error);
                        erroresContados++;
                    }
                }
            }

            alert(`Proceso de importación finalizado:\n✅ ${registrosInsertados} Alumnos cargados correctamente.\n⚠️ ${erroresContados} Filas omitidas por inconsistencia o duplicidad.`);
            inputElement.value = ""; // Resetear el input file
        };

        lector.readAsText(archivo, "UTF-8");
    },

    // ==========================================
    // OPCIÓN 2: ENTRADA MANUAL POR FORMULARIO
    // ==========================================
    abrirModalManual: function() {
        document.getElementById('formEstudianteManual').reset();
        document.getElementById('modalEstudianteManual').style.display = 'flex';

        document.getElementById('formEstudianteManual').onsubmit = async (e) => {
            e.preventDefault();
            await this.guardarEstudianteManual();
        };
    },

    cerrarModalManual: function() {
        document.getElementById('modalEstudianteManual').style.display = 'none';
    },

    guardarEstudianteManual: async function() {
        const cedula = parseInt(document.getElementById('est_cedula').value);
        const nombre = document.getElementById('est_nombre').value.trim().toUpperCase();
        const apellido = document.getElementById('est_apellido').value.trim().toUpperCase();
        const nacimiento = document.getElementById('est_nacimiento').value;
        const genero = document.getElementById('est_genero').value;

        try {
            const queryInsert = `
                INSERT INTO estudiantes (id_cedula, nombre, apellido, fecha_nacimiento, genero)
                VALUES (?, ?, ?, ?, ?);
            `;
            await db_real.execute({
                statement: queryInsert,
                values: [cedula, nombre, apellido, nacimiento, genero]
            });

            mostrarNotificacion("Estudiante registrado");
            this.cerrarModalManual();

        } catch (error) {
            if (error.message && error.message.includes("UNIQUE")) {
                alert(`Error: Ya existe un estudiante registrado con la cédula ${cedula}.`);
            } else {
                console.error("Error al registrar estudiante:", error);
                alert("No se pudo guardar el registro del estudiante.");
            }
        }
    }
};


const AppLapsos = {

    abrirModal: function() {
        // Validación de Integridad Referencial Prematura
        if (!window.escolaridadActivaId) {
            alert("⚠️ Operación rechazada: No se ha detectado ninguna escolaridad vigente en el sistema.\n\nPor favor, configure primero el Año Escolar actual antes de aperturar un Lapso.");
            if (typeof AppEscolaridad !== 'undefined') AppEscolaridad.abrirModalObligatorio();
            return;
        }

        document.getElementById('formLapso').reset();
        document.getElementById('modalLapso').style.display = 'flex';

        document.getElementById('formLapso').onsubmit = async (e) => {
            e.preventDefault();
            await this.guardarLapso();
        };
    },

    cerrarModal: function() {
        document.getElementById('modalLapso').style.display = 'none';
    },

    // INSERCIÓN DEL LAPSO CON INYECCIÓN DE LA ESCOLARIDAD COMO FK
    guardarLapso: async function() {
        const momento = document.getElementById('lap_momento').value;
        const proyecto = document.getElementById('lap_proyecto').value.trim().toUpperCase();
        const fechaInicio = document.getElementById('lap_inicio').value;
        const fechaCierre = document.getElementById('lap_cierre').value;

        try {
            // Insertar datos inyectando la escolaridad global
            const sqlInsert = `
                INSERT INTO lapso (momento, proyecto_aprendizaje, fecha_inicio, fecha_cierre, lapsoescolar_id)
                VALUES (?, ?, ?, ?, ?);
            `;
            
            await db_real.execute({
                statement: sqlInsert,
                values: [momento, proyecto, fechaInicio, fechaCierre, parseInt(window.escolaridadActivaId)]
            });

            // Recuperar inmediatamente el ID del lapso autoincremental recién asignado por SQLite
            const queryID = "SELECT id FROM lapso ORDER BY id DESC LIMIT 1;";
            const resultado = await db_real.query({ statement: queryID });

            if (resultado.values && resultado.values.length > 0) {
                window.lapsoActivoId = resultado.values.id;
                console.log(`Lapso Académico sincronizado para sesiones. ID FK Listo: ${window.lapsoActivoId}`);
            }

            mostrarNotificacion(`${momento} activado exitosamente`);
            this.cerrarModal();

        } catch (error) {
            console.error("Error al registrar el lapso en SQLite:", error);
            alert("Fallo crítico al almacenar el período académico.");
        }
    }
};

const AppNominas = {
    
    inicializar: async function() {
        // Poblamos el selector de cursos para que el usuario elija el destino
        await this.cargarSelectorCursos();
    },

    // Llena el select con los cursos reales de SQLite
    cargarSelectorCursos: async function() {
        const select = document.getElementById('nom_select_curso');
        if (!select) return;

        try {
            const resultado = await db_real.query({
                statement: "SELECT * FROM cursos ORDER BY cursoseccion ASC;"
            });

            select.innerHTML = '<option value="" disabled selected>Seleccione el curso destino...</option>';

            if (resultado.values && resultado.values.length > 0) {
                resultado.values.forEach(curso => {
                    const opt = document.createElement('option');
                    opt.value = curso.id;
                    opt.textContent = curso.cursoseccion;
                    select.appendChild(opt);
                });
            } else {
                select.innerHTML = '<option value="" disabled>⚠️ No hay cursos registrados en Administración</option>';
            }
        } catch (e) {
            console.error("Error al cargar cursos en nómina:", e);
        }
    },

    // FUNCIÓN AUXILIAR: VALIDA SI LA CÉDULA EXISTE EN LA BASE DE DATOS
    verificarEstudianteExiste: async function(cedula) {
        const query = "SELECT id_cedula FROM estudiantes WHERE id_cedula = ? LIMIT 1;";
        const res = await db_real.query({ statement: query, values: [parseInt(cedula)] });
        return (res.values && res.values.length > 0);
    },

    // ==========================================
    // OPCIÓN 1: CARGA MASIVA DE NÓMINA (CSV)
    // ==========================================
    importarCSVNomina: function(inputElement) {
        const cursoID = document.getElementById('nom_select_curso').value;
        
        // Validaciones previas obligatorias de llaves foráneas
        if (!window.escolaridadActivaId) {
            alert("⚠️ Operación rechazada: No hay una escolaridad vigente activa.");
            inputElement.value = "";
            return;
        }
        if (!cursoID) {
            alert("⚠️ Selección requerida: Por favor, escoja un Curso/Sección en el selector antes de importar el archivo CSV.");
            inputElement.value = "";
            return;
        }

        const archivo = inputElement.files[0];
        if (!archivo) return;

        const lector = new FileReader();
        lector.onload = async (evento) => {
            const lineas = evento.target.result.split(/\r\)?\n/);
            let insertados = 0;
            let omitidosNoEncontrados = [];
            let omitidosDuplicados = 0;

            mostrarNotificacion("Validando e importando nómina...");

            for (let i = 0; i < lineas.length; i++) {
                const linea = lineas[i].trim();
                if (!linea || linea.toLowerCase().includes("cedula")) continue;

                const delimitador = linea.includes(";") ? ";" : ",";
                const columnas = linea.split(delimitador);
                
                // Formato esperado en el CSV de nómina: cedula,condicion (ej: 31000222,Regular)
                if (columnas.length >= 1) {
                    const cedula = parseInt(columnas[0].trim());
                    const condicion = (columnas[1] && columnas[1].trim()) ? columnas[1].trim() : "Regular";

                    if (isNaN(cedula)) continue;

                    // VALIDACIÓN SOLICITADA: Revisar si el alumno existe en la App
                    const existe = await this.verificarEstudianteExiste(cedula);
                    if (!existe) {
                        omitidosNoEncontrados.push(cedula);
                        continue;
                    }

                    try {
                        // El UNIQUE compuesto en el Schema evita que un alumno se inscriba dos veces en el mismo curso/año
                        const sql = `
                            INSERT INTO nomina (estudiantes_id, cursoseccion_id, escolaridades_id, condicion_acadm)
                            VALUES (?, ?, ?, ?);
                        `;
                        await db_real.execute({
                            statement: sql,
                            values: [cedula, parseInt(cursoID), parseInt(window.escolaridadActivaId), condicion]
                        });
                        insertados++;
                    } catch (error) {
                        if (error.message && error.message.includes("UNIQUE")) {
                            omitidosDuplicados++;
                        } else {
                            console.error("Error asignando en lote:", error);
                        }
                    }
                }
            }

            // Alerta de resumen detallada con las cédulas no encontradas
            let mensajeResultado = `Resumen de asignación masiva:\n✅ ${insertados} Alumnos agregados a la nómina del curso.\n`;
            if (omitidosDuplicados > 0) mensajeResultado += `⚠️ ${omitidosDuplicados} Ya pertenecían a esta nómina.\n`;
            if (omitidosNoEncontrados.length > 0) {
                mensajeResultado += `❌ REGISTRO NO ENCONTRADO: Las siguientes ${omitidosNoEncontrados.length} cédulas no existen en la base de datos de estudiantes y fueron rechazadas:\n[${omitidosNoEncontrados.join(", ")}]`;
            }
            alert(mensajeResultado);
            inputElement.value = "";
        };

        lector.readAsText(archivo, "UTF-8");
    },

    // ==========================================
    // OPCIÓN 2: ASIGNACIÓN INDIVIDUAL (MANUAL)
    // ==========================================
    abrirModalIndividual: function() {
        const cursoID = document.getElementById('nom_select_curso').value;
        if (!window.escolaridadActivaId) {
            alert("⚠️ Requiere registrar una escolaridad primero.");
            return;
        }
        if (!cursoID) {
            alert("⚠️ Por favor, seleccione el Curso Destino en el selector antes de realizar una asignación individual.");
            return;
        }

        document.getElementById('formNominaIndividual').reset();
        document.getElementById('modalNominaIndividual').style.display = 'flex';

        document.getElementById('formNominaIndividual').onsubmit = async (e) => {
            e.preventDefault();
            await this.guardarIndividual();
        };
    },

    cerrarModalIndividual: function() {
        document.getElementById('modalNominaIndividual').style.display = 'none';
    },

    guardarIndividual: async function() {
        const cursoID = document.getElementById('nom_select_curso').value;
        const cedula = document.getElementById('nom_cedula_alumno').value.trim();
        const condicion = document.getElementById('nom_condicion').value;

        // VALIDACIÓN SOLICITADA: Buscar si el alumno existe en la App
        const existe = await this.verificarEstudianteExiste(cedula);
        if (!existe) {
            alert(`❌ REGISTRO NO ENCONTRADO\n\nLa cédula ${cedula} no corresponde a ningún estudiante matriculado en el sistema. Regístrelo primero en el módulo de estudiantes.`);
            return;
        }

        try {
            const sql = `
                INSERT INTO nomina (estudiantes_id, cursoseccion_id, escolaridades_id, condicion_acadm)
                VALUES (?, ?, ?, ?);
            `;
            await db_real.execute({
                statement: sql,
                values: [parseInt(cedula), parseInt(cursoID), parseInt(window.escolaridadActivaId), condicion]
            });

            mostrarNotificacion("Estudiante integrado a la nómina");
            this.cerrarModalIndividual();

        } catch (error) {
            if (error.message && error.message.includes("UNIQUE")) {
                alert("El estudiante ya se encuentra asignado a la nómina de este curso.");
            } else {
                console.error("Error al crear nómina individual:", error);
                alert("No se pudo completar la asignación.");
            }
        }
    }
};

const AppClasesDiarias = {

    // APERTURA RÁPIDA DE LA CLASE DEL DÍA Consumiendo FKs en segundo plano
    abrirSesionHoy: async function() {
        // 1. CONTROL DE INTEGRIDAD: Validar que existan las planificaciones administrativas previas
        if (!window.lapsoActivoId) {
            alert("⚠️ Operación Rechazada: No se ha detectado ningún Lapso Académico activo.\n\nPor favor, diríjase al Panel de Administración y configure el Lapso vigente antes de abrir una clase.");
            return;
        }

        if (!window.temarioActivoId) {
            alert("⚠️ Operación Rechazada: Falta la Planificación Pedagógica.\n\nPor favor, registre el Tema Central y el Tema Generador en el Panel de Administración antes de iniciar la clase.");
            return;
        }

        // 2. OBTENER FECHA NATIVA DEL SISTEMA (Formato Inteligente)
        const fechaHoy = new Date();
        const opciones = { year: 'numeric', month: '2-digit', day: '2-digit' };
        // Formato limpio legible para el docente: DD/MM/YYYY o según el locale
        const fechaTextoLocal = fechaHoy.toLocaleDateString('es-VE', opciones); 
        
        // Formato estándar para el nombre de la sesión por defecto
        const nombreSesionPorDefecto = `CLASE ASISTIDA - ${fechaTextoLocal}`;

        try {
            // 3. INSERCIÓN RELACIONAL PURA EN LA TABLA 'SESIONES'
            const sqlInsert = `
                INSERT INTO sesiones (nombre, temario_id, lapso_id)
                VALUES (?, ?, ?);
            `;
            
            await db_real.execute({
                statement: sqlInsert,
                values: [nombreSesionPorDefecto, parseInt(window.temarioActivoId), parseInt(window.lapsoActivoId)]
            });

            // 4. CAPTURAR EL ID AUTOINCREMENTAL GENERADO POR SQLITE
            const queryID = "SELECT id, nombre, fecha FROM sesiones ORDER BY id DESC LIMIT 1;";
            const resultado = await db_real.query({ statement: queryID });

            if (resultado.values && resultado.values.length > 0) {
                const sesionCreada = resultado.values;
                window.sesionActivaId = sesionCreada.id;
                console.log(`Sesión de Aula iniciada con éxito. ID FK Disponible: ${window.sesionActivaId}`);
                
                // 5. ACTUALIZAR INTERFAZ EN TIEMPO REAL
                this.actualizarPantallaSesionActiva(sesionCreada.nombre);
                mostrarNotificacion("Clase inicializada correctamente");
            }

        } catch (error) {
            console.error("Error crítico al aperturar la sesión en SQLite:", error);
            alert("Fallo del sistema al intentar abrir la sesión de clases.");
        }
    },

    // Modifica los componentes visuales para reflejar el estado operativo
    actualizarPantallaSesionActiva: function(nombreClase) {
        const contenedorEstado = document.getElementById('estadoSesionDiaria');
        const botonApertura = document.getElementById('btnAbrirSesion');
        const zonaTrabajo = document.getElementById('zonaOperacionesAula');

        if (contenedorEstado) {
            contenedorEstado.className = "alerta-operacional estado-activa";
            contenedorEstado.innerHTML = `🟢 <b>Sesión Activa:</b> ${nombreClase}<br><small>Claves de relación inyectadas en segundo plano con éxito.</small>`;
        }

        if (botonApertura) {
            botonApertura.disabled = true;
            botonApertura.style.opacity = "0.5";
            botonApertura.innerText = "🔒 Clase de Hoy en Curso";
        }

        if (zonaTrabajo) {
            zonaTrabajo.style.display = "block";
        }
    }
};

const AppCriterios = {

    abrirModal: function() {
        // Inicializar el formulario limpio en cada apertura táctil
        document.getElementById('formCriterio').reset();
        document.getElementById('modalCriterio').style.display = 'flex';

        // Escuchar el envío de datos de forma segura
        document.getElementById('formCriterio').onsubmit = async (e) => {
            e.preventDefault();
            await this.guardarCriterio();
        };
    },

    cerrarModal: function() {
        document.getElementById('modalCriterio').style.display = 'none';
    },

    // INSERCIÓN DEL CRITERIO EN SQLITE
    guardarCriterio: async function() {
        const nombre = document.getElementById('crit_nombre').value.trim().toUpperCase();
        const descripcion = document.getElementById('crit_descripcion').value.trim();

        // Validación preventiva antes de tocar la base de datos
        if (isNaN(puntos) || puntos <= 0 || puntos > 20) {
            alert("⚠️ El puntaje debe ser un valor numérico mayor a 0 y menor o igual a 20 puntos.");
            return;
        }

        try {
            const sqlInsert = `
                INSERT INTO criterios_evaluacion (nombre_criterio, descripcion)
                VALUES (?, ?);
            `;
            
            await db_real.execute({
                statement: sqlInsert,
                values: [nombre, descripcion ? descripcion : null, puntos]
            });

            // Recuperar el ID asignado por el AUTOINCREMENT de SQLite
            const queryID = "SELECT id, nombre_criterio FROM criterios_evaluacion ORDER BY id DESC LIMIT 1;";
            const resultado = await db_real.query({ statement: queryID });

            if (resultado.values && resultado.values.length > 0) {
                window.criterioActivoId = resultado.values.id;
                console.log(`Criterio de evaluación indexado. ID FK Listo: ${window.criterioActivoId}`);
                mostrarNotificacion(`Criterio "${resultado.values.nombre_criterio}" registrado`);
            }

            this.cerrarModal();

        } catch (error) {
            console.error("Error crítico al almacenar el criterio de evaluación:", error);
            alert("Fallo del sistema al intentar guardar el criterio didáctico.");
        }
    }
};
