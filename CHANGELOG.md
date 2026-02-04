# Changelog - PropFirm Compare Extension

## 🚀 Version 2.3.9 - FundedNext Network Tracking (Latest)

### ✨ **FundedNext Improvements (content-fundednext.js v2.0):**
- ✅ **Network interception** via `fn-net-intercept.js` (MAIN world script)
- ✅ **Real-time price updates** from `calculate-challenge-price` API
- ✅ **Coupon validation** from `coupon-check` API with accurate discount amounts
- ✅ **Order ID capture** (`gateway_order_id`) from `product-order` API on payment
- ✅ **Plan ID filtering** - ignores stale API responses from previous products
- ✅ **Network data priority** - API data takes precedence over localStorage for 30s

### 📊 **Data Now Tracked for FundedNext:**
| Field | Source |
|-------|--------|
| `product_name` | Network: calculate-challenge-price |
| `original_price` | Network: calculate-challenge-price |
| `final_price` | Network: coupon-check |
| `discount_amount` | Network: coupon-check |
| `coupon_code` | localStorage |
| `email` | localStorage |
| `order_number` | Network: product-order (gateway_order_id) |
| `transaction_id` | Network: product-order (client_secret) |

### 🐛 **Bug Fixes:**
- Fixed tracker showing stale product data when switching products
- Fixed MutationObserver error when document.body not ready
- Fixed race condition where old API responses overwrote new data

---

## 🚀 Version 3.2.0 - Floating Icon & Popup

### ✨ **Nuevas características principales:**

#### 🍯 **Icono flotante estilo Honey**
- ✅ **Icono pequeño flotante** en el lateral derecho de la página
- ✅ **Aparece automáticamente** al detectar prop firms compatibles
- ✅ **Animación de entrada** suave con efecto pulse
- ✅ **Tooltip informativo** al hacer hover
- ✅ **Badge de descuento** visible en el icono

#### 📱 **Popup expandible**
- ✅ **Click en el icono** abre popup elegante estilo Honey
- ✅ **Diseño profesional** con overlay y animaciones suaves
- ✅ **Dos botones de acción**: "Aplicar automáticamente" y "Copiar código"
- ✅ **Información del producto** con descuento destacado
- ✅ **Cierre fácil** haciendo click en X o fuera del popup

#### ⚡ **Funcionalidad mejorada**
- ✅ **Aplicación automática** de códigos desde el popup
- ✅ **Copia al clipboard** con feedback visual
- ✅ **Búsqueda agresiva** de campos de cupón
- ✅ **Estados visuales** claros para éxito/error

### 🎨 **Diseño y UX:**
- ✅ **Menos intrusivo** que el banner anterior
- ✅ **Más parecido a Honey** en comportamiento
- ✅ **Animaciones fluidas** y transiciones profesionales
- ✅ **Responsivo** para móviles y desktop

### 📱 **Experiencia del usuario:**
1. Usuario navega a prop firm → Icono aparece automáticamente
2. Usuario ve icono con descuento → Hace click para expandir
3. Usuario ve popup con opciones → Elige aplicar o copiar
4. Extensión busca campos → Aplica código automáticamente
5. Usuario recibe feedback → Continúa con descuento aplicado

---

## 📋 Version 3.1.0 - Honey Banner (Reemplazada)

### ✨ **Características (ahora mejoradas en v3.2.0):**
- ✅ Banner automático estilo Honey
- ✅ Detección proactiva de prop firms
- ✅ Aplicación automática de códigos
- ✅ Feedback visual en tiempo real

---

## 📋 Version 3.0.0 - Sistema Honey Original

### ✨ **Características base:**
- ✅ Banner estilo Honey completo
- ✅ Detección automática de prop firms
- ✅ Configuración JSON
- ✅ Sistema de códigos universal "LAB"

---

## 📋 Versiones anteriores (2.x)

### Version 2.4.0 - Popup simplificado
- ✅ Eliminados botones "Apply now" individuales
- ✅ Solo botón "Copy code" por código
- ✅ Interface más limpia

### Version 2.3.0 - Sin estadísticas
- ✅ Eliminado header de firma
- ✅ Eliminado botón "Apply best code"
- ✅ Eliminada sección de estadísticas

### Version 2.2.0 - Sin trigger buttons
- ✅ Eliminada funcionalidad de botones de expansión
- ✅ Solo detección directa de campos

### Version 2.1.0 - Trigger buttons
- ✅ Detección de botones "Have a discount?"
- ✅ Expansión automática de campos ocultos

### Version 2.0.0 - Sistema JSON
- ✅ Configuración basada en JSON
- ✅ Sistema de validación
- ✅ Documentación completa

---

## 🏆 **Estado actual: Version 3.2.0**

### ✅ **Lo que funciona perfectamente:**
- 🍯 **Icono flotante automático** - Aparece al detectar prop firms
- 📱 **Popup elegante** - Se abre con click, diseño profesional
- ⚡ **Aplicación automática** - Busca y aplica códigos automáticamente
- 📋 **Copia manual** - Botón para copiar código al clipboard
- 🎨 **Diseño Honey** - Idéntico a la experiencia de Honey.com
- 📱 **Responsivo** - Funciona en desktop y móvil
- 🔍 **Detección robusta** - Background + Content script
- 🎯 **5 prop firms** - My Funded Futures, Lucid Trading, Apex, Tradeify, Funding Ticks

### 🧪 **Archivos de prueba:**
- `test-simple.html` - Página minimalista para testing rápido
- `test-honey-banner.html` - Demo completa con controles

### 📊 **Códigos disponibles:**
- **My Funded Futures**: LAB (50% OFF)
- **Lucid Trading**: LAB (40% OFF) 
- **Apex Trader Funding**: LAB (80% OFF)
- **Tradeify**: LAB (35% OFF)
- **Funding Ticks**: LAB (10% OFF)

---

## 🎯 **Próximas mejoras sugeridas:**
- [ ] Más prop firms en la configuración
- [ ] Integración con API de PropFirm Compare
- [ ] Códigos dinámicos basados en usuario
- [ ] Estadísticas de uso (opcional)
- [ ] Tema personalizable 