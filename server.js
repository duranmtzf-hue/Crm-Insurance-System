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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

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
    
    // Delete existing sample operators first
    db.run('DELETE FROM operators WHERE licencia IN (?, ?)', ['LIC-001', 'LIC-002'], () => {
        // Create operator with license expiring in 8 days (danger alert)
        const operatorExpiringDate = new Date(today);
        operatorExpiringDate.setDate(today.getDate() + 8);
        db.run(`INSERT INTO operators 
                (user_id, nombre, licencia, fecha_vencimiento_licencia, telefono, email, estado) 
                VALUES (?, 'Juan Pérez', 'LIC-001', ?, '555-1234', 'juan@example.com', 'Activo')`, 
                [userId, operatorExpiringDate.toISOString().split('T')[0]], (err) => {
            if (err) {
                console.log('Error creating sample operator:', err.message);
            } else {
                console.log('Created operator with license expiring in 8 days');
            }
        });
        
        // Create operator with license expiring in 20 days (warning alert)
        const operatorWarningDate = new Date(today);
        operatorWarningDate.setDate(today.getDate() + 20);
        db.run(`INSERT INTO operators 
                (user_id, nombre, licencia, fecha_vencimiento_licencia, telefono, email, estado) 
                VALUES (?, 'María González', 'LIC-002', ?, '555-5678', 'maria@example.com', 'Activo')`, 
                [userId, operatorWarningDate.toISOString().split('T')[0]], (err) => {
            if (err) {
                console.log('Error creating sample operator:', err.message);
            } else {
                console.log('Created operator with license expiring in 20 days');
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
            
            // Guardar la sesión explícitamente antes de redirigir
            req.session.save((err) => {
                if (err) {
                    console.error('Error guardando sesión:', err);
                    return res.render('login', { error: 'Error al iniciar sesión. Intenta de nuevo.' });
                }
                res.redirect('/dashboard');
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

                            res.render('billing', {
                                user: req.session,
                                orders: orders || [],
                                invoices: invoices || [],
                                vehicles: vehicles || []
                            });
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
    db.allConverted('SELECT * FROM vehicles WHERE user_id = ?', [userId], (err, vehicles) => {
        if (err) {
            return res.status(500).send('Error al cargar vehículos');
        }
        
        // Get statistics
        const vehicleIds = vehicles.map(v => v.id);
        const placeholders = vehicleIds.map(() => '?').join(',');
        
        if (vehicleIds.length === 0) {
            // Get operator alerts even if no vehicles (including expired licenses)
            db.allConverted(`SELECT 
                    o.nombre,
                    o.licencia,
                    o.fecha_vencimiento_licencia,
                    CASE 
                        WHEN date(o.fecha_vencimiento_licencia) < date('now') THEN 'danger'
                        WHEN date(o.fecha_vencimiento_licencia) <= date('now', '+7 days') THEN 'danger'
                        WHEN date(o.fecha_vencimiento_licencia) <= date('now', '+15 days') THEN 'warning'
                        ELSE 'info'
                    END as priority
                    FROM operators o
                    WHERE o.user_id = ?
                    AND o.fecha_vencimiento_licencia IS NOT NULL
                    AND (date(o.fecha_vencimiento_licencia) < date('now') OR date(o.fecha_vencimiento_licencia) <= date('now', '+30 days'))
                    AND o.estado = 'Activo'
                    ORDER BY o.fecha_vencimiento_licencia ASC`, 
                    [userId], (err, operatorAlerts) => {
                
                const allAlerts = [];
                (operatorAlerts || []).forEach(alert => {
                    const vencimiento = new Date(alert.fecha_vencimiento_licencia);
                    const hoy = new Date();
                    const diasDiferencia = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
                    const estadoTexto = diasDiferencia < 0 
                        ? `VENCIDA hace ${Math.abs(diasDiferencia)} días`
                        : diasDiferencia === 0 
                            ? 'Vence HOY'
                            : `Vence en ${diasDiferencia} días`;
                    
                    allAlerts.push({
                        type: 'operator',
                        icon: 'fa-id-card',
                        title: diasDiferencia < 0 
                            ? `Licencia VENCIDA: ${alert.nombre}`
                            : `Licencia por vencer: ${alert.nombre}`,
                        description: `Licencia ${alert.licencia} - ${estadoTexto} (${vencimiento.toLocaleDateString('es-ES')})`,
                        priority: alert.priority,
                        date: alert.fecha_vencimiento_licencia
                    });
                });
                
                const alertCounts = {
                    total: allAlerts.length,
                    danger: allAlerts.filter(a => a.priority === 'danger').length,
                    warning: allAlerts.filter(a => a.priority === 'warning').length,
                    info: allAlerts.filter(a => a.priority === 'info').length,
                    hasAlerts: allAlerts.length > 0
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
                    alerts: allAlerts,
                    alertCounts: alertCounts,
                    vehicleConsumption: [],
                    costTrends: [],
                    maintenanceTrends: [],
                    vehicleComparisons: [],
                    performanceStats: [],
                    notificationsHistory: [],
                    hasNotificationsHistory: false
                });
            });
            return;
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
                db.get(`SELECT 
                    COUNT(*) as totalVehicles,
                    SUM(CASE WHEN estado = 'Activo' THEN 1 ELSE 0 END) as activeVehicles
                    FROM vehicles WHERE user_id = ?`, [userId], (err, vehicleStats) => {
                    
                    // Handle errors
                    if (err) {
                        console.error('Error getting vehicle stats:', err);
                    }
                    
                    db.get(`SELECT SUM(costo_total) as totalFuelCost 
                            FROM fuel_records 
                            WHERE vehicle_id IN (${placeholders}) 
                            AND fecha >= date('now', '-30 days')`, 
                            vehicleIds, (err, fuelStats) => {
                        
                        // Handle errors
                        if (err) {
                            console.error('Error getting fuel stats:', err);
                        }
                        
                        db.get(`SELECT COUNT(*) as pendingMaintenance 
                                FROM maintenance_records 
                                WHERE vehicle_id IN (${placeholders}) 
                                AND tipo = 'Preventivo' 
                                AND proximo_mantenimiento_km <= (SELECT kilometraje_actual FROM vehicles WHERE id = maintenance_records.vehicle_id)`, 
                                vehicleIds, (err, maintStats) => {
                            
                            // Handle errors
                            if (err) {
                                console.error('Error getting maintenance stats:', err);
                            }
                            
                            db.get(`SELECT COUNT(*) as expiringPolicies 
                                    FROM insurance_policies 
                                    WHERE vehicle_id IN (${placeholders}) 
                                    AND fecha_vencimiento BETWEEN date('now') AND date('now', '+30 days') 
                                    AND estado = 'Vigente'`, 
                                    vehicleIds, (err, policyStats) => {
                                
                                // Handle errors
                                if (err) {
                                    console.error('Error getting policy stats:', err);
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
                                        
                                        // 3. Operator license alerts (including expired licenses)
                                        db.all(`SELECT 
                                                o.nombre,
                                                o.licencia,
                                                o.fecha_vencimiento_licencia,
                                                CASE 
                                                    WHEN date(o.fecha_vencimiento_licencia) < date('now') THEN 'danger'
                                                    WHEN date(o.fecha_vencimiento_licencia) <= date('now', '+7 days') THEN 'danger'
                                                    WHEN date(o.fecha_vencimiento_licencia) <= date('now', '+15 days') THEN 'warning'
                                                    ELSE 'info'
                                                END as priority
                                                FROM operators o
                                                WHERE o.user_id = ?
                                                AND o.fecha_vencimiento_licencia IS NOT NULL
                                                AND (date(o.fecha_vencimiento_licencia) < date('now') OR date(o.fecha_vencimiento_licencia) <= date('now', '+30 days'))
                                                AND o.estado = 'Activo'
                                                ORDER BY o.fecha_vencimiento_licencia ASC`, 
                                                [userId], (err, operatorAlerts) => {
                                            
                                            // Handle errors
                                            if (err) {
                                                console.error('Error getting operator alerts:', err);
                                            }
                                            
                                            // Debug: Log alert counts
                                            console.log('Alert counts - Policies:', (policyAlerts || []).length, 
                                                       'Maintenance:', (maintenanceAlerts || []).length, 
                                                       'Operators:', (operatorAlerts || []).length);
                                            
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
                                            
                                            // Add operator license alerts
                                            (operatorAlerts || []).forEach(alert => {
                                                const vencimiento = new Date(alert.fecha_vencimiento_licencia);
                                                const hoy = new Date();
                                                const diasDiferencia = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
                                                const estadoTexto = diasDiferencia < 0 
                                                    ? `VENCIDA hace ${Math.abs(diasDiferencia)} días`
                                                    : diasDiferencia === 0 
                                                        ? 'Vence HOY'
                                                        : `Vence en ${diasDiferencia} días`;
                                                
                                                allAlerts.push({
                                                    type: 'operator',
                                                    icon: 'fa-id-card',
                                                    title: diasDiferencia < 0 
                                                        ? `Licencia VENCIDA: ${alert.nombre}`
                                                        : `Licencia por vencer: ${alert.nombre}`,
                                                    description: `Licencia ${alert.licencia} - ${estadoTexto} (${vencimiento.toLocaleDateString('es-ES')})`,
                                                    priority: alert.priority,
                                                    date: alert.fecha_vencimiento_licencia
                                                });
                                            });
                                            
                                            // Sort alerts by priority (danger first, then warning, then info)
                                            const priorityOrder = { 'danger': 0, 'warning': 1, 'info': 2 };
                                            allAlerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
                                            
                                            // Store alerts for rendering (define in outer scope)
                                            const alerts = allAlerts;
                                            
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

                                                                        res.render('dashboard', {
                                                                            user: req.session,
                                                                            vehicles: vehicles,
                                                                            stats: {
                                                                                totalVehicles: vehicleStats?.totalVehicles || 0,
                                                                                activeVehicles: vehicleStats?.activeVehicles || 0,
                                                                                totalFuelCost: fuelStats?.totalFuelCost || 0,
                                                                                pendingMaintenance: maintStats?.pendingMaintenance || 0,
                                                                                expiringPolicies: policyStats?.expiringPolicies || 0
                                                                            },
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
});

app.get('/vehicles', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.all(`SELECT v.*, o.nombre as operador_nombre 
            FROM vehicles v 
            LEFT JOIN operators o ON v.operador_id = o.id 
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

app.post('/api/vehicles', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { 
        numero_vehiculo, marca, modelo, año, placas, kilometraje_actual, estado,
        descripcion, numero_serie
    } = req.body;
    
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
                return res.status(500).json({ error: 'Error al crear vehículo: ' + err.message });
            }
            
            const vehicleId = result?.lastID;
            if (!vehicleId) {
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

// Operators routes
app.get('/operators', requireAuth, (req, res) => {
    const userId = req.session.userId;
    db.all('SELECT * FROM operators WHERE user_id = ? ORDER BY nombre', [userId], (err, operators) => {
        if (err) {
            return res.status(500).send('Error al cargar operadores');
        }
        res.render('operators', { user: req.session, operators: operators || [] });
    });
});

app.post('/api/operators', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const { nombre, licencia, fecha_vencimiento_licencia, telefono, email, estado } = req.body;
    
    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }
    
    db.run(`INSERT INTO operators (user_id, nombre, licencia, fecha_vencimiento_licencia, telefono, email, estado)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, nombre, licencia || null, fecha_vencimiento_licencia || null, telefono || null, email || null, estado || 'Activo'],
        (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Error al crear operador' });
            }
            const operatorId = result?.lastID;
            res.json({ success: true, id: operatorId });
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

app.get('/api/operators', requireAuth, (req, res) => {
    const userId = req.session.userId;
    db.all('SELECT * FROM operators WHERE user_id = ? ORDER BY nombre', [userId], (err, operators) => {
        if (err) {
            return res.status(500).json({ error: 'Error al cargar operadores' });
        }
        res.json(operators || []);
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
            return res.status(500).send('Error al cargar llantas');
        }
        // Get vehicles for dropdown
        db.all('SELECT id, numero_vehiculo, marca, modelo FROM vehicles WHERE user_id = ? ORDER BY numero_vehiculo', [userId], (err, vehicles) => {
            if (err) {
                return res.status(500).send('Error al cargar vehículos');
            }
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
                        
                        // Get operators
                        db.all('SELECT * FROM operators WHERE user_id = ? ORDER BY nombre', [userId], (err, operators) => {
                            if (err) operators = [];
                            
                            // Get claims (siniestros)
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
                                    
                                    drawBox(50 + boxWidth + 20, yPos, boxWidth, boxHeight, '#fff3e0');
                                    doc.fontSize(10).font('Helvetica-Bold').fillColor('#001f3f')
                                       .text('Total Operadores', 55 + boxWidth + 20, yPos + 5);
                                    doc.fontSize(18).text(`${(operators || []).length}`, 55 + boxWidth + 20, yPos + 20);
                                    
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
                                        const vCols = [80, 100, 80, 60, 80, 60, 60];
                                        const vHeaders = ['# Vehículo', 'Marca/Modelo', 'Año', 'Placas', 'Kilometraje', 'Estado', 'Operador'];
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
                                            xPos += vCols[5];
                                            drawTableCell(xPos, yPos, vCols[6], 18, '-'); // Operator would need join
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
                                    
                                    // Operators Section with table
                                    if (operators && operators.length > 0) {
                                        yPos = 50;
                                        doc.fontSize(18).font('Helvetica-Bold')
                                           .fillColor('#001f3f')
                                           .text('OPERADORES Y LICENCIAS', 50, yPos);
                                        yPos += 30;
                                        
                                        const oCols = [100, 80, 80, 90, 80, 100];
                                        const oHeaders = ['Nombre', 'Licencia', 'Vencimiento', 'Estado Licencia', 'Teléfono', 'Email'];
                                        let xPos = 50;
                                        
                                        oHeaders.forEach((header, i) => {
                                            drawTableHeader(xPos, yPos, oCols[i], 20, header);
                                            xPos += oCols[i];
                                        });
                                        yPos += 20;
                                        
                                        operators.forEach((operator, index) => {
                                            if (yPos > doc.page.height - 80) {
                                                doc.addPage();
                                                yPos = 50;
                                                xPos = 50;
                                                oHeaders.forEach((header, i) => {
                                                    drawTableHeader(xPos, yPos, oCols[i], 20, header);
                                                    xPos += oCols[i];
                                                });
                                                yPos += 20;
                                            }
                                            
                                            xPos = 50;
                                            drawTableCell(xPos, yPos, oCols[0], 18, operator.nombre || '-', true);
                                            xPos += oCols[0];
                                            drawTableCell(xPos, yPos, oCols[1], 18, operator.licencia || '-');
                                            xPos += oCols[1];
                                            
                                            let estadoLicencia = 'N/A';
                                            let estadoColor = 'black';
                                            if (operator.fecha_vencimiento_licencia) {
                                                const vencimiento = new Date(operator.fecha_vencimiento_licencia);
                                                const hoy = new Date();
                                                const diasDiferencia = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
                                                estadoLicencia = diasDiferencia < 0 ? `VENCIDA (${Math.abs(diasDiferencia)} días)` : 
                                                                 diasDiferencia <= 7 ? `Por vencer (${diasDiferencia} días)` : 
                                                                 diasDiferencia <= 30 ? `Vigente (${diasDiferencia} días)` : 'Vigente';
                                                estadoColor = diasDiferencia < 0 ? '#dc3545' : diasDiferencia <= 7 ? '#ffc107' : '#28a745';
                                                drawTableCell(xPos, yPos, oCols[2], 18, new Date(operator.fecha_vencimiento_licencia).toLocaleDateString('es-ES'));
                                            } else {
                                                drawTableCell(xPos, yPos, oCols[2], 18, '-');
                                            }
                                            xPos += oCols[2];
                                            
                                            doc.fillColor(estadoColor).fontSize(8).font('Helvetica-Bold')
                                               .text(estadoLicencia, xPos + 5, yPos + 5);
                                            doc.fillColor('black');
                                            xPos += oCols[3];
                                            drawTableCell(xPos, yPos, oCols[4], 18, operator.telefono || '-');
                                            xPos += oCols[4];
                                            drawTableCell(xPos, yPos, oCols[5], 18, (operator.email || '-').substring(0, 20));
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

