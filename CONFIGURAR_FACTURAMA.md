# 🔐 Cómo Configurar Credenciales de Facturama para CFDI

## ⚠️ IMPORTANTE: Necesitas esto para generar CFDI timbrados por el SAT

Sin estas credenciales, el sistema funcionará en **modo simulación** y los CFDI generados **NO estarán timbrados por el SAT**.

---

## 💰 ¿Cuánto Cuesta Facturama?

**Sí, Facturama es un servicio de pago**, pero tiene planes muy accesibles:

### Planes Disponibles (2024):

- **Plan Básico**: $110 MXN anuales
  - Incluye 25 facturas al año
  - Ideal para empezar o uso ocasional

- **Plan Estándar**: $165 MXN anuales
  - Incluye 40 facturas al año
  - Buen balance precio/cantidad

- **Plan Ilimitado**: $1,650 MXN anuales
  - Facturas ilimitadas
  - Ideal para empresas con alto volumen

### Plan API (Para Integraciones):

- **Plan API**: $1,650 MXN anuales
  - Incluye 100 folios fiscales
  - Folios adicionales: desde $0.50 MXN cada uno
  - Necesario para usar la API (lo que requiere este sistema)

### 💡 Recomendación:

- Si solo necesitas **probar** el sistema: Usa el **modo simulación** (gratis, pero no válido fiscalmente)
- Si necesitas **CFDI reales timbrados**: Necesitas el **Plan API** de Facturama ($1,650 MXN/año)

**Nota:** Los precios pueden variar. Consulta directamente en https://www.facturama.mx/ para información actualizada.

---

## 📋 Paso 1: Obtener Cuenta de Facturama

### 1.1 Crear Cuenta en Facturama

1. Ve a: **https://www.facturama.mx/**
2. Haz clic en **"Regístrate"** o **"Crear cuenta"**
3. Completa el formulario de registro con tus datos fiscales
4. Verifica tu correo electrónico

### 1.2 Activar tu Cuenta

1. Revisa tu correo y haz clic en el enlace de verificación
2. Completa tu perfil fiscal (RFC, razón social, etc.)
3. Facturama te pedirá validar tu identidad fiscal

---

## 📋 Paso 2: Obtener Credenciales de API

### 2.1 Acceder al Panel de API

1. Inicia sesión en **https://www.facturama.mx/**
2. Ve a **"Configuración"** o **"API"** en el menú
3. Busca la sección **"Credenciales API"** o **"API Keys"**

### 2.2 Obtener Usuario y Contraseña

Facturama te proporcionará:
- **Usuario API** (FACTURAMA_USER): Generalmente es tu RFC o un usuario específico para API
- **Contraseña API** (FACTURAMA_PASS): Una contraseña generada por Facturama

**⚠️ IMPORTANTE:**
- Estas credenciales son **diferentes** a tu usuario y contraseña de inicio de sesión
- Si no las encuentras, contacta al soporte de Facturama
- **Necesitas el Plan API** ($1,650 MXN/año) para acceder a las credenciales de API
- Los planes básicos ($110-$165 MXN/año) NO incluyen acceso a API

### 2.3 Modo Sandbox vs Producción

- **Sandbox (Pruebas)**: Para probar sin generar CFDI reales
  - URL: `https://apisandbox.facturama.mx/3/cfdis`
  - Los CFDI generados son de prueba y NO son válidos fiscalmente
  
- **Producción**: Para generar CFDI reales timbrados por el SAT
  - URL: `https://api.facturama.mx/3/cfdis`
  - Los CFDI generados son REALES y válidos fiscalmente

**Recomendación:** Empieza con **sandbox** para probar, luego cambia a **producción**.

---

## 📋 Paso 3: Configurar en Render

### 3.1 Acceder a Variables de Entorno en Render

1. Ve a tu proyecto en **Render**: https://dashboard.render.com
2. Selecciona tu servicio (Web Service)
3. En el menú lateral, haz clic en **"Environment"** (Variables de Entorno)

### 3.2 Agregar Variables de Entorno

Haz clic en **"Add Environment Variable"** y agrega las siguientes variables:

