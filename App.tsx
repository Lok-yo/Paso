import { Accelerometer, Pedometer } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
const FALLBACK_STEP_THRESHOLD = 0.08;
const FALLBACK_STEP_COOLDOWN_MS = 280;

type MotionLevel = 'idle' | 'walking' | 'running';
type SensorSubscription = { remove: () => void };

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

function AppContent() {
  const [steps, setSteps] = useState(0);
  const [motionLevel, setMotionLevel] = useState<MotionLevel>('idle');
  const [motionStrength, setMotionStrength] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const pedometerSubscription = useRef<SensorSubscription | null>(null);
  const accelerometerSubscription = useRef<SensorSubscription | null>(null);
  const motionAverage = useRef(0);
  const previousMovement = useRef(0);
  const previousPreviousMovement = useRef(0);
  const fallbackSteps = useRef(0);
  const lastFallbackStepAt = useRef(0);
  const pedometerResponding = useRef(false);

  const distance = steps * METERS_PER_STEP;

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
    previousMovement.current = 0;
    previousPreviousMovement.current = 0;
    fallbackSteps.current = 0;
    lastFallbackStepAt.current = 0;
    pedometerResponding.current = false;
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

      if (!isAccelerometerAvailable) {
        setErrorMessage('Este dispositivo no expone un acelerómetro compatible. Prueba en un teléfono físico.');
        return;
      }

      pedometerSubscription.current?.remove();
      accelerometerSubscription.current?.remove();
      setSteps(0);
      setElapsedSeconds(0);
      setStartedAt(Date.now());
      motionAverage.current = 0;
      previousMovement.current = 0;
      previousPreviousMovement.current = 0;
      fallbackSteps.current = 0;
      lastFallbackStepAt.current = 0;
      pedometerResponding.current = false;

      if (isPedometerAvailable) {
        try {
          pedometerSubscription.current = Pedometer.watchStepCount(({ steps: currentSteps }) => {
            pedometerResponding.current = true;
            setSteps(currentSteps);
          });
        } catch {
          // El acelerómetro continúa con su conteo aproximado de respaldo.
        }
      }

      Accelerometer.setUpdateInterval(ACCELEROMETER_INTERVAL_MS);
      accelerometerSubscription.current = Accelerometer.addListener(({ x, y, z }) => {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const dynamicMovement = Math.abs(magnitude - 1);
        motionAverage.current = motionAverage.current * 0.82 + dynamicMovement * 0.18;
        const average = motionAverage.current;
        const strength = Math.min(1, average / 0.35);
        const now = Date.now();
        const isMovementPeak = previousMovement.current > FALLBACK_STEP_THRESHOLD
          && previousMovement.current >= previousPreviousMovement.current
          && previousMovement.current >= average
          && now - lastFallbackStepAt.current >= FALLBACK_STEP_COOLDOWN_MS;

        if (isMovementPeak && !pedometerResponding.current) {
          fallbackSteps.current += 1;
          lastFallbackStepAt.current = now;
          setSteps(fallbackSteps.current);
        }

        previousPreviousMovement.current = previousMovement.current;
        previousMovement.current = average;

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
  }, []);

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

  const statusLabel = isTracking ? 'EN VIVO' : 'LISTO';
  const activeMotionColor = motionColor(motionLevel);

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
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 5, marginTop: 18 },
  noteIcon: { width: 17, height: 17, borderRadius: 9, borderWidth: 1, borderColor: '#AABBB1', color: '#7A8C82', fontSize: 11, fontWeight: '900', textAlign: 'center', lineHeight: 15 },
  noteText: { flex: 1, color: COLORS.muted, fontSize: 11, lineHeight: 17 },
});
