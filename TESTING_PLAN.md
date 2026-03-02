# 🧪 PropFirm Compare Extension - Testing Plan

## 📋 Overview
Este plan de testing verifica que todas las funcionalidades de la extensión funcionen correctamente después de las implementaciones de cache, detección de subdominios, y configuraciones.

---

## 🎯 1. SETUP INICIAL

### 1.1 Preparación
- [ ] **Recargar extensión** en `chrome://extensions/`
- [ ] **Abrir Developer Tools** (`F12`)
- [ ] **Ir a tab Console** para ver logs
- [ ] **Verificar que no hay errores** en consola al cargar

### 1.2 Verificación básica
- [ ] **Popup abre correctamente** (click en icono extensión)
- [ ] **Título muestra** "PropFirm" (normal) + "Compare" (bold) en blanco
- [ ] **Configuraciones visibles**: "Show checkout reminders" y "Show floating icon"
- [ ] **Iconos SVG** en footer (estrella y bug, no emojis)

---

## 🌐 2. DETECCIÓN DE PROP FIRMS

### 2.1 Test de API y Cache
**Objetivo**: Verificar que los datos se cargan correctamente

#### Primera carga (Sin cache)
- [ ] **Ir a**: `https://google.com`
- [ ] **Abrir consola** y ejecutar:
```javascript
chrome.runtime.sendMessage({ type: 'GET_PROP_FIRMS_DATA' })
  .then(data => console.log(`📊 Loaded ${data.data.firms.length} firms:`, data.data.firms.map(f => f.name)))
```
- [ ] **Verificar**: Se muestran todas las prop firms cargadas
- [ ] **Buscar logs**: `🌐 Loading fresh prop firms data from API...`
- [ ] **Tiempo esperado**: 2-5 segundos

#### Segunda carga (Con cache)
- [ ] **Recargar página** y ejecutar el mismo comando
- [ ] **Buscar logs**: `📦 Using cached prop firms data`
- [ ] **Tiempo esperado**: Instantáneo (<100ms)

### 2.2 Test de dominios y affiliate links
**Objetivo**: Verificar extracción correcta de dominios

- [ ] **En consola**, ejecutar:
```javascript
chrome.runtime.sendMessage({ type: 'GET_PROP_FIRMS_DATA' })
  .then(data => {
    data.data.firms.forEach(firm => {
      console.log(`${firm.name}:`);
      console.log(`  Domains: [${firm.domains.join(', ')}]`);
      console.log(`  Affiliate: ${firm.codes[0]?.affiliateLink || 'N/A'}`);
    });
  })
```
- [ ] **Verificar**: Cada firma tiene dominios extraídos de affiliate links
- [ ] **Verificar**: Dominios incluyen tanto específicos como base domains

---

## 🏢 3. TEST EN PROP FIRMS REALES

### 3.1 FTMO (Ejemplo principal)
**URLs a probar**:
- [ ] `https://ftmo.com`
- [ ] `https://www.ftmo.com`
- [ ] `https://app.ftmo.com`
- [ ] `https://dashboard.ftmo.com`
- [ ] `https://partners.ftmo.com`

**Para cada URL**:
- [ ] **Floating icon aparece** (esquina inferior derecha)
- [ ] **Badge en extensión** muestra número de códigos
- [ ] **Logs en consola**:
  ```
  ✅ Direct detection found prop firm: FTMO
  🍯 === CREATING FLOATING ICON ===
  ✅ Floating icon fully created and should be visible!
  ```

### 3.2 My Funded Futures
**URLs a probar**:
- [ ] `https://myfundedfutures.com`
- [ ] `https://www.myfundedfutures.com`
- [ ] `https://app.myfundedfutures.com`
- [ ] `https://affiliate.myfundedfutures.com`

