# Paso

Aplicación móvil de fitness hecha con React Native y Expo. Cuenta los pasos de la sesión en tiempo real, identifica si el movimiento se parece a caminar o correr mediante el acelerómetro y estima la distancia recorrida.

## Cómo funciona

- `Pedometer` de `expo-sensors` obtiene los pasos del podómetro del dispositivo.
- `Accelerometer` toma lecturas cada 100 ms y suaviza la variación de aceleración para clasificar el movimiento como reposo, caminata o carrera.
- La distancia se estima con una zancada promedio de 72 cm: `pasos × 0.72 m`.
- El seguimiento está pensado para usarse con la aplicación abierta. Las actualizaciones de `Pedometer.watchStepCount` no se entregan mientras la app está en segundo plano.

## Requisitos

- Node.js LTS.
- Un teléfono físico con podómetro y acelerómetro. Los simuladores normalmente no exponen lecturas reales.
- Expo Go para probar esta primera versión; `expo-sensors` está incluido en Expo Go.

## Desarrollo

```bash
npm install
npx expo start
```

Escanea el QR con Expo Go y pulsa **Iniciar seguimiento**. La primera vez, concede el permiso de actividad física si el sistema lo solicita.

## Validación

```bash
npx tsc --noEmit
npm run lint
npx expo export --platform web
```

La vista web sirve para revisar la interfaz, pero los sensores solo funcionan de forma real en un dispositivo compatible.

## Estructura

```text
App.tsx       Interfaz, permisos y seguimiento de sensores
app.json      Configuración de Expo y permiso de movimiento en iOS
index.ts      Entrada de la aplicación
assets/       Iconos generados por la plantilla de Expo
```

## Limitaciones actuales

El conteo corresponde a la sesión iniciada dentro de Paso, no a un historial diario persistente. La precisión de la intensidad y de la distancia depende del dispositivo, de dónde se lleve el teléfono y de la longitud real de la zancada.

## Referencias técnicas

- [Expo Sensors](https://docs.expo.dev/versions/latest/sdk/sensors/)
- [Expo Pedometer](https://docs.expo.dev/versions/latest/sdk/pedometer/)
- [Expo Accelerometer](https://docs.expo.dev/versions/latest/sdk/accelerometer/)

## Licencia

MIT. Consulta [`LICENSE`](./LICENSE).
