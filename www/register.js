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
window.escolaridadActivaId = null;
window.temarioActivoId = null;
window.lapsoActivoId = null;
window.sesionActivaId = null;
window.criterioActivoId = null;
//~ AppAulaOperaciones.inicializarSelectoresAula()


document.addEventListener('DOMContentLoaded', async () => {
    try {
        await AppDB.inicializar();
        await AppEscolaridad.controlarFlujoInicial();
        await AppCursos.inicializar();
        await AppNominas.inicializar();
        await AppLapsos.cargarLapsoVigenteInicial();
        await AppPlanificacion.cargarTemarioVigenteInicial();
        await AppPlanificacion.cargarTemariosEnDOM();
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
            }

            // Comprobar si la conexión ya existe en memoria nativa
            let estaConectado;
            try {
                estaConectado = await SQLite.isConnection({ database: this.dbName });
            } catch (e) {
                estaConectado = { result: false };
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
    },
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
            mostrarNotificacion('Bienvenido al Sistema de Apoyo Docente');
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
                await AppLapsos.cargarLapsoVigenteInicial();
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
                    <span class="curso-texto">${curso.cursoseccion}</span>
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
            await AppNominas.cargarSelectorCursos();

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
            await AppNominas.cargarSelectorCursos();

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
                statement: "SELECT id, tema_central FROM catedra ORDER BY id ASC;"
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

                // CORRECCIÓN 1: Captura segura del ID recién generado por SQLite
                const resID = await db_real.query({ statement: "SELECT last_insert_rowid() AS id;" });
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

            // CORRECCIÓN 2: Captura segura del temario asignado usando la sesión de conexión
            const resTemarioID = await db_real.query({ statement: "SELECT last_insert_rowid() AS id;" });
            window.temarioActivoId = resTemarioID.values[0].id;

            mostrarNotificacion("Contenido enlazado correctamente");
            
            // Recargar de inmediato el selector del DOM para que refleje el nuevo tema
            await this.cargarTemariosEnDOM();
            this.cerrarModal();

        } catch (error) {
            console.error("Fallo en la transacción de planificación:", error);
            alert("Error al procesar la planificación.");
        }
    },

    cargarTemarioVigenteInicial: async function() {
        try {
            const res = await db_real.query({ 
                statement: "SELECT id FROM temario ORDER BY id DESC LIMIT 1;" 
            });
        
            if (res.values && res.values.length > 0) {
                window.temarioActivoId = res.values[0].id; 
                console.log("Planificación pedagógica recuperada localmente. ID:", window.temarioActivoId);
            } else {
                window.temarioActivoId = null;
                console.log("No se encontraron registros previos en la tabla 'temario'.");
            }
        } catch (e) {
            console.error("Error al recuperar el temario inicial:", e);
        }
    },
    
    // Muestra todos los temarios en el DOM vinculando su tema generador
    cargarTemariosEnDOM: async function() {
        try {
            // CORRECCIÓN CRÍTICA 3: La tabla 'temario' usa 'tema_generador', no 'nombre'
            const sqlTemas = "SELECT id, tema_generador FROM temario ORDER BY id DESC;";
            const resultado = await db_real.query({ statement: sqlTemas });
            
            const selector = document.getElementById('selectorTemarios');
            if (!selector) return; // Validación por si el elemento no está en la vista actual
            
            if (resultado.values && resultado.values.length > 0) {
                selector.innerHTML = '<option value="">-- Seleccione un Tema --</option>';
                resultado.values.forEach(tema => {
                    // Usamos tema.tema_generador que es la columna real de tu tabla
                    selector.innerHTML += `<option value="${tema.id}">${tema.tema_generador}</option>`;
                });
            } else {
                selector.innerHTML = '<option value="">⚠️ No hay temas registrados</option>';
            }
        } catch (error) {
            console.error("Error al cargar temarios en el DOM:", error);
        }
    }
};

