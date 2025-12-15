# CRM Insurance System - Sistema de Control de Flotillas

Sistema CRM profesional para gestión de flotillas vehiculares con pólizas de seguros.

## Características

- ✅ Autenticación de usuarios
- ✅ Gestión completa de vehículos
- ✅ Registro de combustible
- ✅ Control de mantenimientos (preventivo y correctivo)
- ✅ Gestión de pólizas de seguros
- ✅ Dashboard con métricas en tiempo real
- ✅ Alertas automáticas
- ✅ Base de datos SQLite

## Instalación

1. **Instalar Node.js** (versión 14 o superior)
   - Descarga desde: https://nodejs.org/

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Iniciar el servidor**
   ```bash
   npm start
   ```
   O para desarrollo con auto-reload:
   ```bash
   npm run dev
   ```

4. **Acceder a la aplicación**
   - Abre tu navegador en: http://localhost:3000
   - Usuario por defecto: `admin`
   - Contraseña: `admin123`

## Estructura del Proyecto

```
├── server.js              # Servidor principal
├── package.json           # Dependencias
├── database.sqlite        # Base de datos (se crea automáticamente)
├── views/                 # Plantillas EJS
│   ├── login.ejs
│   ├── register.ejs
│   ├── dashboard.ejs
│   └── vehicles.ejs
├── public/                # Archivos estáticos
├── images/                # Imágenes
└── *.html                 # Páginas estáticas del sitio web
```

## Funcionalidades Principales

### Dashboard
- Vista general de la flotilla
- KPIs principales
- Alertas de pólizas y mantenimientos
- Registros recientes

### Gestión de Vehículos
- Agregar, editar y eliminar vehículos
- Ver detalles completos de cada vehículo
- Historial de combustible y mantenimientos

### Registro de Combustible
- Registrar cargas de combustible
- Seguimiento de consumo
- Análisis de costos

### Mantenimientos
- Programar mantenimientos preventivos
- Registrar mantenimientos correctivos
- Alertas por kilometraje

### Pólizas de Seguros
- Gestión de pólizas
- Alertas de vencimiento
- Historial de siniestros

## API Endpoints

### Autenticación
- `GET /login` - Página de login
- `POST /login` - Iniciar sesión
- `GET /register` - Página de registro
- `POST /register` - Crear cuenta
- `GET /logout` - Cerrar sesión

### Dashboard
- `GET /dashboard` - Dashboard principal

### Vehículos
- `GET /vehicles` - Lista de vehículos
- `GET /vehicles/:id` - Detalles de vehículo
- `GET /api/vehicles` - API JSON de vehículos
- `POST /api/vehicles` - Crear vehículo

### Combustible
- `POST /api/fuel` - Registrar combustible

### Mantenimientos
- `POST /api/maintenance` - Registrar mantenimiento

## Base de Datos

El sistema utiliza SQLite y crea automáticamente las siguientes tablas:

- `users` - Usuarios del sistema
- `vehicles` - Vehículos de la flotilla
- `fuel_records` - Registros de combustible
- `maintenance_records` - Registros de mantenimiento
- `insurance_policies` - Pólizas de seguros
- `operators` - Operadores/conductores

## Seguridad

- Contraseñas encriptadas con bcrypt
- Sesiones seguras
- Validación de datos
- Protección contra acceso no autorizado

## Desarrollo

Para desarrollo con auto-reload:
```bash
npm run dev
```

## Producción

Para producción, se recomienda:
1. Usar un proceso manager como PM2
2. Configurar variables de entorno
3. Usar HTTPS
4. Configurar backup de base de datos

## Soporte

Para más información, contacta a: info@crm-insurance-system.com

