# 🔍 Dónde Encontrar tus Credenciales API en Facturama

## ✅ Ya compraste el Plan API ($1,650 MXN/año) - Ahora encuentra tus credenciales

---

## 📍 Ubicación de las Credenciales API

### Opción 1: Menú Lateral (Más Común)

1. **Inicia sesión en Facturama**
   - Ve a: **https://www.facturama.mx/**
   - Inicia sesión con tu usuario y contraseña

2. **Busca en el Menú Lateral Izquierdo:**
   - Busca una opción que diga:
     - ✅ **"API"** 
     - ✅ **"Configuración"** → luego busca **"API"** dentro
     - ✅ **"Integraciones"**
     - ✅ **"Credenciales API"**
     - ✅ **"API Keys"**

3. **Haz clic en esa opción**

4. **Verás tus credenciales:**
   - **Usuario API** o **Usuario**
   - **Contraseña API** o **Contraseña** o **Token**

---

### Opción 2: Configuración de Cuenta

1. **Inicia sesión en Facturama**

2. **Busca en la parte superior derecha:**
   - Tu nombre de usuario o perfil
   - Menú desplegable (ícono de usuario)

3. **Haz clic y busca:**
   - **"Configuración"**
   - **"Mi Cuenta"**
   - **"Ajustes"**
   - **"Configuración API"**

4. **Navega hasta encontrar la sección de API**

5. **Verás tus credenciales**

---

### Opción 3: Panel de Control

1. **Inicia sesión en Facturama**

2. **Busca un tab o sección que diga:**
   - **"Panel"**
   - **"Dashboard"**
   - **"Inicio"**

3. **Busca un enlace o card que diga:**
   - **"Credenciales API"**
   - **"Configurar API"**
   - **"Integraciones"**

4. **Haz clic**

5. **Verás tus credenciales**

---

## 📋 Qué Buscar

Una vez que encuentres la sección de API, deberías ver algo como esto:

### Ejemplo de lo que verás:

```
┌─────────────────────────────────────┐
│  Credenciales API                   │
├─────────────────────────────────────┤
│                                     │
│  Usuario API:                       │
│  AAA010101AAA                       │
│  [Copiar]                           │
│                                     │
│  Contraseña API:                    │
│  ••••••••••••••                     │
│  [Mostrar] [Copiar] [Regenerar]     │
│                                     │
│  Modo:                              │
│  ○ Sandbox  ● Producción            │
│                                     │
└─────────────────────────────────────┘
```

---

## 🔑 Tipos de Credenciales que Verás

### 1. Usuario API (FACTURAMA_USER)
- Puede ser tu **RFC** (ejemplo: `AAA010101AAA`)
- O un **usuario específico** (ejemplo: `usuario_api@facturama.mx`)
- O un **ID de usuario** (ejemplo: `12345`)

### 2. Contraseña API (FACTURAMA_PASS)
- Una **contraseña generada automáticamente** por Facturama
- Generalmente es una cadena larga de caracteres
- Puede tener opción de **"Mostrar"** o **"Revelar"**
- Puede tener opción de **"Regenerar"**

---

## 💡 Si NO Encuentras las Credenciales

### Posibles Razones:

1. **El plan API aún no está activo**
   - Puede tardar unos minutos después de comprarlo
   - Verifica que el pago se haya procesado correctamente
   - Revisa tu correo de confirmación de Facturama

2. **Estás en la interfaz incorrecta**
   - Asegúrate de estar en la versión correcta de Facturama
   - Si tienes múltiples cuentas, verifica que estés en la correcta

3. **La interfaz ha cambiado**
   - Facturama actualiza su interfaz ocasionalmente
   - Busca términos como: "API", "Credenciales", "Integraciones", "Keys"

### Soluciones:

1. **Buscar en la barra de búsqueda**
   - Si Facturama tiene una barra de búsqueda, busca: `API`, `Credenciales`, `Integraciones`

2. **Contactar soporte de Facturama**
   - Email: soporte@facturama.mx o support@facturama.mx
   - Teléfono: Busca en su sitio web
   - Chat en vivo: Si está disponible en su sitio

3. **Revisar documentación**
   - Ve a: https://apisandbox.facturama.mx/docs
   - Allí puede haber instrucciones sobre dónde encontrar credenciales

---

## 📸 Pasos Visuales (Secuencia Típica)

```
Paso 1: Iniciar sesión
https://www.facturama.mx/
         ↓
Paso 2: Menú lateral izquierdo
[Inicio] [Facturas] [Clientes] [API] ← HAZ CLIC AQUÍ
         ↓
Paso 3: Página de API
[Credenciales] [Documentación] [Ejemplos]
         ↓
Paso 4: Ver credenciales
Usuario: AAA010101AAA
Contraseña: [Mostrar] → abc123xyz...
```

---

## ⚠️ IMPORTANTE: Diferencias entre Credenciales

### ❌ NO Son Credenciales API:
- Tu usuario y contraseña de **inicio de sesión** en Facturama
- Tu RFC y contraseña de **pago**
- Tu contraseña de **email**

### ✅ SÍ Son Credenciales API:
- Usuario API específico (generalmente tu RFC)
- Contraseña API generada por Facturama
- Se encuentran en la sección **"API"** o **"Credenciales API"**

---

## 📝 Una Vez que Encuentres las Credenciales

1. **Copia el Usuario API**
   - Este será el valor de `FACTURAMA_USER`
   - Ejemplo: `AAA010101AAA`

2. **Copia la Contraseña API**
   - Haz clic en **"Mostrar"** o **"Revelar"** si está oculta
   - Este será el valor de `FACTURAMA_PASS`
   - Ejemplo: `abc123xyz789`

3. **Verifica el Modo**
   - **Sandbox**: Para pruebas (recomendado empezar aquí)
   - **Producción**: Para CFDI reales timbrados

4. **Guárdalas en un lugar seguro**
   - Necesitarás estas credenciales para configurar en Render

---

## ✅ Próximo Paso

Una vez que tengas tus credenciales:

1. ✅ Usuario API (FACTURAMA_USER)
2. ✅ Contraseña API (FACTURAMA_PASS)

**Siguiente paso:** Configurar estas credenciales en Render (ver `PASOS_CONECTAR_FACTURAMA.md`)

---

## 🆘 ¿Necesitas Ayuda?

Si después de buscar en todas las opciones anteriores no encuentras tus credenciales:

1. **Contacta a Facturama:**
   - Email: soporte@facturama.mx
   - Teléfono: Busca en su sitio web
   - Chat: Si está disponible

2. **Menciona:**
   - Ya compraste el Plan API ($1,650 MXN/año)
   - Necesitas tus credenciales API (Usuario y Contraseña)
   - Quieres configurarlas para integración

---

**💡 Tip Final:** Las credenciales API generalmente están visibles inmediatamente después de comprar el plan API. Si no las ves, espera unos minutos y recarga la página, o contacta al soporte.