const AppEstudiantes = {
    // OPCIÓN 1: PROCESAMIENTO MASIVO DESDE CSV
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
    // OPCIÓN 2: ENTRADA MANUAL POR FORMULARIO
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

    // NUEVO: Busca de forma automatizada al iniciar la app si hay un lapso vigente en SQLite
    cargarLapsoVigenteInicial: async function() {
        if (!window.escolaridadActivaId) return;
        
        try {
            const hoyISO = new Date().toISOString().split('T')[0]; // Formato "YYYY-MM-DD"
            
            // Consultamos si existe un lapso que cubra la fecha actual y pertenezca al año escolar activo
            const sqlCheck = `
                SELECT id, momento FROM lapso 
                WHERE ? >= fecha_inicio AND ? <= fecha_cierre AND lapsoescolar_id = ?
                LIMIT 1;
            `;
            const resultado = await db_real.query({
                statement: sqlCheck,
                values: [hoyISO, hoyISO, parseInt(window.escolaridadActivaId)]
            });

            if (resultado.values && resultado.values.length > 0) {
                // Posición [0] corregida para inyectar la FK global
                window.lapsoActivoId = resultado.values[0].id;
                console.log(`🎯 Lapso Académico Vigente detectado automáticamente. ID FK: ${window.lapsoActivoId} (${resultado.values[0].momento})`);
            } else {
                // Fallback: Si no hay por fecha actual, tomamos el último registrado como salvavidas activo
                const sqlFallback = "SELECT id, momento FROM lapso WHERE lapsoescolar_id = ? ORDER BY id DESC LIMIT 1;";
                const resFallback = await db_real.query({ statement: sqlFallback, values: [parseInt(window.escolaridadActivaId)] });
                
                if (resFallback.values && resFallback.values.length > 0) {
                    window.lapsoActivoId = resFallback.values[0].id;
                    console.log(`⚠️ Fallback: Cargado último lapso registrado por falta de coincidencia de calendario. ID FK: ${window.lapsoActivoId}`);
                } else {
                    window.lapsoActivoId = null;
                    console.log("ℹ️ No existen lapsos académicos creados para el año escolar actual.");
                }
            }
        } catch (e) {
            console.error("Error al automatizar la carga inicial del lapso académico:", e);
        }
    },

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

    // INSERCIÓN DEL LAPSO CON ASIGNACIÓN DE FILA EN CONTENEDORES NATIVOS
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

            // CORRECCIÓN CRÍTICA: Capturar el ID autoincremental accediendo correctamente a la fila [0]
            const queryID = "SELECT id FROM lapso ORDER BY id DESC LIMIT 1;";
            const resultado = await db_real.query({ statement: queryID });

            if (resultado.values && resultado.values.length > 0) {
                // Agregamos el [0] para extraer de forma efectiva el entero asignado por SQLite
                window.lapsoActivoId = resultado.values[0].id;
                console.log(`🚀 Lapso Académico creado y sincronizado con éxito. ID FK Listo: ${window.lapsoActivoId}`);
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
    // ===== NUEVO: Leer alumnos de la BD y abrir el modal de previsualización =====
abrirModalMasivo: async function() {
    const cursoID = document.getElementById('nom_select_curso').value;
    if (!cursoID) {
        alert("Por favor, seleccione el Curso Destino antes de continuar.");
        return;
    }
    if (!window.escolaridadActivaId) {
        alert("Requiere registrar una escolaridad vigente primero.");
        return;
    }

    try {
        // Consultar estudiantes que NO estén inscritos en este año escolar y curso
        const sql = `SELECT id_cedula, nombre, apellido 
                     FROM estudiantes 
                     WHERE id_cedula NOT IN (
                        SELECT estudiantes_id FROM nomina WHERE escolaridades_id = ?
                     )
                     ORDER BY apellido ASC, nombre ASC;`;
                     
        const resultado = await db_real.query({ 
            statement: sql, 
            values: [parseInt(window.escolaridadActivaId)] 
        });

        const tablaCuerpo = document.getElementById('prev_tabla_nomina_cuerpo');
        if (!tablaCuerpo) return;

        tablaCuerpo.innerHTML = "";

        if (!resultado.values || resultado.values.length === 0) {
            alert("No hay estudiantes nuevos disponibles para asignar en la base de datos.");
            return;
        }

        // Poblar la tabla del modal de previsualización de forma dinámica
        resultado.values.forEach(alumno => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-center">
                    <input type="checkbox" class="chk-select-nomina" checked data-cedula="${alumno.id_cedula}">
                </td>
                <td><b>${alumno.id_cedula}</b></td>
                <td>${alumno.apellido}, ${alumno.nombre}</td>
                <td>Regular</td>
            `;
            tablaCuerpo.appendChild(tr);
        });

        // Mostrar el modal que ya tienes maquetado en el HTML
        document.getElementById('modalPrevisualizarNomina').style.display = 'flex';

    } catch (error) {
        console.error("Error al cargar estudiantes para asignación masiva:", error);
        alert("Error al conectar con la base de datos de estudiantes.");
    }
},

// Funciones de utilidad para cerrar y controlar el nuevo modal
cerrarModalPrevisualizacion: function() {
    document.getElementById('modalPrevisualizarNomina').style.display = 'none';
},

alternarSeleccionMatriz: function(estado) {
    const checks = document.querySelectorAll('#prev_tabla_nomina_cuerpo .chk-select-nomina');
    checks.forEach(chk => chk.checked = estado);
},
    // ===== NUEVO ENFOQUE: MATRIZ DE PREVISUALIZACIÓN TÁCTIL PARA CSV =====
    alumnosAnalizadosCache: [],
// PROCESAMIENTO MASIVAMENTE SEGURO EN SQLITE AL CONFIRMAR LA SELECCIÓN (VERSIÓN APK ROBUSTA)
    procesarInscripcionLoteMatriz: async function() {
        const cursoID = document.getElementById('nom_select_curso').value;
        
        // 1. Buscamos TODOS los checkboxes inyectados en la tabla, sin filtrar por CSS aún
        const todosLosChecks = document.querySelectorAll('#prev_tabla_nomina_cuerpo .chk-select-nomina');

        if (todosLosChecks.length === 0) {
            alert("No hay estudiantes disponibles en la lista para procesar.");
            return;
        }

        let insertados = 0;
        let duplicados = 0;
        let procesadosEnTotal = 0;

        try {
            mostrarNotificacion("Inscribiendo estudiantes seleccionados...");

            // 2. Recorremos el arreglo completo y filtramos con lógica Javascript pura (.checked)
            for (let chk of todosLosChecks) {
                if (chk.checked) {
                    procesadosEnTotal++;
                    const cedula = parseInt(chk.dataset.cedula);
                    const condicion = "Regular"; // Condición basal por lote

                    try {
                        const sqlInsert = `
                            INSERT INTO nomina (estudiantes_id, cursoseccion_id, escolaridades_id, condicion_acadm)
                            VALUES (?, ?, ?, ?);
                        `;
                        await db_real.execute({
                            statement: sqlInsert,
                            values: [cedula, parseInt(cursoID), parseInt(window.escolaridadActivaId), condicion]
                        });
                        insertados++;
                    } catch (error) {
                        // Si ya existía el alumno en esa sección, el UNIQUE frena el duplicado
                        if (error.message && error.message.includes("UNIQUE")) {
                            duplicados++;
                        } else {
                            console.error("Fallo inyectando registro individual de nómina:", error);
                        }
                    }
                }
            }

            // 3. Validación preventiva de seguridad
            if (procesadosEnTotal === 0) {
                alert("⚠️ Operación cancelada: No ha seleccionado ningún estudiante. Por favor, marque las casillas de los alumnos que desea inscribir.");
                return;
            }

            // 4. Desplegar el reporte estadístico real con números limpios
            alert(`🎯 ¡Inscripción Completada!\n\n✅ ${insertados} Estudiantes han sido agregados con éxito a la nómina de esta sección.\n⚠️ ${duplicados} Registros omitidos por inscripción previa.`);
            
            this.cerrarModalPrevisualizacion();

        } catch (err) {
            console.error("Error crítico ejecutando la transacción de nómina:", err);
            alert("Error de consistencia en SQLite. Verifique las llaves foráneas.");
        }
    },
    // OPCIÓN 2: ASIGNACIÓN INDIVIDUAL (MANUAL)
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
    // 1. CONTROL DE INTEGRIDAD: Validar Lapso Académico
    if (!window.lapsoActivoId) {
        alert("⚠️ Operación... No se ha detectado ningún Lapso Académico activo.");
        return;
    }

    // 2. CAPTURAR EL TEMARIO SELECCIONADO DESDE EL DOM
    const selector = document.getElementById('selectorTemarios');
    const temarioSeleccionadoId = selector ? selector.value : null;

    if (!temarioSeleccionadoId || temarioSeleccionadoId === "") {
        alert("⚠️ Operación Rechazada: No ha seleccionado un tema.\n\nPor favor, elija el Tema a tratar en la lista desplegable antes de iniciar la clase.");
        return;
    }

    // Asignamos la variable global con la certeza de lo que el usuario eligió en pantalla
    window.temarioActivoId = temarioSeleccionadoId;

    // 3. OBTENER FECHA NATIVA DEL SISTEMA (Formato Inteligente)
    const fechaHoy = new Date();
    const opciones = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false};
    const fechaTextoLocal = fechaHoy.toLocaleString('es-VE', opciones); 
    const nombreSesionPorDefecto = `CLASE ASISTIDA - ${fechaTextoLocal}`;

    try {
        // 4. INSERCIÓN RELACIONAL PURA EN LA TABLA 'SESIONES'
        const sqlInsert = `
            INSERT INTO sesiones (nombre, temario_id, lapso_id)
            VALUES (?, ?, ?);
        `;
        
        await db_real.execute({
            statement: sqlInsert,
            values: [nombreSesionPorDefecto, parseInt(window.temarioActivoId), parseInt(window.lapsoActivoId)]
        });

        // 5. CAPTURAR EL ID GENERADO USANDO LA FUNCIÓN NATIVA DE SQLITE (MÁXIMA SEGURIDAD)
        const queryID = `
            SELECT id, nombre, fecha 
            FROM sesiones 
            WHERE id = last_insert_rowid() AND temario_id = ?;
        `;
        
        const resultado = await db_real.query({ 
            statement: queryID,
            values: [parseInt(window.temarioActivoId)] 
        });

        if (resultado.values && resultado.values.length > 0) {
            const sesionCreada = resultado.values[0]; 
            window.sesionActivaId = sesionCreada.id;
            console.log(`Sesión de Aula iniciada con éxito. ID FK Disponible: ${window.sesionActivaId}`);
            
            // 6. ACTUALIZAR INTERFAZ EN TIEMPO REAL
            this.actualizarPantallaSesionActiva(sesionCreada.nombre);
            mostrarNotificacion("Clase inicializada correctamente");
        } else {
            throw new Error("No se pudo recuperar la sesión recién creada.");
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
        const criteriosDisponibles = document.getElementById('panelAdmin');

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
            criteriosDisponibles.style.display = "block";
            AppAulaOperaciones.inicializarSelectoresAula();
            AppAulaOperaciones.cargarHistorialSesionesCombo(); // <-- INYECTAR ESTA LÍNEA AQUÍ
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

        try {
            const sqlInsert = `
                INSERT INTO criterios_evaluacion (nombre_criterio, descripcion)
                VALUES (?, ?);
            `;
            
            await db_real.execute({
                statement: sqlInsert,
                values: [nombre, descripcion ? descripcion : null]
            });

            // Recuperar el ID asignado por el AUTOINCREMENT de SQLite
            const queryID = "SELECT id, nombre_criterio FROM criterios_evaluacion ORDER BY id DESC LIMIT 1;";
            const resultado = await db_real.query({ statement: queryID });
            if (resultado.values && resultado.values.length > 0) {
                window.criterioActivoId = resultado.values[0].id;
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

const AppAulaOperaciones = {
    criteriosSeleccionadosIds: [],

    escalaEstimacion: {
        'I':  { texto: 'I',  multiplicador: 0.0,  color: '#e0e0e0', textoColor: '#424242', clase: 'escala-iniciado' },
        'EP': { texto: 'EP', multiplicador: 0.33, color: '#ffb74d', textoColor: '#e65100', clase: 'escala-proceso' },
        'C':  { texto: 'C',  multiplicador: 0.66, color: '#81c784', textoColor: '#1b5e20', clase: 'escala-consolidado' },
        'A':  { texto: 'A',  multiplicador: 1.0,  color: '#4fc3f7', textoColor: '#01579b', clase: 'escala-avanzado' }
    },

    inicializarSelectoresAula: async function() {
        const select = document.getElementById('aula_select_curso');
        if (!select) return;
        try {
            const resultado = await db_real.query({
                statement: "SELECT * FROM cursos ORDER BY cursoseccion ASC;"
            });
            select.innerHTML = '<option value="" disabled selected>Seleccione el curso a trabajar...</option>';
            if (resultado.values && resultado.values.length > 0) {
                resultado.values.forEach(curso => {
                    const opt = document.createElement('option');
                    opt.value = curso.id;
                    opt.textContent = curso.cursoseccion;
                    select.appendChild(opt);
                });
            }
            await this.cargarCriteriosDisponiblesASeleccion();
        } catch (e) {
            console.error("Error al arrancar el panel de aula:", e);
        }
    },

    cargarCriteriosDisponiblesASeleccion: async function() {
        const contenedor = document.getElementById('contenedorCheckboxesCriterios');
        if (!contenedor) return;
        try {
            const res = await db_real.query({ statement: "SELECT * FROM criterios_evaluacion ORDER BY id ASC;" });
            contenedor.innerHTML = "";
            
            if (!res.values || res.values.length === 0) {
                contenedor.innerHTML = `<p class="alerta-texto" style="margin:0;">⚠️ No hay criterios creados en Administración. Use el botón "Configurar Criterio" primero.</p>`;
                return;
            }

            res.values.forEach(crit => {
                const label = document.createElement('label');
                label.className = 'item-check-criterio';
                label.innerHTML = `
                    <input type="checkbox" value="${crit.id}" onchange="AppAulaOperaciones.actualizarMatrizCriteriosActivos()">
                    <span><b>${crit.nombre_criterio}</b> <small>(${crit.descripcion || ''})</small></span>
                `;
                contenedor.appendChild(label);
            });
        } catch (err) {
            console.error("Error al mapear criterios evaluativos:", err);
        }
    },

    actualizarMatrizCriteriosActivos: function() {
        const checkboxes = document.querySelectorAll('#contenedorCheckboxesCriterios input[type="checkbox"]:checked');
        this.criteriosSeleccionadosIds = Array.from(checkboxes).map(chk => parseInt(chk.value));
        this.recalcularNotasEnPantalla();
    },

    cargarEstudiantesAsistencia: async function() {
        const cursoID = document.getElementById('aula_select_curso').value;
        const tablaBody = document.getElementById('listaEstudiantesAula');
        if (!tablaBody || !cursoID) return;

        try {
            const sql = `
                SELECT n.id AS nomina_id, e.id_cedula, e.nombre, e.apellido
                FROM nomina n
                INNER JOIN estudiantes e ON n.estudiantes_id = e.id_cedula
                WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ?
                ORDER BY e.apellido ASC, e.nombre ASC;
            `;
            const resultado = await db_real.query({
                statement: sql,
                values: [parseInt(cursoID), parseInt(window.escolaridadActivaId)]
            });

            tablaBody.innerHTML = "";
            if (!resultado.values || resultado.values.length === 0) {
                tablaBody.innerHTML = `<tr><td colspan="4" class="lista-vacia">Sin estudiantes en esta sección.</td></tr>`;
                return;
            }

            resultado.values.forEach(alumno => {
                const tr = document.createElement('tr');
                tr.className = 'fila-estudiante-aula';
                tr.id = `fila-alumno-${alumno.nomina_id}`;
                tr.dataset.nominaId = alumno.nomina_id;

                tr.innerHTML = `
                    <td>
                        <div class="alumno-info-celda" style="cursor: pointer;" onclick="AppAulaOperaciones.verReporteAcumuladoAlumno(${alumno.nomina_id}, '${alumno.apellido}, ${alumno.nombre}')" title="Toca para ver historial">
                            <span class="alumno-nombre-completo" style="color: #0288d1; text-decoration: underline;">${alumno.apellido}, ${alumno.nombre} 📊</span>
                            <small class="alumno-cedula-sub">C.I: ${alumno.id_cedula}</small>
                        </div>
                    </td>
                    <td class="text-center">
                        <label class="switch-asistencia">
                            <input type="checkbox" class="chk-asistencia" checked onchange="AppAulaOperaciones.alternarAsistenciaFila(this)">
                            <span class="slider-control"></span>
                        </label>
                    </td>
                    <td>
                        <div class="zona-rasgos-estudiante" id="rasgos-est-${alumno.nomina_id}" style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <!-- Controles táctiles inyectados dinámicamente -->
                        </div>
                    </td>
                    <td class="text-center font-weight-bold cell-nota-final" id="nota-final-est-${alumno.nomina_id}" style="font-size:1.2rem; color:#1b5e20;">
                        8.0
                    </td>
                `;
                tablaBody.appendChild(tr);
            });

            this.recalcularNotasEnPantalla();
        } catch (error) {
            console.error("Error al mapear nómina de clase:", error);
        }
    },

    recalcularNotasEnPantalla: function() {
        const filas = document.querySelectorAll('.fila-estudiante-aula');
        const numCriterios = this.criteriosSeleccionadosIds.length;

        filas.forEach(fila => {
            const nominaId = fila.dataset.nominaId;
            const chkAsistencia = fila.querySelector('.chk-asistencia');
            const zonaRasgos = fila.querySelector(`#rasgos-est-${nominaId}`);
            const cellNota = fila.querySelector(`#nota-final-est-${nominaId}`);

            const estadosPrevios = {};
            zonaRasgos.querySelectorAll('.btn-escala-ciclo').forEach(btn => {
                estadosPrevios[btn.dataset.critId] = btn.dataset.estadoActual;
            });

            zonaRasgos.innerHTML = "";

            if (!chkAsistencia.checked) {
                zonaRasgos.innerHTML = `<span style="color:#c62828; font-style:italic;">Inasistente - Bloqueado</span>`;
                cellNota.innerText = "1.00";
                cellNota.style.color = "#c62828";
                return;
            }

            if (numCriterios === 0) {
                zonaRasgos.innerHTML = `<small style="color:#757575;">No se han seleccionado rasgos para evaluar hoy.</small>`;
                cellNota.innerText = "8.00";
                cellNota.style.color = "#1b5e20";
                return;
            }

            this.criteriosSeleccionadosIds.forEach(critId => {
                const estadoInicial = estadosPrevios[critId] || 'I'; 
                const configEscala = this.escalaEstimacion[estadoInicial];

                const div = document.createElement('div');
                div.className = 'subitem-rasgo-escala';
                div.innerHTML = `
                    <button type="button" 
                            class="btn-escala-ciclo" 
                            data-crit-id="${critId}" 
                            data-estado-actual="${estadoInicial}"
                            style="background-color: ${configEscala.color}; color: ${configEscala.textoColor}; border: 1px solid rgba(0,0,0,0.1); padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 0.85rem; cursor: pointer; transition: all 0.2s;"
                            onclick="AppAulaOperaciones.conmutarEstadoEscalaTacto(this, ${nominaId})">
                        ${configEscala.texto}
                    </button>
                `;
                zonaRasgos.appendChild(div);
            });

            this.calcularNotaEstudiante(nominaId);
        });
    },

    // 2. LOGICA DE ROTACIÓN PARA 4 NIVELES ACTUALIZADA
    conmutarEstadoEscalaTacto: function(boton, nominaId) {
        const estadoActual = boton.dataset.estadoActual;
        let siguienteEstado = 'I';

        if (estadoActual === 'I') siguienteEstado = 'EP';
        else if (estadoActual === 'EP') siguienteEstado = 'C';
        else if (estadoActual === 'C') siguienteEstado = 'A';
        else if (estadoActual === 'A') siguienteEstado = 'I';

        boton.dataset.estadoActual = siguienteEstado;
        
        const nuevaConfig = this.escalaEstimacion[siguienteEstado];
        boton.style.backgroundColor = nuevaConfig.color;
        boton.style.color = nuevaConfig.textoColor;
        boton.innerText = nuevaConfig.texto;
        
        this.calcularNotaEstudiante(nominaId);
    },
    
    alternarAsistenciaFila: function(checkbox) {
        this.recalcularNotasEnPantalla();
    },

    calcularNotaEstudiante: function(nominaId) {
const fila = document.getElementById(`fila-alumno-${nominaId}`);
if (!fila) return;
const chkAsistencia = fila.querySelector('.chk-asistencia');
const cellNota = fila.querySelector(`#nota-final-est-${nominaId}`);
if (!chkAsistencia.checked) {
cellNota.innerText = "1.00";
cellNota.style.color = "#c62828";
return;
}
let notaAcumulada = 8.00;
const botonesEscala = fila.querySelectorAll('.zona-rasgos-estudiante .btn-escala-ciclo');
const totalCriteriosActivos = this.criteriosSeleccionadosIds.length;
if (totalCriteriosActivos > 0) {
const pesoBaseCriterio = 12.00 / totalCriteriosActivos;
botonesEscala.forEach(btn => {
const estado = btn.dataset.estadoActual;
const multiplicador = this.escalaEstimacion[estado].multiplicador;
notaAcumulada += (pesoBaseCriterio * multiplicador);
});
}
const notaFinalVal = parseFloat(notaAcumulada.toFixed(2));
cellNota.innerText = notaFinalVal.toFixed(2);
cellNota.style.color = notaFinalVal >= 9.50 ? "#1b5e20" : "#c62828";
},

inyectarAsistenciaPerfecta: function() {
const checkboxesAsistencia = document.querySelectorAll('.fila-estudiante-aula .chk-asistencia');
if (checkboxesAsistencia.length === 0) return;
checkboxesAsistencia.forEach(chk => {
chk.checked = true;
});
mostrarNotificacion("Se inyectó asistencia perfecta en la sección");
this.recalcularNotasEnPantalla();
},
// 3. ACTUALIZACIÓN DE INYECCIÓN MASIVA ('inyectarTodoEvaluado')
// Ahora marca a los estudiantes en el nivel más alto disponible: 'A' (Avanzado / 100%)
inyectarTodoEvaluado: function() {
const filas = document.querySelectorAll('.fila-estudiante-aula');
if (filas.length === 0) return;
if (this.criteriosSeleccionadosIds.length === 0) {
alert("Operación omitida: Primero debe marcar arriba al menos un 'Enfoque Atencional' para hoy.");
return;
}
filas.forEach(fila => {
const chkAsistencia = fila.querySelector('.chk-asistencia');
if (chkAsistencia && chkAsistencia.checked) {
const botonesEscala = fila.querySelectorAll('.zona-rasgos-estudiante .btn-escala-ciclo');
botonesEscala.forEach(btn => {
btn.dataset.estadoActual = 'A';
btn.style.backgroundColor = this.escalaEstimacion['A'].color;
btn.style.color = this.escalaEstimacion['A'].textoColor;
btn.innerText = this.escalaEstimacion['A'].texto;
});
this.calcularNotaEstudiante(fila.dataset.nominaId);
}
});
mostrarNotificacion("Se marcaron todos los rasgos como Avanzados (100%)");
},
reiniciarMatrizFila: function() {
const filas = document.querySelectorAll('.fila-estudiante-aula');
if (filas.length === 0) return;
const confirmar = confirm("¿Desea limpiar todas las marcas de evaluación de la grilla actual?");
if (!confirmar) return;
filas.forEach(fila => {
const chkAsistencia = fila.querySelector('.chk-asistencia');
if (chkAsistencia) chkAsistencia.checked = true;
const botonesEscala = fila.querySelectorAll('.zona-rasgos-estudiante .btn-escala-ciclo');
botonesEscala.forEach(btn => {
btn.dataset.estadoActual = 'I';
btn.style.backgroundColor = this.escalaEstimacion['I'].color;
btn.style.color = this.escalaEstimacion['I'].textoColor;
btn.innerText = this.escalaEstimacion['I'].texto;
});
this.calcularNotaEstudiante(fila.dataset.nominaId);
});
this.recalcularNotasEnPantalla();
mostrarNotificacion("Grilla restablecida a Iniciado (0%)");
},
cargarHistorialSesionesCombo: async function() {
const select = document.getElementById('historial_sesiones_combo');
if (!select) return;
try {
const sql = "SELECT id, nombre, fecha FROM sesiones ORDER BY id DESC LIMIT 15;";
const res = await db_real.query({ statement: sql });
select.innerHTML = '-- Seleccione una sesión para editar --';
if (res.values && res.values.length > 0) {
res.values.forEach(ses => {
const opt = document.createElement('option');
opt.value = ses.id;
const fechaFormat = ses.fecha ? ses.fecha.split(' ')[0] : '';
opt.textContent = `${ses.nombre} [${fechaFormat}]`;
select.appendChild(opt);
});
}
} catch (e) {
console.error("Error cargando historial de sesiones:", e);
}
},
cargarSesionPasadaParaEdicion: async function() {
const sesionId = document.getElementById('historial_sesiones_combo').value;
if (!sesionId) {
window.editandoSesionPasada = false;
document.getElementById('btnAbrirSesion').disabled = false;
document.getElementById('btnAbrirSesion').style.opacity = "1";
document.getElementById('btnAbrirSesion').innerText = "Abrir Sesión de Hoy";
document.getElementById('estadoSesionDiaria').className = "alerta-operacional estado-espera";
document.getElementById('estadoSesionDiaria').innerHTML = "• No hay ninguna sesión activa para el día de hoy.";
document.getElementById('zonaOperacionesAula').style.display = "none";
return;
}
window.sesionActivaId = parseInt(sesionId);
window.editandoSesionPasada = false;
const contenedorEstado = document.getElementById('estadoSesionDiaria');
contenedorEstado.className = "alerta-operacional";
contenedorEstado.style.backgroundColor = "#fff3e0";
contenedorEstado.style.color = "#e65100";
contenedorEstado.style.border = "1.5px solid #ffb74d";
contenedorEstado.innerHTML = `⚠️ <b>MODO CORRECCIÓN ACTIVO:</b> Editando registros de una sesión pasada.<br><small>Los cambios reemplazarán los datos guardados anteriormente.</small>`;
const btnApertura = document.getElementById('btnAbrirSesion');
if (btnApertura) {
btnApertura.disabled = true;
btnApertura.style.opacity = "0.5";
btnApertura.innerText = " Bloqueado por co-edición";
}
document.getElementById('zonaOperacionesAula').style.display = "block";
const selectCurso = document.getElementById('aula_select_curso');
if (selectCurso && selectCurso.value) {
this.cargarEstudiantesAsistencia();
}
},
guardarAsistenciaYNotasLote: async function() {
if (!window.sesionActivaId) {
alert("Operación rechazada: No hay ninguna sesión seleccionada.");
return;
}
const filas = document.querySelectorAll('.fila-estudiante-aula');
if (filas.length === 0) return;
try {
mostrarNotificacion("Sincronizando correcciones en SQLite...");
for (let fila of filas) {
const participantes_id = parseInt(fila.dataset.nominaId);
const asistencia = fila.querySelector('.chk-asistencia').checked ? 'true' : 'false';
const notaFinal = parseFloat(fila.querySelector('.cell-nota-final').innerText);
const tipo_evaluacion = this.criteriosSeleccionadosIds.length > 0 ? 'Sumativa' : 'Formativa';
let registroID = null;
const queryCheck = "SELECT id FROM registros WHERE participantes_id = ? AND sesion_id = ? LIMIT 1;";
const resCheck = await db_real.query({
statement: queryCheck,
values: [participantes_id, parseInt(window.sesionActivaId)]
});
if (resCheck.values && resCheck.values.length > 0) {
registroID = resCheck.values[0].id;
const sqlUpdateReg = `UPDATE registros  SET asistencia = ?, calificacion = ?, tipo_evaluacion = ? WHERE id = ?;`;
await db_real.execute({
statement: sqlUpdateReg,
values: [asistencia, notaFinal, tipo_evaluacion, registroID]
});
} else {
const sqlInsertReg = `INSERT INTO registros (participantes_id, sesion_id, asistencia, calificacion, tipo_evaluacion, instrumento) VALUES (?, ?, ?, ?, ?, 'Observación Sistemática Corrección');`;
await db_real.execute({
statement: sqlInsertReg,
values: [participantes_id, parseInt(window.sesionActivaId), asistencia, notaFinal, tipo_evaluacion]
});
const resNewID = await db_real.query({ statement: "SELECT id FROM registros ORDER BY id DESC LIMIT 1;" });
registroID = resNewID.values[0].id;
}
// 4. CORRECCIÓN EN EL CICLO DE GUARDADO
// Nota: Tu código original tenía un error aquí ("pesoBaseCriterio" y "multiplicador" no estaban definidos).
// He corregido la lectura para que tome dinámicamente el estado actual del botón interactivo.
if (this.criteriosSeleccionadosIds.length > 0) {
const totalCriteriosActivos = this.criteriosSeleccionadosIds.length;
const pesoCadaUno = 12.0 / totalCriteriosActivos;
const botonesEscala = fila.querySelectorAll('.zona-rasgos-estudiante .btn-escala-ciclo');
for (let btn of botonesEscala) {
const criterioId = parseInt(btn.dataset.critId);
const estado = btn.dataset.estadoActual;
const multiplicador = this.escalaEstimacion[estado].multiplicador;
const valoracionCalculada = (asistencia === 'true') ?
parseFloat((pesoCadaUno * multiplicador).toFixed(2)) : 0.00;
const sqlCalificacion = `INSERT OR REPLACE INTO calificacion (registro_id, criterio_id, valoracion) VALUES (?, ?, ?);`;
await db_real.execute({
statement: sqlCalificacion,
values: [registroID, criterioId, valoracionCalculada]
});
}
}
}
alert("🎯 ¡Base de Datos Sincronizada!\nLas calificaciones con escala de estimación y redondeo exacto se guardaron con éxito.");
this.cargarHistorialSesionesCombo();
this.cargarEstudiantesAsistencia();
} catch (error) {
console.error("Fallo crítico en la transacción de corrección:", error);
alert("Error interno de SQLite al sobreescribir las evaluaciones.");
}
},
verReporteAcumuladoAlumno: async function(nominaId, nombreCompleto) {
document.getElementById('rep_alumno_nombre').innerText = nombreCompleto;
const tablaCuerpo = document.getElementById('rep_tabla_cuerpo');
if (!tablaCuerpo) return;
try {
const sql = `SELECT s.nombre AS clase_nombre, s.fecha, r.asistencia, r.calificacion FROM registros r INNER JOIN sesiones s ON r.sesion_id = s.id WHERE r.participantes_id = ? ORDER BY s.id DESC;`;
const res = await db_real.query({
statement: sql,
values: [parseInt(nominaId)]
});
tablaCuerpo.innerHTML = "";
if (!res.values || res.values.length === 0) {
tablaCuerpo.innerHTML = `<tr><td colspan="3" class="lista-vacia">Sin evaluaciones computadas para este alumno.</td></tr>`;
document.getElementById('rep_promedio_val').innerText = "1.0";
document.getElementById('rep_promedio_val').style.color = "#c62828";
document.getElementById('rep_asistencia_val').innerText = "0 / 0";
document.getElementById('modalReporteEstudiante').style.display = 'flex';
return;
}
let sumaNotas = 0;
let totalAsistencias = 0;
let totalSesiones = res.values.length;
res.values.forEach(reg => {
const tr = document.createElement('tr');
const esAsistente = reg.asistencia === 'true';
if (esAsistente) totalAsistencias++;
const notaVal = reg.calificacion ? parseFloat(reg.calificacion) : 1.0;
sumaNotas += notaVal;
const fechaLimpia = reg.fecha ? reg.fecha.split(' ')[0] : 'N/A';
tr.innerHTML = `
    <td>${esAsistente ? 'SÍ' : 'NO'}</td>
    <td>${notaVal.toFixed(1)}</td>
`;

tablaCuerpo.appendChild(tr);
});
const promedioFinal = sumaNotas / totalSesiones;
const cellPromedio = document.getElementById('rep_promedio_val');
cellPromedio.innerText = promedioFinal.toFixed(1);
cellPromedio.style.color = promedioFinal >= 9.5 ? "#2e7d32" : "#c62828";
document.getElementById('rep_asistencia_val').innerText = `${totalAsistencias} / ${totalSesiones}`;
document.getElementById('modalReporteEstudiante').style.display = 'flex';
} catch (error) {
console.error("Error al procesar la auditoría acumulada:", error);
alert("No se pudo estructurar el reporte de calificaciones local.");
}
},
cerrarModalReporte: function() {
document.getElementById('modalReporteEstudiante').style.display = 'none';
},
    abrirReporteConsolidadoAdmin: async function() {
        const cursoID = document.getElementById('nom_select_curso').value;
        const tablaCuerpo = document.getElementById('con_tabla_cuerpo');
        if (!cursoID) {
            alert("Selección requerida: Por favor, escoja un Curso / Sección en el selector de nóminas antes de generar el consolidado.");
        return;
        }
        if (!window.escolaridadActivaId) {
        alert("Operación rechazada: No se ha detectado ninguna escolaridad vigente activa en el sistema.");
        return;
        }
        try {
            const sqlNomina = `SELECT n.id AS nomina_id, e.id_cedula, e.nombre, e.apellido, e.genero FROM nomina n INNER JOIN estudiantes e ON n.estudiantes_id = e.id_cedula WHERE n.cursoseccion_id = ? AND n.escolaridades_id = ? ORDER BY e.apellido ASC, e.nombre ASC;`;
            const resNomina = await db_real.query({
                statement: sqlNomina,
                values: [parseInt(cursoID), parseInt(window.escolaridadActivaId)]
            });
            tablaCuerpo.innerHTML = "";
            if (!resNomina.values || resNomina.values.length === 0) {
                tablaCuerpo.innerHTML = `<tr><td colspan="4" class="lista-vacia">No hay alumnos matriculados en esta sección actualmente.</td></tr>`;
                document.getElementById('stat_m_val').innerText = "0";
                document.getElementById('stat_f_val').innerText = "0";
                document.getElementById('stat_t_val').innerText = "0";
                document.getElementById('modalConsolidadoAdmin').style.display = 'flex';
                return;
            }
            let contM = 0;
            let contF = 0;
            let contT = resNomina.values.length;
            for (let alumno of resNomina.values) {
                if (alumno.genero === 'M') contM++;
                if (alumno.genero === 'F') contF++;
                const sqlNotas = "SELECT calificacion FROM registros WHERE participantes_id = ? AND calificacion IS NOT NULL;";
                const resNotas = await db_real.query({
                    statement: sqlNotas,
                    values: [alumno.nomina_id]
                });
                let promedioAcumulado = 1.0;
                if (resNotas.values && resNotas.values.length > 0) {
                    let suma = 0;
                    resNotas.values.forEach(n => suma += parseFloat(n.calificacion));
                    promedioAcumulado = suma / resNotas.values.length;
                }
                const claseGenero = alumno.genero === 'M' ? 'badge-genero-m' : 'badge-genero-f';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${alumno.apellido}, ${alumno.nombre}</td>
                    <td>${alumno.genero}</td>
                    <td>${promedioAcumulado.toFixed(1)}</td>
                    `;
                tablaCuerpo.appendChild(tr);
            }
            document.getElementById('stat_m_val').innerText = contM;
            document.getElementById('stat_f_val').innerText = contF;
            document.getElementById('stat_t_val').innerText = contT;
            document.getElementById('modalConsolidadoAdmin').style.display = 'flex';
        } catch (error) {
            console.error("Error crítico compilando el consolidado de administración:", error);
            alert("Fallo del motor SQLite al procesar el reporte de la sección.");
            }
    },
    cerrarReporteConsolidadoAdmin: function() {
        document.getElementById('modalConsolidadoAdmin').style.display = 'none';
}
};




