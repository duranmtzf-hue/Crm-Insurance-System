const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bodyParser = require('body-parser');
const path = require('path');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const db = require('./db'); // Database abstraction layer

const app = express();
const PORT = process.env.PORT || 3000;

// Transporter de correo (Gmail con contraseña de aplicación)
let mailTransporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    console.log('📧 Configurando Nodemailer con Gmail...');
    console.log('📧 GMAIL_USER:', process.env.GMAIL_USER);
    console.log('📧 GMAIL_PASS:', process.env.GMAIL_PASS ? `Configurado (${process.env.GMAIL_PASS.length} caracteres)` : 'NO CONFIGURADO');
    
    mailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        },
        // Configuración para evitar timeouts en Render
        connectionTimeout: 10000, // 10 segundos
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
    
    // Verificar conexión (con timeout y sin bloquear)
    // Hacer la verificación de forma asíncrona y no bloqueante
    setTimeout(() => {
        mailTransporter.verify(function (error, success) {
            if (error) {
                // No mostrar error crítico si es timeout - puede ser problema de red de Render
                if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
                    console.warn('⚠️ No se pudo verificar conexión de email (timeout/red). Los emails se intentarán enviar cuando sea necesario.');
                    console.warn('⚠️ Esto es común en Render debido a restricciones de red. La aplicación funcionará normalmente.');
                } else {
                    console.warn('⚠️ Error verificando configuración de email:', error.message);
                    console.warn('⚠️ Los emails se intentarán enviar cuando sea necesario.');
                }
            } else {
                console.log('✅ Servidor de correo configurado correctamente');
            }
        });
    }, 3000); // Esperar 3 segundos después del inicio para no bloquear
} else {
    console.warn('⚠️ GMAIL_USER o GMAIL_PASS no configurados - emails no se enviarán');
    console.warn('⚠️ Configure las variables de entorno para habilitar envío de correos');
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configurar multer para subida de archivos
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB máximo
    },
    fileFilter: function (req, file, cb) {
        // Permitir imágenes, PDFs y documentos comunes
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|txt/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido. Solo se permiten imágenes, PDFs y documentos comunes.'));
        }
    }
});

// Serve static files (HTML, CSS, JS, images) - must be before routes
// Serve all static files from root directory
app.use(express.static(__dirname));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));
// PWA files
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
// Usar PostgreSQL para almacenar sesiones en producción, MemoryStore en desarrollo
let sessionStore = null;
if (process.env.DATABASE_URL) {
    // PostgreSQL en producción (Render)
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
            rejectUnauthorized: false
        }
    });
    try {
        sessionStore = new pgSession({
            pool: pool,
            tableName: 'session', // nombre de la tabla
            createTableIfMissing: true // Dejar que connect-pg-simple cree la tabla automáticamente
        });
    } catch (err) {
        console.error('Error configurando store de sesiones:', err);
        sessionStore = null; // Fallback a MemoryStore si hay error
    }
    console.log('✅ Sesiones configuradas con PostgreSQL');
} else {
    // SQLite en desarrollo - usar MemoryStore (solo para desarrollo)
    console.log('⚠️ Usando MemoryStore para sesiones (solo desarrollo)');
}

app.use(session({
    store: sessionStore || undefined, // undefined = MemoryStore (solo desarrollo)
    secret: process.env.SESSION_SECRET || 'crm-insurance-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // false para permitir HTTP (Render puede usar HTTP internamente)
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax' // Mejor compatibilidad
    }
}));

// Database is initialized in db.js
// Initialize database tables after a short delay to ensure connection is ready
setTimeout(() => {
    initializeDatabase();
}, 1000);

// Initialize database tables
function initializeDatabase() {
    // Session table for PostgreSQL
    // connect-pg-simple creará la tabla automáticamente con createTableIfMissing: true
    // No necesitamos crearla manualmente
    
    // Users table
    db.runConverted(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nombre TEXT,
        empresa TEXT,
        role TEXT DEFAULT 'admin', -- 'admin' or 'operador'
        rfc TEXT, -- RFC para facturación
        regimen_fiscal TEXT, -- Régimen fiscal
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Add role column if it doesn't exist (for existing databases)
    db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin'`, (err) => {
        // Ignore error if column already exists
    });
    
    // Add RFC and regimen_fiscal columns if they don't exist
    db.run(`ALTER TABLE users ADD COLUMN rfc TEXT`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE users ADD COLUMN regimen_fiscal TEXT`, (err) => {
        // Ignore error if column already exists
    });

    // Vehicles table
    db.runConverted(`CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        numero_vehiculo TEXT NOT NULL,
        marca TEXT,
        modelo TEXT,
        año INTEGER,
        placas TEXT,
        kilometraje_actual INTEGER DEFAULT 0,
        estado TEXT DEFAULT 'Activo',
        operador_id INTEGER,
        descripcion TEXT,
        numero_serie TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    
    // Add new columns to vehicles table if they don't exist (for existing databases)
    const vehicleTextColumns = [
        'descripcion', 'numero_serie'
    ];
    
    vehicleTextColumns.forEach(column => {
        db.run(`ALTER TABLE vehicles ADD COLUMN ${column} TEXT`, (err) => {
            // Ignore error if column already exists
        });
    });
    

    // Fuel records table
    db.run(`CREATE TABLE IF NOT EXISTS fuel_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        fecha DATE NOT NULL,
        litros REAL NOT NULL,
        precio_litro REAL,
        costo_total REAL,
        kilometraje INTEGER,
        estacion TEXT,
        ticket_gasolina TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);
    
    // Add ticket_gasolina column if it doesn't exist
    db.run(`ALTER TABLE fuel_records ADD COLUMN ticket_gasolina TEXT`, (err) => {
        // Ignore error if column already exists
    });
    
    // Tires table for tire management
    db.runConverted(`CREATE TABLE IF NOT EXISTS tires (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        posicion TEXT NOT NULL,
        marca TEXT,
        modelo TEXT,
        medida TEXT,
        numero_serie TEXT,
        presion_psi REAL,
        profundidad_mm REAL,
        fecha_instalacion DATE,
        kilometraje_instalacion INTEGER,
        fecha_rotacion DATE,
        kilometraje_rotacion INTEGER,
        costo REAL,
        estado TEXT DEFAULT 'Activo',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);
    
    // Asegurar que las columnas existan (para bases de datos existentes)
    db.run(`ALTER TABLE tires ADD COLUMN kilometraje_rotacion INTEGER`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE tires ADD COLUMN fecha_rotacion DATE`, (err) => {
        // Ignore error if column already exists
    });

    // Tire monthly reviews table
    db.runConverted(`CREATE TABLE IF NOT EXISTS tire_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tire_id INTEGER NOT NULL,
        fecha_revision DATE NOT NULL,
        presion_psi REAL,
        profundidad_mm REAL,
        kilometraje INTEGER,
        observaciones TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tire_id) REFERENCES tires(id)
    )`);

    // Maintenance records table
    db.run(`CREATE TABLE IF NOT EXISTS maintenance_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        fecha DATE NOT NULL,
        kilometraje INTEGER,
        descripcion TEXT,
        costo REAL,
        taller TEXT,
        proximo_mantenimiento_km INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);

    // Insurance policies table
    db.run(`CREATE TABLE IF NOT EXISTS insurance_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        numero_poliza TEXT NOT NULL,
        compania TEXT,
        fecha_inicio DATE,
        fecha_vencimiento DATE,
        tipo_cobertura TEXT,
        costo_anual REAL,
        estado TEXT DEFAULT 'Vigente',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);

    // Operators table
    db.run(`CREATE TABLE IF NOT EXISTS operators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        licencia TEXT,
        fecha_vencimiento_licencia DATE,
        telefono TEXT,
        email TEXT,
        estado TEXT DEFAULT 'Activo',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Accidents/Claims table (Siniestros)
    db.run(`CREATE TABLE IF NOT EXISTS siniestros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        policy_id INTEGER,
        fecha_siniestro DATE NOT NULL,
        tipo_siniestro TEXT,
        descripcion TEXT,
        monto_dano REAL,
        estado TEXT DEFAULT 'En Proceso',
        numero_referencia TEXT,
        compania_seguro TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
        FOREIGN KEY (policy_id) REFERENCES insurance_policies(id)
    )`);

    // Fines table (Multas)
    db.runConverted(`CREATE TABLE IF NOT EXISTS fines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        fecha DATE NOT NULL,
        tipo TEXT,
        motivo TEXT NOT NULL,
        monto REAL NOT NULL,
        estado TEXT DEFAULT 'Pendiente',
        lugar TEXT,
        numero_boleta TEXT,
        fecha_vencimiento DATE,
        observaciones TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);

    // --- Facturación: órdenes de servicio y facturas ---

    // Service orders (ligadas a vehículos, mantenimientos, siniestros, etc.)
    db.run(`CREATE TABLE IF NOT EXISTS service_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        policy_id INTEGER,
        claim_id INTEGER,
        tipo TEXT, -- Mantenimiento, Reparación, Sinestro, Otro
        descripcion TEXT,
        fecha DATE NOT NULL,
        estado TEXT DEFAULT 'Abierta', -- Abierta, En Proceso, Cerrada, Cancelada
        total REAL,
        moneda TEXT DEFAULT 'MXN',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
        FOREIGN KEY (policy_id) REFERENCES insurance_policies(id),
        FOREIGN KEY (claim_id) REFERENCES siniestros(id)
    )`);

    // Invoices (facturas) ligadas a órdenes de servicio
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        service_order_id INTEGER,
        folio TEXT,
        serie TEXT,
        fecha DATE NOT NULL,
        cliente_nombre TEXT,
        cliente_rfc TEXT,
        subtotal REAL,
        impuestos REAL,
        total REAL,
        moneda TEXT DEFAULT 'MXN',
        estado TEXT DEFAULT 'Borrador', -- Borrador, Emitida, Cancelada
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (service_order_id) REFERENCES service_orders(id)
    )`);

    // Carta Porte (documento de transporte) - Campos completos según SAT
    db.run(`CREATE TABLE IF NOT EXISTS carta_porte (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        folio TEXT,
        fecha DATE NOT NULL,
        hora_salida TIME,
        fecha_llegada DATE,
        hora_llegada TIME,
        origen TEXT,
        origen_cp TEXT,
        origen_estado TEXT,
        origen_municipio TEXT,
        destino TEXT,
        destino_cp TEXT,
        destino_estado TEXT,
        destino_municipio TEXT,
        distancia_km REAL,
        tipo_transporte TEXT DEFAULT 'Terrestre', -- Terrestre, Aéreo, Marítimo, Fluvial
        tipo_servicio TEXT, -- Transporte de carga, Pasajeros, etc.
        numero_guia TEXT,
        mercancia TEXT,
        cantidad REAL,
        unidad_medida TEXT DEFAULT 'kg',
        peso REAL,
        peso_bruto REAL,
        volumen REAL,
        valor_declarado REAL,
        moneda TEXT DEFAULT 'MXN',
        -- Datos del Transportista
        transportista_nombre TEXT,
        transportista_rfc TEXT,
        transportista_regimen TEXT,
        -- Datos del Remitente
        remitente_nombre TEXT,
        remitente_rfc TEXT,
        remitente_domicilio TEXT,
        remitente_cp TEXT,
        remitente_estado TEXT,
        remitente_municipio TEXT,
        -- Datos del Destinatario
        destinatario_nombre TEXT,
        destinatario_rfc TEXT,
        destinatario_domicilio TEXT,
        destinatario_cp TEXT,
        destinatario_estado TEXT,
        destinatario_municipio TEXT,
        -- Datos del Operador
        operador_nombre TEXT,
        operador_licencia TEXT,
        operador_rfc TEXT,
        -- Datos del Vehículo
        placas TEXT,
        numero_economico TEXT,
        seguro_poliza TEXT,
        seguro_aseguradora TEXT,
        -- Estado y observaciones
        estado TEXT DEFAULT 'Borrador', -- Borrador, Emitida, Cancelada
        observaciones TEXT,
        -- Datos del CFDI generado
        cfdi_uuid TEXT, -- UUID del CFDI timbrado
        cfdi_xml TEXT, -- XML del CFDI
        cfdi_pdf_path TEXT, -- Ruta del PDF generado
        cfdi_fecha_timbrado DATETIME, -- Fecha de timbrado
        cfdi_qr_code TEXT, -- Código QR del CFDI
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);
    
    // Agregar columnas para CFDI si no existen
    const cfdiColumns = ['cfdi_uuid', 'cfdi_xml', 'cfdi_pdf_path', 'cfdi_fecha_timbrado', 'cfdi_qr_code', 'cfdi_id'];
    cfdiColumns.forEach(column => {
        db.run(`ALTER TABLE carta_porte ADD COLUMN ${column} TEXT`, (err) => {
            // Ignore error if column already exists
        });
    });
    
    // Agregar nuevas columnas si no existen (para bases de datos existentes)
    const cartaPorteNewColumns = [
        'hora_salida', 'fecha_llegada', 'hora_llegada',
        'origen_cp', 'origen_estado', 'origen_municipio',
        'destino_cp', 'destino_estado', 'destino_municipio',
        'distancia_km', 'tipo_transporte', 'tipo_servicio', 'numero_guia',
        'cantidad', 'unidad_medida', 'peso_bruto', 'volumen', 'moneda',
        'transportista_nombre', 'transportista_rfc', 'transportista_regimen',
        'remitente_nombre', 'remitente_rfc', 'remitente_domicilio', 'remitente_cp', 'remitente_estado', 'remitente_municipio',
        'destinatario_nombre', 'destinatario_rfc', 'destinatario_domicilio', 'destinatario_cp', 'destinatario_estado', 'destinatario_municipio',
        'operador_nombre', 'operador_licencia', 'operador_rfc',
        'placas', 'numero_economico', 'seguro_poliza', 'seguro_aseguradora'
    ];
    
    cartaPorteNewColumns.forEach(column => {
        db.run(`ALTER TABLE carta_porte ADD COLUMN ${column} TEXT`, (err) => {
            // Ignore error if column already exists
        });
        // Para columnas numéricas
        if (['distancia_km', 'cantidad', 'peso_bruto', 'volumen'].includes(column)) {
            db.run(`ALTER TABLE carta_porte ADD COLUMN ${column} REAL`, (err) => {
                // Ignore error if column already exists
            });
        }
    });

    // Route tracking (seguimiento de rutas para operadores)
    db.run(`CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        fecha_inicio DATE NOT NULL,
        hora_inicio TIME NOT NULL,
        fecha_fin DATE,
        hora_fin TIME,
        origen TEXT,
        destino TEXT,
        kilometraje_inicio INTEGER,
        kilometraje_fin INTEGER,
        estado TEXT DEFAULT 'En Curso', -- 'En Curso', 'Finalizada', 'Cancelada'
        observaciones TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);

    // --- Notificaciones automáticas (cola simple en BD) ---
    db.run(`CREATE TABLE IF NOT EXISTS notifications_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        channel TEXT, -- email, whatsapp, sms
        tipo TEXT, -- alerta_poliza, alerta_mantenimiento, alerta_licencia, alerta_factura
        destino TEXT, -- correo o teléfono
        asunto TEXT,
        mensaje TEXT,
        scheduled_at DATETIME,
        sent_at DATETIME,
        status TEXT DEFAULT 'pending', -- pending, sent, failed
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // --- CRM Comercial: clientes, contactos, oportunidades y actividades ---

    // Clients (empresas o personas aseguradas)
    db.run(`CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        empresa TEXT,
        tipo TEXT, -- Cliente, Prospecto, Asegurado, Flotilla, Broker
        email TEXT,
        telefono TEXT,
        fuente TEXT, -- Referido, Web, Llamada, Otro
        estado TEXT DEFAULT 'Activo',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Contacts vinculados a un cliente
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        nombre TEXT NOT NULL,
        puesto TEXT,
        email TEXT,
        telefono TEXT,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    // Oportunidades / negocios en pipeline
    db.run(`CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        client_id INTEGER,
        nombre TEXT NOT NULL,
        etapa TEXT DEFAULT 'Prospecto', -- Prospecto, Propuesta, Negociación, Cerrado Ganado, Cerrado Perdido
        monto REAL,
        moneda TEXT DEFAULT 'MXN',
        probabilidad INTEGER, -- 0-100
        fecha_cierre_esperada DATE,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (client_id) REFERENCES clients(id)
    )`);

    // Actividades / tareas y recordatorios
    db.run(`CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        client_id INTEGER,
        opportunity_id INTEGER,
        tipo TEXT, -- Llamada, Reunión, Email, Tarea
        titulo TEXT NOT NULL,
        descripcion TEXT,
        fecha DATETIME,
        recordatorio_at DATETIME,
        estado TEXT DEFAULT 'Pendiente', -- Pendiente, Completada, Cancelada
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (client_id) REFERENCES clients(id),
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id)
    )`);

    // --- Adjuntos (archivos) ---
    db.runConverted(`CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL, -- vehicle, client, policy, claim, maintenance, service_order, invoice
        entity_id INTEGER NOT NULL, -- ID del vehículo, cliente, póliza, etc.
        nombre_archivo TEXT NOT NULL,
        nombre_original TEXT NOT NULL,
        tipo_mime TEXT,
        tamano INTEGER, -- en bytes
        ruta_archivo TEXT NOT NULL,
        descripcion TEXT,
        categoria TEXT, -- foto_siniestro, póliza_pdf, documento_vehiculo, factura, otro
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // --- Historial de actividades detallado ---
    db.run(`CREATE TABLE IF NOT EXISTS activity_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        entity_type TEXT NOT NULL, -- vehicle, client, policy, claim, maintenance, etc.
        entity_id INTEGER NOT NULL,
        accion TEXT NOT NULL, -- created, updated, deleted, attachment_added, etc.
        descripcion TEXT,
        datos_anteriores TEXT, -- JSON con datos anteriores (opcional)
        datos_nuevos TEXT, -- JSON con datos nuevos (opcional)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // --- Rastreo de ubicación GPS ---
    db.runConverted(`CREATE TABLE IF NOT EXISTS location_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        vehicle_id INTEGER,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy REAL,
        altitude REAL,
        heading REAL,
        speed REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        device_info TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )`);

    // Create default admin user if not exists
    // Usar un pequeño delay para asegurar que todas las tablas estén creadas
    setTimeout(() => {
        const defaultPassword = bcrypt.hashSync('admin123', 10);
        // INSERT compatible con SQLite y PostgreSQL
        const insertSQL = db.type === 'postgresql'
            ? `INSERT INTO users (username, email, password, nombre, empresa) 
               VALUES ('admin', 'admin@crm-insurance.com', $1, 'Administrador', 'CRM Insurance System') 
               ON CONFLICT (username) DO NOTHING`
            : `INSERT OR IGNORE INTO users (username, email, password, nombre, empresa) 
               VALUES ('admin', 'admin@crm-insurance.com', ?, 'Administrador', 'CRM Insurance System')`;
        db.run(insertSQL, [defaultPassword], (err, result) => {
            if (err) {
                console.log('Admin user already exists or error:', err.message);
                // Si hay error, intentar verificar si la tabla existe
                db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
                    if (err || !row) {
                        console.error('ERROR CRÍTICO: La tabla users no existe. Reintentando creación...');
                        // Recrear la tabla users
                        db.run(`CREATE TABLE IF NOT EXISTS users (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            username TEXT UNIQUE NOT NULL,
                            email TEXT UNIQUE NOT NULL,
                            password TEXT NOT NULL,
                            nombre TEXT,
                            empresa TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )`, (err) => {
                            if (!err) {
                                // Intentar crear admin nuevamente
                                db.run(`INSERT OR IGNORE INTO users (username, email, password, nombre, empresa) 
                                        VALUES ('admin', 'admin@crm-insurance.com', ?, 'Administrador', 'CRM Insurance System')`, 
                                        [defaultPassword], (err) => {
                                    if (!err && result && result.changes > 0) {
                                        console.log('Default admin user created (username: admin, password: admin123)');
                                    } else if (!err) {
                                        console.log('Admin user already exists');
                                    }
                                });
                            }
                        });
                    }
                });
            } else {
                if (result && result.changes > 0) {
                    console.log('Default admin user created (username: admin, password: admin123)');
                    // Create sample data for testing alerts
                    createSampleData();
                } else {
                    console.log('Admin user already exists');
                }
            }
        });
        
        // Check if admin exists and create sample data if needed
        db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, user) => {
            if (!err && user) {
                // Check if sample data already exists
                db.get('SELECT COUNT(*) as count FROM vehicles WHERE user_id = ?', [user.id], (err, result) => {
                    if (!err && result && result.count === 0) {
                        createSampleData();
                    }
                });
            }
        });
    }, 500); // Esperar 500ms para asegurar que todas las tablas estén creadas
}

// Create sample data for testing alerts
function createSampleData() {
    db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, user) => {
        if (err || !user) return;
        
        const userId = user.id;
        const today = new Date();
        
        // Check if vehicle already exists
        db.get('SELECT id FROM vehicles WHERE user_id = ? AND numero_vehiculo = ?', [userId, 'VH-001'], (err, existingVehicle) => {
            let vehicleId;
            
            if (existingVehicle) {
                vehicleId = existingVehicle.id;
                console.log('Using existing vehicle ID:', vehicleId);
            } else {
                // Create sample vehicle
                db.run(`INSERT INTO vehicles (user_id, numero_vehiculo, marca, modelo, año, placas, kilometraje_actual, estado) 
                        VALUES (?, 'VH-001', 'Toyota', 'Hilux', 2020, 'ABC-123', 45000, 'Activo')`, 
                        [userId], (err, result) => {
                    if (err) {
                        console.log('Error creating sample vehicle:', err.message);
                        return;
                    }
                    
                    vehicleId = result?.lastID;
                    console.log('Created vehicle with ID:', vehicleId);
                    if (vehicleId) {
                        createSampleAlerts(userId, vehicleId);
                    }
                });
                return;
            }
            
            createSampleAlerts(userId, vehicleId);
        });
    });
}

