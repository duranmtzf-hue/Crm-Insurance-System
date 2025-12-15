# Guía de Instalación - CRM Insurance System

## Requisitos Previos

1. **Node.js** (versión 14 o superior)
   - Descarga desde: https://nodejs.org/
   - Verifica la instalación: `node --version`

2. **npm** (viene con Node.js)
   - Verifica la instalación: `npm --version`

## Pasos de Instalación

### 1. Instalar Dependencias

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
npm install
```

Esto instalará todas las dependencias necesarias:
- express (servidor web)
- sqlite3 (base de datos)
- bcryptjs (encriptación de contraseñas)
- express-session (gestión de sesiones)
- ejs (motor de plantillas)

### 2. Iniciar el Servidor

Ejecuta uno de estos comandos:

**Para producción:**
```bash
npm start
```

**Para desarrollo (con auto-reload):**
```bash
npm run dev
```

### 3. Acceder a la Aplicación

Abre tu navegador y ve a:
```
http://localhost:3000
```

## Primera Configuración

### Usuario Administrador por Defecto

El sistema crea automáticamente un usuario administrador:

- **Usuario:** `admin`
- **Contraseña:** `admin123`

**IMPORTANTE:** Cambia esta contraseña después del primer inicio de sesión.

### Crear Nueva Cuenta

1. Ve a: http://localhost:3000/register
2. Completa el formulario de registro
3. Inicia sesión con tus credenciales

## Estructura de la Base de Datos

La base de datos `database.sqlite` se crea automáticamente al iniciar el servidor por primera vez.

### Tablas Creadas:

- **users** - Usuarios del sistema
- **vehicles** - Vehículos de la flotilla
- **fuel_records** - Registros de combustible
- **maintenance_records** - Registros de mantenimiento
- **insurance_policies** - Pólizas de seguros
- **operators** - Operadores/conductores

## Uso del Sistema

### 1. Iniciar Sesión

- Ve a: http://localhost:3000/login
- Ingresa tus credenciales

### 2. Dashboard

Después de iniciar sesión, verás el dashboard con:
- Resumen de vehículos
- KPIs principales
- Alertas importantes
- Registros recientes

### 3. Agregar Vehículos

1. Ve a "Mis Vehículos"
2. Click en "Agregar Vehículo"
3. Completa el formulario
4. Guarda

### 4. Registrar Combustible

1. Abre un vehículo
2. Click en "Agregar Registro" en la sección de combustible
3. Completa los datos
4. Guarda

### 5. Registrar Mantenimientos

1. Abre un vehículo
2. Click en "Agregar Mantenimiento"
3. Selecciona tipo (Preventivo/Correctivo)
4. Completa los datos
5. Guarda

## Solución de Problemas

### Error: "Cannot find module"
```bash
npm install
```

### Error: "Port 3000 already in use"
Cambia el puerto en `server.js`:
```javascript
const PORT = process.env.PORT || 3001; // Cambia 3000 por otro número
```

### La base de datos no se crea
- Verifica que tienes permisos de escritura en la carpeta
- Elimina `database.sqlite` si existe y reinicia el servidor

### No puedo iniciar sesión
- Verifica que el servidor esté corriendo
- Asegúrate de usar las credenciales correctas
- Revisa la consola del servidor para errores

## Producción

Para usar en producción:

1. **Instala PM2** (process manager):
```bash
npm install -g pm2
```

2. **Inicia con PM2**:
```bash
pm2 start server.js --name crm-insurance
```

3. **Configura para iniciar automáticamente**:
```bash
pm2 startup
pm2 save
```

4. **Configura HTTPS** (recomendado)
5. **Configura backup de base de datos** (recomendado)

## Soporte

Para más ayuda, contacta a: info@crm-insurance-system.com

