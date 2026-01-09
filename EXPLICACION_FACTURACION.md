# 📄 Explicación: Facturación CFDI con Carta Porte

## ✅ Respuesta Corta

**Sí, tu sistema puede facturar CFDI con Carta Porte.** Es un **solo documento** que contiene:
- El **CFDI** (Comprobante Fiscal Digital por Internet) - La factura
- El **Complemento Carta Porte** - La información del transporte

---

## 📋 ¿Qué es un CFDI con Complemento Carta Porte?

### Estructura del Documento

```
┌─────────────────────────────────────┐
│         CFDI (Factura)              │
│  ┌───────────────────────────────┐ │
│  │ Datos del Comprobante         │ │
│  │ - Serie, Folio, Fecha         │ │
│  │ - Emisor (Tú)                  │ │
│  │ - Receptor (Cliente)          │ │
│  │ - Conceptos (Servicio)        │ │
│  │ - Total, SubTotal             │ │
│  └───────────────────────────────┘ │
│  ┌───────────────────────────────┐ │
│  │ COMPLEMENTO CARTA PORTE       │ │
│  │ - Origen y Destino            │ │
│  │ - Mercancía                   │ │
│  │ - Vehículo                    │ │
│  │ - Transportista               │ │
│  │ - Operador                    │ │
│  └───────────────────────────────┘ │
│  ┌───────────────────────────────┐ │
│  │ Timbre Fiscal Digital (SAT)   │ │
│  │ - UUID timbrado               │ │
│  │ - Fecha de timbrado           │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

---

## 🔄 Cómo Funciona en tu Sistema

### Paso 1: Crear Carta Porte

1. Vas a **Facturación → Carta Porte**
2. Llenas el formulario con:
   - Datos del transporte (origen, destino)
   - Información de la mercancía
   - Datos del vehículo
   - Información del transportista y operador
3. Guardas la Carta Porte

**Resultado:** La Carta Porte queda guardada, pero **aún NO tiene CFDI**.

---

### Paso 2: Generar CFDI (Factura)

1. Haces clic en **"Generar CFDI"**
2. Tu sistema toma los datos de la Carta Porte
3. Construye un **CFDI** que incluye:
   - **Datos del Comprobante:**
     - Serie, Folio, Fecha
     - Emisor (tus datos fiscales)
     - Receptor (datos del cliente)
     - Concepto: "Transporte de mercancía"
     - SubTotal, Total, Moneda
   
   - **Complemento Carta Porte:**
     - Ubicaciones (Origen y Destino)
     - Mercancías
     - Autotransporte (vehículo, placas)
     - Figuras de Transporte (transportista, operador)

4. El sistema envía todo a **Facturama**
5. Facturama lo timbra con el **SAT**
6. Recibes el **CFDI timbrado** con el Complemento Carta Porte incluido

---

### Paso 3: Descargar el Documento

El documento que descargas contiene **TODO**:
- ✅ El CFDI (factura)
- ✅ El Complemento Carta Porte
- ✅ El Timbre Fiscal Digital (timbrado por SAT)

**Un solo PDF y un solo XML** con toda la información.

---

## 💡 ¿Por qué es así?

Según las especificaciones del **SAT (Servicio de Administración Tributaria)**:

1. **El CFDI es el comprobante fiscal principal** (la factura)
2. **La Carta Porte es un complemento obligatorio** cuando transportas mercancías
3. **Ambos deben ir en el mismo documento XML** para que sea válido

**No puedes facturar por separado:**
- ❌ No puedes generar solo un CFDI sin Carta Porte (si transportas mercancías)
- ❌ No puedes generar solo una Carta Porte sin CFDI
- ✅ **Debes generar un CFDI con Complemento Carta Porte** (lo que hace tu sistema)

---

## 📊 Tipos de Facturación en tu Sistema

### Actualmente Disponible:

✅ **CFDI con Complemento Carta Porte**
- Tipo de Comprobante: **Ingreso (I)**
- Incluye toda la información de transporte
- Timbrado por el SAT
- Válido fiscalmente

### No Disponible (por ahora):

❌ CFDI sin Carta Porte (facturas normales)
- Por ejemplo: facturas de servicios, productos, etc.
- Sin información de transporte

❌ Carta Porte sin CFDI
- No es posible según el SAT

---

## 🎯 Resumen

| Pregunta | Respuesta |
|----------|----------|
| **¿Se puede facturar CFDI?** | ✅ Sí, se genera un CFDI |
| **¿Se puede facturar Carta Porte?** | ✅ Sí, va como complemento del CFDI |
| **¿Son documentos separados?** | ❌ No, es un solo documento |
| **¿Está timbrado por el SAT?** | ✅ Sí (si tienes credenciales de Facturama) |
| **¿Es válido fiscalmente?** | ✅ Sí (si está timbrado) |

---

## 📝 Ejemplo Práctico

**Escenario:** Transportas mercancía de Ciudad de México a Guadalajara

1. **Creas la Carta Porte** con:
   - Origen: CDMX
   - Destino: Guadalajara
   - Mercancía: 1000 kg de productos
   - Vehículo: ABC-123
   - Valor: $50,000 MXN

2. **Generas el CFDI** y obtienes:
   - Un **CFDI** que factura $50,000 MXN por el servicio de transporte
   - Con **Complemento Carta Porte** que detalla el transporte
   - Todo en **un solo documento** timbrado por el SAT

3. **Descargas:**
   - Un **PDF** con la factura y la información de transporte
   - Un **XML** con toda la información estructurada

**Resultado:** Tienes una factura válida fiscalmente que incluye toda la información del transporte.

---

## ✅ Conclusión

Tu sistema **SÍ puede facturar CFDI con Carta Porte**. Es un solo documento que cumple con:
- ✅ Requisitos fiscales del SAT
- ✅ Información de transporte obligatoria
- ✅ Timbrado digital válido

**Todo en un solo documento.** 🎉