// Create sample alerts data
function createSampleAlerts(userId, vehicleId) {
    const today = new Date();
            
    // Delete existing sample policies first
    db.run('DELETE FROM insurance_policies WHERE numero_poliza IN (?, ?)', ['POL-001', 'POL-002'], () => {
        // Create insurance policy expiring in 5 days (danger alert)
        const expiringDate = new Date(today);
        expiringDate.setDate(today.getDate() + 5);
        db.run(`INSERT INTO insurance_policies 
                (vehicle_id, numero_poliza, compania, fecha_inicio, fecha_vencimiento, tipo_cobertura, costo_anual, estado) 
                VALUES (?, 'POL-001', 'Seguros ABC', date('now', '-365 days'), ?, 'Completa', 15000, 'Vigente')`, 
                [vehicleId, expiringDate.toISOString().split('T')[0]], (err) => {
            if (err) {
                console.log('Error creating sample policy:', err.message);
            } else {
                console.log('Created policy expiring in 5 days');
            }
        });
        
        // Create insurance policy expiring in 12 days (warning alert)
        const warningDate = new Date(today);
        warningDate.setDate(today.getDate() + 12);
        db.run(`INSERT INTO insurance_policies 
                (vehicle_id, numero_poliza, compania, fecha_inicio, fecha_vencimiento, tipo_cobertura, costo_anual, estado) 
                VALUES (?, 'POL-002', 'Seguros XYZ', date('now', '-365 days'), ?, 'Básica', 12000, 'Vigente')`, 
                [vehicleId, warningDate.toISOString().split('T')[0]], (err) => {
            if (err) {
                console.log('Error creating sample policy:', err.message);
            } else {
                console.log('Created policy expiring in 12 days');
            }
        });
    });
    
    // Delete existing sample maintenance records first
    db.run(`DELETE FROM maintenance_records WHERE vehicle_id = ? AND descripcion IN (?, ?)`, 
            [vehicleId, 'Cambio de aceite y filtros', 'Revisión general'], () => {
        // Create maintenance record with overdue maintenance (danger alert)
        db.run(`INSERT INTO maintenance_records 
                (vehicle_id, tipo, fecha, kilometraje, descripcion, costo, taller, proximo_mantenimiento_km) 
                VALUES (?, 'Preventivo', date('now', '-90 days'), 40000, 'Cambio de aceite y filtros', 2500, 'Taller ABC', 43000)`, 
                [vehicleId], (err) => {
            if (err) {
                console.log('Error creating sample maintenance:', err.message);
            } else {
                console.log('Created overdue maintenance record');
            }
        });
        
        // Create maintenance record with upcoming maintenance (warning alert)
        db.run(`INSERT INTO maintenance_records 
                (vehicle_id, tipo, fecha, kilometraje, descripcion, costo, taller, proximo_mantenimiento_km) 
                VALUES (?, 'Preventivo', date('now', '-60 days'), 42000, 'Revisión general', 3000, 'Taller XYZ', 46000)`, 
                [vehicleId], (err) => {
            if (err) {
                console.log('Error creating sample maintenance:', err.message);
            } else {
                console.log('Created upcoming maintenance record');
            }
        });
    });
    
    console.log('Sample alerts data created successfully');
}

// Routes
app.get('/', (req, res) => {
    // Si el usuario está logueado, redirigir al dashboard
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    // Si no está logueado, mostrar la página de inicio estática
    const indexPath = path.join(__dirname, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('Error sending index.html:', err);
            res.status(500).send('Error loading page');
        }
    });
});

app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/dashboard');
    }
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.render('login', { error: 'Usuario y contraseña son requeridos' });
    }
    
    db.getConverted('SELECT * FROM users WHERE username = ? OR email = ?', [username, username], (err, user) => {
        if (err) {
            console.error('Error en login (DB):', err);
            return res.render('login', { error: 'Error en la base de datos' });
        }
        
        if (!user) {
            return res.render('login', { error: 'Usuario o contraseña incorrectos' });
        }
        
        if (bcrypt.compareSync(password, user.password)) {
            // Guardar sesión
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.nombre = user.nombre;
            req.session.role = user.role || 'admin';
            
            // Guardar la sesión explícitamente antes de redirigir
            req.session.save((err) => {
                if (err) {
                    console.error('Error guardando sesión:', err);
                    return res.render('login', { error: 'Error al iniciar sesión. Intenta de nuevo.' });
                }
                // Redirigir operadores a su interfaz especial
                if (user.role === 'operador') {
                    res.redirect('/operador/rutas');
                } else {
                    res.redirect('/dashboard');
                }
            });
        } else {
            return res.render('login', { error: 'Usuario o contraseña incorrectos' });
        }
    });
});

app.get('/register', (req, res) => {
    res.render('register', { error: null });
});

