# 🚀 Guía Completa de Despliegue - Sistema CRM Flotilla de Autos

## 📋 Requisitos Previos

Antes de desplegar, asegúrate de tener:
- ✅ Tu código funcionando localmente
- ✅ Una cuenta de GitHub (gratis)
- ✅ Las credenciales de Gmail configuradas (`GMAIL_USER` y `GMAIL_PASS`)

---

## 🎯 Opción 1: Railway (RECOMENDADO - Más Fácil)

Railway es la opción más sencilla y tiene un plan gratuito generoso.

### Paso 1: Subir código a GitHub

1. Si no tienes GitHub, crea una cuenta en https://github.com
2. Crea un nuevo repositorio (público o privado)
3. En tu carpeta del proyecto, ejecuta:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
   git push -u origin main
   ```

### Paso 2: Crear cuenta en Railway

1. Ve a https://railway.app
2. Haz clic en "Start a New Project"
3. Selecciona "Login with GitHub" y autoriza Railway

### Paso 3: Desplegar la aplicación

1. En Railway, haz clic en "New Project"
2. Selecciona "Deploy from GitHub repo"
3. Elige tu repositorio
4. Railway detectará automáticamente que es Node.js
5. Haz clic en "Deploy Now"

### Paso 4: Configurar Variables de Entorno

1. En el dashboard de Railway, ve a tu proyecto
2. Haz clic en la pestaña "Variables"
3. Agrega estas variables:
   ```
   GMAIL_USER=tu_correo@gmail.com
   GMAIL_PASS=tu_contraseña_de_aplicacion_de_16_caracteres
   ```
4. Railway asignará automáticamente `PORT` (no necesitas configurarlo)

### Paso 5: Configurar Base de Datos (Opcional pero Recomendado)

Railway ofrece PostgreSQL gratis. Para migrar de SQLite a PostgreSQL:

1. En Railway, haz clic en "New" → "Database" → "Add PostgreSQL"
2. Railway te dará las credenciales automáticamente
3. Las variables de entorno se configuran automáticamente

**Nota**: Por ahora puedes usar SQLite, pero PostgreSQL es mejor para producción.

### Paso 6: Obtener tu URL

1. Railway te dará una URL automática tipo: `tu-app.railway.app`
2. Haz clic en "Settings" → "Generate Domain" para una URL personalizada
3. ¡Tu aplicación estará en línea!

---

## 🎯 Opción 2: Render (Alternativa Gratuita)

Render también ofrece hosting gratuito con algunas limitaciones.

### Paso 1: Subir código a GitHub
(Sigue los mismos pasos que Railway)

### Paso 2: Crear cuenta en Render

1. Ve a https://render.com
2. Haz clic en "Get Started for Free"
3. Conecta tu cuenta de GitHub

### Paso 3: Crear Web Service

1. En el dashboard, haz clic en "New +" → "Web Service"
2. Conecta tu repositorio de GitHub
3. Configura:
   - **Name**: Nombre de tu app (ej: "crm-flotilla")
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free (tiene limitaciones pero funciona)

### Paso 4: Configurar Variables de Entorno

1. En la configuración del servicio, ve a "Environment"
2. Agrega:
   ```
   GMAIL_USER=tu_correo@gmail.com
   GMAIL_PASS=tu_contraseña_de_aplicacion
   ```

### Paso 5: Desplegar

1. Haz clic en "Create Web Service"
2. Render comenzará a construir y desplegar tu app
3. Espera 5-10 minutos
4. Obtendrás una URL tipo: `tu-app.onrender.com`

**Nota**: En el plan gratuito, Render "duerme" tu app después de 15 minutos de inactividad. La primera carga puede tardar ~30 segundos.

---

## 🎯 Opción 3: Vercel (Solo Frontend + Serverless)

Vercel es excelente pero requiere adaptar el código para serverless. **No recomendado** para esta app sin modificaciones.

---

## 📧 Configuración de Email

### Opción A: Gmail (Actual)

**Ventajas:**
- ✅ Gratis
- ✅ Fácil de configurar
- ✅ Ya está implementado

**Desventajas:**
- ⚠️ Límite de ~500 emails/día
- ⚠️ Puede ir a spam si envías muchos

**Configuración:**
1. Usa la contraseña de aplicación de Gmail (16 caracteres)
2. Configúrala en las variables de entorno del hosting

### Opción B: Resend (Recomendado para Producción)

**Ventajas:**
- ✅ 3,000 emails/mes gratis
- ✅ Mejor deliverability (llegan a inbox)
- ✅ Dashboard con estadísticas
- ✅ API más simple

**Cómo configurar:**

1. Crea cuenta en https://resend.com
2. Obtén tu API key
3. Modifica `server.js` para usar Resend en lugar de Nodemailer
4. Configura la variable `RESEND_API_KEY` en tu hosting

---

## 🔒 Seguridad en Producción

### Checklist de Seguridad:

- [ ] Cambia `SESSION_SECRET` a un valor aleatorio fuerte
- [ ] Usa HTTPS (Railway y Render lo incluyen automáticamente)
- [ ] No subas archivos `.env` a GitHub
- [ ] Agrega `.env` a `.gitignore`
- [ ] Considera usar PostgreSQL en lugar de SQLite para producción

### Crear `.gitignore`

Crea un archivo `.gitignore` en la raíz del proyecto:

```
node_modules/
.env
*.log
.DS_Store
uploads/
*.db
*.sqlite
*.sqlite3
```

---

## 🐛 Solución de Problemas Comunes

### Error: "Cannot find module"
- **Solución**: Asegúrate de que `package.json` tenga todas las dependencias
- Ejecuta `npm install` localmente y verifica que funcione

### Error: "Port already in use"
- **Solución**: Railway y Render asignan el puerto automáticamente
- Tu código ya usa `process.env.PORT || 3000`, así que está bien

### Emails no se envían
- **Solución**: Verifica que `GMAIL_USER` y `GMAIL_PASS` estén configurados correctamente
- Revisa los logs del hosting para ver errores específicos

### Base de datos no persiste
- **Solución**: En Railway/Render, los archivos pueden resetearse
- Considera migrar a PostgreSQL (Railway lo ofrece gratis)

---

## 📊 Comparación de Opciones

| Característica | Railway | Render | Heroku |
|----------------|---------|--------|--------|
| Plan Gratuito | ✅ Sí | ✅ Sí | ❌ No |
| Base de Datos Gratis | ✅ PostgreSQL | ✅ PostgreSQL | ❌ No |
| Facilidad de Uso | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Velocidad | ⚡⚡⚡⚡ | ⚡⚡⚡ | ⚡⚡⚡⚡ |
| Sleep en Free | ❌ No | ✅ Sí (15 min) | ❌ No |

---

## 🎓 Próximos Pasos Después del Despliegue

1. **Dominio Personalizado**: Compra un dominio y conéctalo a Railway/Render
2. **Base de Datos**: Migra de SQLite a PostgreSQL para mejor rendimiento
3. **Monitoreo**: Configura alertas para errores
4. **Backups**: Configura backups automáticos de la base de datos
5. **CDN**: Considera usar Cloudflare para mejor velocidad global

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs en el dashboard de tu hosting
2. Verifica que las variables de entorno estén configuradas
3. Asegúrate de que el código funcione localmente primero

---

## ✅ Checklist Final

Antes de considerar el despliegue completo:

- [ ] Código funciona localmente sin errores
- [ ] Variables de entorno configuradas correctamente
- [ ] `.gitignore` creado y configurado
- [ ] Código subido a GitHub
- [ ] Cuenta creada en Railway o Render
- [ ] Variables de entorno configuradas en el hosting
- [ ] Aplicación desplegada y funcionando
- [ ] Pruebas realizadas (registro, login, crear póliza, enviar email)

¡Feliz despliegue! 🚀