### 3.3 Otras Prop Firms (según API)
**Obtener lista completa**:
- [ ] **Ejecutar en consola**:
```javascript
chrome.runtime.sendMessage({ type: 'GET_PROP_FIRMS_DATA' })
  .then(data => {
    data.data.firms.forEach(firm => {
      console.log(`🔗 ${firm.name}: ${firm.domains.join(', ')}`);
    });
  })
```
- [ ] **Probar al menos 5 prop firms diferentes**
- [ ] **Verificar detección** en cada una

---

## ⚙️ 4. TEST DE CONFIGURACIONES

### 4.1 Show Floating Icon
**Test 1: Desactivar**
- [ ] **Ir a**: Cualquier prop firm
- [ ] **Verificar**: Floating icon visible
- [ ] **Abrir popup** → Desactivar "Show floating icon"
- [ ] **Resultado esperado**: Floating icon desaparece inmediatamente
- [ ] **Logs esperados**: `🔕 Floating icon hidden`

**Test 2: Reactivar**
- [ ] **Activar "Show floating icon"** en popup
- [ ] **Resultado esperado**: Floating icon aparece inmediatamente
- [ ] **Logs esperados**: `🔄 Creating floating icon due to settings change`

**Test 3: Persistencia**
- [ ] **Desactivar** floating icon
- [ ] **Ir a otra prop firm**
- [ ] **Verificar**: No aparece floating icon
- [ ] **Recargar página**
- [ ] **Verificar**: Sigue sin aparecer

### 4.2 Show Checkout Reminders (Config-Based)
**Test 1: En página de checkout detectada por config**
- [ ] **Ir a**: Página de checkout de prop firm con elementos específicos
- [ ] **Verificar**: Aparece popup recordando usar código
- [ ] **Logs esperados**: 
  ```
  ✅ CHECKOUT DETECTED! Found: form
  📋 Matched selector: form[action*='checkout']
  🏢 Using config for: [PropFirm Name]
  ```

**Test 2: En página sin elementos de checkout**
- [ ] **Ir a**: Homepage, dashboard, about, etc.
- [ ] **Verificar**: NO aparece popup
- [ ] **Logs esperados**: 
  ```
  ❌ No checkout elements found with configured selectors
  🔍 Searched for: [list of selectors]
  ```

**Test 3: Desactivar checkout reminders**
- [ ] **Desactivar** "Show checkout reminders"
- [ ] **Ir a página checkout real**
- [ ] **Verificar**: No aparece popup
- [ ] **Logs esperados**: `🔕 Checkout reminders disabled by user`

**Test 4: Configuración específica por dominio**
- [ ] **En consola**, ejecutar para ver config:
```javascript
// Ver configuración para el dominio actual
chrome.runtime.sendMessage({ 
  type: 'GET_CHECKOUT_CONFIG', 
  domain: window.location.hostname 
}).then(config => console.log('Config:', config));
```

### 4.3 Automatic Code Filling - Secuencias Específicas (Nuevo)
**Test 1: Lucid Trading (lucidtrading.com)**
- [ ] **Ir a**: URL con `/checkout`
- [ ] **Verificar**: Detecta checkout por URL
- [ ] **Verificar**: Auto-fill secuencia: Fill input[name='coupon_code'] → Click button#apply_coupon_button
- [ ] **Logs esperados**: 
  ```
  ✅ CHECKOUT DETECTED! Method: URL pattern
  🤖 === STARTING AUTO-FILL SEQUENCE ===
  📝 Step 1/2: fill
  📝 Step 2/2: click
  ✅ Auto-fill sequence completed successfully!
  ```

**Test 2: Tradeify (tradeify.co)**
- [ ] **Ir a**: Página con `<p>` conteniendo "Confirm and pay"
- [ ] **Verificar**: Detecta checkout por elemento
- [ ] **Verificar**: Secuencia: Click "Add promo code" → Wait 500ms → Fill input → Click "Apply"
- [ ] **Verificar**: Aparece notificación "✅ Auto-fill Complete!"