app.post('/register', (req, res) => {
    const { username, email, password, nombre, empresa } = req.body;
    
    if (!username || !email || !password) {
        return res.render('register', { error: 'Todos los campos son requeridos' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    db.runConverted('INSERT INTO users (username, email, password, nombre, empresa) VALUES (?, ?, ?, ?, ?)',
        [username, email, hashedPassword, nombre || null, empresa || null], (err, result) => {
        if (err) {
            if (err.message && (err.message.includes('UNIQUE constraint') || err.message.includes('duplicate key'))) {
                return res.render('register', { error: 'El usuario o email ya existe' });
            }
            console.error('Error creando usuario:', err);
            return res.render('register', { error: 'Error al crear la cuenta' });
        }
        
        req.session.userId = result.lastID;
        req.session.username = username;
        req.session.nombre = nombre;
        res.redirect('/dashboard');
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Middleware to check authentication
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Middleware to check if user is admin
function requireAdmin(req, res, next) {
    if (req.session.userId && req.session.role === 'admin') {
        next();
    } else {
        res.status(403).send('Acceso denegado. Se requieren permisos de administrador.');
    }
}

// Middleware to check if user is operator
function requireOperator(req, res, next) {
    if (req.session.userId && req.session.role === 'operador') {
        next();
    } else {
        res.status(403).send('Acceso denegado. Se requieren permisos de operador.');
    }
}

// --- Facturación: vistas y APIs básicas ---

// Vista principal de órdenes de servicio y facturas
app.get('/billing', requireAuth, (req, res) => {
    const userId = req.session.userId;

    // Obtener últimas órdenes de servicio y facturas (resumen simple)
    db.all(
        `SELECT so.*, v.numero_vehiculo, v.marca, v.modelo
         FROM service_orders so
         LEFT JOIN vehicles v ON so.vehicle_id = v.id
         WHERE so.user_id = ?
         ORDER BY so.fecha DESC, so.id DESC
         LIMIT 50`,
        [userId],
        (err, orders) => {
            if (err) {
                console.error('Error loading service orders:', err);
                orders = [];
            }

            db.all(
                `SELECT i.*, so.tipo as order_tipo
                 FROM invoices i
                 LEFT JOIN service_orders so ON i.service_order_id = so.id
                 WHERE i.user_id = ?
                 ORDER BY i.fecha DESC, i.id DESC
                 LIMIT 50`,
                [userId],
                (err2, invoices) => {
                    if (err2) {
                        console.error('Error loading invoices:', err2);
                        invoices = [];
                    }

                    // También necesitamos vehículos para seleccionar al crear orden
                    db.all(
                        'SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo',
                        [userId],
                        (err3, vehicles) => {
                            if (err3) {
                                console.error('Error loading vehicles for billing:', err3);
                                vehicles = [];
                            }

                            // Obtener cartas porte
                            db.all(
                                `SELECT cp.*, v.numero_vehiculo, v.marca, v.modelo, v.placas as vehiculo_placas
                                 FROM carta_porte cp
                                 LEFT JOIN vehicles v ON cp.vehicle_id = v.id
                                 WHERE cp.user_id = ?
                                 ORDER BY cp.fecha DESC, cp.id DESC
                                 LIMIT 50`,
                                [userId],
                                (err4, cartasPorte) => {
                                    // Si no hay placas en carta_porte, usar las del vehículo
                                    if (cartasPorte) {
                                        cartasPorte.forEach(cp => {
                                            if (!cp.placas && cp.vehiculo_placas) {
                                                cp.placas = cp.vehiculo_placas;
                                            }
                                        });
                                    }
                                    if (err4) {
                                        console.error('Error loading cartas porte:', err4);
                                        cartasPorte = [];
                                    }

                                    res.render('billing', {
                                        user: req.session,
                                        orders: orders || [],
                                        invoices: invoices || [],
                                        vehicles: vehicles || [],
                                        cartasPorte: cartasPorte || []
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// API: simulación de envío de notificaciones automáticas pendientes
app.post('/api/notifications/send-pending', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    console.log('📬 Procesando notificaciones pendientes para usuario:', userId);

    // Obtener correo del usuario para usarlo como destino
    console.log('🔍 Buscando usuario ID:', userId);
    db.get('SELECT email FROM users WHERE id = ?', [userId], async (errUser, userRow) => {
        console.log('🔍 Resultado de búsqueda de usuario:', { errUser, userRow });
        
        if (errUser) {
            console.error('❌ Error loading user for notifications:', errUser);
            return res.status(500).json({ error: 'No se pudo obtener el usuario para notificaciones: ' + errUser.message });
        }
        
        if (!userRow) {
            console.error('❌ Usuario no encontrado para ID:', userId);
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const userEmail = userRow.email;
        console.log('📧 Email del usuario:', userEmail);
        console.log('📧 MailTransporter configurado:', !!mailTransporter);
        console.log('📧 GMAIL_USER:', process.env.GMAIL_USER ? 'Configurado' : 'NO CONFIGURADO');

        db.all(
            `SELECT * FROM notifications_queue 
             WHERE user_id = ? AND status = 'pending'
             ORDER BY scheduled_at IS NULL, scheduled_at ASC, created_at ASC
             LIMIT 50`,
            [userId],
            async (err, pending) => {
                if (err) {
                    console.error('❌ Error loading pending notifications:', err);
                    return res.status(500).json({ error: 'Error al revisar notificaciones' });
                }

                console.log(`📋 Notificaciones pendientes encontradas: ${pending ? pending.length : 0}`);

                if (!pending || pending.length === 0) {
                    return res.json({ success: true, sent: 0, message: 'No hay notificaciones pendientes' });
                }

                const nowIso = new Date().toISOString();
                let sentCount = 0;
                let failedCount = 0;

                // Si no hay transporter configurado, solo marcamos como enviados (modo simulación)
                if (!mailTransporter) {
                    console.warn('⚠️ MailTransporter NO configurado - modo simulación');
                    (pending || []).forEach(n => {
                        console.log('Simulando envío de notificación (sin transporter):', {
                            id: n.id,
                            tipo: n.tipo,
                            canal: n.channel,
                            asunto: n.asunto
                        });

                        db.run(
                            `UPDATE notifications_queue 
                             SET status = 'sent', sent_at = ? 
                             WHERE id = ?`,
                            [nowIso, n.id]
                        );
                        sentCount++;
                    });

                    return res.json({ success: true, sent: sentCount, simulated: true, message: 'Modo simulación - configure GMAIL_USER y GMAIL_PASS' });
                }

                // Enviar correos reales usando Gmail configurado
                
                const promises = pending.map((n) => {
                    return new Promise((resolve) => {
                        // Timeout de seguridad de 30 segundos por correo
                        const timeout = setTimeout(() => {
                            console.warn(`⏱️ Timeout enviando notificación ${n.id}`);
                            resolve();
                        }, 30000);

                        const mailOptions = {
                            from: process.env.GMAIL_USER,
                            to: userEmail,
                            subject: n.asunto || 'Notificación CRM Insurance System',
                            text: n.mensaje || 'Tienes una nueva notificación en el sistema.'
                        };

                        console.log(`📤 Enviando correo a ${userEmail}:`, n.asunto);

                        mailTransporter.sendMail(mailOptions, (errSend) => {
                            clearTimeout(timeout);
                            
                            if (errSend) {
                                console.error(`❌ Error enviando notificación ${n.id} por correo:`, errSend.message);
                                failedCount++;
                                db.run(
                                    `UPDATE notifications_queue 
                                     SET status = 'failed', error = ? 
                                     WHERE id = ?`,
                                    [errSend.message.substring(0, 200), n.id],
                                    function(updateErr) {
                                        if (updateErr) {
                                            console.error('❌ Error actualizando estado a failed:', updateErr);
                                        } else {
                                            console.log(`✅ Estado actualizado a 'failed' para notificación ${n.id}`);
                                        }
                                        // Siempre resolver, incluso si hay error en la BD
                                        resolve();
                                    }
                                );
                            } else {
                                console.log(`✅ Correo enviado exitosamente: ${n.asunto}`);
                                sentCount++;
                                db.run(
                                    `UPDATE notifications_queue 
                                     SET status = 'sent', sent_at = ? 
                                     WHERE id = ?`,
                                    [nowIso, n.id],
                                    function(updateErr) {
                                        if (updateErr) {
                                            console.error('❌ Error actualizando estado a sent:', updateErr);
                                            // Intentar actualizar sin sent_at si falla
                                            db.run(
                                                `UPDATE notifications_queue SET status = 'sent' WHERE id = ?`,
                                                [n.id],
                                                function(retryErr) {
                                                    if (retryErr) {
                                                        console.error('❌ Error en segundo intento de actualización:', retryErr);
                                                    } else {
                                                        console.log(`✅ Estado actualizado a 'sent' (sin fecha) para notificación ${n.id}`);
                                                    }
                                                    resolve();
                                                }
                                            );
                                        } else {
                                            console.log(`✅ Estado actualizado a 'sent' para notificación ${n.id}`);
                                            resolve();
                                        }
                                    }
                                );
                            }
                        });
                    });
                });

                // Esperar a que todos los correos se procesen con timeout global
                try {
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Timeout procesando notificaciones')), 60000);
                    });
                    
                    await Promise.race([Promise.all(promises), timeoutPromise]);
                    console.log(`✅ Procesamiento completo: ${sentCount} enviados, ${failedCount} fallidos`);
                    
                    // Verificar que la respuesta no se haya enviado ya
                    if (!res.headersSent) {
                        res.json({ success: true, sent: sentCount, failed: failedCount, total: pending.length });
                    } else {
                        console.warn('⚠️ Respuesta ya enviada, ignorando segunda respuesta');
                    }
                } catch (error) {
                    console.error('❌ Error procesando notificaciones:', error);
                    if (!res.headersSent) {
                        res.json({ success: false, error: error.message, sent: sentCount, failed: failedCount });
                    }
                }
            }
        );
    });
});

// Endpoint de prueba para verificar configuración de email
app.get('/api/notifications/test-config', requireAuth, (req, res) => {
    try {
        const config = {
            mailTransporterConfigured: !!mailTransporter,
            gmailUserConfigured: !!process.env.GMAIL_USER,
            gmailPassConfigured: !!process.env.GMAIL_PASS,
            gmailUser: process.env.GMAIL_USER ? process.env.GMAIL_USER.substring(0, 5) + '...' : 'NO CONFIGURADO',
            userEmail: null
        };

        db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (err, userRow) => {
            if (err) {
                console.error('Error obteniendo email del usuario:', err);
                // Responder de todas formas con la configuración disponible
                return res.json(config);
            }
            
            if (userRow && userRow.email) {
                config.userEmail = userRow.email;
            }
            
            res.json(config);
        });
    } catch (error) {
        console.error('Error en test-config:', error);
        res.json({
            mailTransporterConfigured: false,
            gmailUserConfigured: false,
            gmailPassConfigured: false,
            gmailUser: 'ERROR',
            userEmail: null,
            error: error.message
        });
    }
});

// API: crear orden de servicio rápida
app.post('/api/service-orders', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const {
        vehicle_id,
        policy_id,
        claim_id,
        tipo,
        descripcion,
        fecha,
        estado,
        total,
        moneda,
        notas
    } = req.body;

    if (!fecha) {
        return res.status(400).json({ error: 'La fecha es obligatoria' });
    }

    db.run(
        `INSERT INTO service_orders (
            user_id, vehicle_id, policy_id, claim_id, tipo, descripcion, fecha, estado, total, moneda, notas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            vehicle_id || null,
            policy_id || null,
            claim_id || null,
            tipo || null,
            descripcion || null,
            fecha,
            estado || 'Abierta',
            total || null,
            moneda || 'MXN',
            notas || null
        ],
        (err, result) => {
            if (err) {
                console.error('Error creating service order:', err);
                return res.status(500).json({ error: 'Error al crear la orden de servicio' });
            }
            
            const orderId = result?.lastID;
            if (!orderId) {
                return res.status(500).json({ error: 'Error: No se pudo obtener el ID de la orden creada' });
            }
            // Registrar en historial
            logActivity(userId, 'service_order', orderId, 'created',
                `Orden de servicio creada: ${tipo || 'N/A'}`, null, { tipo, descripcion, total });
            if (vehicle_id) {
                logActivity(userId, 'vehicle', vehicle_id, 'service_order_created',
                    `Orden de servicio creada`, null, { tipo, total });
            }
            
            res.json({ success: true, id: orderId });
        }
    );
});

// API: crear factura rápida ligada (opcionalmente) a orden de servicio
app.post('/api/invoices', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const {
        service_order_id,
        folio,
        serie,
        fecha,
        cliente_nombre,
        cliente_rfc,
        subtotal,
        impuestos,
        total,
        moneda,
        estado,
        notas
    } = req.body;

    if (!fecha) {
        return res.status(400).json({ error: 'La fecha es obligatoria' });
    }

    db.run(
        `INSERT INTO invoices (
            user_id, service_order_id, folio, serie, fecha, cliente_nombre, cliente_rfc,
            subtotal, impuestos, total, moneda, estado, notas
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            service_order_id || null,
            folio || null,
            serie || null,
            fecha,
            cliente_nombre || null,
            cliente_rfc || null,
            subtotal || null,
            impuestos || null,
            total || null,
            moneda || 'MXN',
            estado || 'Borrador',
            notas || null
        ],
        (err, result) => {
            if (err) {
                console.error('Error creating invoice:', err);
                return res.status(500).json({ error: 'Error al crear la factura' });
            }
            const invoiceId = result?.lastID;
            if (!invoiceId) {
                return res.status(500).json({ error: 'Error: No se pudo obtener el ID de la factura creada' });
            }
            // Registrar en historial
            logActivity(userId, 'invoice', invoiceId, 'created',
                `Factura creada: ${folio || 'N/A'}`, null, { folio, total, estado });
            if (service_order_id) {
                logActivity(userId, 'service_order', service_order_id, 'invoice_created',
                    `Factura creada`, null, { folio, total });
            }
            
            res.json({ success: true, id: invoiceId });
        }
    );
});

// Eliminar orden de servicio
app.delete('/api/service-orders/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const orderId = req.params.id;

    db.get('SELECT * FROM service_orders WHERE id = ? AND user_id = ?', [orderId, userId], (err, order) => {
        if (err || !order) {
            return res.status(404).json({ error: 'Orden de servicio no encontrada' });
        }

        const orderData = { ...order };

        db.run('DELETE FROM service_orders WHERE id = ? AND user_id = ?', [orderId, userId], function(err) {
            if (err) {
                console.error('Error eliminando orden de servicio:', err);
                return res.status(500).json({ error: 'Error al eliminar orden de servicio' });
            }

            logActivity(userId, 'service_order', orderId, 'deleted',
                `Orden de servicio eliminada: ${order.tipo || 'N/A'}`, orderData, null);
            if (order.vehicle_id) {
                logActivity(userId, 'vehicle', order.vehicle_id, 'service_order_deleted',
                    `Orden de servicio eliminada`, { tipo: order.tipo }, null);
            }

            res.json({ success: true });
        });
    });
});

// Eliminar factura
app.delete('/api/invoices/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const invoiceId = req.params.id;

    db.get('SELECT * FROM invoices WHERE id = ? AND user_id = ?', [invoiceId, userId], (err, invoice) => {
        if (err || !invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        const invoiceData = { ...invoice };

        db.run('DELETE FROM invoices WHERE id = ? AND user_id = ?', [invoiceId, userId], function(err) {
            if (err) {
                console.error('Error eliminando factura:', err);
                return res.status(500).json({ error: 'Error al eliminar factura' });
            }

            logActivity(userId, 'invoice', invoiceId, 'deleted',
                `Factura eliminada: ${invoice.folio || 'N/A'}`, invoiceData, null);
            if (invoice.service_order_id) {
                logActivity(userId, 'service_order', invoice.service_order_id, 'invoice_deleted',
                    `Factura eliminada`, { folio: invoice.folio }, null);
            }

            res.json({ success: true });
        });
    });
});

// API: Carta Porte
app.post('/api/carta-porte', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const {
        vehicle_id, numero_guia, fecha, hora_salida, fecha_llegada, hora_llegada,
        origen, origen_cp, origen_estado, origen_municipio,
        destino, destino_cp, destino_estado, destino_municipio,
        distancia_km, tipo_transporte, tipo_servicio,
        transportista_nombre, transportista_rfc, transportista_regimen,
        remitente_nombre, remitente_rfc, remitente_domicilio, remitente_cp, remitente_estado, remitente_municipio,
        destinatario_nombre, destinatario_rfc, destinatario_domicilio, destinatario_cp, destinatario_estado, destinatario_municipio,
        operador_nombre, operador_licencia, operador_rfc,
        placas, numero_economico, seguro_poliza, seguro_aseguradora,
        mercancia, cantidad, unidad_medida, peso, peso_bruto, volumen, valor_declarado, moneda,
        estado, observaciones
    } = req.body;

    if (!fecha || !origen || !destino || !origen_estado || !destino_estado) {
        return res.status(400).json({ error: 'Fecha, origen, destino y estados son requeridos' });
    }

    db.run(
        `INSERT INTO carta_porte (
            user_id, vehicle_id, numero_guia, fecha, hora_salida, fecha_llegada, hora_llegada,
            origen, origen_cp, origen_estado, origen_municipio,
            destino, destino_cp, destino_estado, destino_municipio,
            distancia_km, tipo_transporte, tipo_servicio,
            transportista_nombre, transportista_rfc, transportista_regimen,
            remitente_nombre, remitente_rfc, remitente_domicilio, remitente_cp, remitente_estado, remitente_municipio,
            destinatario_nombre, destinatario_rfc, destinatario_domicilio, destinatario_cp, destinatario_estado, destinatario_municipio,
            operador_nombre, operador_licencia, operador_rfc,
            placas, numero_economico, seguro_poliza, seguro_aseguradora,
            mercancia, cantidad, unidad_medida, peso, peso_bruto, volumen, valor_declarado, moneda,
            estado, observaciones
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId, vehicle_id || null, numero_guia || null, fecha, hora_salida || null, fecha_llegada || null, hora_llegada || null,
            origen, origen_cp || null, origen_estado, origen_municipio || null,
            destino, destino_cp || null, destino_estado, destino_municipio || null,
            distancia_km || null, tipo_transporte || 'Terrestre', tipo_servicio || null,
            transportista_nombre || null, transportista_rfc || null, transportista_regimen || null,
            remitente_nombre || null, remitente_rfc || null, remitente_domicilio || null, remitente_cp || null, remitente_estado || null, remitente_municipio || null,
            destinatario_nombre || null, destinatario_rfc || null, destinatario_domicilio || null, destinatario_cp || null, destinatario_estado || null, destinatario_municipio || null,
            operador_nombre || null, operador_licencia || null, operador_rfc || null,
            placas || null, numero_economico || null, seguro_poliza || null, seguro_aseguradora || null,
            mercancia || null, cantidad || null, unidad_medida || 'kg', peso || null, peso_bruto || null, volumen || null, valor_declarado || null, moneda || 'MXN',
            estado || 'Borrador', observaciones || null
        ],
        function(err) {
            if (err) {
                console.error('Error creating carta porte:', err);
                return res.status(500).json({ error: 'Error al crear la carta porte: ' + err.message });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.delete('/api/carta-porte/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const cartaPorteId = req.params.id;

    db.run('DELETE FROM carta_porte WHERE id = ? AND user_id = ?', [cartaPorteId, userId], function(err) {
        if (err) {
            console.error('Error deleting carta porte:', err);
            return res.status(500).json({ error: 'Error al eliminar la carta porte' });
        }
        res.json({ success: true });
    });
});

// API: Generar CFDI con Carta Porte (Integración con Facturama)
app.post('/api/carta-porte/:id/generar-cfdi', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const cartaPorteId = req.params.id;
    
    // Verificar que la carta porte existe y pertenece al usuario
    db.get('SELECT * FROM carta_porte WHERE id = ? AND user_id = ?', [cartaPorteId, userId], async (err, cartaPorte) => {
        if (err || !cartaPorte) {
            return res.status(404).json({ error: 'Carta Porte no encontrada' });
        }
        
        // Verificar si ya tiene CFDI generado
        if (cartaPorte.cfdi_uuid) {
            return res.status(400).json({ 
                error: 'Esta Carta Porte ya tiene un CFDI generado',
                uuid: cartaPorte.cfdi_uuid,
                fecha_timbrado: cartaPorte.cfdi_fecha_timbrado
            });
        }
        
        // Obtener datos del usuario (emisor)
        db.get('SELECT * FROM users WHERE id = ?', [userId], (errUser, user) => {
            if (errUser || !user) {
                return res.status(500).json({ error: 'Error al obtener datos del usuario' });
            }
            
            // Obtener datos del vehículo si existe
            let vehicleData = null;
            const getVehicleAndGenerate = () => {
                if (cartaPorte.vehicle_id) {
                    db.get('SELECT * FROM vehicles WHERE id = ?', [cartaPorte.vehicle_id], (errVehicle, vehicle) => {
                        if (!errVehicle && vehicle) {
                            vehicleData = vehicle;
                        }
                        generateCFDI();
                    });
                } else {
                    generateCFDI();
                }
            };
            
            getVehicleAndGenerate();
            
            async function generateCFDI() {
                try {
                    // Verificar si hay credenciales de Facturama configuradas
                    const FACTURAMA_USER = process.env.FACTURAMA_USER;
                    const FACTURAMA_PASS = process.env.FACTURAMA_PASS;
                    const FACTURAMA_MODE = process.env.FACTURAMA_MODE || 'sandbox';
                    
                    // REQUERIR credenciales de Facturama para generar CFDI real timbrado por el SAT
                    if (!FACTURAMA_USER || !FACTURAMA_PASS) {
                        return res.status(400).json({ 
                            error: 'Credenciales de Facturama no configuradas',
                            mensaje: 'Para generar CFDI timbrado por el SAT, debe configurar las variables de entorno FACTURAMA_USER y FACTURAMA_PASS en el servidor.',
                            instrucciones: 'Contacte al administrador del sistema para configurar las credenciales de Facturama.'
                        });
                    }
                    
                    // Construir el objeto CFDI según el formato de Facturama
                    const cfdiData = buildCFDIData(cartaPorte, user, vehicleData);
                    
                    // Llamar a la API de Facturama
                    const facturamaUrl = FACTURAMA_MODE === 'production' 
                        ? 'https://api.facturama.mx/3/cfdis'
                        : 'https://apisandbox.facturama.mx/3/cfdis';
                    
                    const auth = Buffer.from(`${FACTURAMA_USER}:${FACTURAMA_PASS}`).toString('base64');
                    
                    const response = await axios.post(facturamaUrl, cfdiData, {
                        headers: {
                            'Authorization': `Basic ${auth}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    if (response.data && response.data.Id) {
                        // CFDI generado exitosamente
                        const cfdiId = response.data.Id;
                        
                        // Extraer UUID de diferentes ubicaciones posibles en la respuesta
                        const uuid = response.data.UUID 
                            || response.data.Cfdi?.UUID 
                            || response.data.CfdiId?.UUID
                            || (response.data.Cfdi && typeof response.data.Cfdi === 'string' ? null : response.data.Cfdi?.UUID)
                            || generateUUID();
                        
                        // Extraer XML de diferentes ubicaciones posibles
                        let xml = response.data.Xml 
                            || response.data.Cfdi?.Xml 
                            || response.data.CfdiId?.Xml
                            || '';
                        
                        // Si el XML viene codificado en base64, decodificarlo
                        if (xml && !xml.trim().startsWith('<?xml')) {
                            try {
                                // Intentar decodificar si parece base64
                                const decoded = Buffer.from(xml, 'base64').toString('utf-8');
                                if (decoded.trim().startsWith('<?xml')) {
                                    xml = decoded;
                                }
                            } catch (e) {
                                // Si no es base64, usar el XML tal cual
                                console.log('XML no está en base64, usando directamente');
                            }
                        }
                        
                        // Si aún no tenemos XML, intentar obtenerlo directamente del CFDI
                        if (!xml || xml.trim() === '') {
                            try {
                                const cfdiResponse = await axios.get(`${facturamaUrl}/${cfdiId}`, {
                                    headers: { 'Authorization': `Basic ${auth}` },
                                    timeout: 30000
                                });
                                
                                // Buscar XML en múltiples ubicaciones posibles
                                xml = cfdiResponse.data?.Xml 
                                    || cfdiResponse.data?.Cfdi?.Xml 
                                    || cfdiResponse.data?.CfdiId?.Xml
                                    || (typeof cfdiResponse.data === 'string' ? cfdiResponse.data : '')
                                    || '';
                                
                                // Decodificar si viene en base64
                                if (xml && !xml.trim().startsWith('<?xml')) {
                                    try {
                                        const decoded = Buffer.from(xml, 'base64').toString('utf-8');
                                        if (decoded.trim().startsWith('<?xml')) {
                                            xml = decoded;
                                        }
                                    } catch (e) {
                                        // Si no es base64 válido, intentar como string directo
                                        if (xml.includes('<?xml') || xml.includes('<cfdi:Comprobante')) {
                                            // El XML puede estar embebido en el string
                                            const xmlMatch = xml.match(/<\?xml[\s\S]*<\/cfdi:Comprobante>/);
                                            if (xmlMatch) {
                                                xml = xmlMatch[0];
                                            }
                                        }
                                    }
                                }
                                
                                // Si aún no tenemos XML, intentar obtenerlo del endpoint específico de XML
                                if (!xml || xml.trim() === '') {
                                    try {
                                        const xmlResponse = await axios.get(`${facturamaUrl}/${cfdiId}/xml`, {
                                            headers: { 'Authorization': `Basic ${auth}` },
                                            responseType: 'text',
                                            timeout: 30000
                                        });
                                        xml = xmlResponse.data || '';
                                    } catch (xmlErr) {
                                        console.warn('No se pudo obtener XML del endpoint /xml:', xmlErr.message);
                                    }
                                }
                            } catch (cfdiErr) {
                                console.error('Error obteniendo XML del CFDI:', cfdiErr.response?.data || cfdiErr.message);
                                // Continuar sin XML, se guardará vacío y se podrá obtener después
                            }
                        }
                        
                        // Extraer fecha de timbrado
                        let fechaTimbrado = response.data.Date 
                            || response.data.Cfdi?.Date 
                            || response.data.FechaTimbrado
                            || new Date().toISOString();
                        
                        // Asegurar que la fecha esté en formato ISO
                        if (fechaTimbrado && !fechaTimbrado.includes('T')) {
                            fechaTimbrado = new Date(fechaTimbrado).toISOString();
                        }
                        
                        // Limpiar y validar el XML
                        if (xml) {
                            xml = xml.toString().trim();
                            // Asegurar que comience con <?xml
                            if (!xml.startsWith('<?xml')) {
                                const xmlStart = xml.indexOf('<?xml');
                                if (xmlStart > 0) {
                                    xml = xml.substring(xmlStart);
                                }
                            }
                        }
                        
                        // Descargar PDF si está disponible
                        let pdfPath = null;
                        try {
                            const pdfResponse = await axios.get(`${facturamaUrl}/${cfdiId}/pdf`, {
                                headers: { 'Authorization': `Basic ${auth}` },
                                responseType: 'arraybuffer'
                            });
                            
                            const pdfDir = path.join(__dirname, 'uploads', 'cfdi');
                            if (!fs.existsSync(pdfDir)) {
                                fs.mkdirSync(pdfDir, { recursive: true });
                            }
                            
                            pdfPath = path.join(pdfDir, `carta-porte-${cartaPorteId}-${uuid}.pdf`);
                            fs.writeFileSync(pdfPath, pdfResponse.data);
                        } catch (pdfErr) {
                            console.error('Error descargando PDF:', pdfErr);
                        }
                        
                        // Guardar datos del CFDI
                        db.run(
                            `UPDATE carta_porte SET 
                             cfdi_uuid = ?, 
                             cfdi_id = ?,
                             cfdi_fecha_timbrado = ?,
                             cfdi_xml = ?,
                             cfdi_pdf_path = ?,
                             estado = 'Emitida',
                             updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?`,
                            [uuid, cfdiId.toString(), fechaTimbrado, xml, pdfPath, cartaPorteId],
                            function(updateErr) {
                                if (updateErr) {
                                    console.error('Error guardando CFDI:', updateErr);
                                    return res.status(500).json({ error: 'Error al guardar CFDI' });
                                }
                                
                                res.json({
                                    success: true,
                                    message: 'CFDI generado y timbrado exitosamente',
                                    uuid: uuid,
                                    fecha_timbrado: fechaTimbrado,
                                    pdf_path: pdfPath,
                                    modo: 'produccion',
                                    xml_length: xml ? xml.length : 0
                                });
                            }
                        );
                    } else {
                        throw new Error('Respuesta inesperada de Facturama');
                    }
                } catch (error) {
                    console.error('Error generando CFDI:', error.response?.data || error.message);
                    res.status(500).json({ 
                        error: 'Error al generar CFDI',
                        detalles: error.response?.data?.Message || error.message
                    });
                }
            }
        });
    });
});

// API: Descargar PDF del CFDI
app.get('/api/carta-porte/:id/download-pdf', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const cartaPorteId = req.params.id;
    
    db.get('SELECT * FROM carta_porte WHERE id = ? AND user_id = ?', [cartaPorteId, userId], async (err, cartaPorte) => {
        if (err || !cartaPorte) {
            return res.status(404).json({ error: 'Carta Porte no encontrada' });
        }
        
        // Si no tiene CFDI generado
        if (!cartaPorte.cfdi_uuid && !cartaPorte.cfdi_id) {
            return res.status(404).json({ error: 'CFDI no generado para esta Carta Porte' });
        }
        
        // Intentar servir PDF local si existe
        if (cartaPorte.cfdi_pdf_path && fs.existsSync(cartaPorte.cfdi_pdf_path)) {
            const fileName = `CFDI-${cartaPorte.cfdi_uuid || cartaPorteId}.pdf`;
            return res.download(cartaPorte.cfdi_pdf_path, fileName, (err) => {
                if (err) {
                    console.error('Error descargando PDF local:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Error al descargar el PDF' });
                    }
                }
            });
        }
        
        // Si no existe localmente, intentar descargarlo de Facturama
        const FACTURAMA_USER = process.env.FACTURAMA_USER;
        const FACTURAMA_PASS = process.env.FACTURAMA_PASS;
        const FACTURAMA_MODE = process.env.FACTURAMA_MODE || 'sandbox';
        
        // Si no tiene cfdi_id, significa que fue generado en modo simulación
        if (!cartaPorte.cfdi_id) {
            // Si tiene PDF local (simulado), servirlo
            if (cartaPorte.cfdi_pdf_path && fs.existsSync(cartaPorte.cfdi_pdf_path)) {
                const fileName = `CFDI-${cartaPorte.cfdi_uuid || cartaPorteId}.pdf`;
                return res.download(cartaPorte.cfdi_pdf_path, fileName, (err) => {
                    if (err) {
                        console.error('Error descargando PDF simulado:', err);
                        if (!res.headersSent) {
                            res.status(500).json({ error: 'Error al descargar el PDF' });
                        }
                    }
                });
            }
            return res.status(404).json({ 
                error: 'PDF no disponible',
                mensaje: 'Este CFDI fue generado en modo simulación. Para obtener un CFDI timbrado por el SAT, configure las credenciales de Facturama y genere un nuevo CFDI.'
            });
        }
        
        if (!FACTURAMA_USER || !FACTURAMA_PASS) {
            return res.status(500).json({ 
                error: 'Credenciales de Facturama no configuradas',
                mensaje: 'No se pueden descargar PDFs de Facturama sin credenciales configuradas.'
            });
        }
        
        try {
            const facturamaUrl = FACTURAMA_MODE === 'production' 
                ? 'https://api.facturama.mx/3/cfdis'
                : 'https://apisandbox.facturama.mx/3/cfdis';
            
            const auth = Buffer.from(`${FACTURAMA_USER}:${FACTURAMA_PASS}`).toString('base64');
            
            // Descargar PDF directamente de Facturama
            const pdfResponse = await axios.get(`${facturamaUrl}/${cartaPorte.cfdi_id}/pdf`, {
                headers: { 'Authorization': `Basic ${auth}` },
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            // Guardar el PDF localmente para futuras descargas
            const pdfDir = path.join(__dirname, 'uploads', 'cfdi');
            if (!fs.existsSync(pdfDir)) {
                fs.mkdirSync(pdfDir, { recursive: true });
            }
            const pdfPath = path.join(pdfDir, `carta-porte-${cartaPorteId}-${cartaPorte.cfdi_uuid || cartaPorteId}.pdf`);
            fs.writeFileSync(pdfPath, pdfResponse.data);
            
            // Actualizar la ruta en la base de datos
            db.run('UPDATE carta_porte SET cfdi_pdf_path = ? WHERE id = ?', [pdfPath, cartaPorteId], (updateErr) => {
                if (updateErr) {
                    console.error('Error actualizando ruta del PDF:', updateErr);
                }
            });
            
            // Enviar el PDF al cliente
            const fileName = `CFDI-${cartaPorte.cfdi_uuid || cartaPorteId}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
            res.send(pdfResponse.data);
        } catch (error) {
            console.error('Error descargando PDF de Facturama:', error.response?.data || error.message);
            res.status(500).json({ 
                error: 'Error al descargar el PDF de Facturama',
                detalles: error.response?.data?.Message || error.message
            });
        }
    });
});

// API: Descargar XML del CFDI
app.get('/api/carta-porte/:id/download-xml', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const cartaPorteId = req.params.id;
    
    db.get('SELECT * FROM carta_porte WHERE id = ? AND user_id = ?', [cartaPorteId, userId], async (err, cartaPorte) => {
        if (err || !cartaPorte) {
            return res.status(404).json({ error: 'Carta Porte no encontrada' });
        }
        
        // Si no tiene CFDI generado
        if (!cartaPorte.cfdi_uuid && !cartaPorte.cfdi_id) {
            return res.status(404).json({ error: 'CFDI no generado para esta Carta Porte' });
        }
        
        let xmlContent = null;
        
        // PRIORIDAD: Si tenemos cfdi_id, siempre obtener el XML más reciente de Facturama
        // para asegurar que sea el XML timbrado real
        if (cartaPorte.cfdi_id) {
            const FACTURAMA_USER = process.env.FACTURAMA_USER;
            const FACTURAMA_PASS = process.env.FACTURAMA_PASS;
            const FACTURAMA_MODE = process.env.FACTURAMA_MODE || 'sandbox';
            
            const FACTURAMA_USER = process.env.FACTURAMA_USER;
            const FACTURAMA_PASS = process.env.FACTURAMA_PASS;
            const FACTURAMA_MODE = process.env.FACTURAMA_MODE || 'sandbox';
            
            if (FACTURAMA_USER && FACTURAMA_PASS) {
                try {
                    const facturamaUrl = FACTURAMA_MODE === 'production' 
                        ? 'https://api.facturama.mx/3/cfdis'
                        : 'https://apisandbox.facturama.mx/3/cfdis';
                    
                    const auth = Buffer.from(`${FACTURAMA_USER}:${FACTURAMA_PASS}`).toString('base64');
                    
                    // Intentar obtener el CFDI completo
                    const cfdiResponse = await axios.get(`${facturamaUrl}/${cartaPorte.cfdi_id}`, {
                        headers: { 'Authorization': `Basic ${auth}` },
                        timeout: 30000
                    });
                    
                    // Buscar XML en múltiples ubicaciones
                    xmlContent = cfdiResponse.data?.Xml 
                        || cfdiResponse.data?.Cfdi?.Xml 
                        || cfdiResponse.data?.CfdiId?.Xml
                        || '';
                    
                    // Si no se encontró, intentar endpoint específico de XML
                    if (!xmlContent || xmlContent.trim() === '') {
                        try {
                            const xmlResponse = await axios.get(`${facturamaUrl}/${cartaPorte.cfdi_id}/xml`, {
                                headers: { 'Authorization': `Basic ${auth}` },
                                responseType: 'text',
                                timeout: 30000
                            });
                            xmlContent = xmlResponse.data || '';
                        } catch (xmlErr) {
                            console.warn('No se pudo obtener XML del endpoint /xml:', xmlErr.message);
                        }
                    }
                    
                    // Decodificar si viene en base64
                    if (xmlContent && !xmlContent.trim().startsWith('<?xml')) {
                        try {
                            const decoded = Buffer.from(xmlContent, 'base64').toString('utf-8');
                            if (decoded.trim().startsWith('<?xml')) {
                                xmlContent = decoded;
                            }
                        } catch (e) {
                            // Si no es base64 válido, buscar XML embebido
                            if (xmlContent.includes('<?xml') || xmlContent.includes('<cfdi:Comprobante')) {
                                const xmlMatch = xmlContent.match(/<\?xml[\s\S]*<\/cfdi:Comprobante>/);
                                if (xmlMatch) {
                                    xmlContent = xmlMatch[0];
                                }
                            }
                        }
                    }
                    
                    // Guardar el XML en la base de datos si se obtuvo exitosamente
                    if (xmlContent && xmlContent.trim().startsWith('<?xml')) {
                        db.run('UPDATE carta_porte SET cfdi_xml = ? WHERE id = ?', [xmlContent, cartaPorteId], (updateErr) => {
                            if (updateErr) {
                                console.error('Error actualizando XML:', updateErr);
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error obteniendo XML de Facturama:', error.response?.data || error.message);
                    // Si falla, intentar usar XML de la BD si existe
                    if (cartaPorte.cfdi_xml) {
                        xmlContent = cartaPorte.cfdi_xml.toString().trim();
                    }
                }
            } else {
                // Si no hay credenciales pero tenemos XML en BD, usarlo
                if (cartaPorte.cfdi_xml) {
                    xmlContent = cartaPorte.cfdi_xml.toString().trim();
                }
            }
        } else {
            // Si no hay cfdi_id, usar XML de la BD (puede ser simulado)
            if (cartaPorte.cfdi_xml) {
                xmlContent = cartaPorte.cfdi_xml.toString().trim();
            }
        }
        
        if (!xmlContent || xmlContent === '') {
            return res.status(404).json({ error: 'XML no disponible para esta Carta Porte' });
        }
        
        // Limpiar el XML de caracteres extra y asegurar que comience correctamente
        xmlContent = xmlContent.toString().trim();
        
        // Si el XML no comienza con <?xml, buscar el inicio real
        if (!xmlContent.startsWith('<?xml')) {
            const xmlStart = xmlContent.indexOf('<?xml');
            if (xmlStart > 0) {
                xmlContent = xmlContent.substring(xmlStart);
            }
        }
        
        // Asegurar que el XML esté bien formado
        if (!xmlContent.startsWith('<?xml')) {
            return res.status(500).json({ error: 'XML mal formado' });
        }
        
        // Formatear el XML para que se vea bien (pretty print básico)
        try {
            // Reemplazar espacios múltiples y saltos de línea inconsistentes
            xmlContent = xmlContent.replace(/>\s+</g, '>\n<');
            // Añadir indentación básica
            const lines = xmlContent.split('\n');
            let indent = 0;
            const indentSize = 2;
            xmlContent = lines.map(line => {
                const trimmed = line.trim();
                if (!trimmed) return '';
                if (trimmed.startsWith('</')) {
                    indent = Math.max(0, indent - indentSize);
                }
                const indented = ' '.repeat(indent) + trimmed;
                if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.startsWith('<?')) {
                    indent += indentSize;
                }
                return indented;
            }).filter(line => line).join('\n');
        } catch (formatErr) {
            // Si falla el formateo, usar el XML tal cual
            console.warn('Error formateando XML, usando original:', formatErr);
        }
        
        const fileName = `CFDI-${cartaPorte.cfdi_uuid || cartaPorteId}.xml`;
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.send(xmlContent);
    });
});

// Función auxiliar para construir datos del CFDI según formato Facturama
function buildCFDIData(cartaPorte, user, vehicle) {
    return {
        "Serie": "A",
        "Folio": cartaPorte.numero_guia || cartaPorte.folio || `CP${cartaPorte.id}`,
        "Fecha": new Date(cartaPorte.fecha).toISOString(),
        "SubTotal": cartaPorte.valor_declarado || 0,
        "Total": cartaPorte.valor_declarado || 0,
        "Moneda": cartaPorte.moneda || "MXN",
        "TipoDeComprobante": "I",
        "MetodoPago": "PUE",
        "FormaPago": "03",
        "LugarExpedicion": cartaPorte.origen_cp || "00000",
        "Emisor": {
            "Rfc": user.rfc || "XAXX010101000",
            "Nombre": user.empresa || user.nombre || "Transportista",
            "RegimenFiscal": user.regimen_fiscal || "601"
        },
        "Receptor": {
            "Rfc": cartaPorte.destinatario_rfc || "XAXX010101000",
            "Nombre": cartaPorte.destinatario_nombre || cartaPorte.destinatario || "Cliente",
            "UsoCFDI": "G03"
        },
        "Conceptos": [
            {
                "ClaveProdServ": "78102200",
                "Cantidad": cartaPorte.cantidad || 1,
                "ClaveUnidad": cartaPorte.unidad_medida === "kg" ? "KGM" : "MTR",
                "Unidad": cartaPorte.unidad_medida || "kg",
                "Descripcion": cartaPorte.mercancia || "Transporte de mercancía",
                "ValorUnitario": cartaPorte.valor_declarado ? (cartaPorte.valor_declarado / (cartaPorte.cantidad || 1)) : 0,
                "Importe": cartaPorte.valor_declarado || 0
            }
        ],
        "Complemento": {
            "CartaPorte30": {
                "Version": "3.1",
                "Transp": {
                    "Ubicaciones": {
                        "Ubicacion": [
                            {
                                "TipoUbicacion": "Origen",
                                "IDUbicacion": "OR001",
                                "RFCRemitenteDestinatario": cartaPorte.remitente_rfc || "",
                                "NombreRemitenteDestinatario": cartaPorte.remitente_nombre || cartaPorte.remitente || "",
                                "FechaHoraSalidaLlegada": `${cartaPorte.fecha}T${cartaPorte.hora_salida || '00:00:00'}`,
                                "Domicilio": {
                                    "Calle": cartaPorte.origen || "",
                                    "CodigoPostal": cartaPorte.origen_cp || "",
                                    "Estado": cartaPorte.origen_estado || "",
                                    "Municipio": cartaPorte.origen_municipio || ""
                                }
                            },
                            {
                                "TipoUbicacion": "Destino",
                                "IDUbicacion": "DE001",
                                "RFCRemitenteDestinatario": cartaPorte.destinatario_rfc || "",
                                "NombreRemitenteDestinatario": cartaPorte.destinatario_nombre || cartaPorte.destinatario || "",
                                "FechaHoraSalidaLlegada": cartaPorte.fecha_llegada ? `${cartaPorte.fecha_llegada}T${cartaPorte.hora_llegada || '00:00:00'}` : null,
                                "Domicilio": {
                                    "Calle": cartaPorte.destino || "",
                                    "CodigoPostal": cartaPorte.destino_cp || "",
                                    "Estado": cartaPorte.destino_estado || "",
                                    "Municipio": cartaPorte.destino_municipio || ""
                                }
                            }
                        ]
                    },
                    "Mercancias": {
                        "Mercancia": [
                            {
                                "BienesTransp": "01010101",
                                "Descripcion": cartaPorte.mercancia || "Mercancía general",
                                "Cantidad": cartaPorte.cantidad || 1,
                                "ClaveUnidad": cartaPorte.unidad_medida === "kg" ? "KGM" : "MTR",
                                "Unidad": cartaPorte.unidad_medida || "kg",
                                "PesoEnKg": cartaPorte.peso || cartaPorte.peso_bruto || 0,
                                "ValorMercancia": cartaPorte.valor_declarado || 0
                            }
                        ],
                        "PesoBrutoTotal": cartaPorte.peso_bruto || cartaPorte.peso || 0,
                        "UnidadPeso": "KGM"
                    },
                    "Autotransporte": cartaPorte.tipo_transporte === "Terrestre" ? {
                        "PermSCT": "TPAF01",
                        "NumPermisoSCT": "000000",
                        "IdentificacionVehicular": {
                            "ConfigVehicular": "C2",
                            "PesoBrutoVehicular": cartaPorte.peso_bruto || 0,
                            "PlacaVM": cartaPorte.placas || vehicle?.placas || ""
                        },
                        "Seguros": cartaPorte.seguro_poliza ? {
                            "AseguraRespCivil": cartaPorte.seguro_aseguradora || "",
                            "PolizaRespCivil": cartaPorte.seguro_poliza || ""
                        } : null
                    } : null,
                    "FiguraTransporte": [
                        {
                            "TipoFigura": "01",
                            "RFCFigura": cartaPorte.transportista_rfc || "",
                            "NombreFigura": cartaPorte.transportista_nombre || "",
                            "PartesTransporte": cartaPorte.operador_nombre ? [
                                {
                                    "ParteTransporte": "01",
                                    "RFC": cartaPorte.operador_rfc || "",
                                    "Nombre": cartaPorte.operador_nombre || "",
                                    "NumLicencia": cartaPorte.operador_licencia || ""
                                }
                            ] : null
                        }
                    ]
                }
            }
        }
    };
}

// Función auxiliar para generar UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    }).toUpperCase();
}

// Función para generar XML CFDI simulado válido
function generateSimulatedXML(cartaPorte, uuid, fechaTimbrado, user) {
    const fecha = new Date(cartaPorte.fecha || new Date()).toISOString().replace(/\.\d{3}Z$/, '');
    const rfcEmisor = user.rfc || 'XAXX010101000';
    const nombreEmisor = user.empresa || user.nombre || 'Transportista';
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd" Version="4.0" Serie="A" Folio="${cartaPorte.numero_guia || cartaPorte.folio || `CP${cartaPorte.id}`}" Fecha="${fecha}" Sello="SIMULADO" FormaPago="03" NoCertificado="00001000000000000000" Certificado="SIMULADO" SubTotal="${cartaPorte.valor_declarado || 0}" Moneda="MXN" Total="${cartaPorte.valor_declarado || 0}" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="${cartaPorte.origen_cp || '00000'}">
    <cfdi:Emisor Rfc="${rfcEmisor}" Nombre="${nombreEmisor}" RegimenFiscal="601"/>
    <cfdi:Receptor Rfc="${cartaPorte.destinatario_rfc || 'XAXX010101000'}" Nombre="${cartaPorte.destinatario_nombre || cartaPorte.destinatario || 'Cliente'}" UsoCFDI="G03"/>
    <cfdi:Conceptos>
        <cfdi:Concepto ClaveProdServ="78102200" Cantidad="${cartaPorte.cantidad || 1}" ClaveUnidad="${cartaPorte.unidad_medida === 'kg' ? 'KGM' : 'MTR'}" Unidad="${cartaPorte.unidad_medida || 'kg'}" Descripcion="${cartaPorte.mercancia || 'Transporte de mercancía'}" ValorUnitario="${cartaPorte.valor_declarado ? (cartaPorte.valor_declarado / (cartaPorte.cantidad || 1)) : 0}" Importe="${cartaPorte.valor_declarado || 0}"/>
    </cfdi:Conceptos>
    <cfdi:Complemento>
        <cartaporte20:CartaPorte xmlns:cartaporte20="http://www.sat.gob.mx/CartaPorte20" Version="2.0" TranspInternac="No" TotalDistRec="${cartaPorte.distancia_km || 0}">
            <cartaporte20:Ubicaciones>
                <cartaporte20:Ubicacion TipoUbicacion="Origen" IDUbicacion="ORIGEN" RFCRemitenteDestinatario="${rfcEmisor}" FechaHoraSalidaLlegada="${fecha}">
                    <cartaporte20:Domicilio CodigoPostal="${cartaPorte.origen_cp || '00000'}" Estado="${cartaPorte.origen_estado || 'Estado'}" Municipio="${cartaPorte.origen_municipio || 'Municipio'}" Localidad="${cartaPorte.origen_localidad || 'Localidad'}" Calle="${cartaPorte.origen_calle || 'Calle'}" NumeroExterior="${cartaPorte.origen_numero || 'S/N'}"/>
                </cartaporte20:Ubicacion>
                <cartaporte20:Ubicacion TipoUbicacion="Destino" IDUbicacion="DESTINO" RFCRemitenteDestinatario="${cartaPorte.destinatario_rfc || 'XAXX010101000'}" FechaHoraSalidaLlegada="${fecha}">
                    <cartaporte20:Domicilio CodigoPostal="${cartaPorte.destino_cp || '00000'}" Estado="${cartaPorte.destino_estado || 'Estado'}" Municipio="${cartaPorte.destino_municipio || 'Municipio'}" Localidad="${cartaPorte.destino_localidad || 'Localidad'}" Calle="${cartaPorte.destino_calle || 'Calle'}" NumeroExterior="${cartaPorte.destino_numero || 'S/N'}"/>
                </cartaporte20:Ubicacion>
            </cartaporte20:Ubicaciones>
            <cartaporte20:Mercancias PesoBrutoTotal="${cartaPorte.peso_bruto || 0}" UnidadPeso="KGM" NumTotalMercancias="1">
                <cartaporte20:Mercancia BienesTransp="${cartaPorte.mercancia || 'Mercancía'}" Cantidad="${cartaPorte.cantidad || 1}" ClaveUnidad="${cartaPorte.unidad_medida === 'kg' ? 'KGM' : 'MTR'}" Unidad="${cartaPorte.unidad_medida || 'kg'}" PesoEnKg="${cartaPorte.peso_bruto || 0}"/>
            </cartaporte20:Mercancias>
            <cartaporte20:FiguraTransporte TipoFigura="01">
                <cartaporte20:PartesTransporte ParteTransporte="TP-01">
                    <cartaporte20:Domicilio CodigoPostal="${cartaPorte.origen_cp || '00000'}" Estado="${cartaPorte.origen_estado || 'Estado'}" Municipio="${cartaPorte.origen_municipio || 'Municipio'}"/>
                </cartaporte20:PartesTransporte>
            </cartaporte20:FiguraTransporte>
        </cartaporte20:CartaPorte>
    </cfdi:Complemento>
    <cfdi:Complemento>
        <tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" xsi:schemaLocation="http://www.sat.gob.mx/TimbreFiscalDigital http://www.sat.gob.mx/sitio_internet/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" Version="1.1" UUID="${uuid}" FechaTimbrado="${fechaTimbrado}" RfcProvCertif="SIMULADO" SelloCFD="SIMULADO" NoCertificadoSAT="00001000000000000000" SelloSAT="SIMULADO"/>
    </cfdi:Complemento>
</cfdi:Comprobante>`;
}

// Función para generar PDF CFDI simulado
function generateSimulatedPDF(cartaPorte, uuid, fechaTimbrado, user, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);
            
            // Encabezado
            doc.fontSize(18).font('Helvetica-Bold').text('CFDI - Carta Porte', { align: 'center' });
            doc.moveDown();
            doc.fontSize(10).font('Helvetica').text(`UUID: ${uuid}`, { align: 'center' });
            doc.text(`Fecha de Timbrado: ${new Date(fechaTimbrado).toLocaleString('es-MX')}`, { align: 'center' });
            doc.moveDown();
            
            // Información del Emisor
            doc.fontSize(12).font('Helvetica-Bold').text('EMISOR', { underline: true });
            doc.fontSize(10).font('Helvetica');
            doc.text(`RFC: ${user.rfc || 'XAXX010101000'}`);
            doc.text(`Nombre: ${user.empresa || user.nombre || 'Transportista'}`);
            doc.moveDown();
            
            // Información del Receptor
            doc.fontSize(12).font('Helvetica-Bold').text('RECEPTOR', { underline: true });
            doc.fontSize(10).font('Helvetica');
            doc.text(`RFC: ${cartaPorte.destinatario_rfc || 'XAXX010101000'}`);
            doc.text(`Nombre: ${cartaPorte.destinatario_nombre || cartaPorte.destinatario || 'Cliente'}`);
            doc.moveDown();
            
            // Información de la Carta Porte
            doc.fontSize(12).font('Helvetica-Bold').text('INFORMACIÓN DE CARTA PORTE', { underline: true });
            doc.fontSize(10).font('Helvetica');
            doc.text(`Número de Guía: ${cartaPorte.numero_guia || cartaPorte.folio || `CP${cartaPorte.id}`}`);
            doc.text(`Fecha: ${new Date(cartaPorte.fecha || new Date()).toLocaleDateString('es-MX')}`);
            doc.text(`Origen: ${cartaPorte.origen_calle || ''} ${cartaPorte.origen_numero || ''}, ${cartaPorte.origen_localidad || ''}, ${cartaPorte.origen_municipio || ''}, ${cartaPorte.origen_estado || ''} CP: ${cartaPorte.origen_cp || ''}`);
            doc.text(`Destino: ${cartaPorte.destino_calle || ''} ${cartaPorte.destino_numero || ''}, ${cartaPorte.destino_localidad || ''}, ${cartaPorte.destino_municipio || ''}, ${cartaPorte.destino_estado || ''} CP: ${cartaPorte.destino_cp || ''}`);
            doc.text(`Mercancía: ${cartaPorte.mercancia || 'N/A'}`);
            doc.text(`Cantidad: ${cartaPorte.cantidad || 0} ${cartaPorte.unidad_medida || 'kg'}`);
            doc.text(`Peso Bruto: ${cartaPorte.peso_bruto || 0} kg`);
            doc.text(`Valor Declarado: $${(cartaPorte.valor_declarado || 0).toFixed(2)}`);
            doc.moveDown();
            
            // Nota de simulación
            doc.fontSize(8).font('Helvetica-Oblique').fillColor('red');
            doc.text('NOTA: Este es un CFDI generado en modo simulación. Configure FACTURAMA_USER y FACTURAMA_PASS para generar CFDI real timbrado por el SAT.', { align: 'center' });
            
            doc.end();
            stream.on('finish', () => resolve(outputPath));
            stream.on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

// --- Rutas para Operadores ---
app.get('/operador/rutas', requireOperator, (req, res) => {
    const userId = req.session.userId;
    
    // Obtener vehículos asignados al operador
    db.all(
        'SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE operador_id = ? OR user_id = ? ORDER BY numero_vehiculo',
        [userId, userId],
        (err, vehicles) => {
            if (err) {
                console.error('Error loading vehicles for operator:', err);
                vehicles = [];
            }
            res.render('operator-routes', {
                user: req.session,
                vehicles: vehicles || []
            });
        }
    );
});

// API: Iniciar ruta
app.post('/api/routes/start', requireOperator, (req, res) => {
    const userId = req.session.userId;
    const { vehicle_id, fecha_inicio, hora_inicio, origen, destino, kilometraje_inicio, observaciones } = req.body;

    if (!vehicle_id || !fecha_inicio || !hora_inicio) {
        return res.status(400).json({ error: 'Vehículo, fecha y hora de inicio son requeridos' });
    }

    // Verificar si ya hay una ruta activa
    db.get(
        'SELECT * FROM routes WHERE user_id = ? AND estado = ?',
        [userId, 'En Curso'],
        (err, activeRoute) => {
            if (err) {
                console.error('Error checking active route:', err);
                return res.status(500).json({ error: 'Error al verificar rutas activas' });
            }
            if (activeRoute) {
                return res.status(400).json({ error: 'Ya tienes una ruta en curso. Finalízala antes de iniciar una nueva.' });
            }

            db.run(
                `INSERT INTO routes (user_id, vehicle_id, fecha_inicio, hora_inicio, origen, destino, 
                 kilometraje_inicio, observaciones, estado)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, vehicle_id, fecha_inicio, hora_inicio, origen || null, destino || null,
                 kilometraje_inicio || null, observaciones || null, 'En Curso'],
                function(err) {
                    if (err) {
                        console.error('Error starting route:', err);
                        return res.status(500).json({ error: 'Error al iniciar la ruta' });
                    }
                    res.json({ success: true, id: this.lastID });
                }
            );
        }
    );
});

// API: Finalizar ruta
app.post('/api/routes/:id/end', requireOperator, (req, res) => {
    const userId = req.session.userId;
    const routeId = req.params.id;
    const { kilometraje_fin, observaciones } = req.body;

    if (!kilometraje_fin) {
        return res.status(400).json({ error: 'Kilometraje final es requerido' });
    }

    const now = new Date();
    const fechaFin = now.toISOString().split('T')[0];
    const horaFin = now.toTimeString().split(' ')[0].substring(0, 5);

    db.run(
        `UPDATE routes SET fecha_fin = ?, hora_fin = ?, kilometraje_fin = ?, 
         observaciones = COALESCE(?, observaciones), estado = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND estado = ?`,
        [fechaFin, horaFin, kilometraje_fin, observaciones || null, 'Finalizada', routeId, userId, 'En Curso'],
        function(err) {
            if (err) {
                console.error('Error ending route:', err);
                return res.status(500).json({ error: 'Error al finalizar la ruta' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Ruta no encontrada o ya finalizada' });
            }
            res.json({ success: true });
        }
    );
});

// API: Obtener ruta activa
app.get('/api/routes/active', requireOperator, (req, res) => {
    const userId = req.session.userId;
    
    db.get(
        `SELECT r.*, v.numero_vehiculo, v.marca, v.modelo
         FROM routes r
         LEFT JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.user_id = ? AND r.estado = ?
         ORDER BY r.created_at DESC
         LIMIT 1`,
        [userId, 'En Curso'],
        (err, route) => {
            if (err) {
                console.error('Error loading active route:', err);
                return res.status(500).json({ error: 'Error al cargar la ruta activa' });
            }
            res.json({ success: true, route: route || null });
        }
    );
});

// API: Obtener historial de rutas
app.get('/api/routes', requireOperator, (req, res) => {
    const userId = req.session.userId;
    
    db.all(
        `SELECT r.*, v.numero_vehiculo, v.marca, v.modelo
         FROM routes r
         LEFT JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.user_id = ?
         ORDER BY r.fecha_inicio DESC, r.hora_inicio DESC
         LIMIT 50`,
        [userId],
        (err, routes) => {
            if (err) {
                console.error('Error loading routes:', err);
                return res.status(500).json({ error: 'Error al cargar las rutas' });
            }
            res.json({ success: true, routes: routes || [] });
        }
    );
});

// --- Funciones helper para historial ---
function logActivity(userId, entityType, entityId, accion, descripcion, datosAnteriores, datosNuevos) {
    db.runConverted(
        `INSERT INTO activity_history (user_id, entity_type, entity_id, accion, descripcion, datos_anteriores, datos_nuevos)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            entityType,
            entityId,
            accion,
            descripcion || null,
            datosAnteriores ? JSON.stringify(datosAnteriores) : null,
            datosNuevos ? JSON.stringify(datosNuevos) : null
        ],
        (err) => {
            if (err) {
                console.error('Error registrando actividad en historial:', err);
            }
        }
    );
}

// --- API: Adjuntos (archivos) ---

// Subir adjunto
app.post('/api/attachments', requireAuth, upload.single('file'), (req, res) => {
    const userId = req.session.userId;
    const { entity_type, entity_id, descripcion, categoria } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No se proporcionó ningún archivo' });
    }

    if (!entity_type || !entity_id) {
        // Eliminar archivo si falta información
        fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'entity_type y entity_id son requeridos' });
    }

    // Verificar que la entidad pertenece al usuario
    let checkQuery = '';
    let checkParams = [entity_id, userId];

    switch (entity_type) {
        case 'vehicle':
            checkQuery = 'SELECT id FROM vehicles WHERE id = ? AND user_id = ?';
            break;
        case 'client':
            checkQuery = 'SELECT id FROM clients WHERE id = ? AND user_id = ?';
            break;
        case 'policy':
            checkQuery = `SELECT ip.id FROM insurance_policies ip 
                         JOIN vehicles v ON ip.vehicle_id = v.id 
                         WHERE ip.id = ? AND v.user_id = ?`;
            break;
        case 'claim':
            checkQuery = `SELECT s.id FROM siniestros s 
                         JOIN vehicles v ON s.vehicle_id = v.id 
                         WHERE s.id = ? AND v.user_id = ?`;
            break;
        default:
            fs.unlinkSync(file.path);
            return res.status(400).json({ error: 'Tipo de entidad no válido' });
    }

    db.get(checkQuery, checkParams, (err, entity) => {
        if (err || !entity) {
            fs.unlinkSync(file.path);
            return res.status(403).json({ error: 'Entidad no encontrada o no autorizada' });
        }

        db.runConverted(
            `INSERT INTO attachments (user_id, entity_type, entity_id, nombre_archivo, nombre_original, tipo_mime, tamano, ruta_archivo, descripcion, categoria)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                entity_type,
                entity_id,
                file.filename,
                file.originalname,
                file.mimetype,
                file.size,
                file.path,
                descripcion || null,
                categoria || 'otro'
            ],
            (err, result) => {
                if (err) {
                    console.error('Error guardando adjunto:', err);
                    fs.unlinkSync(file.path);
                    return res.status(500).json({ error: 'Error al guardar el adjunto' });
                }

                const attachmentId = result?.lastID;
                if (!attachmentId) {
                    fs.unlinkSync(file.path);
                    return res.status(500).json({ error: 'Error: No se pudo obtener el ID del adjunto creado' });
                }

                // Registrar en historial
                logActivity(userId, entity_type, entity_id, 'attachment_added', 
                    `Se agregó el archivo: ${file.originalname}`, null, { nombre: file.originalname, categoria: categoria || 'otro' });

                res.json({ success: true, id: attachmentId, file: {
                    id: attachmentId,
                    nombre_original: file.originalname,
                    tamano: file.size,
                    tipo_mime: file.mimetype,
                    categoria: categoria || 'otro'
                }});
            }
        );
    });
});

// Obtener adjuntos de una entidad
app.get('/api/attachments/:entity_type/:entity_id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { entity_type, entity_id } = req.params;

    db.allConverted(
        `SELECT id, nombre_original, tipo_mime, tamano, descripcion, categoria, created_at
         FROM attachments
         WHERE entity_type = ? AND entity_id = ? AND user_id = ?
         ORDER BY created_at DESC`,
        [entity_type, entity_id, userId],
        (err, attachments) => {
            if (err) {
                console.error('Error obteniendo adjuntos:', err);
                return res.status(500).json({ error: 'Error al obtener adjuntos' });
            }
            res.json({ success: true, attachments: attachments || [] });
        }
    );
});

// Descargar adjunto
app.get('/api/attachments/:id/download', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const attachmentId = req.params.id;

    db.getConverted(
        `SELECT * FROM attachments WHERE id = ? AND user_id = ?`,
        [attachmentId, userId],
        (err, attachment) => {
            if (err || !attachment) {
                return res.status(404).json({ error: 'Adjunto no encontrado' });
            }

            if (!fs.existsSync(attachment.ruta_archivo)) {
                return res.status(404).json({ error: 'Archivo no encontrado en el servidor' });
            }

            res.download(attachment.ruta_archivo, attachment.nombre_original, (err) => {
                if (err) {
                    console.error('Error descargando archivo:', err);
                }
            });
        }
    );
});

// Eliminar adjunto
app.delete('/api/attachments/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const attachmentId = req.params.id;

    db.getConverted(
        `SELECT * FROM attachments WHERE id = ? AND user_id = ?`,
        [attachmentId, userId],
        (err, attachment) => {
            if (err || !attachment) {
                return res.status(404).json({ error: 'Adjunto no encontrado' });
            }

            // Eliminar archivo del sistema
            if (fs.existsSync(attachment.ruta_archivo)) {
                fs.unlinkSync(attachment.ruta_archivo);
            }

            // Registrar en historial antes de eliminar
            logActivity(userId, attachment.entity_type, attachment.entity_id, 'attachment_deleted',
                `Se eliminó el archivo: ${attachment.nombre_original}`, { nombre: attachment.nombre_original }, null);

            // Eliminar registro de la base de datos
            db.runConverted(
                `DELETE FROM attachments WHERE id = ? AND user_id = ?`,
                [attachmentId, userId],
                (err) => {
                    if (err) {
                        console.error('Error eliminando adjunto:', err);
                        return res.status(500).json({ error: 'Error al eliminar el adjunto' });
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

// --- API: Historial de actividades ---

// Obtener historial de una entidad
app.get('/api/history/:entity_type/:entity_id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { entity_type, entity_id } = req.params;

    db.all(
        `SELECT ah.*, u.username, u.nombre as usuario_nombre
         FROM activity_history ah
         JOIN users u ON ah.user_id = u.id
         WHERE ah.entity_type = ? AND ah.entity_id = ? AND ah.user_id = ?
         ORDER BY ah.created_at DESC
         LIMIT 100`,
        [entity_type, entity_id, userId],
        (err, history) => {
            if (err) {
                console.error('Error obteniendo historial:', err);
                return res.status(500).json({ error: 'Error al obtener historial' });
            }

            // Parsear JSON de datos_anteriores y datos_nuevos
            const parsedHistory = (history || []).map(item => ({
                ...item,
                datos_anteriores: item.datos_anteriores ? JSON.parse(item.datos_anteriores) : null,
                datos_nuevos: item.datos_nuevos ? JSON.parse(item.datos_nuevos) : null
            }));

            res.json({ success: true, history: parsedHistory });
        }
    );
});

app.get('/dashboard', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    // Get user vehicles
    console.log('🔍 Dashboard - userId:', userId);
    db.allConverted('SELECT * FROM vehicles WHERE user_id = ?', [userId], (err, vehicles) => {
        if (err) {
            console.error('❌ Error loading vehicles:', err);
            return res.status(500).send('Error al cargar vehículos');
        }
        
        console.log('🚗 Vehicles found:', vehicles ? vehicles.length : 0);
        if (vehicles && vehicles.length > 0) {
            console.log('📋 First vehicle:', JSON.stringify(vehicles[0], null, 2));
        }
        
        // Get statistics
        const vehicleIds = vehicles.map(v => v.id);
        const placeholders = vehicleIds.map(() => '?').join(',');
        console.log('🔢 Vehicle IDs:', vehicleIds);
        
        if (vehicleIds.length === 0) {
            const alertCounts = {
                total: 0,
                danger: 0,
                warning: 0,
                info: 0,
                hasAlerts: false
            };
            
            return res.render('dashboard', {
                user: req.session,
                vehicles: [],
                stats: {
                    totalVehicles: 0,
                    activeVehicles: 0,
                    totalFuelCost: 0,
                    pendingMaintenance: 0,
                    expiringPolicies: 0
                },
                recentFuel: [],
                recentMaintenance: [],
                alerts: [],
                alertCounts: alertCounts,
                vehicleConsumption: [],
                costTrends: [],
                maintenanceTrends: [],
                vehicleComparisons: [],
                performanceStats: [],
                notificationsHistory: [],
                hasNotificationsHistory: false
            });
        }
        
        // Get fuel records
        db.allConverted(`SELECT fr.*, v.numero_vehiculo, v.marca, v.modelo 
                FROM fuel_records fr 
                JOIN vehicles v ON fr.vehicle_id = v.id 
                WHERE fr.vehicle_id IN (${placeholders}) 
                ORDER BY fr.fecha DESC LIMIT 10`, 
                vehicleIds, (err, recentFuel) => {
            
            // Handle errors
            if (err) {
                console.error('Error getting recent fuel:', err);
            }
            
            // Get maintenance records
            db.allConverted(`SELECT mr.*, v.numero_vehiculo, v.marca, v.modelo 
                    FROM maintenance_records mr 
                    JOIN vehicles v ON mr.vehicle_id = v.id 
                    WHERE mr.vehicle_id IN (${placeholders}) 
                    ORDER BY mr.fecha DESC LIMIT 10`, 
                    vehicleIds, (err, recentMaintenance) => {
                
                // Handle errors
                if (err) {
                    console.error('Error getting recent maintenance:', err);
                }
                
                // Get statistics
                const statsQuery = `SELECT 
                    COUNT(*) as totalVehicles,
                    COALESCE(SUM(CASE WHEN estado = 'Activo' THEN 1 ELSE 0 END), 0) as activeVehicles
                    FROM vehicles WHERE user_id = ?`;
                console.log('📝 Executing stats query with userId:', userId);
                console.log('📝 Query:', statsQuery);
                
                db.getConverted(statsQuery, [userId], (err, vehicleStats) => {
                    
                    // Handle errors
                    if (err) {
                        console.error('❌ Error getting vehicle stats:', err);
                        console.error('❌ Error details:', JSON.stringify(err, null, 2));
                        vehicleStats = { totalVehicles: vehicles.length, activeVehicles: vehicles.filter(v => v.estado === 'Activo').length };
                    }
                    
                    // Convert to numbers (PostgreSQL may return strings or BigInt)
                    if (vehicleStats) {
                        const originalTotal = vehicleStats.totalVehicles;
                        const originalActive = vehicleStats.activeVehicles;
                        vehicleStats.totalVehicles = parseInt(vehicleStats.totalVehicles) || vehicles.length || 0;
                        vehicleStats.activeVehicles = parseInt(vehicleStats.activeVehicles) || vehicles.filter(v => v.estado === 'Activo').length || 0;
                        console.log('📊 Vehicle Stats (raw):', { totalVehicles: originalTotal, activeVehicles: originalActive });
                        console.log('📊 Vehicle Stats (converted):', vehicleStats);
                    } else {
                        vehicleStats = { totalVehicles: vehicles.length, activeVehicles: vehicles.filter(v => v.estado === 'Activo').length };
                        console.log('⚠️ Vehicle Stats is null, using vehicles array count:', vehicleStats);
                    }
                    
                    db.getConverted(`SELECT COALESCE(SUM(costo_total), 0) as totalFuelCost 
                            FROM fuel_records 
                            WHERE vehicle_id IN (${placeholders}) 
                            AND fecha >= date('now', '-30 days')`, 
                            vehicleIds, (err, fuelStats) => {
                        
                        // Handle errors
                        if (err) {
                            console.error('Error getting fuel stats:', err);
                            fuelStats = { totalFuelCost: 0 };
                        }
                        
                        // Convert to number
                        if (fuelStats) {
                            fuelStats.totalFuelCost = parseFloat(fuelStats.totalFuelCost) || 0;
                        } else {
                            fuelStats = { totalFuelCost: 0 };
                        }
                        
                        db.getConverted(`SELECT COUNT(*) as pendingMaintenance 
                                FROM maintenance_records 
                                WHERE vehicle_id IN (${placeholders}) 
                                AND tipo = 'Preventivo' 
                                AND proximo_mantenimiento_km <= (SELECT kilometraje_actual FROM vehicles WHERE id = maintenance_records.vehicle_id)`, 
                                vehicleIds, (err, maintStats) => {
                            
                            // Handle errors
                            if (err) {
                                console.error('Error getting maintenance stats:', err);
                                maintStats = { pendingMaintenance: 0 };
                            }
                            
                            // Convert to number
                            if (maintStats) {
                                maintStats.pendingMaintenance = parseInt(maintStats.pendingMaintenance) || 0;
                            } else {
                                maintStats = { pendingMaintenance: 0 };
                            }
                            
                            db.getConverted(`SELECT COUNT(*) as expiringPolicies 
                                    FROM insurance_policies 
                                    WHERE vehicle_id IN (${placeholders}) 
                                    AND fecha_vencimiento BETWEEN date('now') AND date('now', '+30 days') 
                                    AND estado = 'Vigente'`, 
                                    vehicleIds, (err, policyStats) => {
                                
                                // Handle errors
                                if (err) {
                                    console.error('Error getting policy stats:', err);
                                    policyStats = { expiringPolicies: 0 };
                                }
                                
                                // Convert to number
                                if (policyStats) {
                                    policyStats.expiringPolicies = parseInt(policyStats.expiringPolicies) || 0;
                                } else {
                                    policyStats = { expiringPolicies: 0 };
                                }
                                
                                // Get all types of alerts
                                // 1. Insurance policies expiring
                                db.all(`SELECT 
                                        v.numero_vehiculo, 
                                        v.marca, 
                                        v.modelo, 
                                        ip.fecha_vencimiento,
                                        CASE 
                                            WHEN date(ip.fecha_vencimiento) <= date('now', '+7 days') THEN 'danger'
                                            WHEN date(ip.fecha_vencimiento) <= date('now', '+15 days') THEN 'warning'
                                            ELSE 'info'
                                        END as priority
                                        FROM insurance_policies ip
                                        JOIN vehicles v ON ip.vehicle_id = v.id
                                        WHERE ip.vehicle_id IN (${placeholders})
                                        AND ip.fecha_vencimiento BETWEEN date('now') AND date('now', '+30 days')
                                        AND ip.estado = 'Vigente'
                                        ORDER BY ip.fecha_vencimiento ASC`, 
                                        vehicleIds, (err, policyAlerts) => {
                                    
                                    // Handle errors
                                    if (err) {
                                        console.error('Error getting policy alerts:', err);
                                    }
                                    
                                    // 2. Maintenance alerts (preventive maintenance due)
                                    db.all(`SELECT 
                                            v.numero_vehiculo,
                                            v.marca,
                                            v.modelo,
                                            v.kilometraje_actual,
                                            mr.proximo_mantenimiento_km,
                                            mr.tipo,
                                            (v.kilometraje_actual - mr.proximo_mantenimiento_km) as km_overdue,
                                            CASE 
                                                WHEN v.kilometraje_actual >= mr.proximo_mantenimiento_km THEN 'danger'
                                                WHEN (mr.proximo_mantenimiento_km - v.kilometraje_actual) <= 500 THEN 'warning'
                                                ELSE 'info'
                                            END as priority
                                            FROM vehicles v
                                            JOIN maintenance_records mr ON v.id = mr.vehicle_id
                                            WHERE v.id IN (${placeholders})
                                            AND mr.tipo = 'Preventivo'
                                            AND (v.kilometraje_actual >= mr.proximo_mantenimiento_km 
                                                 OR (mr.proximo_mantenimiento_km - v.kilometraje_actual) <= 1000)
                                            ORDER BY (v.kilometraje_actual - mr.proximo_mantenimiento_km) DESC`, 
                                            vehicleIds, (err, maintenanceAlerts) => {
                                        
                                        // Handle errors
                                        if (err) {
                                            console.error('Error getting maintenance alerts:', err);
                                        }
                                        
                                        // Combine all alerts into a structured format
                                        const allAlerts = [];
                                        
                                        // Add policy alerts
                                        (policyAlerts || []).forEach(alert => {
                                            allAlerts.push({
                                                type: 'policy',
                                                icon: 'fa-shield-alt',
                                                title: `Póliza próxima a vencer: ${alert.numero_vehiculo}`,
                                                description: `${alert.marca} ${alert.modelo} - Vence: ${new Date(alert.fecha_vencimiento).toLocaleDateString('es-ES')}`,
                                                priority: alert.priority,
                                                date: alert.fecha_vencimiento
                                            });
                                        });
                                        
                                        // Add maintenance alerts
                                        (maintenanceAlerts || []).forEach(alert => {
                                            const kmStatus = alert.km_overdue > 0 
                                                ? `${Math.abs(alert.km_overdue).toLocaleString()} km vencidos`
                                                : `Faltan ${Math.abs(alert.km_overdue).toLocaleString()} km`;
                                            allAlerts.push({
                                                type: 'maintenance',
                                                icon: 'fa-tools',
                                                title: `Mantenimiento preventivo: ${alert.numero_vehiculo}`,
                                                description: `${alert.marca} ${alert.modelo} - ${kmStatus} (KM actual: ${alert.kilometraje_actual.toLocaleString()})`,
                                                priority: alert.priority,
                                                kmOverdue: alert.km_overdue
                                            });
                                        });
                                        
                                        // Sort alerts by priority (danger first, then warning, then info)
                                        const priorityOrder = { 'danger': 0, 'warning': 1, 'info': 2 };
                                        allAlerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
                                        
                                        // Store alerts for rendering (define in outer scope)
                                        const alerts = allAlerts;
                                        
                                        // Debug: Log alert counts
                                        console.log('Alert counts - Policies:', (policyAlerts || []).length, 
                                                   'Maintenance:', (maintenanceAlerts || []).length);
                                        
                                        // Calculate alert counts for template
                                        const alertCounts = {
                                            total: alerts.length,
                                            danger: alerts.filter(a => a.priority === 'danger').length,
                                            warning: alerts.filter(a => a.priority === 'warning').length,
                                            info: alerts.filter(a => a.priority === 'info').length,
                                            hasAlerts: alerts.length > 0
                                        };
                                        
                                        // Calculate advanced statistics
                                        // Fuel consumption per vehicle (km/litro)
                                        db.all(`SELECT 
                                                v.id,
                                                v.numero_vehiculo,
                                                v.marca,
                                                v.modelo,
                                                v.kilometraje_actual,
                                                COUNT(fr.id) as fuel_records_count,
                                                SUM(fr.litros) as total_litros,
                                                MIN(fr.kilometraje) as min_km,
                                                MAX(fr.kilometraje) as max_km
                                                FROM vehicles v
                                                LEFT JOIN fuel_records fr ON v.id = fr.vehicle_id
                                                WHERE v.id IN (${placeholders})
                                                GROUP BY v.id`, 
                                                vehicleIds, (err, fuelConsumption) => {
                                                
                                                // Handle errors
                                                if (err) {
                                                    console.error('Error getting fuel consumption:', err);
                                                }
                                                
                                                // Calculate average consumption per vehicle
                                                const vehicleConsumption = (fuelConsumption || []).map(v => {
                                                    const kmDiff = (v.max_km && v.min_km && v.max_km > v.min_km) ? (v.max_km - v.min_km) : 0;
                                                    const totalLitros = v.total_litros || 0;
                                                    const avgConsumption = totalLitros > 0 && kmDiff > 0 ? parseFloat((kmDiff / totalLitros).toFixed(2)) : 0;
                                                    return {
                                                        ...v,
                                                        avgConsumption: avgConsumption,
                                                        kmDiff: kmDiff,
                                                        fuel_records_count: v.fuel_records_count || 0
                                                    };
                                                });
                                                
                                                // Get cost trends (last 6 months)
                                                db.all(`SELECT 
                                                    strftime('%Y-%m', fecha) as month,
                                                    SUM(costo_total) as total_cost,
                                                    SUM(litros) as total_litros
                                                    FROM fuel_records
                                                    WHERE vehicle_id IN (${placeholders})
                                                    AND fecha >= date('now', '-6 months')
                                                    GROUP BY strftime('%Y-%m', fecha)
                                                    ORDER BY month`, 
                                                    vehicleIds, (err, costTrends) => {
                                                    
                                                    // Handle errors
                                                    if (err) {
                                                        console.error('Error getting cost trends:', err);
                                                    }
                                                    
                                                    // Get maintenance costs by period
                                                    db.all(`SELECT 
                                                        strftime('%Y-%m', fecha) as month,
                                                        SUM(costo) as total_cost,
                                                        COUNT(*) as count
                                                        FROM maintenance_records
                                                        WHERE vehicle_id IN (${placeholders})
                                                        AND fecha >= date('now', '-6 months')
                                                        GROUP BY strftime('%Y-%m', fecha)
                                                        ORDER BY month`, 
                                                        vehicleIds, (err, maintenanceTrends) => {
                                                        
                                                        // Handle errors
                                                        if (err) {
                                                            console.error('Error getting maintenance trends:', err);
                                                        }
                                                        
                                                        // Get vehicle comparisons
                                                        db.allConverted(`SELECT 
                                                            v.id,
                                                            v.numero_vehiculo,
                                                            v.marca,
                                                            v.modelo,
                                                            COALESCE(SUM(fr.costo_total), 0) as total_fuel_cost,
                                                            COALESCE(SUM(mr.costo), 0) as total_maintenance_cost,
                                                            COALESCE(COUNT(DISTINCT fr.id), 0) as fuel_records,
                                                            COALESCE(COUNT(DISTINCT mr.id), 0) as maintenance_records
                                                            FROM vehicles v
                                                            LEFT JOIN fuel_records fr ON v.id = fr.vehicle_id
                                                            LEFT JOIN maintenance_records mr ON v.id = mr.vehicle_id
                                                            WHERE v.id IN (${placeholders})
                                                            GROUP BY v.id
                                                            ORDER BY (COALESCE(SUM(fr.costo_total), 0) + COALESCE(SUM(mr.costo), 0)) DESC`, 
                                                            vehicleIds, (err, vehicleComparisons) => {
                                                            
                                                            // Handle errors
                                                            if (err) {
                                                                console.error('Error getting vehicle comparisons:', err);
                                                            }
                                                            
                                                            // Performance statistics by period
                                                            db.all(`SELECT 
                                                                strftime('%Y-%m', fr.fecha) as period,
                                                                COUNT(DISTINCT fr.vehicle_id) as vehicles_count,
                                                                SUM(fr.litros) as total_litros,
                                                                SUM(fr.costo_total) as total_fuel_cost,
                                                                AVG(fr.costo_total / fr.litros) as avg_price_per_liter
                                                                FROM fuel_records fr
                                                                WHERE fr.vehicle_id IN (${placeholders})
                                                                AND fr.fecha >= date('now', '-12 months')
                                                                GROUP BY strftime('%Y-%m', fr.fecha)
                                                                ORDER BY period`, 
                                                                vehicleIds, (err, performanceStats) => {
                                                                
                                                                // Handle errors
                                                                if (err) {
                                                                    console.error('Error getting performance stats:', err);
                                                                }

                                                                // Cargar historial de notificaciones automáticas
                                                                db.all(
                                                                    `SELECT * FROM notifications_queue 
                                                                     WHERE user_id = ? 
                                                                     ORDER BY created_at DESC 
                                                                     LIMIT 20`,
                                                                    [userId],
                                                                    (errNotif, notificationsHistory) => {
                                                                        if (errNotif) {
                                                                            console.error('Error loading notifications history:', errNotif);
                                                                            notificationsHistory = [];
                                                                        }

                                                                        // Log final stats before rendering
                                                                        // Use vehicles array as fallback if stats query failed
                                                                        const vehiclesCount = vehicles ? vehicles.length : 0;
                                                                        const activeVehiclesCount = vehicles ? vehicles.filter(v => v.estado === 'Activo').length : 0;
                                                                        
                                                                        const finalStats = {
                                                                            totalVehicles: vehicleStats && vehicleStats.totalVehicles !== undefined 
                                                                                ? parseInt(vehicleStats.totalVehicles) || vehiclesCount 
                                                                                : vehiclesCount,
                                                                            activeVehicles: vehicleStats && vehicleStats.activeVehicles !== undefined 
                                                                                ? parseInt(vehicleStats.activeVehicles) || activeVehiclesCount 
                                                                                : activeVehiclesCount,
                                                                            totalFuelCost: fuelStats && fuelStats.totalFuelCost !== undefined 
                                                                                ? parseFloat(fuelStats.totalFuelCost) || 0 
                                                                                : 0,
                                                                            pendingMaintenance: maintStats && maintStats.pendingMaintenance !== undefined 
                                                                                ? parseInt(maintStats.pendingMaintenance) || 0 
                                                                                : 0,
                                                                            expiringPolicies: policyStats && policyStats.expiringPolicies !== undefined 
                                                                                ? parseInt(policyStats.expiringPolicies) || 0 
                                                                                : 0
                                                                        };
                                                                        console.log('📊 Final Stats being sent to template:', finalStats);
                                                                        console.log('📊 Vehicles count from array:', vehiclesCount);
                                                                        console.log('📊 Active vehicles from array:', activeVehiclesCount);
                                                                        console.log('📊 Raw vehicleStats:', vehicleStats);
                                                                        console.log('📊 Raw fuelStats:', fuelStats);
                                                                        console.log('📊 Raw maintStats:', maintStats);
                                                                        console.log('📊 Raw policyStats:', policyStats);
                                                                        
                                                                        res.render('dashboard', {
                                                                            user: req.session,
                                                                            vehicles: vehicles,
                                                                            stats: finalStats,
                                                                            recentFuel: recentFuel || [],
                                                                            recentMaintenance: recentMaintenance || [],
                                                                            alerts: alerts || [],
                                                                            alertCounts: alertCounts || { total: 0, danger: 0, warning: 0, info: 0, hasAlerts: false },
                                                                            vehicleConsumption: vehicleConsumption || [],
                                                                            costTrends: costTrends || [],
                                                                            maintenanceTrends: maintenanceTrends || [],
                                                                            vehicleComparisons: vehicleComparisons || [],
                                                                            performanceStats: performanceStats || [],
                                                                            notificationsHistory: notificationsHistory || [],
                                                                            hasNotificationsHistory: (notificationsHistory && notificationsHistory.length > 0) || false
                                                                        });
                                                                    }
                                                                );
                                                            });
                                                        });
                                                    });
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

app.get('/vehicles', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all(`SELECT v.*
            FROM vehicles v 
            WHERE v.user_id = ? 
            ORDER BY v.numero_vehiculo`, 
            [userId], (err, vehicles) => {
        if (err) {
            return res.status(500).send('Error al cargar vehículos');
        }
        res.render('vehicles', { user: req.session, vehicles: vehicles || [] });
    });
});

app.get('/vehicles/:id', requireAuth, (req, res) => {
    const vehicleId = req.params.id;
    const userId = req.session.userId;
    
    db.getConverted('SELECT * FROM vehicles WHERE id = ? AND user_id = ?', [vehicleId, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(404).send('Vehículo no encontrado');
        }
        
        // Get fuel records
        db.allConverted('SELECT * FROM fuel_records WHERE vehicle_id = ? ORDER BY fecha DESC', [vehicleId], (err, fuelRecords) => {
            
            // Get maintenance records
            db.allConverted('SELECT * FROM maintenance_records WHERE vehicle_id = ? ORDER BY fecha DESC', [vehicleId], (err, maintenanceRecords) => {
                
                // Get insurance policies
                db.allConverted('SELECT * FROM insurance_policies WHERE vehicle_id = ? ORDER BY fecha_vencimiento DESC', [vehicleId], (err, policies) => {
                    
                    // Get tires
                    db.allConverted('SELECT * FROM tires WHERE vehicle_id = ? ORDER BY fecha_instalacion DESC', [vehicleId], (err, tires) => {
                        
                        res.render('vehicle-detail', {
                            user: req.session,
                            vehicle: vehicle,
                            fuelRecords: fuelRecords || [],
                            maintenanceRecords: maintenanceRecords || [],
                            policies: policies || [],
                            tires: tires || []
                        });
                    });
                });
            });
        });
    });
});

// Route to create sample data for testing
app.get('/create-sample-data', requireAuth, (req, res) => {
    createSampleData();
    res.send('<h1>Datos de prueba creados</h1><p>Los datos de prueba se han creado. <a href="/dashboard">Volver al dashboard</a></p>');
});

// API Routes for AJAX
app.get('/api/vehicles', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all('SELECT * FROM vehicles WHERE user_id = ?', [userId], (err, vehicles) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cargar vehículos' });
        }
        res.json(vehicles || []);
    });
});

// Cache para prevenir duplicados en la misma sesión
const recentVehicleSubmissions = new Map();

app.post('/api/vehicles', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { 
        numero_vehiculo, marca, modelo, año, placas, kilometraje_actual, estado,
        descripcion, numero_serie
    } = req.body;
    
    // Crear una clave única para esta solicitud
    const requestKey = `${userId}-${numero_vehiculo}-${Date.now()}`;
    const submissionKey = `${userId}-${numero_vehiculo}-${marca}-${modelo}`;
    
    // Verificar si hay una solicitud duplicada reciente (últimos 2 segundos)
    if (recentVehicleSubmissions.has(submissionKey)) {
        const lastSubmission = recentVehicleSubmissions.get(submissionKey);
        if (Date.now() - lastSubmission < 2000) {
            console.log('Solicitud duplicada detectada, ignorando...');
            return res.status(409).json({ error: 'Solicitud duplicada detectada' });
        }
    }
    
    // Registrar esta solicitud
    recentVehicleSubmissions.set(submissionKey, Date.now());
    
    // Limpiar entradas antiguas después de 5 segundos
    setTimeout(() => {
        recentVehicleSubmissions.delete(submissionKey);
    }, 5000);
    
    db.runConverted(`INSERT INTO vehicles (
        user_id, numero_vehiculo, marca, modelo, año, placas, kilometraje_actual, estado,
        descripcion, numero_serie
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId, numero_vehiculo, marca, modelo, año, placas, kilometraje_actual || 0, estado || 'Activo',
            descripcion || null, numero_serie || null
        ],
        (err, result) => {
            if (err) {
                console.error('Error creating vehicle:', err);
                recentVehicleSubmissions.delete(submissionKey);
                return res.status(500).json({ error: 'Error al crear vehículo: ' + err.message });
            }
            
            const vehicleId = result?.lastID;
            if (!vehicleId) {
                recentVehicleSubmissions.delete(submissionKey);
                return res.status(500).json({ error: 'Error: No se pudo obtener el ID del vehículo creado' });
            }
            // Registrar en historial
            logActivity(userId, 'vehicle', vehicleId, 'created', 
                `Vehículo creado: ${numero_vehiculo} - ${marca} ${modelo}`, null, req.body);
            
            res.json({ success: true, id: vehicleId });
        });
});

// Eliminar vehículo
app.delete('/api/vehicles/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const vehicleId = req.params.id;

    // Verificar que el vehículo pertenece al usuario
    db.getConverted('SELECT * FROM vehicles WHERE id = ? AND user_id = ?', [vehicleId, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(404).json({ error: 'Vehículo no encontrado' });
        }

        // Obtener datos antes de eliminar para el historial
        const vehicleData = { ...vehicle };

        // Eliminar registros relacionados primero (en orden inverso de dependencias)
        // 1. Eliminar attachments relacionados con el vehículo
        db.runConverted('DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?', ['vehicle', vehicleId], (err) => {
            if (err) console.error('Error eliminando attachments:', err);
            
            // 2. Eliminar tire_reviews (depende de tires)
            db.runConverted('DELETE FROM tire_reviews WHERE tire_id IN (SELECT id FROM tires WHERE vehicle_id = ?)', [vehicleId], (err) => {
                if (err) console.error('Error eliminando tire_reviews:', err);
                
                // 3. Eliminar tires
                db.runConverted('DELETE FROM tires WHERE vehicle_id = ?', [vehicleId], (err) => {
                    if (err) console.error('Error eliminando tires:', err);
                    
                    // 4. Eliminar siniestros
                    db.runConverted('DELETE FROM siniestros WHERE vehicle_id = ?', [vehicleId], (err) => {
                        if (err) console.error('Error eliminando siniestros:', err);
                        
                        // 5. Eliminar service_orders (puede depender de siniestros, pero ya los eliminamos)
                        db.runConverted('DELETE FROM service_orders WHERE vehicle_id = ?', [vehicleId], (err) => {
                            if (err) console.error('Error eliminando service_orders:', err);
                            
                            // 6. Eliminar invoices relacionadas con service_orders del vehículo
                            db.runConverted('DELETE FROM invoices WHERE service_order_id IN (SELECT id FROM service_orders WHERE vehicle_id = ?)', [vehicleId], (err) => {
                                if (err) console.error('Error eliminando invoices:', err);
                                
                                // 7. Eliminar insurance_policies
                                db.runConverted('DELETE FROM insurance_policies WHERE vehicle_id = ?', [vehicleId], (err) => {
                                    if (err) console.error('Error eliminando insurance_policies:', err);
                                    
                                    // 8. Eliminar maintenance_records
                                    db.runConverted('DELETE FROM maintenance_records WHERE vehicle_id = ?', [vehicleId], (err) => {
                                        if (err) console.error('Error eliminando maintenance_records:', err);
                                        
                                        // 9. Eliminar fuel_records
                                        db.runConverted('DELETE FROM fuel_records WHERE vehicle_id = ?', [vehicleId], (err) => {
                                            if (err) console.error('Error eliminando fuel_records:', err);
                                            
                                            // 10. Finalmente eliminar el vehículo
                                            db.runConverted('DELETE FROM vehicles WHERE id = ? AND user_id = ?', [vehicleId, userId], (err, result) => {
                                                if (err) {
                                                    console.error('Error eliminando vehículo:', err);
                                                    return res.status(500).json({ error: 'Error al eliminar vehículo: ' + err.message });
                                                }

                                                // Registrar en historial (sin bloquear si falla)
                                                try {
                                                    logActivity(userId, 'vehicle', vehicleId, 'deleted',
                                                        `Vehículo eliminado: ${vehicle.numero_vehiculo} - ${vehicle.marca} ${vehicle.modelo}`, vehicleData, null);
                                                } catch (logErr) {
                                                    console.error('Error registrando en historial:', logErr);
                                                    // No fallar la eliminación si el historial falla
                                                }

                                                res.json({ success: true, message: 'Vehículo eliminado exitosamente' });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/fuel', requireAuth, (req, res) => {
    const { vehicle_id, fecha, litros, precio_litro, kilometraje, estacion, ticket_gasolina } = req.body;
    const costo_total = litros * precio_litro;
    
    // Verify vehicle belongs to user
    db.get('SELECT user_id FROM vehicles WHERE id = ?', [vehicle_id], (err, vehicle) => {
        if (err || !vehicle || vehicle.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        
        db.run(`INSERT INTO fuel_records (vehicle_id, fecha, litros, precio_litro, costo_total, kilometraje, estacion, ticket_gasolina) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [vehicle_id, fecha, litros, precio_litro, costo_total, kilometraje, estacion, ticket_gasolina || null],
            (err, result) => {
                if (err) {
                    console.error('Error creating fuel record:', err);
                    return res.status(500).json({ error: 'Error al registrar combustible: ' + err.message });
                }
                const fuelId = result?.lastID;
                // Registrar en historial
                logActivity(req.session.userId, 'vehicle', vehicle_id, 'fuel_record_added',
                    `Registro de combustible agregado: ${litros}L - $${costo_total.toFixed(2)}`, null, { litros, costo_total, fecha });
                res.json({ success: true, id: fuelId });
            });
    });
});

app.post('/api/maintenance', requireAuth, (req, res) => {
    const { vehicle_id, tipo, fecha, kilometraje, descripcion, costo, taller, proximo_mantenimiento_km } = req.body;
    
    // Verify vehicle belongs to user
    db.get('SELECT user_id FROM vehicles WHERE id = ?', [vehicle_id], (err, vehicle) => {
        if (err || !vehicle || vehicle.user_id !== req.session.userId) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        
        db.run(`INSERT INTO maintenance_records (vehicle_id, tipo, fecha, kilometraje, descripcion, costo, taller, proximo_mantenimiento_km) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [vehicle_id, tipo, fecha, kilometraje, descripcion, costo, taller, proximo_mantenimiento_km],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al registrar mantenimiento' });
                }
                const maintId = result?.lastID;
                // Registrar en historial
                logActivity(req.session.userId, 'vehicle', vehicle_id, 'maintenance_added',
                    `Mantenimiento ${tipo} agregado: ${descripcion || 'Sin descripción'}`, null, { tipo, fecha, costo });
                res.json({ success: true, id: maintId });
            });
    });
});


// Insurance Policies routes
app.get('/policies', requireAuth, (req, res) => {
    const userId = req.session.userId;
    db.all(`SELECT p.*, v.numero_vehiculo, v.marca, v.modelo 
            FROM insurance_policies p
            JOIN vehicles v ON p.vehicle_id = v.id
            WHERE v.user_id = ?
            ORDER BY p.fecha_vencimiento DESC`, [userId], (err, policies) => {
        if (err) {
            return res.status(500).send('Error al cargar pólizas');
        }
        // Get vehicles for dropdown
        db.all('SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
            if (err) {
                return res.status(500).send('Error al cargar vehículos');
            }
            res.render('policies', { user: req.session, policies: policies || [], vehicles: vehicles || [] });
        });
    });
});

// API Routes for React Frontend
app.get('/api/check-auth', requireAuth, (req, res) => {
    res.json({ 
        id: req.session.userId, 
        username: req.session.username,
        nombre: req.session.nombre,
        email: req.session.email 
    });
});

app.get('/api/policies', requireAuth, (req, res) => {
    const userId = req.session.userId;
    db.all(`SELECT p.*, v.numero_vehiculo, v.marca, v.modelo 
            FROM insurance_policies p
            JOIN vehicles v ON p.vehicle_id = v.id
            WHERE v.user_id = ?
            ORDER BY p.fecha_vencimiento DESC`, [userId], (err, policies) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cargar pólizas' });
        }
        res.json(policies || []);
    });
});

app.post('/api/policies', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { vehicle_id, numero_poliza, compania, fecha_inicio, fecha_vencimiento, tipo_cobertura, costo_anual, estado } = req.body;
    
    if (!vehicle_id || !numero_poliza) {
        return res.status(400).json({ error: 'Vehículo y número de póliza son requeridos' });
    }
    
    // Verify vehicle belongs to user
    db.getConverted('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicle_id, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(403).json({ error: 'Vehículo no encontrado' });
        }

        // Obtener email del usuario para mandar alerta a su Gmail (o el correo que registró)
        db.get('SELECT email FROM users WHERE id = ?', [userId], (errUser, userRow) => {
            if (errUser || !userRow) {
                console.error('No se pudo obtener el email del usuario para la póliza:', errUser);
            }

            const userEmail = userRow?.email || null;
            console.log('📧 Email del usuario para póliza:', userEmail);
            console.log('📧 MailTransporter configurado:', !!mailTransporter);
            console.log('📧 GMAIL_USER configurado:', !!process.env.GMAIL_USER);

            db.runConverted(`INSERT INTO insurance_policies (vehicle_id, numero_poliza, compania, fecha_inicio, fecha_vencimiento, tipo_cobertura, costo_anual, estado)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [vehicle_id, numero_poliza, compania || null, fecha_inicio || null, fecha_vencimiento || null, tipo_cobertura || null, costo_anual || null, estado || 'Vigente'],
                (err, result) => {
                    if (err) {
                        return res.status(500).json({ error: 'Error al crear póliza' });
                    }

                    const policyId = result?.lastID;
                    if (!policyId) {
                        return res.status(500).json({ error: 'Error: No se pudo obtener el ID de la póliza creada' });
                    }

                    // Encolar notificación automática de póliza nueva / próxima a vencer
                    const scheduledAt = fecha_vencimiento || null;
                    db.run(`INSERT INTO notifications_queue (
                                user_id, channel, tipo, destino, asunto, mensaje, scheduled_at, status
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
                        [
                            userId,
                            'email',
                            'alerta_poliza',
                            userEmail,
                            'Nueva póliza registrada',
                            `Se registró la póliza ${numero_poliza} para el vehículo ID ${vehicle_id}.`,
                            scheduledAt
                        ],
                        function (errNotif) {
                            if (errNotif) {
                                console.error('Error encolando notificación de póliza:', errNotif.message);
                            }
                        }
                    );

                    // Registrar en historial
                    if (!policyId) {
                        return res.status(500).json({ error: 'Error: No se pudo obtener el ID de la póliza creada' });
                    }
                    logActivity(userId, 'vehicle', vehicle_id, 'policy_created',
                        `Póliza creada: ${numero_poliza} - ${compania || 'Sin compañía'}`, null, { numero_poliza, compania, tipo_cobertura });
                    logActivity(userId, 'policy', policyId, 'created',
                        `Póliza ${numero_poliza} creada para vehículo ID ${vehicle_id}`, null, { numero_poliza, compania });

                    // Enviar correo inmediato si el transporter está configurado
                    if (mailTransporter && userEmail) {
                        const mailOptions = {
                            from: process.env.GMAIL_USER,
                            to: userEmail,
                            subject: 'Nueva póliza registrada',
                            text: `Se registró la póliza ${numero_poliza} para uno de tus vehículos en CRM Insurance System.`
                        };

                        mailTransporter.sendMail(mailOptions, (errSend) => {
                            if (errSend) {
                                console.error('Error enviando correo de póliza:', errSend);
                            } else {
                                console.log('Correo de póliza enviado a', userEmail);
                            }
                        });
                    }

                    res.json({ success: true, id: policyId });
                });
        });
    });
});

app.put('/api/policies/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const policyId = req.params.id;
    const { vehicle_id, numero_poliza, compania, fecha_inicio, fecha_vencimiento, tipo_cobertura, costo_anual, estado } = req.body;
    
    // Verify policy belongs to user
    db.get(`SELECT p.id FROM insurance_policies p
            JOIN vehicles v ON p.vehicle_id = v.id
            WHERE p.id = ? AND v.user_id = ?`, [policyId, userId], (err, policy) => {
        if (err || !policy) {
            return res.status(403).json({ error: 'Póliza no encontrada' });
        }
        
        // Verify vehicle belongs to user if changed
        if (vehicle_id) {
            db.get('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicle_id, userId], (err, vehicle) => {
                if (err || !vehicle) {
                    return res.status(403).json({ error: 'Vehículo no encontrado' });
                }
                
                updatePolicy();
            });
        } else {
            updatePolicy();
        }
        
        function updatePolicy() {
            db.run(`UPDATE insurance_policies 
                    SET vehicle_id = COALESCE(?, vehicle_id),
                        numero_poliza = COALESCE(?, numero_poliza),
                        compania = ?,
                        fecha_inicio = ?,
                        fecha_vencimiento = ?,
                        tipo_cobertura = ?,
                        costo_anual = ?,
                        estado = COALESCE(?, estado)
                    WHERE id = ?`,
                [vehicle_id, numero_poliza, compania || null, fecha_inicio || null, fecha_vencimiento || null, tipo_cobertura || null, costo_anual || null, estado, policyId],
                function(err) {
                    if (err) {
                        return res.status(500).json({ error: 'Error al actualizar póliza' });
                    }
                    res.json({ success: true });
                });
        }
    });
});

app.delete('/api/policies/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const policyId = req.params.id;
    
    // Verify policy belongs to user
    db.get(`SELECT ip.* FROM insurance_policies ip
            JOIN vehicles v ON ip.vehicle_id = v.id
            WHERE ip.id = ? AND v.user_id = ?`, [policyId, userId], (err, policy) => {
        if (err || !policy) {
            return res.status(403).json({ error: 'Póliza no encontrada' });
        }
        
        const policyData = { ...policy };
        
        db.run('DELETE FROM insurance_policies WHERE id = ?', [policyId], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Error al eliminar póliza' });
            }
            
            // Registrar en historial
            logActivity(userId, 'policy', policyId, 'deleted',
                `Póliza eliminada: ${policy.numero_poliza}`, policyData, null);
            logActivity(userId, 'vehicle', policy.vehicle_id, 'policy_deleted',
                `Póliza ${policy.numero_poliza} eliminada`, { numero_poliza: policy.numero_poliza }, null);
            
            res.json({ success: true });
        });
    });
});

// --- Rastreo de Ubicación GPS ---
// Endpoint para recibir ubicaciones desde el dispositivo
app.post('/api/location', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { vehicle_id, latitude, longitude, accuracy, altitude, heading, speed, device_info } = req.body;
    
    if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Latitud y longitud son requeridas' });
    }
    
    // Si se proporciona vehicle_id, verificar que pertenezca al usuario
    if (vehicle_id) {
        db.getConverted('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicle_id, userId], (err, vehicle) => {
            if (err || !vehicle) {
                return res.status(403).json({ error: 'Vehículo no encontrado' });
            }
            insertLocation();
        });
    } else {
        insertLocation();
    }
    
    function insertLocation() {
        db.runConverted(`INSERT INTO location_tracking 
                (user_id, vehicle_id, latitude, longitude, accuracy, altitude, heading, speed, device_info, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [userId, vehicle_id || null, latitude, longitude, accuracy || null, altitude || null, heading || null, speed || null, device_info || null],
            (err, result) => {
                if (err) {
                    console.error('Error guardando ubicación:', err);
                    return res.status(500).json({ error: 'Error al guardar ubicación: ' + err.message });
                }
                res.json({ success: true, id: result?.lastID });
            });
    }
});

// Obtener todas las ubicaciones del usuario (últimas 24 horas por defecto)
app.get('/api/location', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const hours = parseInt(req.query.hours) || 24;
    
    const query = db.type === 'postgresql'
        ? `SELECT l.*, v.numero_vehiculo, v.marca, v.modelo, v.placas
           FROM location_tracking l
           LEFT JOIN vehicles v ON l.vehicle_id = v.id
           WHERE l.user_id = $1 
           AND l.timestamp >= NOW() - INTERVAL '${hours} hours'
           ORDER BY l.timestamp DESC`
        : `SELECT l.*, v.numero_vehiculo, v.marca, v.modelo, v.placas
           FROM location_tracking l
           LEFT JOIN vehicles v ON l.vehicle_id = v.id
           WHERE l.user_id = ? 
           AND l.timestamp >= datetime('now', '-' || ? || ' hours')
           ORDER BY l.timestamp DESC`;
    
    const params = db.type === 'postgresql' ? [userId] : [userId, hours];
    
    db.allConverted(query, params, (err, locations) => {
        if (err) {
            console.error('Error obteniendo ubicaciones:', err);
            return res.status(500).json({ error: 'Error al obtener ubicaciones' });
        }
        res.json(locations || []);
    });
});

// Obtener ubicaciones de un vehículo específico
app.get('/api/location/vehicle/:vehicleId', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const vehicleId = req.params.vehicleId;
    const hours = parseInt(req.query.hours) || 24;
    
    // Verificar que el vehículo pertenezca al usuario
    db.getConverted('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicleId, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(403).json({ error: 'Vehículo no encontrado' });
        }
        
        const query = db.type === 'postgresql'
            ? `SELECT l.*, v.numero_vehiculo, v.marca, v.modelo, v.placas
               FROM location_tracking l
               JOIN vehicles v ON l.vehicle_id = v.id
               WHERE l.vehicle_id = $1 AND l.user_id = $2
               AND l.timestamp >= NOW() - INTERVAL '${hours} hours'
               ORDER BY l.timestamp DESC`
            : `SELECT l.*, v.numero_vehiculo, v.marca, v.modelo, v.placas
               FROM location_tracking l
               JOIN vehicles v ON l.vehicle_id = v.id
               WHERE l.vehicle_id = ? AND l.user_id = ?
               AND l.timestamp >= datetime('now', '-' || ? || ' hours')
               ORDER BY l.timestamp DESC`;
        
        const params = db.type === 'postgresql' ? [vehicleId, userId] : [vehicleId, userId, hours];
        
        db.allConverted(query, params, (err, locations) => {
            if (err) {
                console.error('Error obteniendo ubicaciones:', err);
                return res.status(500).json({ error: 'Error al obtener ubicaciones' });
            }
            res.json(locations || []);
        });
    });
});

// Obtener la última ubicación de cada vehículo del usuario
app.get('/api/location/latest', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    // Usar subquery compatible con SQLite y PostgreSQL
    if (db.type === 'postgresql') {
        db.allConverted(`SELECT DISTINCT ON (l.vehicle_id) l.*, v.numero_vehiculo, v.marca, v.modelo, v.placas
                FROM location_tracking l
                LEFT JOIN vehicles v ON l.vehicle_id = v.id
                WHERE l.user_id = $1
                ORDER BY l.vehicle_id, l.timestamp DESC`,
            [userId], (err, locations) => {
                if (err) {
                    console.error('Error obteniendo últimas ubicaciones:', err);
                    return res.status(500).json({ error: 'Error al obtener ubicaciones' });
                }
                res.json(locations || []);
            });
    } else {
        // SQLite - usar subquery
        db.allConverted(`SELECT l.*, v.numero_vehiculo, v.marca, v.modelo, v.placas
                FROM location_tracking l
                LEFT JOIN vehicles v ON l.vehicle_id = v.id
                WHERE l.user_id = ?
                AND l.id IN (
                    SELECT MAX(id) 
                    FROM location_tracking 
                    WHERE user_id = ? AND vehicle_id IS NOT NULL
                    GROUP BY vehicle_id
                )
                ORDER BY l.timestamp DESC`,
            [userId, userId], (err, locations) => {
                if (err) {
                    console.error('Error obteniendo últimas ubicaciones:', err);
                    return res.status(500).json({ error: 'Error al obtener ubicaciones' });
                }
                res.json(locations || []);
            });
    }
});

// Vista de rastreo GPS
app.get('/tracking', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    // Obtener vehículos del usuario
    db.allConverted('SELECT * FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
        if (err) {
            return res.status(500).send('Error al cargar vehículos');
        }
        
        res.render('tracking', { 
            user: req.session, 
            vehicles: vehicles || [] 
        });
    });
});

// Eliminar orden de servicio
app.delete('/api/service-orders/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const orderId = req.params.id;

    db.get('SELECT * FROM service_orders WHERE id = ? AND user_id = ?', [orderId, userId], (err, order) => {
        if (err || !order) {
            return res.status(404).json({ error: 'Orden de servicio no encontrada' });
        }

        const orderData = { ...order };

        db.run('DELETE FROM service_orders WHERE id = ? AND user_id = ?', [orderId, userId], function(err) {
            if (err) {
                console.error('Error eliminando orden de servicio:', err);
                return res.status(500).json({ error: 'Error al eliminar orden de servicio' });
            }

            logActivity(userId, 'service_order', orderId, 'deleted',
                `Orden de servicio eliminada: ${order.tipo || 'N/A'}`, orderData, null);
            if (order.vehicle_id) {
                logActivity(userId, 'vehicle', order.vehicle_id, 'service_order_deleted',
                    `Orden de servicio eliminada`, { tipo: order.tipo }, null);
            }

            res.json({ success: true });
        });
    });
});

// Eliminar factura
app.delete('/api/invoices/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const invoiceId = req.params.id;

    db.get('SELECT * FROM invoices WHERE id = ? AND user_id = ?', [invoiceId, userId], (err, invoice) => {
        if (err || !invoice) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        const invoiceData = { ...invoice };

        db.run('DELETE FROM invoices WHERE id = ? AND user_id = ?', [invoiceId, userId], function(err) {
            if (err) {
                console.error('Error eliminando factura:', err);
                return res.status(500).json({ error: 'Error al eliminar factura' });
            }

            logActivity(userId, 'invoice', invoiceId, 'deleted',
                `Factura eliminada: ${invoice.folio || 'N/A'}`, invoiceData, null);
            if (invoice.service_order_id) {
                logActivity(userId, 'service_order', invoice.service_order_id, 'invoice_deleted',
                    `Factura eliminada`, { folio: invoice.folio }, null);
            }

            res.json({ success: true });
        });
    });
});


app.get('/api/dashboard-stats', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    // Get vehicles
    db.all('SELECT * FROM vehicles WHERE user_id = ?', [userId], (err, vehicles) => {
        if (err) vehicles = [];
        
        const vehicleIds = vehicles.map(v => v.id);
        const placeholders = vehicleIds.map(() => '?').join(',');
        
        // Calculate stats
        const totalVehicles = vehicles.length;
        const activeVehicles = vehicles.filter(v => v.estado === 'Activo').length;
        
        // Get fuel cost (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const fuelQuery = vehicleIds.length > 0
            ? `SELECT SUM(costo_total) as total FROM fuel_records 
               WHERE vehicle_id IN (${placeholders}) AND fecha >= ?`
            : 'SELECT 0 as total';
        
        db.get(fuelQuery, [...vehicleIds, thirtyDaysAgo.toISOString().split('T')[0]], (err, fuelResult) => {
            const totalFuelCost = fuelResult?.total || 0;
            
            // Get pending maintenance
            const maintQuery = vehicleIds.length > 0
                ? `SELECT COUNT(*) as count FROM maintenance_records 
                   WHERE vehicle_id IN (${placeholders}) AND tipo = 'Preventivo' 
                   AND (proximo_mantenimiento_km IS NULL OR proximo_mantenimiento_km <= (SELECT kilometraje_actual FROM vehicles WHERE id = maintenance_records.vehicle_id))`
                : 'SELECT 0 as count';
            
            db.get(maintQuery, vehicleIds, (err, maintResult) => {
                const pendingMaintenance = maintResult?.count || 0;
                
                // Get expiring policies (next 30 days)
                const thirtyDaysFromNow = new Date();
                thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                
                const policyQuery = vehicleIds.length > 0
                    ? `SELECT COUNT(*) as count FROM insurance_policies 
                       WHERE vehicle_id IN (${placeholders}) 
                       AND fecha_vencimiento BETWEEN date('now') AND ? 
                       AND estado IN ('Vigente', 'Activa')`
                    : 'SELECT 0 as count';
                
                db.get(policyQuery, [...vehicleIds, thirtyDaysFromNow.toISOString().split('T')[0]], (err, policyResult) => {
                    const expiringPolicies = policyResult?.count || 0;
                    
                    // Get alerts
                    const alerts = [];
                    
                    // Policy alerts
                    if (vehicleIds.length > 0) {
                        db.all(`SELECT p.*, v.numero_vehiculo FROM insurance_policies p
                                JOIN vehicles v ON p.vehicle_id = v.id
                                WHERE p.vehicle_id IN (${placeholders}) 
                                AND p.fecha_vencimiento BETWEEN date('now') AND ?
                                AND p.estado IN ('Vigente', 'Activa')`,
                            [...vehicleIds, thirtyDaysFromNow.toISOString().split('T')[0]],
                            (err, expiringPoliciesList) => {
                                if (!err && expiringPoliciesList) {
                                    expiringPoliciesList.forEach(p => {
                                        const vencimiento = new Date(p.fecha_vencimiento);
                                        const hoy = new Date();
                                        const diasRestantes = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
                                        
                                        alerts.push({
                                            priority: diasRestantes <= 7 ? 'danger' : 'warning',
                                            title: `Póliza ${p.numero_poliza} por vencer`,
                                            description: `Vehículo #${p.numero_vehiculo} - Vence en ${diasRestantes} días`,
                                            icon: 'fa-file-contract'
                                        });
                                    });
                                }
                                
                                // Get recent fuel
                                const recentFuelQuery = vehicleIds.length > 0
                                    ? `SELECT fr.*, v.numero_vehiculo, v.marca, v.modelo 
                                       FROM fuel_records fr
                                       JOIN vehicles v ON fr.vehicle_id = v.id
                                       WHERE fr.vehicle_id IN (${placeholders})
                                       ORDER BY fr.fecha DESC LIMIT 10`
                                    : 'SELECT * FROM fuel_records WHERE 1=0';
                                
                                db.all(recentFuelQuery, vehicleIds, (err, recentFuel) => {
                                    // Get recent maintenance
                                    const recentMaintQuery = vehicleIds.length > 0
                                        ? `SELECT mr.*, v.numero_vehiculo, v.marca, v.modelo 
                                           FROM maintenance_records mr
                                           JOIN vehicles v ON mr.vehicle_id = v.id
                                           WHERE mr.vehicle_id IN (${placeholders})
                                           ORDER BY mr.fecha DESC LIMIT 10`
                                        : 'SELECT * FROM maintenance_records WHERE 1=0';
                                    
                                    db.all(recentMaintQuery, vehicleIds, (err, recentMaintenance) => {
                                        res.json({
                                            stats: {
                                                totalVehicles,
                                                activeVehicles,
                                                totalFuelCost,
                                                pendingMaintenance,
                                                expiringPolicies
                                            },
                                            alerts,
                                            recentFuel: recentFuel || [],
                                            recentMaintenance: recentMaintenance || []
                                        });
                                    });
                                });
                            });
                    } else {
                        res.json({
                            stats: {
                                totalVehicles: 0,
                                activeVehicles: 0,
                                totalFuelCost: 0,
                                pendingMaintenance: 0,
                                expiringPolicies: 0
                            },
                            alerts: [],
                            recentFuel: [],
                            recentMaintenance: []
                        });
                    }
                });
            });
        });
    });
});

// Accidents/Claims routes
app.get('/claims', requireAuth, (req, res) => {
    const userId = req.session.userId;
    db.all(`SELECT s.*, v.numero_vehiculo, v.marca, v.modelo, p.numero_poliza
            FROM siniestros s
            JOIN vehicles v ON s.vehicle_id = v.id
            LEFT JOIN insurance_policies p ON s.policy_id = p.id
            WHERE v.user_id = ?
            ORDER BY s.fecha_siniestro DESC`, [userId], (err, claims) => {
        if (err) {
            return res.status(500).send('Error al cargar siniestros');
        }
        // Get vehicles and policies for dropdowns
        db.all('SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
            if (err) {
                return res.status(500).send('Error al cargar vehículos');
            }
            db.all(`SELECT id, numero_poliza, vehicle_id FROM insurance_policies 
                    WHERE vehicle_id IN (SELECT id FROM vehicles WHERE user_id = ?) 
                    ORDER BY numero_poliza`, [userId], (err, policies) => {
                if (err) {
                    return res.status(500).send('Error al cargar pólizas');
                }
                res.render('claims', { user: req.session, claims: claims || [], vehicles: vehicles || [], policies: policies || [] });
            });
        });
    });
});

app.post('/api/claims', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { vehicle_id, policy_id, fecha_siniestro, tipo_siniestro, descripcion, monto_dano, estado, numero_referencia, compania_seguro } = req.body;
    
    if (!vehicle_id || !fecha_siniestro) {
        return res.status(400).json({ error: 'Vehículo y fecha son requeridos' });
    }
    
    // Verify vehicle belongs to user
    db.getConverted('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicle_id, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(403).json({ error: 'Vehículo no encontrado' });
        }
        
        db.runConverted(`INSERT INTO siniestros (vehicle_id, policy_id, fecha_siniestro, tipo_siniestro, descripcion, monto_dano, estado, numero_referencia, compania_seguro)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [vehicle_id, policy_id || null, fecha_siniestro, tipo_siniestro || null, descripcion || null, monto_dano || null, estado || 'En Proceso', numero_referencia || null, compania_seguro || null],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al crear siniestro' });
                }
                const claimId = result?.lastID;
                res.json({ success: true, id: claimId });
            });
    });
});

// Tires routes
app.get('/tires', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const vehicleId = req.query.vehicle_id;
    
    let query = `SELECT t.*, v.numero_vehiculo, v.marca, v.modelo, v.kilometraje_actual
                 FROM tires t
                 JOIN vehicles v ON t.vehicle_id = v.id
                 WHERE v.user_id = ?`;
    let params = [userId];
    
    if (vehicleId) {
        query += ' AND t.vehicle_id = ?';
        params.push(vehicleId);
    }
    
    query += ' ORDER BY t.fecha_instalacion DESC';
    
    db.allConverted(query, params, (err, tires) => {
        if (err) {
            console.error('Error loading tires:', err);
            return res.status(500).send('Error al cargar llantas');
        }
        // Get vehicles for dropdown - use allConverted for consistency
        db.allConverted('SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
            if (err) {
                console.error('Error loading vehicles for tires page:', err);
                return res.status(500).send('Error al cargar vehículos');
            }
            console.log('Vehicles loaded for tires page:', vehicles ? vehicles.length : 0);
            res.render('tires', { user: req.session, tires: tires || [], vehicles: vehicles || [], selectedVehicle: vehicleId });
        });
    });
});

app.post('/api/tires', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { vehicle_id, posicion, marca, modelo, medida, numero_serie, presion_psi, profundidad_mm, fecha_instalacion, kilometraje_instalacion, costo, estado } = req.body;
    
    if (!vehicle_id || !posicion) {
        return res.status(400).json({ error: 'Vehículo y posición son requeridos' });
    }
    
    // Verify vehicle belongs to user
    db.getConverted('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicle_id, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(403).json({ error: 'Vehículo no encontrado' });
        }
        
        db.runConverted(`INSERT INTO tires (vehicle_id, posicion, marca, modelo, medida, numero_serie, presion_psi, profundidad_mm, fecha_instalacion, kilometraje_instalacion, costo, estado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [vehicle_id, posicion, marca || null, modelo || null, medida || null, numero_serie || null, presion_psi || null, profundidad_mm || null, fecha_instalacion || null, kilometraje_instalacion || null, costo || null, estado || 'Activo'],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al crear registro de llanta' });
                }
                
                const tireId = result?.lastID;
                if (!tireId) {
                    return res.status(500).json({ error: 'Error: No se pudo obtener el ID de la llanta creada' });
                }
                
                // Registrar actividad
                logActivity(userId, 'tire', tireId, 'created', 
                    `Llantas ${posicion} agregada al vehículo`, null, { posicion: posicion, marca: marca, modelo: modelo });
                
                res.json({ success: true, id: tireId });
            });
    });
});

