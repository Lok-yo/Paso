import { Accelerometer, Pedometer } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const COLORS = {
  background: '#F4F8F5',
  card: '#FFFFFF',
  ink: '#173128',
  muted: '#71827A',
  line: '#E0EAE3',
  green: '#2D8A61',
  greenSoft: '#DFF2E8',
  mint: '#BDE8D0',
  dark: '#123B2C',
  orange: '#D88442',
  orangeSoft: '#FFF0E2',
  blue: '#4281A4',
  blueSoft: '#E5F2F8',
};

const METERS_PER_STEP = 0.72;
const ACCELEROMETER_INTERVAL_MS = 100;
const MOTION_WALKING_THRESHOLD = 0.055;
const MOTION_RUNNING_THRESHOLD = 0.17;

type MotionLevel = 'idle' | 'walking' | 'running';
type SensorSubscription = { remove: () => void };
type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unknown';
type AccelerometerReading = {
  x: number;
  y: number;
  z: number;
  magnitude: number;
};

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function motionLabel(level: MotionLevel) {
  if (level === 'running') return 'Corriendo';
  if (level === 'walking') return 'Caminando';
  return 'En reposo';
}

function motionDescription(level: MotionLevel) {
  if (level === 'running') return 'Movimiento intenso detectado';
  if (level === 'walking') return 'Ritmo moderado detectado';
  return 'Empieza a moverte para detectarlo';
}

function motionColor(level: MotionLevel) {
  if (level === 'running') return COLORS.orange;
  if (level === 'walking') return COLORS.green;
  return COLORS.blue;
}

function permissionLabel(permission: PermissionState) {
  if (permission === 'granted') return 'Concedido';
  if (permission === 'denied') return 'Denegado';
  if (permission === 'undetermined') return 'Sin solicitar';
  return 'Sin comprobar';
}

function availabilityLabel(available: boolean | null) {
  if (available === null) return 'Comprobando…';
  return available ? 'Disponible' : 'No disponible';
}

function debugTime(timestamp: number | null) {
  if (!timestamp) return 'Sin eventos todavía';
  return new Date(timestamp).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StatCard({ label, value, detail, tone = 'green' }: {
  label: string;
  value: string;
  detail: string;
  tone?: 'green' | 'blue';
}) {
  const isBlue = tone === 'blue';
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: isBlue ? COLORS.blueSoft : COLORS.greenSoft }]}>
        <Text style={[styles.statIconText, { color: isBlue ? COLORS.blue : COLORS.green }]}>{isBlue ? '↗' : '⌁'}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}

function DebugRow({ label, value, tone = 'normal' }: {
  label: string;
  value: string;
  tone?: 'normal' | 'good' | 'bad';
}) {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}</Text>
      <Text style={[styles.debugValue, tone === 'good' && styles.debugGood, tone === 'bad' && styles.debugBad]}>{value}</Text>
    </View>
  );
}

