# 🔧 Debug Control - PropFirm Compare Extension

## 📋 Overview

La extensión tiene un sistema de logging controlado para prevenir que aparezcan mensajes de consola en producción, manteniendo logs útiles durante el desarrollo.

## 🎛️ Control de Logging

### **Configuración Principal**

En cada archivo principal (`content.js`, `background.js`, `popup.js`):

```javascript
// Production logging control - set to false for production builds
const DEBUG_MODE = false; // Change to false for production

// Controlled logging functions
const debugLog = (...args) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

const debugError = (...args) => {
  if (DEBUG_MODE) {
    console.error(...args);
  }
};

const debugWarn = (...args) => {
  if (DEBUG_MODE) {
    console.warn(...args);
  }
};
```

### **Estados de Logging**

| Estado | DEBUG_MODE | Comportamiento |
|--------|------------|----------------|
| **🔧 Desarrollo** | `true` | Todos los logs aparecen en consola |
| **🚀 Producción** | `false` | Sin logs en consola |

## 📝 Uso en el Código

### **Antes (Problemático)**
```javascript
console.log('🎯 PropFirm detected:', firm.name);
console.error('❌ Error loading data:', error);
console.warn('⚠️ No affiliate link found');
```

### **Después (Controlado)**
```javascript
debugLog('🎯 PropFirm detected:', firm.name);
debugError('❌ Error loading data:', error);
debugWarn('⚠️ No affiliate link found');
```

## 🚀 Proceso de Release

### **Para Desarrollo (Debugging Habilitado)**
1. Cambiar `DEBUG_MODE = true` en todos los archivos
2. Recargar extensión
3. Ver logs detallados en consola

### **Para Producción (Logging Deshabilitado)**
1. Cambiar `DEBUG_MODE = false` en todos los archivos:
   - `content.js` línea 4
   - `background.js` línea 4  
   - `popup.js` línea 4
2. Verificar que no aparezcan logs
3. Crear .zip para Chrome Web Store

## ⚡ Script Rápido de Cambio

### **Habilitar Debug Mode**
```powershell
# Habilitar logging para desarrollo
(Get-Content content.js) -replace 'const DEBUG_MODE = false', 'const DEBUG_MODE = true' | Set-Content content.js
(Get-Content background.js) -replace 'const DEBUG_MODE = false', 'const DEBUG_MODE = true' | Set-Content background.js  
(Get-Content popup.js) -replace 'const DEBUG_MODE = false', 'const DEBUG_MODE = true' | Set-Content popup.js
```

### **Deshabilitar Debug Mode**  
```powershell
# Deshabilitar logging para producción
(Get-Content content.js) -replace 'const DEBUG_MODE = true', 'const DEBUG_MODE = false' | Set-Content content.js
(Get-Content background.js) -replace 'const DEBUG_MODE = true', 'const DEBUG_MODE = false' | Set-Content background.js
(Get-Content popup.js) -replace 'const DEBUG_MODE = true', 'const DEBUG_MODE = false' | Set-Content popup.js
```

## 🔍 Verificación

### **Comprobar Estado Actual**
```powershell
# Ver estado de DEBUG_MODE en todos los archivos
Select-String "const DEBUG_MODE" *.js
```

### **Verificar Sin Console Statements**
```powershell  
# Buscar console statements no controlados
Select-String "console\." *.js | Where-Object { $_.Line -notmatch "debugLog|debugError|debugWarn" }
```

## ⚠️ Importante

- **NUNCA** usar `console.log/error/warn` directamente
- **SIEMPRE** usar `debugLog/debugError/debugWarn`
- **VERIFICAR** `DEBUG_MODE = false` antes de release
- **PROBAR** extensión sin logs antes de enviar a Chrome Web Store

## 📊 Beneficios

✅ **Sin spam en consola de usuarios**  
✅ **Logs útiles durante desarrollo**  
✅ **Control centralizado y fácil**  
✅ **Cumple requisitos de Chrome Web Store**  
✅ **Experiencia de usuario profesional**  

---

**Estado Actual: `DEBUG_MODE = false` (Producción)** 🚀 