#### Variable 1: FACTURAMA_USER
- **Key:** `FACTURAMA_USER`
- **Value:** Tu usuario API de Facturama (el que obtuviste en el Paso 2.2)
- **Ejemplo:** `AAA010101AAA` o `usuario_api@facturama.mx`

#### Variable 2: FACTURAMA_PASS
- **Key:** `FACTURAMA_PASS`
- **Value:** Tu contraseña API de Facturama (la que obtuviste en el Paso 2.2)
- **Ejemplo:** `TuContraseñaAPI123`

#### Variable 3: FACTURAMA_MODE (Opcional)
- **Key:** `FACTURAMA_MODE`
- **Value:** `sandbox` (para pruebas) o `production` (para producción)
- **Por defecto:** Si no la configuras, usará `sandbox`

### 3.3 Guardar y Reiniciar

1. Haz clic en **"Save Changes"**
2. Render reiniciará automáticamente tu servicio
3. Espera 1-2 minutos a que el servicio se reinicie

---

## 📋 Paso 4: Verificar Configuración

### 4.1 Verificar en los Logs

1. En Render, ve a **"Logs"** de tu servicio
2. Busca mensajes que indiquen:
   - ✅ "CFDI generado exitosamente" (si hay credenciales)
   - ⚠️ "Modo simulación" (si no hay credenciales)

### 4.2 Probar Generación de CFDI

1. Ve a tu aplicación → **Facturación** → **Carta Porte**
2. Crea o selecciona una Carta Porte
3. Haz clic en **"Generar CFDI"**
4. Si está configurado correctamente:
   - Verás un UUID real del SAT
   - El PDF será el oficial de Facturama
   - El XML estará timbrado por el SAT

---

## 🔍 Solución de Problemas

### Error: "Credenciales de Facturama no configuradas"
- **Solución:** Verifica que `FACTURAMA_USER` y `FACTURAMA_PASS` estén configuradas en Render
- **Solución:** Asegúrate de que el servicio se haya reiniciado después de agregar las variables

### Error: "Unauthorized" o "401"
- **Solución:** Verifica que las credenciales sean correctas
- **Solución:** Asegúrate de usar las credenciales de API, no las de inicio de sesión
- **Solución:** Contacta a Facturama para verificar que tu cuenta tenga acceso a API

### Error: "Forbidden" o "403"
- **Solución:** Tu plan de Facturama puede no incluir acceso a API
- **Solución:** Verifica que tu cuenta esté activa y pagada
- **Solución:** Contacta al soporte de Facturama

### Los CFDI siguen siendo simulados
- **Solución:** Verifica que las variables estén escritas correctamente (sin espacios)
- **Solución:** Reinicia manualmente el servicio en Render
- **Solución:** Verifica los logs de Render para ver si hay errores de conexión

---

## 📞 Soporte

### Facturama
- **Sitio web:** https://www.facturama.mx/
- **Soporte:** https://www.facturama.mx/soporte
- **Documentación API:** https://apisandbox.facturama.mx/help

### Render
- **Documentación:** https://render.com/docs
- **Soporte:** https://render.com/support

---

## ✅ Checklist de Configuración

- [ ] Cuenta de Facturama creada y verificada
- [ ] Credenciales API obtenidas (usuario y contraseña)
- [ ] Variable `FACTURAMA_USER` configurada en Render
- [ ] Variable `FACTURAMA_PASS` configurada en Render
- [ ] Variable `FACTURAMA_MODE` configurada (opcional, recomendado: `sandbox` para empezar)
- [ ] Servicio reiniciado en Render
- [ ] CFDI de prueba generado exitosamente
- [ ] PDF y XML descargados y verificados

---

## 🎯 Próximos Pasos

Una vez configurado:

1. **Prueba en Sandbox:** Genera algunos CFDI de prueba para familiarizarte
2. **Verifica Datos:** Asegúrate de que todos los datos fiscales estén correctos
3. **Cambia a Producción:** Cuando estés listo, cambia `FACTURAMA_MODE` a `production`
4. **Genera CFDI Reales:** Ahora podrás generar CFDI timbrados por el SAT

---

**Nota:** Los CFDI generados en modo **sandbox** son solo para pruebas y NO son válidos fiscalmente. Solo los CFDI generados en modo **production** están timbrados por el SAT y son válidos para efectos fiscales.