// Obtener revisiones mensuales de una llanta
app.get('/api/tires/:tire_id/reviews', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const tireId = req.params.tire_id;
    
    // Verificar que la llanta pertenece al usuario
    db.get(`SELECT t.id FROM tires t
            JOIN vehicles v ON t.vehicle_id = v.id
            WHERE t.id = ? AND v.user_id = ?`, [tireId, userId], (err, tire) => {
        if (err || !tire) {
            return res.status(403).json({ error: 'Llantas no encontrada' });
        }
        
        db.all(`SELECT * FROM tire_reviews 
                WHERE tire_id = ? 
                ORDER BY fecha_revision DESC, created_at DESC`, 
            [tireId], (err, reviews) => {
            if (err) {
                return res.status(500).json({ error: 'Error al cargar revisiones' });
            }
            res.json({ success: true, reviews: reviews || [] });
        });
    });
});

// Agregar revisión mensual de llanta
app.post('/api/tires/:tire_id/reviews', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const tireId = req.params.tire_id;
    const { fecha_revision, presion_psi, profundidad_mm, kilometraje, observaciones } = req.body;
    
    if (!fecha_revision) {
        return res.status(400).json({ error: 'Fecha de revisión es requerida' });
    }
    
    // Verificar que la llanta pertenece al usuario
    db.get(`SELECT t.id, t.vehicle_id FROM tires t
            JOIN vehicles v ON t.vehicle_id = v.id
            WHERE t.id = ? AND v.user_id = ?`, [tireId, userId], (err, tire) => {
        if (err || !tire) {
            return res.status(403).json({ error: 'Llantas no encontrada' });
        }
        
        db.run(`INSERT INTO tire_reviews (tire_id, fecha_revision, presion_psi, profundidad_mm, kilometraje, observaciones)
                VALUES (?, ?, ?, ?, ?, ?)`,
            [tireId, fecha_revision, presion_psi || null, profundidad_mm || null, kilometraje || null, observaciones || null],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: 'Error al crear revisión' });
                }
                
                const reviewId = result?.lastID;
                
                // Actualizar datos de la llanta con la última revisión
                const updateFields = [];
                const updateValues = [];
                if (presion_psi !== null && presion_psi !== undefined) {
                    updateFields.push('presion_psi = ?');
                    updateValues.push(presion_psi);
                }
                if (profundidad_mm !== null && profundidad_mm !== undefined) {
                    updateFields.push('profundidad_mm = ?');
                    updateValues.push(profundidad_mm);
                }
                
                if (updateFields.length > 0) {
                    updateValues.push(tireId);
                    db.run(`UPDATE tires SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
                }
                
                // Actualizar kilometraje del vehículo si se proporciona
                if (kilometraje !== null && kilometraje !== undefined && tire.vehicle_id) {
                    db.run(`UPDATE vehicles SET kilometraje_actual = ? WHERE id = ? AND kilometraje_actual < ?`, 
                        [kilometraje, tire.vehicle_id, kilometraje]);
                }
                
                // Registrar actividad
                logActivity(userId, 'tire', tireId, 'review_added', 
                    `Revisión mensual agregada: Presión ${presion_psi || 'N/A'} PSI, Profundidad ${profundidad_mm || 'N/A'} mm, KM ${kilometraje || 'N/A'}`, 
                    null, { fecha_revision: fecha_revision, presion_psi: presion_psi, profundidad_mm: profundidad_mm, kilometraje: kilometraje });
                
                res.json({ success: true, id: reviewId });
            });
    });
});

// Fines routes (Multas)
app.get('/fines', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const vehicleId = req.query.vehicle_id;
    const estado = req.query.estado;
    
    let query = `SELECT f.*, v.numero_vehiculo, v.marca, v.modelo
                 FROM fines f
                 JOIN vehicles v ON f.vehicle_id = v.id
                 WHERE v.user_id = ?`;
    let params = [userId];
    
    if (vehicleId) {
        query += ' AND f.vehicle_id = ?';
        params.push(vehicleId);
    }
    
    if (estado) {
        query += ' AND f.estado = ?';
        params.push(estado);
    }
    
    query += ' ORDER BY f.fecha DESC';
    
    db.allConverted(query, params, (err, fines) => {
        if (err) {
            console.error('Error loading fines:', err);
            return res.status(500).send('Error al cargar multas');
        }
        // Get vehicles for dropdown
        db.allConverted('SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
            if (err) {
                console.error('Error loading vehicles for fines page:', err);
                return res.status(500).send('Error al cargar vehículos');
            }
            res.render('fines', { 
                user: req.session, 
                fines: fines || [], 
                vehicles: vehicles || [], 
                selectedVehicle: vehicleId,
                selectedEstado: estado 
            });
        });
    });
});

app.get('/api/fines', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const vehicleId = req.query.vehicle_id;
    const estado = req.query.estado;
    
    let query = `SELECT f.*, v.numero_vehiculo, v.marca, v.modelo
                 FROM fines f
                 JOIN vehicles v ON f.vehicle_id = v.id
                 WHERE v.user_id = ?`;
    let params = [userId];
    
    if (vehicleId) {
        query += ' AND f.vehicle_id = ?';
        params.push(vehicleId);
    }
    
    if (estado) {
        query += ' AND f.estado = ?';
        params.push(estado);
    }
    
    query += ' ORDER BY f.fecha DESC';
    
    db.allConverted(query, params, (err, fines) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cargar multas' });
        }
        res.json(fines || []);
    });
});

app.post('/api/fines', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { vehicle_id, fecha, tipo, motivo, monto, estado, lugar, numero_boleta, fecha_vencimiento, observaciones } = req.body;
    
    if (!vehicle_id || !fecha || !motivo || !monto) {
        return res.status(400).json({ error: 'Vehículo, fecha, motivo y monto son requeridos' });
    }
    
    // Verify vehicle belongs to user
    db.getConverted('SELECT id FROM vehicles WHERE id = ? AND user_id = ?', [vehicle_id, userId], (err, vehicle) => {
        if (err || !vehicle) {
            return res.status(403).json({ error: 'Vehículo no encontrado' });
        }
        
        db.runConverted(`INSERT INTO fines (vehicle_id, fecha, tipo, motivo, monto, estado, lugar, numero_boleta, fecha_vencimiento, observaciones)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [vehicle_id, fecha, tipo || null, motivo, monto, estado || 'Pendiente', lugar || null, numero_boleta || null, fecha_vencimiento || null, observaciones || null],
            (err, result) => {
                if (err) {
                    console.error('Error creating fine:', err);
                    return res.status(500).json({ error: 'Error al crear registro de multa' });
                }
                
                const fineId = result?.lastID;
                if (!fineId) {
                    return res.status(500).json({ error: 'Error: No se pudo obtener el ID de la multa creada' });
                }
                
                // Registrar actividad
                logActivity(userId, 'fine', fineId, 'created', 
                    `Multa agregada: ${motivo} - $${monto}`, null, { motivo: motivo, monto: monto, estado: estado || 'Pendiente' });
                
                res.json({ success: true, id: fineId });
            });
    });
});

