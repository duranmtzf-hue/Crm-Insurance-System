# 🚀 Pasos para Conectar Facturama con tu Sistema

## ✅ Ya tienes sesión iniciada en Facturama - Ahora sigue estos pasos:

---

## 📋 Paso 1: Obtener Credenciales de API

### 1.1 Acceder a la Sección de API

1. **Dentro de Facturama**, busca en el menú:
   - **"API"** o
   - **"Configuración"** → **"API"** o
   - **"Integraciones"** o
   - **"Credenciales API"**

2. **Si no encuentras la opción:**
   - Puede que necesites activar el **Plan API** primero
   - El Plan API cuesta $1,650 MXN/año
   - Los planes básicos ($110-$165 MXN/año) NO incluyen acceso a API

### 1.2 Obtener Usuario y Contraseña API

Una vez en la sección de API, Facturama te mostrará:

- **Usuario API** (FACTURAMA_USER)
  - Puede ser tu RFC o un usuario específico
  - Ejemplo: `AAA010101AAA` o `usuario_api@facturama.mx`

- **Contraseña API** (FACTURAMA_PASS)
  - Una contraseña generada por Facturama
  - Puede que puedas regenerarla si es necesario

**⚠️ IMPORTANTE:**
- Estas credenciales son **DIFERENTES** a tu usuario y contraseña de inicio de sesión
- Son específicas para usar la API
- **Copia estas credenciales** y guárdalas en un lugar seguro

### 1.3 Verificar Modo (Sandbox vs Producción)

Facturama tiene dos modos:

- **Sandbox (Pruebas)**: Para probar sin generar CFDI reales
  - Los CFDI generados son de prueba
  - NO son válidos fiscalmente
  - Recomendado para empezar

- **Producción**: Para generar CFDI reales timbrados por el SAT
  - Los CFDI generados son REALES
  - Válidos fiscalmente
  - Usa esto cuando estés listo para producción

**Recomendación:** Empieza con **Sandbox** para probar.

---

## 📋 Paso 2: Configurar en Render

### 2.1 Acceder a Render

1. Ve a: **https://dashboard.render.com**
2. Inicia sesión con tu cuenta
3. Selecciona tu proyecto (Web Service)

### 2.2 Ir a Variables de Entorno

1. En el menú lateral de tu servicio, busca:
   - **"Environment"** o
   - **"Variables de Entorno"** o
   - **"Env"**

2. Haz clic en esa sección

### 2.3 Agregar Variable 1: FACTURAMA_USER

1. Haz clic en **"Add Environment Variable"** o **"Add Variable"**
2. En el campo **"Key"** escribe exactamente:
   ```
   FACTURAMA_USER
   ```
3. En el campo **"Value"** pega tu **Usuario API** de Facturama
4. Haz clic en **"Save"** o **"Add"**

### 2.4 Agregar Variable 2: FACTURAMA_PASS

1. Haz clic en **"Add Environment Variable"** nuevamente
2. En el campo **"Key"** escribe exactamente:
   ```
   FACTURAMA_PASS
   ```
3. En el campo **"Value"** pega tu **Contraseña API** de Facturama
4. Haz clic en **"Save"** o **"Add"**

### 2.5 Agregar Variable 3: FACTURAMA_MODE (Opcional pero Recomendado)

1. Haz clic en **"Add Environment Variable"** nuevamente
2. En el campo **"Key"** escribe exactamente:
   ```
   FACTURAMA_MODE
   ```
3. En el campo **"Value"** escribe:
   - `sandbox` (para pruebas) - **Recomendado para empezar**
   - `production` (para producción real)
4. Haz clic en **"Save"** o **"Add"**

**Nota:** Si no configuras `FACTURAMA_MODE`, el sistema usará `sandbox` por defecto.

---

## 📋 Paso 3: Reiniciar el Servicio

### 3.1 Reinicio Automático

- Render normalmente reinicia automáticamente cuando agregas variables de entorno
- Espera 1-2 minutos a que el servicio se reinicie

### 3.2 Reinicio Manual (si es necesario)

1. En Render, ve a tu servicio
2. Busca el botón **"Manual Deploy"** o **"Restart"**
3. Haz clic para reiniciar manualmente

---

## 📋 Paso 4: Verificar que Funciona

### 4.1 Probar Generación de CFDI

