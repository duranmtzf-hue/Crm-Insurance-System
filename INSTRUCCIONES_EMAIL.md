# 📧 Instrucciones para Configurar Email Automático

## ⚠️ PROBLEMA COMÚN: Las variables de entorno no se cargan

Las variables de entorno **solo existen en la terminal donde las configuraste**. Si ejecutas `npm start` en otra terminal, no funcionará.

## ✅ SOLUCIÓN: Usa el script PowerShell

### Opción 1: Ejecutar el script (RECOMENDADO)

1. **Abre PowerShell** en la carpeta del proyecto
2. **Ejecuta el script**:
   ```powershell
   .\start-with-email.ps1
   ```
   
   Esto configurará las variables Y ejecutará `npm start` automáticamente.

### Opción 2: Configurar manualmente en la misma terminal

1. **Abre PowerShell** en la carpeta del proyecto
2. **Configura las variables**:
   ```powershell
   $env:GMAIL_USER = "tu_correo@gmail.com"
   $env:GMAIL_PASS = "tu_contraseña_de_aplicacion"
   ```
3. **Ejecuta npm start**:
   ```powershell
   npm start
   ```

⚠️ **IMPORTANTE**: Debes hacer TODO en la misma ventana de PowerShell.

## 🔍 Verificar que funciona

1. **Inicia sesión** en tu aplicación
2. **Crea una póliza nueva** (no las antiguas)
3. **Revisa la consola** donde ejecutaste `npm start` - deberías ver:
   ```
   📧 Email del usuario para póliza: tu_correo@gmail.com
   📧 MailTransporter configurado: true
   Correo de póliza enviado a tu_correo@gmail.com
   ```
4. **Revisa tu bandeja de entrada** (y spam)

## 📬 Para pólizas antiguas

Las pólizas que creaste ANTES de configurar las variables tienen notificaciones pendientes:

1. Ve al **Dashboard**
2. Busca la sección **"Historial de Notificaciones Automáticas"**
3. Haz clic en **"Enviar Notificaciones Pendientes"**
4. Espera a que se procesen
5. Revisa tu correo

## 🐛 Si aún no funciona

### Verifica que tienes contraseña de aplicación (no tu contraseña normal)

1. Ve a: https://myaccount.google.com/apppasswords
2. Si no tienes 2FA activado, actívalo primero
3. Genera una contraseña de aplicación para "Correo"
4. Usa esa contraseña (16 caracteres sin espacios) en `GMAIL_PASS`

### Verifica que el email del usuario está guardado

1. Ve al Dashboard
2. Revisa que tu usuario tiene un email guardado en la base de datos
3. Si no, regístrate de nuevo con tu email

### Revisa la consola del servidor

Cuando creas una póliza, deberías ver logs como:
- `📧 Email del usuario para póliza: ...`
- `📧 MailTransporter configurado: true/false`
- `Correo de póliza enviado a ...` (si funciona)

Si ves errores, cópialos y revisa qué dice.