app.put('/api/fines/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const fineId = req.params.id;
    const { fecha, tipo, motivo, monto, estado, lugar, numero_boleta, fecha_vencimiento, observaciones } = req.body;
    
    // Verify fine belongs to user
    db.getConverted(`SELECT f.id FROM fines f
            JOIN vehicles v ON f.vehicle_id = v.id
            WHERE f.id = ? AND v.user_id = ?`, [fineId, userId], (err, fine) => {
        if (err || !fine) {
            return res.status(403).json({ error: 'Multa no encontrada' });
        }
        
        db.runConverted(`UPDATE fines 
                SET fecha = ?, tipo = ?, motivo = ?, monto = ?, estado = ?, lugar = ?, numero_boleta = ?, fecha_vencimiento = ?, observaciones = ?
                WHERE id = ?`,
            [fecha, tipo || null, motivo, monto, estado, lugar || null, numero_boleta || null, fecha_vencimiento || null, observaciones || null, fineId],
            (err) => {
                if (err) {
                    console.error('Error updating fine:', err);
                    return res.status(500).json({ error: 'Error al actualizar multa' });
                }
                
                // Registrar actividad
                logActivity(userId, 'fine', fineId, 'updated', 
                    `Multa actualizada: ${motivo} - $${monto}`, null, { motivo: motivo, monto: monto, estado: estado });
                
                res.json({ success: true });
            });
    });
});

