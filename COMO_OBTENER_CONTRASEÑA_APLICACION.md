# 🔐 Cómo Obtener Contraseña de Aplicación de Gmail

## ⚠️ IMPORTANTE: Necesitas esto para que funcione el envío de correos

## 📋 Pasos Detallados:

### Paso 1: Activar Verificación en Dos Pasos (2FA)

1. Ve a: https://myaccount.google.com/security
2. Busca la sección **"Verificación en dos pasos"** o **"2-Step Verification"**
3. Haz clic en **"Activar"** o **"Get started"**
4. Sigue las instrucciones para configurar 2FA (puede ser con tu teléfono)

### Paso 2: Generar Contraseña de Aplicación

**Opción A: Desde la página de seguridad**
1. En https://myaccount.google.com/security
2. Busca **"Contraseñas de aplicaciones"** o **"App passwords"**
3. Haz clic en ese enlace

**Opción B: Acceso directo**
1. Ve directamente a: **https://myaccount.google.com/apppasswords**
2. Si te pide verificar tu identidad, hazlo

### Paso 3: Crear la Contraseña

1. En la página de "App passwords":
   - **Selecciona la app:** Elige **"Correo"** o **"Mail"**
   - **Selecciona el dispositivo:** Elige **"Otro (nombre personalizado)"** o **"Other (Custom name)"**
   - **Escribe un nombre:** Por ejemplo: `CRM Insurance System`
   - **Haz clic en "Generar"** o **"Generate"**

2. **Google te mostrará una contraseña de 16 caracteres** (sin espacios)
   - Ejemplo: `abcd efgh ijkl mnop` → Usa: `abcdefghijklmnop` (sin espacios)

### Paso 4: Copiar y Usar la Contraseña

1. **Copia la contraseña completa** (16 caracteres, sin espacios)
2. **Abre el archivo `start-with-email.ps1`**
3. **Pega la contraseña** en la línea 5:
   ```powershell
   $env:GMAIL_PASS = "TU_CONTRASEÑA_DE_16_CARACTERES_AQUI"
   ```
4. **Guarda el archivo**
5. **Reinicia el servidor** ejecutando: `.\start-with-email.ps1`

## ⚠️ IMPORTANTE:

- **NO uses tu contraseña normal de Gmail** - No funcionará
- **Usa SOLO la contraseña de aplicación** de 16 caracteres
- **La contraseña de aplicación es de un solo uso** - Si la pierdes, genera una nueva
- **No compartas esta contraseña** - Es específica para tu aplicación

## 🔍 ¿No puedes ver "App passwords"?

Si no ves la opción "App passwords", significa que:
1. **No tienes 2FA activado** - Actívalo primero en https://myaccount.google.com/security
2. **Tu cuenta es de una organización** - Puede que necesites permisos del administrador
3. **Estás usando una cuenta de trabajo/escuela** - Puede que no esté disponible

## ✅ Verificación:

Después de configurar todo, cuando ejecutes `.\start-with-email.ps1`, deberías ver en la consola:

```
✅ Servidor de correo configurado correctamente
```

Si ves esto, ¡todo está funcionando correctamente!