**Test 3: My Funded Futures (myfundedfutures.com)**
- [ ] **Ir a**: Página con `<p>` conteniendo "Payment Type"
- [ ] **Verificar**: Secuencia: Click link "Add coupon code" → Fill input[placeholder='Coupon code'] → Click "Apply"

**Test 5: Apex Trader Funding (apextraderfunding.com)**
- [ ] **Ir a**: URL con `/signup`
- [ ] **Verificar**: Secuencia simple: Fill input[name='coupon'] con "LAB"

**Test 6: Funded Next (fundednext.com)**
- [ ] **Ir a**: URL con `/checkout`
- [ ] **Verificar**: Secuencia: Click "Apply Code" → Fill input → Click "Apply"

**Test 7: Auto-fill desactivado**
- [ ] **Desactivar** "Automatic code filling"
- [ ] **Ir a cualquier prop firm checkout**
- [ ] **Verificar**: Solo aparece popup recordatorio, NO auto-fill
- [ ] **Logs esperados**: `🔕 Automatic code filling disabled by user`

**Test 7: Botón disabled**
- [ ] **Verificar**: Si botón permanece disabled por 3 segundos, muestra error
- [ ] **Logs esperados**:
  ```
  ⏳ Waiting for element to be enabled (max 3000ms)...
  ⏳ Element still disabled, waiting... (1s)
  ✅ Element is now enabled, proceeding with click
  ```

**Test 9: Secuencia fallida**
- [ ] **Ir a página checkout** pero sin elementos necesarios
- [ ] **Verificar**: Aparece notificación roja de error
- [ ] **Logs esperados**: 
  ```
  ❌ Auto-fill sequence failed: Step X failed: Element not found
  ```

**Test 10: Configuración por defecto**
- [ ] **Ir a prop firm** no configurada específicamente
- [ ] **Verificar**: Usa configuración "default"
- [ ] **Logs esperados**: `⚠️ Using default checkout config for [domain]`

---

## 🎨 5. TEST DE UI/UX

### 5.1 Floating Icon
- [ ] **Posición**: Esquina inferior derecha
- [ ] **Animación**: Aparece con fade-in
- [ ] **Hover**: Muestra tooltip con descuento
- [ ] **Click**: Abre popup con códigos
- [ ] **Responsive**: No interfiere con contenido de la página

### 5.2 Popup de códigos
- [ ] **Diseño**: Limpio y profesional
- [ ] **Información**: Nombre firma, descuento, código "LAB"
- [ ] **Botón Copy**: Funciona correctamente
- [ ] **Icono check**: Aparece tras copiar (no emoji ✅)
- [ ] **Links de afiliado**: Funcionan correctamente

### 5.3 Popup de extensión
- [ ] **Título**: "PropFirm" normal + "Compare" bold, color blanco
- [ ] **Configuraciones**: Toggles funcionan visualmente
- [ ] **Footer**: Iconos SVG (no emojis)
- [ ] **Información firma**: Se muestra si está en prop firm

---

## 🚀 6. TEST DE PERFORMANCE

### 6.1 Velocidad de carga
**Primera vez (sin cache)**:
- [ ] **Tiempo de detección**: <3 segundos
- [ ] **API response time**: <5 segundos
- [ ] **Floating icon aparición**: <1 segundo tras detección

**Con cache**:
- [ ] **Tiempo de detección**: <500ms
- [ ] **Floating icon aparición**: <200ms

### 6.2 Impacto en navegación
- [ ] **Páginas cargan normalmente**: Sin delays visibles
- [ ] **No errors en consola**: Durante navegación normal
- [ ] **Memory usage**: Razonable en DevTools > Performance

---

## 🔧 7. TEST DE EDGE CASES

### 7.1 Problemas de red
- [ ] **Desconectar internet** temporalmente
- [ ] **Recargar extensión**
- [ ] **Verificar**: Usa cache expirado como fallback
- [ ] **Logs esperados**: `⚠️ Using expired cache as fallback`

