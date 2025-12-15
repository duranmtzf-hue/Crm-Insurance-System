# Inicio Rápido - CRM Insurance System

## ⚡ Pasos para Iniciar el Sistema

### 1. Abre una Terminal/PowerShell en la carpeta del proyecto

### 2. Instala las dependencias (solo la primera vez):
```bash
npm install
```

### 3. Inicia el servidor:
```bash
npm start
```

Deberías ver:
```
Server running on http://localhost:3000
Connected to SQLite database
Default admin: username=admin, password=admin123
```

### 4. Abre tu navegador y ve a:
```
http://localhost:3000
```

### 5. Para acceder al sistema funcional:
- Click en el botón **"Acceder al Sistema"** en la página principal
- O ve directamente a: http://localhost:3000/login

### 6. Inicia sesión con:
- **Usuario:** `admin`
- **Contraseña:** `admin123`

## 🎯 ¿Qué puedes hacer ahora?

1. **Dashboard** - Ve métricas y resumen de tu flotilla
2. **Agregar Vehículos** - Registra tus vehículos
3. **Registrar Combustible** - Lleva control de consumo
4. **Registrar Mantenimientos** - Prevención y correctivos
5. **Ver Alertas** - Pólizas y mantenimientos por vencer

## 🔧 Si algo no funciona:

1. **Verifica que Node.js esté instalado:**
   ```bash
   node --version
   ```
   Debe mostrar v14 o superior

2. **Verifica que el puerto 3000 esté libre**

3. **Revisa la consola del servidor** para ver errores

4. **Si hay errores de módulos:**
   ```bash
   npm install
   ```

5. **Si la base de datos da error:**
   - Elimina el archivo `database.sqlite` si existe
   - Reinicia el servidor

## 📝 Notas Importantes:

- El sistema crea la base de datos automáticamente
- El usuario admin se crea automáticamente la primera vez
- Todos los datos se guardan en `database.sqlite`
- El servidor debe estar corriendo para usar el sistema

## 🆘 Problemas Comunes:

**"Cannot find module"**
→ Ejecuta: `npm install`

**"Port 3000 already in use"**
→ Cambia el puerto en server.js o cierra el otro proceso

**"No se ve el logo"**
→ Verifica que la carpeta `images` tenga el archivo `logo.png`

**"La página está en blanco"**
→ Verifica que el servidor esté corriendo y revisa la consola

