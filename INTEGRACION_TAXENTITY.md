# ✅ Integración del Endpoint TaxEntity de Facturama

## 🎯 ¿Qué se Implementó?

Se integró el endpoint `/api/TaxEntity` de Facturama para obtener automáticamente los datos fiscales del emisor antes de generar el CFDI.

---

## 🔄 ¿Cómo Funciona?

### Antes (Sin TaxEntity):
- El sistema usaba los datos del usuario guardados en la base de datos local
- Si los datos no coincidían exactamente con Facturama, podía haber errores

### Ahora (Con TaxEntity):
1. **Al generar un CFDI**, el sistema primero consulta Facturama para obtener los datos oficiales del emisor
2. **Usa esos datos** para construir el CFDI (más confiables y exactos)
3. **Si no puede obtenerlos** (por ejemplo, sin conexión), usa los datos del usuario como respaldo

---

## 📋 Datos que se Obtienen de TaxEntity

El endpoint `/api/TaxEntity` proporciona:

- **RFC**: RFC del emisor configurado en Facturama
- **Nombre/Razón Social**: Nombre fiscal oficial
- **Régimen Fiscal**: Régimen fiscal registrado
- **Código Postal**: Código postal del domicilio fiscal
- **Dirección**: Dirección fiscal completa

---

## 🔧 Cambios Técnicos Realizados

### 1. Nueva Función: `getTaxEntityFromFacturama()`

```javascript
async function getTaxEntityFromFacturama() {
    // Obtiene datos fiscales desde Facturama
    // URL: https://api.facturama.mx/api/TaxEntity
    // o: https://apisandbox.facturama.mx/api/TaxEntity (sandbox)
}
```

**Características:**
- ✅ Usa autenticación Basic Auth con credenciales de Facturama
- ✅ Soporta modo sandbox y producción
- ✅ Maneja errores gracefully (retorna null si falla)
- ✅ Timeout de 10 segundos

### 2. Función Actualizada: `buildCFDIData()`

Ahora acepta un parámetro adicional `taxEntity`:

```javascript
function buildCFDIData(cartaPorte, user, vehicle, taxEntity = null) {
    // Prioriza datos de TaxEntity sobre datos del usuario
    const emisorRfc = taxEntity?.rfc || user.rfc || "XAXX010101000";
    const emisorNombre = taxEntity?.nombre || user.empresa || user.nombre || "Transportista";
    const emisorRegimen = taxEntity?.regimenFiscal || user.regimen_fiscal || "601";
    const lugarExpedicion = taxEntity?.codigoPostal || cartaPorte.origen_cp || "00000";
    // ...
}
```

### 3. Endpoint Actualizado: `/api/carta-porte/:id/generar-cfdi`

Ahora obtiene TaxEntity antes de generar el CFDI:

```javascript
// Obtener datos de TaxEntity desde Facturama
const taxEntity = await getTaxEntityFromFacturama();

// Construir CFDI con datos de TaxEntity (más confiables)
const cfdiData = buildCFDIData(cartaPorte, user, vehicleData, taxEntity);
```

---

## ✅ Beneficios

1. **Datos Más Confiables**: Usa los datos oficiales de Facturama, no datos locales
2. **Menos Errores**: Evita discrepancias entre datos locales y Facturama
3. **Actualización Automática**: Si cambias datos en Facturama, se reflejan automáticamente
4. **Fallback Seguro**: Si no puede obtener datos de Facturama, usa datos locales

---

## 🔄 Flujo Completo

```
┌─────────────────────┐
│ Usuario hace clic   │
│ "Generar CFDI"      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Verificar          │
│ credenciales       │
│ Facturama          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      ┌──────────────────┐
│ Obtener TaxEntity  │─────▶│ GET /api/TaxEntity│
│ desde Facturama    │      │ (Facturama API)   │
└──────────┬──────────┘      └──────────────────┘
           │
           ▼
┌─────────────────────┐
│ Construir CFDI con │
│ datos de TaxEntity  │
│ (más confiables)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Enviar a Facturama │
│ para timbrar       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ CFDI Timbrado      │
│ con datos correctos│
└─────────────────────┘
```

---

## ⚙️ Configuración

**No requiere configuración adicional.** El sistema usa las mismas credenciales:

- `FACTURAMA_USER`
- `FACTURAMA_PASS`
- `FACTURAMA_MODE` (sandbox o production)

---

## 🧪 Pruebas

### Modo Sandbox:
- URL: `https://apisandbox.facturama.mx/api/TaxEntity`
- Usa credenciales de sandbox

### Modo Producción:
- URL: `https://api.facturama.mx/api/TaxEntity`
- Usa credenciales de producción

---

## 📝 Notas Importantes

1. **Si no hay credenciales de Facturama**: El sistema funciona en modo simulación (no obtiene TaxEntity)
2. **Si falla la obtención de TaxEntity**: El sistema usa datos del usuario como fallback
3. **Los datos de TaxEntity tienen prioridad**: Se usan sobre los datos locales si están disponibles

---

## ✅ Estado

**✅ Implementado y listo para usar**

El sistema ahora obtiene automáticamente los datos fiscales desde Facturama antes de generar cada CFDI, asegurando que los datos del emisor sean exactamente los configurados en Facturama.