### 7.2 API no disponible
- [ ] **Bloquear propfirm.compare** en hosts file temporalmente
- [ ] **Recargar extensión**
- [ ] **Verificar**: No crashea, usa fallback
- [ ] **Restaurar conexión**
- [ ] **Verificar**: Se recupera automáticamente

### 7.3 Páginas problemáticas
- [ ] **Páginas con mucho JavaScript**: React/Angular apps
- [ ] **SPAs**: Single Page Applications
- [ ] **Páginas con iframes**: Verificar no interfiere
- [ ] **Páginas HTTPS/HTTP mixtas**

---

## 📱 8. TEST EN DIFERENTES CONTEXTOS

### 8.1 Páginas diferentes de prop firms
**Checkout pages**:
- [ ] `/checkout`, `/payment`, `/order`, `/purchase`
- [ ] **Verificar**: Checkout reminders aparecen (si activado)

**Dashboard pages**:
- [ ] `/dashboard`, `/account`, `/profile`
- [ ] **Verificar**: Floating icon aparece correctamente

**Landing pages**:
- [ ] Páginas principales de marketing
- [ ] **Verificar**: Detección correcta

### 8.2 Subdominios complejos
- [ ] **3+ niveles**: `app.client.ftmo.com`
- [ ] **Múltiples subdominios**: `api.v2.dashboard.firm.com`
- [ ] **Verificar**: Detección funciona en todos los casos

---

## 🐛 9. TEST DE DEBUGGING

### 9.1 Logging verificación
**En cualquier prop firm, verificar logs aparecen**:
- [ ] `🔍 Direct detection for hostname: [hostname]`
- [ ] `📊 Total firms available: [number]`
- [ ] `✅ Direct detection found prop firm: [name]`
- [ ] `🍯 === CREATING FLOATING ICON ===`
- [ ] `🎯 SUCCESS: Floating icon fully created and should be visible!`

### 9.2 Cache debugging
- [ ] **Ejecutar en consola**:
```javascript
// Force refresh cache
chrome.runtime.sendMessage({ type: 'FORCE_REFRESH_CACHE' })
  .then(result => console.log('Cache refreshed:', result))
```
- [ ] **Verificar**: Cache se actualiza correctamente

---

## ✅ 10. CHECKLIST FINAL

### 10.1 Funcionalidades core
- [ ] ✅ Detección funciona en todas las prop firms
- [ ] ✅ Subdominios detectados correctamente  
- [ ] ✅ Floating icon aparece y funciona
- [ ] ✅ Configuraciones funcionan correctamente
- [ ] ✅ Cache mejora performance
- [ ] ✅ UI/UX es profesional y funcional

### 10.2 Ready for production
- [ ] ✅ No errores en consola durante uso normal
- [ ] ✅ Performance es aceptable
- [ ] ✅ Funciona en diferentes tipos de páginas
- [ ] ✅ Edge cases manejados correctamente
- [ ] ✅ Logging proporciona información útil para debug

---

## 🎯 CRITERIOS DE ÉXITO

**✅ PASS**: La extensión pasa el testing si:
1. **Detecta correctamente** ≥90% de prop firms en la API
2. **Funciona en todos los subdominios** principales
3. **Configuraciones** se aplican inmediatamente
4. **Performance** es fluida (cache <500ms)
5. **No crashes** o errores críticos
6. **UI/UX** es profesional y usable

**❌ FAIL**: Si cualquier funcionalidad core no funciona o hay errores críticos.

---

## 📞 REPORTING

### Issues encontrados:
```
❌ ISSUE: [Descripción]
   - URL: [donde ocurre]
   - Steps: [cómo reproducir]
   - Expected: [qué debería pasar]
   - Actual: [qué pasó]
   - Console: [errores en consola]
```

### Status final:
```
🎯 TESTING COMPLETED
   ✅ Passed: [X/Y] tests
   ⚠️ Issues: [número] minor
   ❌ Critical: [número] issues
   📈 Performance: [rating]
   🚀 Ready for production: [YES/NO]
``` 