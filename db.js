// Database abstraction layer - supports both PostgreSQL and SQLite
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

let db = null;
let dbType = 'sqlite'; // 'sqlite' or 'postgresql'

// Detectar si estamos en Render con PostgreSQL
if (process.env.DATABASE_URL) {
    // PostgreSQL en Render
    dbType = 'postgresql';
    console.log('🐘 Usando PostgreSQL (Render)');
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
            rejectUnauthorized: false
        }
    });
    
    db = {
        type: 'postgresql',
        pool: pool,
        query: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            const convertedSQL = convertSQL(sql);
            pool.query(convertedSQL, params || [], (err, result) => {
                if (callback) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, result.rows);
                    }
                }
            });
        },
        run: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            let convertedSQL = convertSQL(sql);
            
            // Para INSERT en PostgreSQL, agregar RETURNING id si no está presente
            if (convertedSQL.match(/^INSERT\s+INTO/i) && !convertedSQL.match(/RETURNING/i)) {
                // Extraer el nombre de la tabla
                const tableMatch = convertedSQL.match(/INSERT\s+INTO\s+(\w+)/i);
                if (tableMatch) {
                    convertedSQL += ' RETURNING id';
                }
            }
            
            pool.query(convertedSQL, params || [], (err, result) => {
                if (callback) {
                    if (err) {
                        callback(err, null);
                    } else {
                        // Para INSERT, PostgreSQL devuelve el id en RETURNING
                        let lastID = null;
                        if (result.rows && result.rows.length > 0 && result.rows[0].id) {
                            lastID = result.rows[0].id;
                        }
                        callback(null, { 
                            lastID: lastID,
                            changes: result.rowCount || 0 
                        });
                    }
                }
            });
        },
        get: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            const convertedSQL = convertSQL(sql);
            pool.query(convertedSQL, params || [], (err, result) => {
                if (callback) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, result.rows[0] || null);
                    }
                }
            });
        },
        all: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            const convertedSQL = convertSQL(sql);
            pool.query(convertedSQL, params || [], (err, result) => {
                if (callback) {
                    if (err) {
                        callback(err, null);
                    } else {
                        callback(null, result.rows);
                    }
                }
            });
        }
    };
    
    // Test connection
    pool.query('SELECT NOW()', (err, result) => {
        if (err) {
            console.error('❌ Error conectando a PostgreSQL:', err.message);
        } else {
            console.log('✅ Conectado a PostgreSQL exitosamente');
        }
    });
} else {
    // SQLite para desarrollo local
    dbType = 'sqlite';
    console.log('💾 Usando SQLite (desarrollo local)');
    
    const dbPath = process.env.DATABASE_PATH || './database.sqlite';
    const dbDir = path.dirname(dbPath);
    if (dbDir !== '.' && !fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    const sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
            console.error('❌ Error abriendo SQLite:', err.message);
            process.exit(1);
        } else {
            console.log('✅ Conectado a SQLite');
            // Configurar modo WAL
            sqliteDb.run('PRAGMA journal_mode = WAL;');
            sqliteDb.run('PRAGMA synchronous = NORMAL;');
        }
    });
    
    db = {
        type: 'sqlite',
        db: sqliteDb,
        query: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            sqliteDb.all(sql, params || [], callback);
        },
        run: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            sqliteDb.run(sql, params || [], function(err) {
                if (callback) {
                    callback(err, { lastID: this.lastID, changes: this.changes });
                }
            });
        },
        get: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            sqliteDb.get(sql, params || [], callback);
        },
        all: (sql, params, callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            sqliteDb.all(sql, params || [], callback);
        }
    };
}

