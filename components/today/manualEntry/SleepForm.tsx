import { useState } from 'react';
import { Feather } from '@expo/vector-icons';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../../../lib/theme';
import { PillRow } from './PillRow';
import {
  SLEEP_QUALITIES, SLEEP_TEMP_PILLS, SLEEP_LIGHT_PILLS,
  SLEEP_NOISE_PILLS, SLEEP_SCREEN_PILLS, SLEEP_CAFFEINE_PILLS,
} from './constants';
import { s } from '../TodayModals';

interface SleepFormProps {
  loggedAt: Date;
  onSleepSubmit: (data: {
    sleepStart?: string; sleepEnd?: string; totalMinutes?: number;
    quality?: string; notes?: string; energy?: number; environment?: string;
  }) => void;
  onClose: () => void;
  isFuture: boolean;
}

export function SleepForm({ loggedAt, onSleepSubmit, onClose, isFuture }: SleepFormProps) {
  const [sleepHours, setSleepHours] = useState('');
  const [sleepMinutes, setSleepMinutes] = useState('');
  const [sleepQuality, setSleepQuality] = useState('');
  const [sleepNotes, setSleepNotes] = useState('');
  const [sleepSubmitting, setSleepSubmitting] = useState(false);
  const [sleepEnergy, setSleepEnergy] = useState<number | null>(null);
  const [sleepTemp, setSleepTemp] = useState('');
  const [sleepLight, setSleepLight] = useState('');
  const [sleepNoise, setSleepNoise] = useState('');
  const [sleepScreen, setSleepScreen] = useState('');
  const [sleepCaffeine, setSleepCaffeine] = useState('');
  const [sleepMorningLight, setSleepMorningLight] = useState(false);

  const handleSleepSubmit = async () => {
    const h = parseInt(sleepHours, 10) || 0;
    const m = parseInt(sleepMinutes, 10) || 0;
    const totalMin = h * 60 + m;
    if (totalMin <= 0) return;
    setSleepSubmitting(true);

    const sleepStart = loggedAt.toISOString();
    const sleepEnd = new Date(loggedAt.getTime() + totalMin * 60000).toISOString();

    // Serialize environment
    const envParts: Record<string, string> = {};
    if (sleepTemp) envParts.temperature = sleepTemp;
    if (sleepLight) envParts.light = sleepLight;
    if (sleepNoise) envParts.noise = sleepNoise;
    if (sleepScreen) envParts.screen = sleepScreen;
    if (sleepCaffeine) envParts.caffeine = sleepCaffeine;
    if (sleepMorningLight) envParts.morningLight = 'true';
    const envStr = Object.keys(envParts).length > 0 ? JSON.stringify(envParts) : undefined;

    try {
      await onSleepSubmit({
        sleepStart,
        sleepEnd,
        totalMinutes: totalMin,
        quality: sleepQuality || undefined,
        notes: sleepNotes.trim() || undefined,
        energy: sleepEnergy ?? undefined,
        environment: envStr,
      });
      onClose();
    } finally {
      setSleepSubmitting(false);
    }
  };

  const totalMin = (parseInt(sleepHours, 10) || 0) * 60 + (parseInt(sleepMinutes, 10) || 0);

  return (
    <>
      <Text style={s.modalSub}>How long did you sleep?</Text>

      {/* Duration inputs */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md }}>
        <Feather name="moon" size={14} color={colors.textMuted} />
        <TextInput
          style={[s.sleepDurationInput]}
          value={sleepHours}
          onChangeText={setSleepHours}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          maxLength={2}
        />
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>hrs</Text>
        <TextInput
          style={[s.sleepDurationInput]}
          value={sleepMinutes}
          onChangeText={setSleepMinutes}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          maxLength={2}
        />
        <Text style={{ fontSize: 13, color: colors.textSecondary }}>min</Text>
      </View>

      {/* Quality pills */}
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Quality</Text>
      <PillRow pills={SLEEP_QUALITIES} value={sleepQuality} onChange={setSleepQuality} />

      {/* Energy on waking -- only for past events */}
      {!isFuture && (
        <>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 }}>Energy on waking (-5 to +5)</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
            {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity
                key={v}
                style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }, sleepEnergy === v && { backgroundColor: colors.textPrimary }]}
                onPress={() => setSleepEnergy(sleepEnergy === v ? null : v)}
                activeOpacity={0.6}
              >
                <Text style={[{ fontSize: 8, fontWeight: '600', color: colors.textMuted }, sleepEnergy === v && { color: colors.bg }]}>
                  {v > 0 ? `+${v}` : v}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Drained</Text>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>0</Text>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Energized</Text>
          </View>
        </>
      )}

      {/* Environment pills -- only for past events */}
      {!isFuture && (
        <>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Sleep Environment</Text>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: colors.textPrimary, fontWeight: '500' }}>Morning sunlight visibility?</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Crucial for circadian rhythm mapping</Text>
            </View>
            <TouchableOpacity style={[s.typePill, { minWidth: 60, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0, paddingVertical: 6, backgroundColor: sleepMorningLight ? colors.textPrimary : '#FFF', borderColor: sleepMorningLight ? colors.textPrimary : colors.border }]} onPress={() => setSleepMorningLight(!sleepMorningLight)}>
              <Text style={[s.typePillText, { color: sleepMorningLight ? '#FFF' : colors.textMuted }]}>{sleepMorningLight ? 'Yes' : 'No'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Temperature (65-68F optimal)</Text>
          <PillRow pills={SLEEP_TEMP_PILLS} value={sleepTemp} onChange={setSleepTemp} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Light</Text>
          <PillRow pills={SLEEP_LIGHT_PILLS} value={sleepLight} onChange={setSleepLight} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Noise</Text>
          <PillRow pills={SLEEP_NOISE_PILLS} value={sleepNoise} onChange={setSleepNoise} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Screen before bed</Text>
          <PillRow pills={SLEEP_SCREEN_PILLS} value={sleepScreen} onChange={setSleepScreen} />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Caffeine</Text>
          <PillRow pills={SLEEP_CAFFEINE_PILLS} value={sleepCaffeine} onChange={setSleepCaffeine} />
        </>
      )}

      {/* Notes */}
      <TextInput
        style={[s.modalInput, { minHeight: 44 }]}
        value={sleepNotes}
        onChangeText={setSleepNotes}
        placeholder="Notes (optional)"
        placeholderTextColor={colors.textMuted}
        multiline
      />

      <View style={s.modalActions}>
        <TouchableOpacity style={s.modalBtnCancel} onPress={onClose} disabled={sleepSubmitting}>
          <Text style={s.modalBtnTextCancel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.modalBtnSave}
          onPress={handleSleepSubmit}
          disabled={sleepSubmitting || totalMin <= 0}
        >
          {sleepSubmitting ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.modalBtnTextSave}>Log</Text>}
        </TouchableOpacity>
      </View>
    </>
  );
}