1. Ve a tu aplicación desplegada en Render
2. Inicia sesión
3. Ve a **Facturación** → **Carta Porte**
4. Crea una nueva Carta Porte o selecciona una existente
5. Haz clic en **"Generar CFDI"**

### 4.2 Verificar Resultado

**Si está configurado correctamente:**
- ✅ Verás un mensaje de éxito
- ✅ Verás un UUID (si es sandbox, será un UUID de prueba)
- ✅ Podrás descargar el PDF
- ✅ Podrás descargar el XML
- ✅ El estado cambiará a "Emitida"

**Si NO está configurado correctamente:**
- ⚠️ Verás un mensaje de "modo simulación"
- ⚠️ El sistema generará un CFDI simulado (no timbrado)

### 4.3 Verificar en los Logs de Render

1. En Render, ve a la sección **"Logs"** de tu servicio
2. Busca mensajes relacionados con Facturama
3. Si hay errores, verás mensajes como:
   - "Unauthorized" → Credenciales incorrectas
   - "Forbidden" → Plan no incluye API
   - "Connection timeout" → Problema de conexión

---

## 🔍 Solución de Problemas Comunes

### ❌ Error: "Credenciales de Facturama no configuradas"

**Solución:**
- Verifica que `FACTURAMA_USER` y `FACTURAMA_PASS` estén configuradas en Render
- Asegúrate de que no haya espacios antes o después de los valores
- Reinicia el servicio manualmente

### ❌ Error: "Unauthorized" o "401"

**Solución:**
- Verifica que las credenciales sean correctas
- Asegúrate de usar las credenciales de **API**, no las de inicio de sesión
- Verifica que no haya espacios o caracteres extra en las credenciales

### ❌ Error: "Forbidden" o "403"

**Solución:**
- Tu plan de Facturama puede no incluir acceso a API
- Necesitas el **Plan API** ($1,650 MXN/año)
- Contacta al soporte de Facturama para verificar tu plan

### ❌ Los CFDI siguen siendo simulados

**Solución:**
- Verifica que las variables estén escritas correctamente (sin espacios, mayúsculas/minúsculas correctas)
- Reinicia manualmente el servicio en Render
- Verifica los logs de Render para ver si hay errores

### ❌ No encuentro la sección de API en Facturama

**Solución:**
- Puede que necesites activar el Plan API primero
- Contacta al soporte de Facturama: https://www.facturama.mx/soporte
- Pregunta específicamente por "Credenciales de API" o "API Keys"

---

## ✅ Checklist Final

Antes de considerar que está todo configurado:

- [ ] Obtuve las credenciales API de Facturama (usuario y contraseña)
- [ ] Agregué `FACTURAMA_USER` en Render con el valor correcto
- [ ] Agregué `FACTURAMA_PASS` en Render con el valor correcto
- [ ] Agregué `FACTURAMA_MODE` en Render (recomendado: `sandbox`)
- [ ] El servicio se reinició en Render
- [ ] Probé generar un CFDI y funcionó correctamente
- [ ] Verifiqué que puedo descargar PDF y XML

---

## 🎯 Próximos Pasos

Una vez que todo funcione:

1. **Prueba en Sandbox:**
   - Genera algunos CFDI de prueba
   - Verifica que los PDFs y XMLs se descarguen correctamente
   - Familiarízate con el proceso

2. **Verifica tus Datos Fiscales:**
   - Asegúrate de que tu RFC esté correcto en tu perfil
   - Verifica que el régimen fiscal sea correcto
   - Revisa que todos los datos de la Carta Porte estén completos

3. **Cuando estés listo para Producción:**
   - Cambia `FACTURAMA_MODE` a `production` en Render
   - Reinicia el servicio
   - Ahora los CFDI serán REALES y timbrados por el SAT

---

## 📞 ¿Necesitas Ayuda?

### Soporte de Facturama
- **Sitio web:** https://www.facturama.mx/
- **Soporte:** https://www.facturama.mx/soporte
- **Documentación API:** https://apisandbox.facturama.mx/help

### Soporte de Render
- **Documentación:** https://render.com/docs
- **Soporte:** https://render.com/support

---

**¡Listo!** Una vez que completes estos pasos, tu sistema estará conectado con Facturama y podrás generar CFDI timbrados por el SAT. 🎉