// Helper para convertir SQL de SQLite a PostgreSQL
function convertSQL(sql) {
    if (dbType === 'postgresql') {
        let converted = sql;
        
        // Convertir AUTOINCREMENT a SERIAL (solo en CREATE TABLE)
        converted = converted.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
        converted = converted.replace(/INTEGER PRIMARY KEY/gi, 'SERIAL PRIMARY KEY');
        
        // Convertir DATETIME a TIMESTAMP
        converted = converted.replace(/DATETIME/gi, 'TIMESTAMP');
        
        // Convertir CURRENT_TIMESTAMP para DEFAULT
        converted = converted.replace(/DEFAULT CURRENT_TIMESTAMP/gi, 'DEFAULT CURRENT_TIMESTAMP');
        
        // Convertir INSERT OR IGNORE a INSERT ... ON CONFLICT DO NOTHING
        if (converted.match(/INSERT\s+OR\s+IGNORE/i)) {
            // Extraer tabla y valores
            const match = converted.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
            if (match) {
                const table = match[1];
                const columns = match[2];
                const values = match[3];
                // Encontrar columnas UNIQUE para el ON CONFLICT
                converted = `INSERT INTO ${table} (${columns}) VALUES (${values}) ON CONFLICT DO NOTHING`;
            }
        }
        
        // Convertir funciones de fecha de SQLite a PostgreSQL
        // IMPORTANTE: El orden importa - primero los casos más específicos
        
        // date('now', '+7 days') → CURRENT_DATE + INTERVAL '7 days'
        // Maneja: '+7 days', '+15 days', '+30 days', etc.
        converted = converted.replace(/date\('now',\s*'\+(\d+)\s+(days?|months?|years?|weeks?|hours?|minutes?|seconds?)'\s*\)/gi, 
            "CURRENT_DATE + INTERVAL '$1 $2'");
        
        // date('now', '-365 days') → CURRENT_DATE - INTERVAL '365 days'
        // Maneja: '-365 days', '-90 days', '-60 days', '-30 days', '-12 months', '-6 months', etc.
        converted = converted.replace(/date\('now',\s*'-(\d+)\s+(days?|months?|years?|weeks?|hours?|minutes?|seconds?)'\s*\)/gi, 
            "CURRENT_DATE - INTERVAL '$1 $2'");
        
        // date('now') → CURRENT_DATE (debe ir después de los casos con intervalos)
        converted = converted.replace(/date\('now'\)/gi, "CURRENT_DATE");
        
        // date(column) → column::DATE (debe ir después de date('now'))
        // Maneja: date(o.fecha_vencimiento_licencia), date(ip.fecha_vencimiento), etc.
        converted = converted.replace(/date\(([a-zA-Z_][a-zA-Z0-9_.]*)\)/gi, "$1::DATE");
        
        // datetime('now') → CURRENT_TIMESTAMP
        converted = converted.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
        
        // strftime('%Y-%m', column) → TO_CHAR(column, 'YYYY-MM')
        // Maneja: strftime('%Y-%m', fecha), strftime('%Y-%m', fr.fecha), etc.
        converted = converted.replace(/strftime\('%Y-%m',\s*([a-zA-Z_][a-zA-Z0-9_.]*)\)/gi, "TO_CHAR($1, 'YYYY-MM')");
        
        // strftime('%Y-W%W', column) → TO_CHAR(column, 'IYYY-IW') (ISO week format)
        // Maneja: strftime('%Y-W%W', fecha)
        converted = converted.replace(/strftime\('%Y-W%W',\s*([a-zA-Z_][a-zA-Z0-9_.]*)\)/gi, "TO_CHAR($1, 'IYYY-\"W\"IW')");
        
        // Convertir sqlite_master a información_schema para PostgreSQL
        converted = converted.replace(/sqlite_master/gi, 'information_schema.tables');
        converted = converted.replace(/type='table'/gi, "table_type='BASE TABLE'");
        
        // Convertir ? placeholders a $1, $2, etc. (debe ser lo último)
        let paramIndex = 1;
        converted = converted.replace(/\?/g, () => `$${paramIndex++}`);
        
        return converted;
    }
    return sql;
}

// Helper para ejecutar queries con conversión automática
db.queryConverted = function(sql, params, callback) {
    const convertedSQL = convertSQL(sql);
    return this.query(convertedSQL, params, callback);
};

db.runConverted = function(sql, params, callback) {
    const convertedSQL = convertSQL(sql);
    return this.run(convertedSQL, params, callback);
};

db.getConverted = function(sql, params, callback) {
    const convertedSQL = convertSQL(sql);
    return this.get(convertedSQL, params, callback);
};

db.allConverted = function(sql, params, callback) {
    const convertedSQL = convertSQL(sql);
    return this.all(convertedSQL, params, callback);
};

module.exports = db;