app.delete('/api/fines/:id', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const fineId = req.params.id;
    
    // Verify fine belongs to user
    db.getConverted(`SELECT f.id FROM fines f
            JOIN vehicles v ON f.vehicle_id = v.id
            WHERE f.id = ? AND v.user_id = ?`, [fineId, userId], (err, fine) => {
        if (err || !fine) {
            return res.status(403).json({ error: 'Multa no encontrada' });
        }
        
        db.runConverted('DELETE FROM fines WHERE id = ?', [fineId], (err) => {
            if (err) {
                console.error('Error deleting fine:', err);
                return res.status(500).json({ error: 'Error al eliminar multa' });
            }
            
            // Registrar actividad
            logActivity(userId, 'fine', fineId, 'deleted', 
                'Multa eliminada', null, null);
            
            res.json({ success: true });
        });
    });
});

// Reports route
app.get('/reports', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const period = req.query.period || '6months'; // 1month, 3months, 6months, 12months
    
    // Get user vehicles
    db.all('SELECT * FROM vehicles WHERE user_id = ?', [userId], (err, vehicles) => {
        if (err) {
            return res.status(500).send('Error al cargar vehículos');
        }
        
        const vehicleIds = vehicles.map(v => v.id);
        const placeholders = vehicleIds.map(() => '?').join(',');
        
        if (vehicleIds.length === 0) {
            return res.render('reports', {
                user: req.session,
                vehicles: [],
                period: period,
                stats: {},
                fuelData: [],
                maintenanceData: [],
                vehicleComparisons: []
            });
        }
        
        // Calculate period date
        let periodDate = "date('now', '-6 months')";
        if (period === '1month') periodDate = "date('now', '-1 month')";
        else if (period === '3months') periodDate = "date('now', '-3 months')";
        else if (period === '12months') periodDate = "date('now', '-12 months')";
        
        // Get detailed fuel statistics
        db.all(`SELECT 
            v.id,
            v.numero_vehiculo,
            v.marca,
            v.modelo,
            COUNT(fr.id) as fuel_records_count,
            SUM(fr.litros) as total_litros,
            SUM(fr.costo_total) as total_cost,
            MIN(fr.kilometraje) as min_km,
            MAX(fr.kilometraje) as max_km,
            AVG(fr.precio_litro) as avg_price_per_liter
            FROM vehicles v
            LEFT JOIN fuel_records fr ON v.id = fr.vehicle_id AND fr.fecha >= ${periodDate}
            WHERE v.id IN (${placeholders})
            GROUP BY v.id`, 
            vehicleIds, (err, fuelData) => {
            
            // Calculate consumption for each vehicle
            const fuelDataWithConsumption = fuelData.map(v => {
                const kmDiff = v.max_km && v.min_km ? v.max_km - v.min_km : 0;
                const avgConsumption = v.total_litros > 0 && kmDiff > 0 ? (kmDiff / v.total_litros).toFixed(2) : 0;
                return {
                    ...v,
                    avgConsumption: parseFloat(avgConsumption),
                    kmDiff: kmDiff
                };
            });
            
            // Get maintenance statistics
            db.all(`SELECT 
                v.id,
                v.numero_vehiculo,
                v.marca,
                v.modelo,
                COUNT(mr.id) as maintenance_count,
                SUM(mr.costo) as total_cost,
                SUM(CASE WHEN mr.tipo = 'Preventivo' THEN 1 ELSE 0 END) as preventive_count,
                SUM(CASE WHEN mr.tipo = 'Correctivo' THEN 1 ELSE 0 END) as corrective_count
                FROM vehicles v
                LEFT JOIN maintenance_records mr ON v.id = mr.vehicle_id AND mr.fecha >= ${periodDate}
                WHERE v.id IN (${placeholders})
                GROUP BY v.id`, 
                vehicleIds, (err, maintenanceData) => {
                
                // Get monthly trends
                db.all(`SELECT 
                    strftime('%Y-%m', fecha) as month,
                    SUM(costo_total) as fuel_cost,
                    SUM(litros) as total_litros,
                    COUNT(DISTINCT vehicle_id) as vehicles_count
                    FROM fuel_records
                    WHERE vehicle_id IN (${placeholders})
                    AND fecha >= ${periodDate}
                    GROUP BY strftime('%Y-%m', fecha)
                    ORDER BY month`, 
                    vehicleIds, (err, monthlyTrends) => {
                    
                    // Get vehicle comparisons
                    db.allConverted(`SELECT 
                        v.id,
                        v.numero_vehiculo,
                        v.marca,
                        v.modelo,
                        COALESCE(SUM(fr.costo_total), 0) as total_fuel_cost,
                        COALESCE(SUM(mr.costo), 0) as total_maintenance_cost,
                        (COALESCE(SUM(fr.costo_total), 0) + COALESCE(SUM(mr.costo), 0)) as total_cost,
                        COALESCE(COUNT(DISTINCT fr.id), 0) as fuel_records,
                        COALESCE(COUNT(DISTINCT mr.id), 0) as maintenance_records
                        FROM vehicles v
                        LEFT JOIN fuel_records fr ON v.id = fr.vehicle_id AND fr.fecha >= ${periodDate}
                        LEFT JOIN maintenance_records mr ON v.id = mr.vehicle_id AND mr.fecha >= ${periodDate}
                        WHERE v.id IN (${placeholders})
                        GROUP BY v.id
                        ORDER BY (COALESCE(SUM(fr.costo_total), 0) + COALESCE(SUM(mr.costo), 0)) DESC`, 
                        vehicleIds, (err, vehicleComparisons) => {
                            
                            res.render('reports', {
                                user: req.session,
                                vehicles: vehicles,
                                period: period,
                                stats: {
                                    totalVehicles: vehicles.length,
                                    totalFuelCost: fuelDataWithConsumption.reduce((sum, v) => sum + (v.total_cost || 0), 0),
                                    totalMaintenanceCost: maintenanceData.reduce((sum, v) => sum + (v.total_cost || 0), 0),
                                    totalRecords: fuelDataWithConsumption.reduce((sum, v) => sum + (v.fuel_records_count || 0), 0)
                                },
                                fuelData: fuelDataWithConsumption,
                                maintenanceData: maintenanceData || [],
                                monthlyTrends: monthlyTrends || [],
                                vehicleComparisons: vehicleComparisons || []
                            });
                        });
                    });
                });
            });
        });
    });