function AppContent() {
  const [steps, setSteps] = useState(0);
  const [motionLevel, setMotionLevel] = useState<MotionLevel>('idle');
  const [motionStrength, setMotionStrength] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pedometerAvailable, setPedometerAvailable] = useState<boolean | null>(Platform.OS === 'web' ? false : null);
  const [accelerometerAvailable, setAccelerometerAvailable] = useState<boolean | null>(Platform.OS === 'web' ? false : null);
  const [pedometerPermission, setPedometerPermission] = useState<PermissionState>('unknown');
  const [permissionCanAskAgain, setPermissionCanAskAgain] = useState(true);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [accelerometerReading, setAccelerometerReading] = useState<AccelerometerReading | null>(null);
  const [accelerometerEventCount, setAccelerometerEventCount] = useState(0);
  const [pedometerEventCount, setPedometerEventCount] = useState(0);
  const [rawPedometerSteps, setRawPedometerSteps] = useState<number | null>(null);
  const [lastPedometerUpdateAt, setLastPedometerUpdateAt] = useState<number | null>(null);

  const pedometerSubscription = useRef<SensorSubscription | null>(null);
  const accelerometerSubscription = useRef<SensorSubscription | null>(null);
  const permissionRequestActive = useRef(false);
  const motionAverage = useRef(0);

  const distance = steps * METERS_PER_STEP;

  const refreshSensorStatus = useCallback(async () => {
    if (Platform.OS === 'web') return;

    try {
      const [isPedometerAvailable, isAccelerometerAvailable, permission] = await Promise.all([
        Pedometer.isAvailableAsync(),
        Accelerometer.isAvailableAsync(),
        Pedometer.getPermissionsAsync(),
      ]);
      setPedometerAvailable(isPedometerAvailable);
      setAccelerometerAvailable(isAccelerometerAvailable);
      setPedometerPermission(permission.granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'undetermined');
      setPermissionCanAskAgain(permission.canAskAgain);
    } catch {
      setPedometerAvailable(false);
      setAccelerometerAvailable(false);
      setPedometerPermission('unknown');
    }
  }, []);

  const requestSensorPermissions = useCallback(async () => {
    if (Platform.OS === 'web' || permissionRequestActive.current) return null;
    permissionRequestActive.current = true;

    try {
      const currentPermission = await Pedometer.getPermissionsAsync();
      setPedometerPermission(currentPermission.granted ? 'granted' : currentPermission.status === 'denied' ? 'denied' : 'undetermined');
      setPermissionCanAskAgain(currentPermission.canAskAgain);

      if (currentPermission.granted || !currentPermission.canAskAgain) return currentPermission;

      const permission = await Pedometer.requestPermissionsAsync();
      setPedometerPermission(permission.granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'undetermined');
      setPermissionCanAskAgain(permission.canAskAgain);
      if (permission.granted) await Accelerometer.requestPermissionsAsync();
      return permission;
    } finally {
      permissionRequestActive.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTracking || !startedAt) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isTracking, startedAt]);

  const stopTracking = () => {
    pedometerSubscription.current?.remove();
    accelerometerSubscription.current?.remove();
    pedometerSubscription.current = null;
    accelerometerSubscription.current = null;
    motionAverage.current = 0;
    setIsTracking(false);
    setMotionLevel('idle');
    setMotionStrength(0);
  };

  const startTracking = useCallback(async () => {
    setErrorMessage(null);
    setIsStarting(true);

    try {
      const [isPedometerAvailable, isAccelerometerAvailable] = await Promise.all([
        Pedometer.isAvailableAsync(),
        Accelerometer.isAvailableAsync(),
      ]);

      setPedometerAvailable(isPedometerAvailable);
      setAccelerometerAvailable(isAccelerometerAvailable);

      if (!isPedometerAvailable || !isAccelerometerAvailable) {
        setErrorMessage('Este dispositivo no expone un podómetro y acelerómetro compatibles. Prueba en un teléfono físico.');
        return;
      }

      const permission = await requestSensorPermissions();
      if (!permission) return;
      setPedometerPermission(permission.granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'undetermined');
      setPermissionCanAskAgain(permission.canAskAgain);
      if (!permission.granted) {
        setErrorMessage('Necesitamos permiso para contar tus pasos. Puedes habilitarlo desde los ajustes del dispositivo.');
        return;
      }

      setPedometerAvailable(true);
      setSteps(0);
      setElapsedSeconds(0);
      setStartedAt(Date.now());
      motionAverage.current = 0;
      setPedometerEventCount(0);
      setAccelerometerEventCount(0);
      setRawPedometerSteps(null);
      setLastPedometerUpdateAt(null);
      setAccelerometerReading(null);

      pedometerSubscription.current = Pedometer.watchStepCount(({ steps: currentSteps }) => {
        setSteps(currentSteps);
        setRawPedometerSteps(currentSteps);
        setPedometerEventCount((count) => count + 1);
        setLastPedometerUpdateAt(Date.now());
      });

      Accelerometer.setUpdateInterval(ACCELEROMETER_INTERVAL_MS);
      accelerometerSubscription.current = Accelerometer.addListener(({ x, y, z }) => {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const dynamicMovement = Math.abs(magnitude - 1);
        motionAverage.current = motionAverage.current * 0.82 + dynamicMovement * 0.18;
        const average = motionAverage.current;
        const strength = Math.min(1, average / 0.35);

        setAccelerometerReading({ x, y, z, magnitude });
        setAccelerometerEventCount((count) => count + 1);
        setMotionStrength(strength);
        if (average >= MOTION_RUNNING_THRESHOLD) {
          setMotionLevel('running');
        } else if (average >= MOTION_WALKING_THRESHOLD) {
          setMotionLevel('walking');
        } else {
          setMotionLevel('idle');
        }
      });

      setIsTracking(true);
    } catch {
      setErrorMessage('No se pudieron iniciar los sensores. Cierra otras aplicaciones que estén usando el movimiento e inténtalo de nuevo.');
    } finally {
      setIsStarting(false);
    }
  }, [requestSensorPermissions]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const trackingTimer = setTimeout(() => {
      void startTracking();
    }, 350);

    return () => {
      clearTimeout(trackingTimer);
      pedometerSubscription.current?.remove();
      accelerometerSubscription.current?.remove();
    };
  }, [startTracking]);

  const toggleTracking = () => {
    if (isTracking) {
      stopTracking();
    } else {
      void startTracking();
    }
  };

  const handlePermissionAction = async () => {
    if (pedometerPermission === 'denied' && !permissionCanAskAgain) {
      await Linking.openSettings();
      return;
    }

    setPermissionBusy(true);
    setErrorMessage(null);
    try {
      const permission = await requestSensorPermissions();
      if (permission && !permission.granted) {
        setErrorMessage('Android no concedió el permiso de actividad. Revisa Ajustes → Aplicaciones → Expo Go → Permisos → Actividad física.');
      } else if (permission?.granted) {
        await startTracking();
      }
    } catch {
      setErrorMessage('No se pudo solicitar el permiso. Ábrelo manualmente desde los ajustes del dispositivo.');
    } finally {
      setPermissionBusy(false);
    }
  };

  const statusLabel = isTracking ? 'EN VIVO' : pedometerAvailable === false ? 'NO DISPONIBLE' : 'LISTO';
  const activeMotionColor = motionColor(motionLevel);
  const sensorPairAvailable = pedometerAvailable === true && accelerometerAvailable === true;
  const readingText = accelerometerReading
    ? `x ${accelerometerReading.x.toFixed(2)} · y ${accelerometerReading.y.toFixed(2)} · z ${accelerometerReading.z.toFixed(2)}`
    : 'Sin lecturas todavía';
  const toggleDiagnostics = () => {
    setShowDiagnostics((visible) => !visible);
    void refreshSensorStatus();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>P</Text>
            </View>
            <View>
              <Text style={styles.brandName}>PASO</Text>
              <Text style={styles.brandSubtitle}>MOVIMIENTO REAL</Text>
            </View>
          </View>
          <View style={[styles.statusPill, isTracking && styles.statusPillActive]}>
            <View style={[styles.statusDot, isTracking && styles.statusDotActive]} />
            <Text style={[styles.statusText, isTracking && styles.statusTextActive]}>{statusLabel}</Text>
          </View>
        </View>

        <Text style={styles.eyebrow}>TU ACTIVIDAD</Text>
        <Text style={styles.title}>Cada paso{`\n`}cuenta.</Text>
        <Text style={styles.subtitle}>Mide tu movimiento en tiempo real y conoce la distancia aproximada que recorres.</Text>

        {errorMessage ? (
          <View style={styles.errorCard}>
            <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable onPress={() => setErrorMessage(null)} hitSlop={10} accessibilityLabel="Cerrar aviso">
              <Text style={styles.errorClose}>×</Text>
            </Pressable>
          </View>
        ) : null}

        {Platform.OS !== 'web' && pedometerPermission !== 'granted' ? (
          <View style={styles.permissionCard}>
            <View style={styles.permissionIcon}><Text style={styles.permissionIconText}>✓</Text></View>
            <View style={styles.permissionContent}>
              <Text style={styles.permissionTitle}>Permiso para contar pasos</Text>
              <Text style={styles.permissionText}>
                Paso necesita acceso a la actividad física del teléfono. Android puede llamarlo «Actividad física».
              </Text>
              <Pressable
                style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}
                onPress={() => void handlePermissionAction()}
                disabled={permissionBusy}>
                {permissionBusy ? <ActivityIndicator size="small" color={COLORS.dark} /> : null}
                <Text style={styles.permissionButtonText}>
                  {permissionBusy ? 'Solicitando…' : permissionCanAskAgain ? 'Permitir permisos' : 'Abrir ajustes'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.heroCard}>
          <View style={styles.heroOrb} />
          <View style={styles.heroTopRow}>
            <Text style={styles.heroLabel}>PASOS DE ESTA SESIÓN</Text>
            <Text style={styles.heroTime}>{formatTime(elapsedSeconds)}</Text>
          </View>
          <Text style={styles.heroNumber}>{steps.toLocaleString('es-MX')}</Text>
          <Text style={styles.heroCaption}>{isTracking ? 'Contando ahora mismo' : 'Inicia para comenzar a contar'}</Text>
          <View style={styles.heroBottomRow}>
            <View style={styles.heroMiniStat}>
              <Text style={styles.heroMiniLabel}>DISTANCIA ESTIMADA</Text>
              <Text style={styles.heroMiniValue}>{formatDistance(distance)}</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroMiniStat}>
              <Text style={styles.heroMiniLabel}>RITMO</Text>
              <Text style={styles.heroMiniValue}>{motionLabel(motionLevel)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Lecturas en vivo</Text>
          <Text style={styles.sectionHint}>Sensores del teléfono</Text>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="DISTANCIA" value={formatDistance(distance)} detail="aproximada" />
          <StatCard label="TIEMPO" value={formatTime(elapsedSeconds)} detail="en movimiento" tone="blue" />
        </View>

        <View style={styles.motionCard}>
          <View style={styles.motionHeader}>
            <View style={styles.motionTitleRow}>
              <View style={[styles.motionIcon, { backgroundColor: `${activeMotionColor}18` }]}>
                <View style={[styles.motionPulse, { backgroundColor: activeMotionColor }]} />
              </View>
              <View>
                <Text style={styles.motionLabel}>INTENSIDAD</Text>
                <Text style={styles.motionValue}>{motionLabel(motionLevel)}</Text>
              </View>
            </View>
            <Text style={[styles.motionStatus, { color: activeMotionColor }]}>{motionDescription(motionLevel)}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(4, motionStrength * 100)}%`, backgroundColor: activeMotionColor }]} />
          </View>
          <View style={styles.progressLabels}>
            <Text style={styles.progressLabel}>Reposo</Text>
            <Text style={styles.progressLabel}>Caminar</Text>
            <Text style={styles.progressLabel}>Correr</Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.mainButton, isTracking && styles.mainButtonStop, pressed && styles.pressed]}
          onPress={toggleTracking}
          disabled={isStarting}
          accessibilityRole="button"
          accessibilityLabel={isTracking ? 'Detener seguimiento' : 'Iniciar seguimiento'}>
          {isStarting ? <ActivityIndicator color="#FFFFFF" /> : <View style={[styles.buttonDot, isTracking && styles.buttonSquare]} />}
          <Text style={styles.mainButtonText}>
            {isStarting ? 'Preparando sensores…' : isTracking ? 'Detener seguimiento' : 'Iniciar seguimiento'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.debugToggle, pressed && styles.pressed]}
          onPress={toggleDiagnostics}
          accessibilityRole="button"
          accessibilityLabel="Abrir diagnóstico de sensores">
          <View style={styles.debugToggleLeft}>
            <View style={styles.debugToggleIcon}><Text style={styles.debugToggleIconText}>⌁</Text></View>
            <View>
              <Text style={styles.debugToggleTitle}>Desarrollo</Text>
              <Text style={styles.debugToggleSubtitle}>Verificar sensores y permisos</Text>
            </View>
          </View>
          <Text style={styles.debugToggleAction}>{showDiagnostics ? 'Ocultar' : 'Abrir'}</Text>
        </Pressable>

        {showDiagnostics ? (
          <View style={styles.debugCard}>
            <View style={styles.debugCardHeader}>
              <View>
                <Text style={styles.debugCardTitle}>Diagnóstico en vivo</Text>
                <Text style={styles.debugCardSubtitle}>Los contadores cambian cuando llega un evento nativo.</Text>
              </View>
              <View style={[styles.debugBadge, sensorPairAvailable && styles.debugBadgeGood]}>
                <View style={[styles.debugBadgeDot, sensorPairAvailable && styles.debugBadgeDotGood]} />
                <Text style={[styles.debugBadgeText, sensorPairAvailable && styles.debugBadgeTextGood]}>
                  {sensorPairAvailable ? 'OK' : 'REVISAR'}
                </Text>
              </View>
            </View>

            <View style={styles.debugRows}>
              <DebugRow label="Podómetro" value={availabilityLabel(pedometerAvailable)} tone={pedometerAvailable ? 'good' : pedometerAvailable === false ? 'bad' : 'normal'} />
              <DebugRow label="Acelerómetro" value={availabilityLabel(accelerometerAvailable)} tone={accelerometerAvailable ? 'good' : accelerometerAvailable === false ? 'bad' : 'normal'} />
              <DebugRow label="Permiso de actividad" value={permissionLabel(pedometerPermission)} tone={pedometerPermission === 'granted' ? 'good' : pedometerPermission === 'denied' ? 'bad' : 'normal'} />
              <DebugRow label="Seguimiento" value={isTracking ? 'Activo' : 'Detenido'} tone={isTracking ? 'good' : 'normal'} />
              <DebugRow label="Eventos acelerómetro" value={String(accelerometerEventCount)} tone={accelerometerEventCount > 0 ? 'good' : 'normal'} />
              <DebugRow label="Eventos podómetro" value={String(pedometerEventCount)} tone={pedometerEventCount > 0 ? 'good' : 'normal'} />
              <DebugRow label="Pasos recibidos del sistema" value={rawPedometerSteps === null ? '—' : String(rawPedometerSteps)} tone={rawPedometerSteps !== null ? 'good' : 'normal'} />
              <DebugRow label="Último evento de pasos" value={debugTime(lastPedometerUpdateAt)} />
              <DebugRow label="Lectura acelerómetro" value={readingText} />
              <DebugRow label="Magnitud total" value={accelerometerReading ? accelerometerReading.magnitude.toFixed(3) : '—'} />
            </View>

            <Text style={styles.debugHelp}>
              Para probarlo: pulsa Iniciar, mantén el teléfono contigo y camina entre 20 y 30 pasos. Si suben los eventos del acelerómetro pero los del podómetro se quedan en 0, el sistema no está entregando pasos o el permiso está bloqueado.
            </Text>
            <Pressable style={styles.refreshButton} onPress={() => void refreshSensorStatus()}>
              <Text style={styles.refreshButtonText}>Actualizar disponibilidad y permisos</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.noteCard}>
          <Text style={styles.noteIcon}>i</Text>
          <Text style={styles.noteText}>
            La distancia es una estimación usando una zancada promedio de 72 cm. Puedes mantener Paso abierto para ver las lecturas en tiempo real.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.dark, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: COLORS.mint, fontSize: 22, fontWeight: '900', fontStyle: 'italic' },
  brandName: { color: COLORS.ink, fontSize: 17, fontWeight: '900', letterSpacing: 2 },
  brandSubtitle: { color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.1, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 99, backgroundColor: '#E9F0EC' },
  statusPillActive: { backgroundColor: COLORS.greenSoft },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.muted },
  statusDotActive: { backgroundColor: COLORS.green },
  statusText: { color: COLORS.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  statusTextActive: { color: COLORS.green },
  eyebrow: { color: COLORS.green, fontSize: 10, fontWeight: '900', letterSpacing: 1.7, marginTop: 38 },
  title: { color: COLORS.ink, fontSize: 39, lineHeight: 42, fontWeight: '900', letterSpacing: -1.4, marginTop: 9 },
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 350 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF0EA', borderWidth: 1, borderColor: '#F3D5C9', borderRadius: 15, padding: 12, marginTop: 19 },
  errorIcon: { width: 25, height: 25, borderRadius: 9, backgroundColor: '#D97958', alignItems: 'center', justifyContent: 'center' },
  errorIconText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  errorText: { flex: 1, color: '#8B4B39', fontSize: 12, lineHeight: 17 },
  errorClose: { color: '#A86653', fontSize: 23, fontWeight: '400', lineHeight: 23 },
  permissionCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, backgroundColor: '#FFF8E8', borderWidth: 1, borderColor: '#F0DFC0', borderRadius: 17, padding: 14, marginTop: 18 },
  permissionIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#F2C976', alignItems: 'center', justifyContent: 'center' },
  permissionIconText: { color: '#664716', fontSize: 17, fontWeight: '900' },
  permissionContent: { flex: 1 },
  permissionTitle: { color: '#664716', fontSize: 13, fontWeight: '900' },
  permissionText: { color: '#896A36', fontSize: 11, lineHeight: 16, marginTop: 4 },
  permissionButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F2C976', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginTop: 10 },
  permissionButtonText: { color: COLORS.dark, fontSize: 11, fontWeight: '900' },
  heroCard: { backgroundColor: COLORS.dark, borderRadius: 25, padding: 20, marginTop: 25, overflow: 'hidden' },
  heroOrb: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90, backgroundColor: '#245B45', opacity: 0.72 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: { color: '#9ACBB2', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  heroTime: { color: '#BDE8D0', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroNumber: { color: '#F2FCF6', fontSize: 58, lineHeight: 64, fontWeight: '900', letterSpacing: -2, marginTop: 22 },
  heroCaption: { color: '#9DBDAE', fontSize: 12, marginTop: 1 },
  heroBottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 25, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(189,232,208,0.15)' },
  heroMiniStat: { flex: 1 },
  heroMiniLabel: { color: '#82B69C', fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  heroMiniValue: { color: '#F2FCF6', fontSize: 16, fontWeight: '800', marginTop: 5 },
  heroDivider: { width: 1, height: 31, backgroundColor: 'rgba(189,232,208,0.18)', marginHorizontal: 15 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 29, marginBottom: 12 },
  sectionTitle: { color: COLORS.ink, fontSize: 19, fontWeight: '900', letterSpacing: -0.4 },
  sectionHint: { color: COLORS.muted, fontSize: 10 },
  statsRow: { flexDirection: 'row', gap: 11 },
  statCard: { flex: 1, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, padding: 14 },
  statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  statIconText: { fontSize: 21, fontWeight: '700' },
  statLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  statValue: { color: COLORS.ink, fontSize: 21, fontWeight: '900', marginTop: 4 },
  statDetail: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  motionCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, padding: 16, marginTop: 12 },
  motionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  motionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  motionIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  motionPulse: { width: 12, height: 12, borderRadius: 6 },
  motionLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  motionValue: { color: COLORS.ink, fontSize: 16, fontWeight: '900', marginTop: 3 },
  motionStatus: { fontSize: 10, fontWeight: '800', maxWidth: 120, textAlign: 'right' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: '#E8EFEA', marginTop: 17, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  progressLabel: { color: COLORS.muted, fontSize: 9 },
  mainButton: { minHeight: 57, borderRadius: 17, backgroundColor: COLORS.dark, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 20 },
  mainButtonStop: { backgroundColor: '#A95445' },
  buttonDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: COLORS.mint },
  buttonSquare: { width: 11, height: 11, borderRadius: 3, backgroundColor: '#FFE0D7' },
  mainButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  debugToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, padding: 12, marginTop: 12 },
  debugToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  debugToggleIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#EEF2F0', alignItems: 'center', justifyContent: 'center' },
  debugToggleIconText: { color: COLORS.dark, fontSize: 22, fontWeight: '700' },
  debugToggleTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '900' },
  debugToggleSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  debugToggleAction: { color: COLORS.green, fontSize: 11, fontWeight: '900' },
  debugCard: { backgroundColor: '#10291F', borderRadius: 18, padding: 16, marginTop: 8 },
  debugCardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  debugCardTitle: { color: '#F2FCF6', fontSize: 16, fontWeight: '900' },
  debugCardSubtitle: { color: '#9DBDAE', fontSize: 10, lineHeight: 15, marginTop: 4, maxWidth: 235 },
  debugBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(216,132,66,0.17)', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6 },
  debugBadgeGood: { backgroundColor: 'rgba(189,232,208,0.14)' },
  debugBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.orange },
  debugBadgeDotGood: { backgroundColor: COLORS.mint },
  debugBadgeText: { color: '#F1B382', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  debugBadgeTextGood: { color: COLORS.mint },
  debugRows: { borderTopWidth: 1, borderTopColor: 'rgba(189,232,208,0.14)', marginTop: 15 },
  debugRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 30, borderBottomWidth: 1, borderBottomColor: 'rgba(189,232,208,0.09)' },
  debugLabel: { color: '#9DBDAE', fontSize: 10, flex: 1 },
  debugValue: { color: '#F2FCF6', fontSize: 10, fontWeight: '800', textAlign: 'right', maxWidth: '62%' },
  debugGood: { color: COLORS.mint },
  debugBad: { color: '#F1B382' },
  debugHelp: { color: '#AFCDBD', fontSize: 10, lineHeight: 16, marginTop: 13 },
  refreshButton: { alignItems: 'center', justifyContent: 'center', minHeight: 38, borderRadius: 11, backgroundColor: 'rgba(189,232,208,0.13)', marginTop: 13 },
  refreshButtonText: { color: COLORS.mint, fontSize: 10, fontWeight: '900' },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 5, marginTop: 18 },
  noteIcon: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: '#AABBB1', color: '#7A8C82', fontSize: 11, fontWeight: '900', textAlign: 'center', lineHeight: 15 },
  noteText: { flex: 1, color: COLORS.muted, fontSize: 11, lineHeight: 17 },
});
