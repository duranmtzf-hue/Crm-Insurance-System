# Solución de Problemas - CRM Insurance System

## 🔴 Problema: La página está incompleta, no se ve el logo, no funcionan los paneles

### Solución Paso a Paso:

#### 1. Detén todos los procesos de Node.js
```powershell
# En PowerShell, ejecuta:
Get-Process -Name node | Stop-Process -Force
```

#### 2. Verifica que tengas todos los archivos necesarios
Asegúrate de tener estos archivos en tu carpeta:
- ✅ `server.js`
- ✅ `package.json`
- ✅ `index.html`
- ✅ `images/logo.png`
- ✅ Carpeta `views/` con los archivos .ejs

#### 3. Reinstala las dependencias
```bash
npm install
```

#### 4. Inicia el servidor de nuevo
```bash
npm start
```

Deberías ver:
```
Server running on http://localhost:3000
   Connected to SQLite database
   Default admin: username=admin, password=admin123
   ```

#### 5. Accede correctamente:
- **Página principal:** http://localhost:3000
- **Sistema de login:** http://localhost:3000/login
- **Dashboard (después de login):** http://localhost:3000/dashboard

### ⚠️ Verificaciones Importantes:

1. **¿El servidor está corriendo?**
   - Debes ver mensajes en la consola
   - Si no ves nada, hay un error

2. **¿El puerto 3000 está libre?**
   - Cierra otros programas que usen el puerto 3000
   - O cambia el puerto en `server.js` línea 9:
     ```javascript
     const PORT = process.env.PORT || 3001; // Cambia a 3001
     ```

3. **¿Los archivos HTML se cargan?**
   - Abre las herramientas de desarrollador (F12)
   - Ve a la pestaña "Network" o "Red"
   - Recarga la página
   - Verifica que los archivos se carguen sin errores 404

4. **¿El logo aparece?**
   - Verifica que exista `images/logo.png`
   - Verifica la ruta en el HTML: `src="images/logo.png"`

### 🔧 Si sigue sin funcionar:

#### Opción 1: Reinicio completo
1. Cierra todas las terminales
2. Elimina `node_modules` y `package-lock.json`
3. Ejecuta `npm install` de nuevo
4. Ejecuta `npm start`

#### Opción 2: Verifica errores en consola
1. Abre la consola del navegador (F12)
2. Ve a la pestaña "Console"
3. Busca errores en rojo
4. Comparte esos errores para diagnóstico

#### Opción 3: Prueba con servidor de prueba
```bash
node test-server.js
```
Luego ve a: http://localhost:3001

Si esto funciona, el problema está en la configuración del servidor principal.

### 📋 Checklist de Verificación:

- [ ] Node.js está instalado (`node --version`)
- [ ] npm está instalado (`npm --version`)
- [ ] `npm install` se ejecutó sin errores
- [ ] El servidor inicia sin errores
- [ ] Puedes acceder a http://localhost:3000
- [ ] El logo existe en `images/logo.png`
- [ ] La carpeta `views/` existe con archivos .ejs
- [ ] No hay otros procesos usando el puerto 3000

### 🆘 Si nada funciona:

1. Comparte el mensaje de error completo de la consola
2. Comparte el mensaje de error del navegador (F12 → Console)
3. Verifica que todos los archivos estén presentes