// PDF Report Generation Route
app.get('/api/download-report', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    // Get user info
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
        if (err || !user) {
            return res.status(500).json({ error: 'Error al obtener información del usuario' });
        }
        
        // Get all vehicles
        db.all('SELECT * FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
            if (err) {
                return res.status(500).json({ error: 'Error al obtener vehículos' });
            }
            
            const vehicleIds = vehicles.map(v => v.id);
            const placeholders = vehicleIds.length > 0 ? vehicleIds.map(() => '?').join(',') : '';
            
            // Get fuel records
            const fuelQuery = vehicleIds.length > 0 
                ? `SELECT fr.*, v.numero_vehiculo, v.marca, v.modelo FROM fuel_records fr 
                   JOIN vehicles v ON fr.vehicle_id = v.id 
                   WHERE fr.vehicle_id IN (${placeholders}) ORDER BY fr.fecha DESC`
                : 'SELECT * FROM fuel_records WHERE 1=0';
            
            db.all(fuelQuery, vehicleIds, (err, fuelRecords) => {
                if (err) fuelRecords = [];
                
                // Get maintenance records
                const maintQuery = vehicleIds.length > 0
                    ? `SELECT mr.*, v.numero_vehiculo, v.marca, v.modelo FROM maintenance_records mr 
                       JOIN vehicles v ON mr.vehicle_id = v.id 
                       WHERE mr.vehicle_id IN (${placeholders}) ORDER BY mr.fecha DESC`
                    : 'SELECT * FROM maintenance_records WHERE 1=0';
                
                db.all(maintQuery, vehicleIds, (err, maintenanceRecords) => {
                    if (err) maintenanceRecords = [];
                    
                    // Get insurance policies
                    const policyQuery = vehicleIds.length > 0
                        ? `SELECT ip.*, v.numero_vehiculo, v.marca, v.modelo FROM insurance_policies ip 
                           JOIN vehicles v ON ip.vehicle_id = v.id 
                           WHERE ip.vehicle_id IN (${placeholders}) ORDER BY ip.fecha_vencimiento DESC`
                        : 'SELECT * FROM insurance_policies WHERE 1=0';
                    
                    db.all(policyQuery, vehicleIds, (err, policies) => {
                        if (err) policies = [];
                        
                        // Get claims (siniestros)
                        const operators = []; // Operators removed from system
                        const claimsQuery = vehicleIds.length > 0
                            ? `SELECT s.*, v.numero_vehiculo, v.marca, v.modelo FROM siniestros s 
                               JOIN vehicles v ON s.vehicle_id = v.id 
                               WHERE s.vehicle_id IN (${placeholders}) ORDER BY s.fecha_siniestro DESC`
                            : 'SELECT * FROM siniestros WHERE 1=0';
                        
                        db.all(claimsQuery, vehicleIds, (err, claims) => {
                            if (err) claims = [];
                            
                            // Get tires
                            const tiresQuery = vehicleIds.length > 0
                                ? `SELECT t.*, v.numero_vehiculo, v.marca, v.modelo FROM tires t 
                                   JOIN vehicles v ON t.vehicle_id = v.id 
                                   WHERE t.vehicle_id IN (${placeholders}) ORDER BY t.fecha_instalacion DESC`
                                : 'SELECT * FROM tires WHERE 1=0';
                            
                            db.all(tiresQuery, vehicleIds, (err, tires) => {
                                if (err) tires = [];
                                
                                // Generate PDF
                                const doc = new PDFDocument({ 
                                        margin: 50,
                                        size: 'A4',
                                        info: {
                                            Title: 'Reporte Completo de Flotilla',
                                            Author: user.nombre || user.username,
                                            Subject: 'Reporte de Gestión de Flotilla'
                                        }
                                    });
                                    
                                    // Set response headers
                                    res.setHeader('Content-Type', 'application/pdf');
                                    res.setHeader('Content-Disposition', `attachment; filename="reporte-flotilla-${new Date().toISOString().split('T')[0]}.pdf"`);
                                    
                                    // Pipe PDF to response
                                    doc.pipe(res);
                                    
                                    // Helper function to draw a colored box
                                    const drawBox = (x, y, width, height, color) => {
                                        doc.rect(x, y, width, height)
                                           .fillColor(color)
                                           .fill()
                                           .fillColor('black');
                                    };
                                    
                                    // Helper function to draw table header
                                    const drawTableHeader = (x, y, width, height, text, color = '#001f3f') => {
                                        drawBox(x, y, width, height, color);
                                        doc.fillColor('white')
                                           .fontSize(9)
                                           .font('Helvetica-Bold')
                                           .text(text, x + 5, y + 5, { width: width - 10, align: 'left' })
                                           .fillColor('black');
                                    };
                                    
                                    // Helper function to draw table cell
                                    const drawTableCell = (x, y, width, height, text, bold = false) => {
                                        doc.rect(x, y, width, height)
                                           .strokeColor('#dee2e6')
                                           .lineWidth(0.5)
                                           .stroke();
                                        doc.fontSize(8)
                                           .font(bold ? 'Helvetica-Bold' : 'Helvetica')
                                           .fillColor('black')
                                           .text(text || '-', x + 5, y + 5, { width: width - 10, align: 'left' });
                                    };
                                    
                                    // Header with colored background
                                    const headerColor = '#001f3f';
                                    drawBox(0, 0, doc.page.width, 120, headerColor);
                                    
                                    doc.fillColor('white')
                                       .fontSize(24).font('Helvetica-Bold')
                                       .text('REPORTE COMPLETO DE FLOTILLA', 50, 30, { align: 'center', width: doc.page.width - 100 });
                                    
                                    doc.fontSize(11).font('Helvetica')
                                       .text(`Generado: ${new Date().toLocaleString('es-ES')}`, 50, 65, { align: 'center', width: doc.page.width - 100 });
                                    doc.text(`Empresa: ${user.empresa || 'N/A'}`, 50, 80, { align: 'center', width: doc.page.width - 100 });
                                    doc.text(`Usuario: ${user.nombre || user.username}`, 50, 95, { align: 'center', width: doc.page.width - 100 });
                                    
                                    doc.fillColor('black');
                                    doc.moveDown(3);
                                    
                                    // Summary Statistics with colored boxes
                                    let yPos = 140;
                                    doc.fontSize(18).font('Helvetica-Bold')
                                       .fillColor('#001f3f')
                                       .text('RESUMEN GENERAL', 50, yPos);
                                    yPos += 30;
                                    
                                    const totalFuelCost = (fuelRecords || []).reduce((sum, r) => sum + (parseFloat(r.costo_total || r.costo) || 0), 0);
                                    const totalMaintenanceCost = (maintenanceRecords || []).reduce((sum, r) => sum + (parseFloat(r.costo) || 0), 0);
                                    const totalPolicyCost = (policies || []).reduce((sum, p) => sum + (parseFloat(p.costo_anual) || 0), 0);
                                    const totalCost = totalFuelCost + totalMaintenanceCost + totalPolicyCost;
                                    
                                    // Statistics boxes
                                    const boxWidth = (doc.page.width - 120) / 2;
                                    const boxHeight = 50;
                                    
                                    // Top row boxes
                                    drawBox(50, yPos, boxWidth, boxHeight, '#e3f2fd');
                                    doc.fontSize(10).font('Helvetica-Bold').fillColor('#001f3f')
                                       .text('Total Vehículos', 55, yPos + 5);
                                    doc.fontSize(18).text(`${vehicles.length}`, 55, yPos + 20);
                                    
                                    yPos += boxHeight + 15;
                                    
                                    // Second row boxes
                                    drawBox(50, yPos, boxWidth, boxHeight, '#e8f5e9');
                                    doc.fontSize(10).font('Helvetica-Bold').fillColor('#001f3f')
                                       .text('Registros Combustible', 55, yPos + 5);
                                    doc.fontSize(18).text(`${(fuelRecords || []).length}`, 55, yPos + 20);
                                    
                                    drawBox(50 + boxWidth + 20, yPos, boxWidth, boxHeight, '#fce4ec');
                                    doc.fontSize(10).font('Helvetica-Bold').fillColor('#001f3f')
                                       .text('Mantenimientos', 55 + boxWidth + 20, yPos + 5);
                                    doc.fontSize(18).text(`${(maintenanceRecords || []).length}`, 55 + boxWidth + 20, yPos + 20);
                                    
                                    yPos += boxHeight + 30;
                                    
                                    // Cost summary table
                                    const tableWidth = doc.page.width - 100;
                                    const colWidth = tableWidth / 2;
                                    
                                    drawTableHeader(50, yPos, colWidth, 25, 'Concepto', '#001f3f');
                                    drawTableHeader(50 + colWidth, yPos, colWidth, 25, 'Monto', '#4da6ff');
                                    yPos += 25;
                                    
                                    drawTableCell(50, yPos, colWidth, 20, 'Costo Total Combustible', false);
                                    doc.fillColor('#28a745').fontSize(9).font('Helvetica-Bold')
                                       .text(`$${totalFuelCost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 55 + colWidth, yPos + 5);
                                    doc.fillColor('black');
                                    yPos += 20;
                                    
                                    drawTableCell(50, yPos, colWidth, 20, 'Costo Total Mantenimientos', false);
                                    doc.fillColor('#ffc107').fontSize(9).font('Helvetica-Bold')
                                       .text(`$${totalMaintenanceCost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 55 + colWidth, yPos + 5);
                                    doc.fillColor('black');
                                    yPos += 20;
                                    
                                    drawTableCell(50, yPos, colWidth, 20, 'Costo Total Pólizas', false);
                                    doc.fillColor('#17a2b8').fontSize(9).font('Helvetica-Bold')
                                       .text(`$${totalPolicyCost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 55 + colWidth, yPos + 5);
                                    doc.fillColor('black');
                                    yPos += 20;
                                    
                                    drawTableHeader(50, yPos, colWidth, 25, 'COSTO TOTAL GENERAL', '#001f3f');
                                    doc.fillColor('#dc3545').fontSize(12).font('Helvetica-Bold')
                                       .text(`$${totalCost.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, 55 + colWidth, yPos + 5);
                                    doc.fillColor('black');
                                    
                                    doc.addPage();
                                    
                                    // Vehicles Section with table
                                    if (vehicles.length > 0) {
                                        yPos = 50;
                                        doc.fontSize(18).font('Helvetica-Bold')
                                           .fillColor('#001f3f')
                                           .text('VEHÍCULOS', 50, yPos);
                                        yPos += 30;
                                        
                                        // Table headers
                                        const vCols = [80, 100, 80, 60, 80, 60];
                                        const vHeaders = ['# Vehículo', 'Marca/Modelo', 'Año', 'Placas', 'Kilometraje', 'Estado'];
                                        let xPos = 50;
                                        
                                        vHeaders.forEach((header, i) => {
                                            drawTableHeader(xPos, yPos, vCols[i], 20, header);
                                            xPos += vCols[i];
                                        });
                                        yPos += 20;
                                        
                                        vehicles.forEach((vehicle, index) => {
                                            if (yPos > doc.page.height - 100) {
                                                doc.addPage();
                                                yPos = 50;
                                                // Redraw headers
                                                xPos = 50;
                                                vHeaders.forEach((header, i) => {
                                                    drawTableHeader(xPos, yPos, vCols[i], 20, header);
                                                    xPos += vCols[i];
                                                });
                                                yPos += 20;
                                            }
                                            
                                            xPos = 50;
                                            drawTableCell(xPos, yPos, vCols[0], 18, `#${vehicle.numero_vehiculo}`, true);
                                            xPos += vCols[0];
                                            drawTableCell(xPos, yPos, vCols[1], 18, `${vehicle.marca || ''} ${vehicle.modelo || ''}`);
                                            xPos += vCols[1];
                                            drawTableCell(xPos, yPos, vCols[2], 18, vehicle.año || '-');
                                            xPos += vCols[2];
                                            drawTableCell(xPos, yPos, vCols[3], 18, vehicle.placas || '-');
                                            xPos += vCols[3];
                                            drawTableCell(xPos, yPos, vCols[4], 18, `${(vehicle.kilometraje_actual || 0).toLocaleString()} km`);
                                            xPos += vCols[4];
                                            drawTableCell(xPos, yPos, vCols[5], 18, vehicle.estado || '-');
                                            yPos += 18;
                                        });
                                        
                                        doc.addPage();
                                    }
                                    
                                    // Fuel Records Section with table
                                    if (fuelRecords && fuelRecords.length > 0) {
                                        yPos = 50;
                                        doc.fontSize(18).font('Helvetica-Bold')
                                           .fillColor('#001f3f')
                                           .text('REGISTROS DE COMBUSTIBLE', 50, yPos);
                                        yPos += 30;
                                        
                                        const fCols = [60, 80, 60, 70, 80, 80];
                                        const fHeaders = ['Fecha', 'Vehículo', 'Litros', 'Precio/L', 'Costo Total', 'Kilometraje'];
                                        let xPos = 50;
                                        
                                        fHeaders.forEach((header, i) => {
                                            drawTableHeader(xPos, yPos, fCols[i], 20, header);
                                            xPos += fCols[i];
                                        });
                                        yPos += 20;
                                        
                                        fuelRecords.slice(0, 100).forEach((record, index) => {
                                            if (yPos > doc.page.height - 80) {
                                                doc.addPage();
                                                yPos = 50;
                                                xPos = 50;
                                                fHeaders.forEach((header, i) => {
                                                    drawTableHeader(xPos, yPos, fCols[i], 20, header);
                                                    xPos += fCols[i];
                                                });
                                                yPos += 20;
                                            }
                                            
                                            xPos = 50;
                                            drawTableCell(xPos, yPos, fCols[0], 18, new Date(record.fecha).toLocaleDateString('es-ES'));
                                            xPos += fCols[0];
                                            drawTableCell(xPos, yPos, fCols[1], 18, `#${record.numero_vehiculo || 'N/A'}`);
                                            xPos += fCols[1];
                                            drawTableCell(xPos, yPos, fCols[2], 18, `${record.litros || 0} L`);
                                            xPos += fCols[2];
                                            const precioLitro = record.litros > 0 ? (parseFloat(record.costo_total || record.costo) / parseFloat(record.litros)).toFixed(2) : '0.00';
                                            drawTableCell(xPos, yPos, fCols[3], 18, `$${precioLitro}`);
                                            xPos += fCols[3];
                                            doc.fillColor('#28a745').fontSize(8).font('Helvetica-Bold')
                                               .text(`$${(parseFloat(record.costo_total || record.costo) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, xPos + 5, yPos + 5);
                                            doc.fillColor('black');
                                            xPos += fCols[4];
                                            drawTableCell(xPos, yPos, fCols[5], 18, `${(record.kilometraje || 0).toLocaleString()} km`);
                                            yPos += 18;
                                        });
                                        
                                        if (fuelRecords.length > 100) {
                                            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#6c757d')
                                               .text(`... y ${fuelRecords.length - 100} registros más`, 50, yPos + 10);
                                        }
                                        
                                        doc.addPage();
                                    }
                                    
                                    // Maintenance Records Section with table
                                    if (maintenanceRecords && maintenanceRecords.length > 0) {
                                        yPos = 50;
                                        doc.fontSize(18).font('Helvetica-Bold')
                                           .fillColor('#001f3f')
                                           .text('REGISTROS DE MANTENIMIENTO', 50, yPos);
                                        yPos += 30;
                                        
                                        const mCols = [60, 70, 80, 90, 100, 120];
                                        const mHeaders = ['Fecha', 'Vehículo', 'Tipo', 'Taller', 'Costo', 'Descripción'];
                                        let xPos = 50;
                                        
                                        mHeaders.forEach((header, i) => {
                                            drawTableHeader(xPos, yPos, mCols[i], 20, header);
                                            xPos += mCols[i];
                                        });
                                        yPos += 20;
                                        
                                        maintenanceRecords.slice(0, 100).forEach((record, index) => {
                                            if (yPos > doc.page.height - 80) {
                                                doc.addPage();
                                                yPos = 50;
                                                xPos = 50;
                                                mHeaders.forEach((header, i) => {
                                                    drawTableHeader(xPos, yPos, mCols[i], 20, header);
                                                    xPos += mCols[i];
                                                });
                                                yPos += 20;
                                            }
                                            
                                            xPos = 50;
                                            drawTableCell(xPos, yPos, mCols[0], 18, new Date(record.fecha).toLocaleDateString('es-ES'));
                                            xPos += mCols[0];
                                            drawTableCell(xPos, yPos, mCols[1], 18, `#${record.numero_vehiculo || 'N/A'}`);
                                            xPos += mCols[1];
                                            drawTableCell(xPos, yPos, mCols[2], 18, record.tipo || '-');
                                            xPos += mCols[2];
                                            drawTableCell(xPos, yPos, mCols[3], 18, (record.taller || '-').substring(0, 15));
                                            xPos += mCols[3];
                                            doc.fillColor('#ffc107').fontSize(8).font('Helvetica-Bold')
                                               .text(`$${(parseFloat(record.costo) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, xPos + 5, yPos + 5);
                                            doc.fillColor('black');
                                            xPos += mCols[4];
                                            drawTableCell(xPos, yPos, mCols[5], 18, (record.descripcion || '-').substring(0, 25));
                                            yPos += 18;
                                        });
                                        
                                        if (maintenanceRecords.length > 100) {
                                            doc.fontSize(8).font('Helvetica-Oblique').fillColor('#6c757d')
                                               .text(`... y ${maintenanceRecords.length - 100} registros más`, 50, yPos + 10);
                                        }
                                        
                                        doc.addPage();
                                    }
                                    
                                    // Policies Section with table
                                    if (policies && policies.length > 0) {
                                        yPos = 50;
                                        doc.fontSize(18).font('Helvetica-Bold')
                                           .fillColor('#001f3f')
                                           .text('PÓLIZAS DE SEGURO', 50, yPos);
                                        yPos += 30;
                                        
                                        const pCols = [90, 70, 100, 80, 60, 90];
                                        const pHeaders = ['Número Póliza', 'Vehículo', 'Compañía', 'Vencimiento', 'Estado', 'Costo Anual'];
                                        let xPos = 50;
                                        
                                        pHeaders.forEach((header, i) => {
                                            drawTableHeader(xPos, yPos, pCols[i], 20, header);
                                            xPos += pCols[i];
                                        });
                                        yPos += 20;
                                        
                                        policies.forEach((policy, index) => {
                                            if (yPos > doc.page.height - 80) {
                                                doc.addPage();
                                                yPos = 50;
                                                xPos = 50;
                                                pHeaders.forEach((header, i) => {
                                                    drawTableHeader(xPos, yPos, pCols[i], 20, header);
                                                    xPos += pCols[i];
                                                });
                                                yPos += 20;
                                            }
                                            
                                            xPos = 50;
                                            drawTableCell(xPos, yPos, pCols[0], 18, policy.numero_poliza || '-', true);
                                            xPos += pCols[0];
                                            drawTableCell(xPos, yPos, pCols[1], 18, `#${policy.numero_vehiculo || 'N/A'}`);
                                            xPos += pCols[1];
                                            drawTableCell(xPos, yPos, pCols[2], 18, (policy.compania || '-').substring(0, 20));
                                            xPos += pCols[2];
                                            drawTableCell(xPos, yPos, pCols[3], 18, policy.fecha_vencimiento ? new Date(policy.fecha_vencimiento).toLocaleDateString('es-ES') : '-');
                                            xPos += pCols[3];
                                            drawTableCell(xPos, yPos, pCols[4], 18, policy.estado || '-');
                                            xPos += pCols[4];
                                            doc.fillColor('#17a2b8').fontSize(8).font('Helvetica-Bold')
                                               .text(`$${(parseFloat(policy.costo_anual) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, xPos + 5, yPos + 5);
                                            doc.fillColor('black');
                                            yPos += 18;
                                        });
                                        
                                        doc.addPage();
                                    }
                                    
                                    
                                    // Claims Section with table
                                    if (claims && claims.length > 0) {
                                        yPos = 50;
                                        doc.fontSize(18).font('Helvetica-Bold')
                                           .fillColor('#001f3f')
                                           .text('SINIESTROS', 50, yPos);
                                        yPos += 30;
                                        
                                        const cCols = [90, 70, 80, 80, 70, 90];
                                        const cHeaders = ['Número Referencia', 'Vehículo', 'Fecha', 'Tipo', 'Estado', 'Monto'];
                                        let xPos = 50;
                                        
                                        cHeaders.forEach((header, i) => {
                                            drawTableHeader(xPos, yPos, cCols[i], 20, header);
                                            xPos += cCols[i];
                                        });
                                        yPos += 20;
                                        
                                        claims.forEach((claim, index) => {
                                            if (yPos > doc.page.height - 80) {
                                                doc.addPage();
                                                yPos = 50;
                                                xPos = 50;
                                                cHeaders.forEach((header, i) => {
                                                    drawTableHeader(xPos, yPos, cCols[i], 20, header);
                                                    xPos += cCols[i];
                                                });
                                                yPos += 20;
                                            }
                                            
                                            xPos = 50;
                                            drawTableCell(xPos, yPos, cCols[0], 18, claim.numero_referencia || '-', true);
                                            xPos += cCols[0];
                                            drawTableCell(xPos, yPos, cCols[1], 18, `#${claim.numero_vehiculo || 'N/A'}`);
                                            xPos += cCols[1];
                                            drawTableCell(xPos, yPos, cCols[2], 18, new Date(claim.fecha_siniestro).toLocaleDateString('es-ES'));
                                            xPos += cCols[2];
                                            drawTableCell(xPos, yPos, cCols[3], 18, (claim.tipo_siniestro || '-').substring(0, 15));
                                            xPos += cCols[3];
                                            drawTableCell(xPos, yPos, cCols[4], 18, claim.estado || '-');
                                            xPos += cCols[4];
                                            doc.fillColor('#dc3545').fontSize(8).font('Helvetica-Bold')
                                               .text(`$${(parseFloat(claim.monto_dano) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, xPos + 5, yPos + 5);
                                            doc.fillColor('black');
                                            yPos += 18;
                                        });
                                        
                                        doc.addPage();
                                    }
                                    
                                    // Footer with colored background
                                    const footerY = doc.page.height - 40;
                                    drawBox(0, footerY, doc.page.width, 40, '#f8f9fa');
                                    doc.fontSize(8).font('Helvetica')
                                       .fillColor('#6c757d')
                                       .text(`Reporte generado el ${new Date().toLocaleString('es-ES')}`, 50, footerY + 10, { align: 'center', width: doc.page.width - 100 })
                                       .text(`Sistema de Gestión de Flotillas - CRM Insurance System`, 50, footerY + 22, { align: 'center', width: doc.page.width - 100 });
                                    
                                // Finalize PDF
                                doc.end();
                            });
                        });
                    });
                });
            });
        });
    });
});

// 404 handler for undefined routes
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.url}`);
    res.status(404).send(`
        <h1>404 - Página no encontrada</h1>
        <p>La ruta <strong>${req.url}</strong> no existe.</p>
        <p><a href="/">Volver al inicio</a></p>
        <p><a href="/login">Ir al login</a></p>
    `);
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`✅ Servidor iniciado correctamente`);
    console.log(`========================================`);
    console.log(`🌐 URL Principal: http://localhost:${PORT}`);
    console.log(`🔐 Login: http://localhost:${PORT}/login`);
    console.log(`👤 Usuario admin: admin`);
    console.log(`🔑 Contraseña: admin123`);
    console.log(`========================================\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed');
        process.exit(0);
    });
});

