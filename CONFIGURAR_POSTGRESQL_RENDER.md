# 🐘 Configurar PostgreSQL en Render

## ⚠️ IMPORTANTE: Esto soluciona el problema de persistencia

Sin PostgreSQL, los usuarios y vehículos se pierden cuando Render reinicia el servicio. Con PostgreSQL, **todo se guarda permanentemente**.

---

## 📋 Pasos para Configurar PostgreSQL en Render

### Paso 1: Crear Base de Datos PostgreSQL

1. Ve a https://dashboard.render.com
2. En tu proyecto, haz clic en **"New +"** (arriba a la derecha)
3. Selecciona **"PostgreSQL"**
4. Configura:
   - **Name**: `crm-insurance-db` (o el nombre que prefieras)
   - **Database**: `crm_insurance` (o el nombre que prefieras)
   - **User**: Se crea automáticamente
   - **Region**: Elige la misma región que tu servicio web
   - **Plan**: **Free** (suficiente para empezar)
5. Haz clic en **"Create Database"**

### Paso 2: Conectar Base de Datos al Servicio Web

1. Render creará automáticamente la variable de entorno `DATABASE_URL`
2. Ve a tu **Web Service** (tu aplicación)
3. En **"Settings"** → **"Environment"**
4. Verifica que `DATABASE_URL` esté presente (Render la agrega automáticamente)
5. Si no está, cópiala desde la base de datos PostgreSQL:
   - Ve a tu base de datos PostgreSQL
   - En **"Connections"** verás la **"Internal Database URL"**
   - Cópiala y agrégala como variable de entorno en tu Web Service

### Paso 3: Redesplegar la Aplicación

1. En tu Web Service, haz clic en **"Manual Deploy"**
2. Selecciona **"Deploy latest commit"**
3. Espera 5-10 minutos

---

## ✅ Verificación

Después del despliegue, en los logs deberías ver:

```
🐘 Usando PostgreSQL (Render)
✅ Conectado a PostgreSQL exitosamente
```

En lugar de:
```
💾 Usando SQLite (desarrollo local)
```

---

## 🎯 Resultado

Una vez configurado PostgreSQL:

✅ **Los usuarios se guardan permanentemente**  
✅ **Los vehículos se guardan permanentemente**  
✅ **Todas las pólizas, facturas, etc. se guardan permanentemente**  
✅ **No se pierden datos al reiniciar el servicio**  
✅ **Funciona igual que en desarrollo local, pero con persistencia real**

---

## 🔧 Si Algo Sale Mal

### Error: "relation does not exist"
- **Solución**: La base de datos está vacía. La aplicación creará las tablas automáticamente al iniciar.

### Error: "connection refused"
- **Solución**: Verifica que `DATABASE_URL` esté configurada correctamente en las variables de entorno.

### Error: "password authentication failed"
- **Solución**: Usa la URL interna de Render, no la externa.

---

## 📝 Notas Importantes

- **PostgreSQL en Render es GRATIS** en el plan básico
- **Los datos persisten** incluso si el servicio se reinicia
- **La aplicación detecta automáticamente** si hay PostgreSQL o SQLite
- **En desarrollo local** seguirá usando SQLite (no necesitas cambiar nada)

---

## 🚀 ¡Listo!

Una vez configurado PostgreSQL, tu aplicación tendrá persistencia real y los usuarios y vehículos se guardarán permanentemente.

