# 🔄 Cómo Funciona Facturama en tu Sistema

## 📋 Resumen General

Tu sistema integra **Facturama** como un **PAC (Proveedor Autorizado de Certificación)** para generar, timbrar y almacenar CFDI con Complemento Carta Porte. Facturama actúa como intermediario entre tu sistema y el SAT.

---

## 🔄 Flujo Completo del Proceso

### **Paso 1: Crear Carta Porte en tu Sistema**

1. El usuario va a **Facturación → Carta Porte**
2. Llena el formulario con:
   - Datos generales (número de guía, fecha, etc.)
   - Información del vehículo (placas, tipo, etc.)
   - Datos de origen y destino
   - Información de mercancía (tipo, cantidad, peso, valor)
   - Datos del transportista, remitente, destinatario
   - Información del operador
3. Guarda la Carta Porte en tu base de datos

**Resultado:** La Carta Porte queda guardada en tu sistema, pero **aún NO tiene CFDI**.

---

### **Paso 2: Generar CFDI (Botón "Generar CFDI")**

Cuando el usuario hace clic en **"Generar CFDI"**, tu sistema hace lo siguiente:

#### **2.1 Verificación de Credenciales**

```javascript
// Tu sistema verifica si hay credenciales de Facturama
const FACTURAMA_USER = process.env.FACTURAMA_USER;
const FACTURAMA_PASS = process.env.FACTURAMA_PASS;
```

**Si NO hay credenciales:**
- ✅ Genera CFDI en **modo simulación**
- ✅ Crea UUID simulado
- ✅ Genera XML simulado (válido pero no timbrado)
- ✅ Genera PDF simulado
- ⚠️ **NO está timbrado por el SAT** (no válido fiscalmente)

**Si SÍ hay credenciales:**
- ✅ Continúa con el proceso real

---

#### **2.2 Construcción de Datos CFDI**

Tu sistema toma los datos de la Carta Porte y los convierte al formato que Facturama requiere:

```javascript
// Función buildCFDIData() convierte:
Carta Porte → Formato Facturama API
```

**Datos que se envían a Facturama:**

1. **Datos del Comprobante:**
   - Serie, Folio, Fecha
   - SubTotal, Total, Moneda
   - Tipo de Comprobante (Ingreso)
   - Método y Forma de Pago

2. **Datos del Emisor (Tú):**
   - RFC, Nombre, Régimen Fiscal
   - (Obtenidos de tu perfil de usuario)

3. **Datos del Receptor (Cliente):**
   - RFC, Nombre
   - Uso de CFDI

4. **Conceptos:**
   - Descripción de la mercancía
   - Cantidad, Unidad, Valor

5. **Complemento Carta Porte:**
   - Ubicaciones (Origen y Destino)
   - Mercancías (tipo, peso, valor)
   - Autotransporte (placas, configuración)
   - Figuras de Transporte (transportista, operador)

---

#### **2.3 Envío a Facturama**

Tu sistema envía una petición HTTP POST a Facturama:

```javascript
POST https://api.facturama.mx/3/cfdis
// o
POST https://apisandbox.facturama.mx/3/cfdis (modo pruebas)

Headers:
- Authorization: Basic [usuario:contraseña en base64]
- Content-Type: application/json

Body: { datos del CFDI en formato JSON }
```

**Facturama recibe:**
- ✅ Valida los datos
- ✅ Verifica que tengas folios disponibles
- ✅ Genera el XML del CFDI
- ✅ Lo envía al SAT para timbrarlo
- ✅ Recibe el UUID timbrado del SAT
- ✅ Genera el PDF oficial

---

#### **2.4 Respuesta de Facturama**

Facturama responde con:

```json
{
  "Id": "12345",  // ID del CFDI en Facturama
  "Cfdi": {
    "Id": "12345",
    "Folio": "CP001",
    "Uuid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",  // UUID timbrado por SAT
    "FechaTimbrado": "2024-01-15T10:30:00",
    "Xml": "<?xml version='1.0'...",  // XML timbrado
    "Pdf": "base64..."  // PDF en base64 (opcional)
  }
}
```

---

#### **2.5 Guardado en tu Base de Datos**

Tu sistema guarda la información recibida:

```sql
UPDATE carta_porte SET
  cfdi_id = '12345',              -- ID en Facturama
  cfdi_uuid = 'A1B2C3D4...',      -- UUID timbrado por SAT
  cfdi_fecha_timbrado = '2024-01-15T10:30:00',
  cfdi_xml = '<?xml...',          -- XML completo
  cfdi_pdf_path = '/uploads/...', -- Ruta del PDF
  estado = 'Emitida'
WHERE id = [carta_porte_id]
```

---

#### **2.6 Descarga del PDF**

Si Facturama no envió el PDF en la respuesta inicial, tu sistema lo descarga:

```javascript
GET https://api.facturama.mx/3/cfdis/12345/pdf
Headers: Authorization: Basic [credenciales]
```

El PDF se guarda en `uploads/cfdi/` para futuras descargas.

---

### **Paso 3: Descargar PDF/XML**

Cuando el usuario hace clic en **"Descargar PDF"** o **"Descargar XML"**:

#### **3.1 Descargar PDF**

