# Guía de Despliegue - CRM Insurance System

## ⚠️ IMPORTANTE: Netlify NO es adecuado para esta aplicación

Netlify está diseñado para sitios estáticos y funciones serverless. Esta aplicación necesita:
- Un servidor Node.js **persistente** (siempre corriendo)
- Base de datos SQLite (o mejor aún, PostgreSQL/MySQL en producción)
- Variables de entorno para configuración de email

## ✅ Hosting Recomendado para Producción

### Opción 1: Railway (Recomendado - Más fácil)
1. Ve a https://railway.app
2. Conecta tu repositorio de GitHub
3. Railway detecta automáticamente que es Node.js
4. Configura las variables de entorno en el dashboard:
   - `GMAIL_USER` = tu correo Gmail
   - `GMAIL_PASS` = contraseña de aplicación de Gmail
   - `PORT` = Railway lo asigna automáticamente
5. ¡Listo! Tu app estará en línea

### Opción 2: Render
1. Ve a https://render.com
2. Crea un nuevo "Web Service"
3. Conecta tu repositorio
4. Configura las variables de entorno igual que Railway
5. Render te da una URL automática

### Opción 3: Heroku (Requiere tarjeta de crédito para producción)
1. Similar a Railway pero más complejo
2. Requiere configuración adicional

## 📧 Configuración de Email en Producción

### Opción A: Gmail (Actual - Funciona pero limitado)
- Configura `GMAIL_USER` y `GMAIL_PASS` en las variables de entorno del hosting
- Límite: ~500 emails/día con cuenta gratuita

### Opción B: Servicio Profesional (Recomendado para producción)
Usa **Resend** (gratis hasta 3,000 emails/mes) o **SendGrid**:
- Más confiable
- Mejor deliverability (llegan a inbox, no spam)
- Dashboard para ver estadísticas
- APIs más simples

## 🔧 Variables de Entorno Necesarias

En el dashboard de tu hosting (Railway/Render/etc), configura:

```
GMAIL_USER=tu_correo@gmail.com
GMAIL_PASS=tu_contraseña_de_aplicacion
PORT=3000 (o el que asigne el hosting)
```

## 📝 Cómo Funciona para Cada Usuario

1. Usuario se registra con su email → Se guarda en tabla `users`
2. Usuario crea una póliza → Sistema busca su email en `users.email`
3. Sistema envía correo automáticamente usando las credenciales configuradas
4. El correo llega al email del usuario (no al tuyo)

**IMPORTANTE**: El `GMAIL_USER` es el REMITENTE (desde dónde se envía), pero el DESTINATARIO es el email del usuario que se registró.

## 🚀 Pasos para Desplegar

1. Sube tu código a GitHub
2. Crea cuenta en Railway o Render
3. Conecta el repositorio
4. Configura las variables de entorno
5. Espera a que se despliegue (2-5 minutos)
6. ¡Tu app estará en línea!

## 📚 Recursos

- Railway: https://railway.app/docs
- Render: https://render.com/docs
- Resend (email profesional): https://resend.com