1. Tu sistema verifica si existe el PDF localmente
2. Si existe: Lo sirve directamente
3. Si no existe:
   - Si tiene `cfdi_id`: Lo descarga de Facturama
   - Si no tiene `cfdi_id` (simulación): Genera PDF simulado

#### **3.2 Descargar XML**

1. Tu sistema busca el XML en la base de datos
2. Si no está, lo obtiene de Facturama usando `cfdi_id`
3. Formatea el XML para que sea legible
4. Lo envía al usuario para descarga

---

## 🎯 Diferencias: Modo Simulación vs Real

### **Modo Simulación (Sin Credenciales)**

| Aspecto | Modo Simulación |
|---------|----------------|
| **UUID** | Generado localmente (no válido) |
| **Timbrado** | ❌ NO timbrado por SAT |
| **PDF** | Generado localmente con PDFKit |
| **XML** | Generado localmente (válido pero no timbrado) |
| **Válido Fiscalmente** | ❌ NO |
| **Costo** | ✅ Gratis |
| **Uso** | Solo para pruebas |

### **Modo Real (Con Credenciales)**

| Aspecto | Modo Real |
|---------|----------|
| **UUID** | Generado y timbrado por SAT |
| **Timbrado** | ✅ SÍ timbrado por SAT |
| **PDF** | PDF oficial de Facturama |
| **XML** | XML timbrado oficial del SAT |
| **Válido Fiscalmente** | ✅ SÍ |
| **Costo** | $1,650 MXN/año (Plan API) |
| **Uso** | Producción real |

---

## 🔐 Seguridad y Autenticación

### **Autenticación con Facturama**

Tu sistema usa **HTTP Basic Authentication**:

```javascript
// Credenciales se convierten a base64
const auth = Buffer.from(`${FACTURAMA_USER}:${FACTURAMA_PASS}`).toString('base64');

// Se envían en el header
headers: {
  'Authorization': `Basic ${auth}`
}
```

### **Almacenamiento Seguro**

- ✅ Las credenciales se guardan como **variables de entorno** en Render
- ✅ **NO** se guardan en el código
- ✅ **NO** se exponen al cliente
- ✅ Solo el servidor tiene acceso

---

## 📊 Datos que se Envían a Facturama

### **Datos del Emisor (Tú)**
- RFC
- Nombre/Razón Social
- Régimen Fiscal

### **Datos del Receptor (Cliente)**
- RFC
- Nombre
- Uso de CFDI

### **Datos de la Carta Porte**
- Origen (calle, CP, estado, municipio)
- Destino (calle, CP, estado, municipio)
- Mercancía (tipo, cantidad, peso, valor)
- Vehículo (placas, configuración)
- Transportista (RFC, nombre)
- Operador (RFC, nombre, licencia)
- Remitente y Destinatario

---

## 🔄 Flujo Visual Simplificado

```
┌─────────────────┐
│  Usuario crea   │
│  Carta Porte   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Click "Generar │
│  CFDI"          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│  ¿Hay           │ NO    │  Modo        │
│  credenciales?  │──────▶│  Simulación  │
└────────┬────────┘       └──────────────┘
         │ SÍ
         ▼
┌─────────────────┐
│  Construir      │
│  datos CFDI     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Enviar a       │
│  Facturama API  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Facturama      │
│  valida y       │
│  envía al SAT   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SAT timbra     │
│  y devuelve     │
│  UUID           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Facturama      │
│  genera PDF     │
│  y XML          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Tu sistema     │
│  guarda datos   │
│  en BD          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Usuario puede  │
│  descargar      │
│  PDF y XML      │
└─────────────────┘
```

---

## 💡 Ventajas de Usar Facturama

1. **✅ Cumplimiento Fiscal Automático**
   - Facturama se encarga de validar todos los datos
   - Asegura que el CFDI cumpla con las reglas del SAT

2. **✅ Timbrado Automático**
   - No necesitas certificados digitales propios
   - Facturama actúa como PAC autorizado

3. **✅ PDF y XML Oficiales**
   - PDFs con formato oficial del SAT
   - XMLs válidos y timbrados

4. **✅ Almacenamiento en la Nube**
   - Facturama guarda una copia de tus CFDI
   - Puedes acceder desde su plataforma

5. **✅ Integración Simple**
   - Solo necesitas hacer peticiones HTTP
   - No necesitas manejar certificados

---

## ⚠️ Consideraciones Importantes

1. **Costo por Folio:**
   - Plan API incluye 100 folios/año
   - Folios adicionales: $0.50 MXN cada uno

2. **Dependencia de Internet:**
   - Necesitas conexión a internet para generar CFDI
   - Si Facturama está caído, no puedes generar

3. **Límites de la API:**
   - Facturama puede tener límites de velocidad
   - Consulta su documentación para límites

4. **Modo Sandbox:**
   - Úsalo para pruebas
   - Los CFDI de sandbox NO son válidos fiscalmente

---

## 🎓 Resumen en 3 Puntos

1. **Tu sistema** recopila los datos de la Carta Porte
2. **Facturama** valida, timbra y genera el CFDI
3. **El SAT** autoriza y devuelve el UUID timbrado

**Resultado:** CFDI válido fiscalmente que puedes descargar como PDF y XML.

---

¿Tienes más preguntas sobre cómo funciona la integración? ¡Pregúntame!

