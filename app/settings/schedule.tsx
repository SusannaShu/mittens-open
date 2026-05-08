import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, SafeAreaView, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useGetProfileQuery, useUpdateProfileMutation } from '../../lib/services/profileApi';
import { scheduleBedtimeAlarms, clearScheduledRhythms, ensureRhythmsForDate } from '../../lib/services/schedule/alarmScheduler';
import { getCurrentLocation } from '../../lib/services/location/locationService';
import { colors, fonts, spacing, radius } from '../../lib/theme';

const CHRONOTYPE_WAKE: Record<string, number> = {
  morning: 330,      // 5:30 AM
  intermediate: 360, // 6:00 AM
  evening: 420,      // 7:00 AM
};

const CHRONOTYPE_LABELS: Record<string, string> = {
  morning: 'Early Bird',
  intermediate: 'Neutral',
  evening: 'Night Owl',
};

// Common wake time presets for quick selection
const WAKE_PRESETS = [
  { label: '5:00', minutes: 300 },
  { label: '5:30', minutes: 330 },
  { label: '6:00', minutes: 360 },
  { label: '6:30', minutes: 390 },
  { label: '7:00', minutes: 420 },
  { label: '7:30', minutes: 450 },
  { label: '8:00', minutes: 480 },
];

export default function ScheduleSettingsScreen() {
  const router = useRouter();
  const { data: profile, isLoading } = useGetProfileQuery();
  const [updateProfile] = useUpdateProfileMutation();
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const [form, setForm] = useState({
    wakeTimeLmstMinutes: '360',
    sleepHours: '8',
    chronotype: 'intermediate',
    breakfastOffsetMinutes: '45',
    dinnerBeforeBedMinutes: '240',
    scheduleMode: 'local_clock',
    scheduleTravelMode: 'home',
    homeLongitude: '',
    homeLatitude: '',
    homeLabel: '',
    scheduleEnabled: true,
  });

  useEffect(() => {
    if (profile && profile.onboarded) {
      setForm({
        wakeTimeLmstMinutes: profile.wakeTimeLmstMinutes?.toString() || '360',
        sleepHours: profile.sleepHours?.toString() || '8',
        chronotype: profile.chronotype || 'intermediate',
        breakfastOffsetMinutes: profile.breakfastOffsetMinutes?.toString() || '45',
        dinnerBeforeBedMinutes: profile.dinnerBeforeBedMinutes?.toString() || '240',
        scheduleMode: profile.scheduleMode || 'local_clock',
        scheduleTravelMode: profile.scheduleTravelMode || 'home',
        homeLongitude: profile.homeLongitude?.toString() || '',
        homeLatitude: profile.homeLatitude?.toString() || '',
        homeLabel: profile.homeLabel || '',
        scheduleEnabled: profile.scheduleEnabled !== false,
      });
    }
  }, [profile]);

  const handleUpdateLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        alert('Permission denied.');
        setLocating(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude;
      const lon = loc.coords.longitude;
      let label = 'Home';
      try {
        const reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (reverse && reverse.length > 0) {
          label = reverse[0].city || reverse[0].region || 'Home';
        }
      } catch (e) {}

      setForm((f) => ({
        ...f,
        homeLatitude: lat.toString(),
        homeLongitude: lon.toString(),
        homeLabel: label,
      }));
    } catch (e) {
      alert('Failed to update location.');
    } finally {
      setLocating(false);
    }
  };

  const handleChronotypeChange = (type: string) => {
    setForm(f => ({
      ...f,
      chronotype: type,
      wakeTimeLmstMinutes: CHRONOTYPE_WAKE[type]?.toString() || f.wakeTimeLmstMinutes,
    }));
  };

  // Compute derived bedtime for preview
  const wakeMin = parseInt(form.wakeTimeLmstMinutes || '360', 10);
  const sleepMin = (parseFloat(form.sleepHours) || 8) * 60;
  const bedtimeMin = ((wakeMin - sleepMin) % 1440 + 1440) % 1440;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        wakeTimeLmstMinutes: parseInt(form.wakeTimeLmstMinutes, 10) || 360,
        sleepHours: parseFloat(form.sleepHours) || 8,
        chronotype: form.chronotype,
        breakfastOffsetMinutes: parseInt(form.breakfastOffsetMinutes, 10) || 45,
        dinnerBeforeBedMinutes: parseInt(form.dinnerBeforeBedMinutes, 10) || 240,
        scheduleMode: form.scheduleMode,
        scheduleTravelMode: form.scheduleTravelMode,
        homeLongitude: form.homeLongitude ? parseFloat(form.homeLongitude) : null,
        homeLatitude: form.homeLatitude ? parseFloat(form.homeLatitude) : null,
        homeLabel: form.homeLabel,
        scheduleEnabled: form.scheduleEnabled,
      };
      await updateProfile(payload).unwrap();

      // Regenerate rhythm blocks (non-blocking — don't let this crash the save)
      if (payload.homeLongitude && payload.scheduleEnabled) {
        const today = new Date().toLocaleDateString('en-CA');
        const mergedProfile = { ...profile, ...payload };
        clearScheduledRhythms(today)
          .then(() => ensureRhythmsForDate(mergedProfile, today))
          .then(() => {
            const loc = getCurrentLocation();
            return scheduleBedtimeAlarms(
              payload.sleepHours, 
              { lat: payload.homeLatitude!, lon: payload.homeLongitude! },
              loc,
              payload.scheduleTravelMode,
              undefined,
              mergedProfile
            );
          })
          .catch(err => console.warn('Rhythm regen failed:', err));
      }

      router.back();
    } catch (e: any) {
      alert('Error saving schedule: ' + (e?.message || e?.data?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const formatLmst = (minutes: number) => {
    const min = minutes % 1440;
    const hrs = Math.floor(min / 60);
    const m = min % 60;
    return `${hrs.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: spacing.sm }}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sleep & Schedule</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} style={{ padding: spacing.sm }}>
          {saving ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.saveBtnText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        <Text style={styles.sectionTitle}>Solar Anchor Location</Text>
        <Text style={styles.explainer}>Your schedule is pinned to the solar time exactly at your longitude.</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Location Label</Text>
          <TextInput style={styles.input} value={form.homeLabel} onChangeText={t => setForm({...form, homeLabel: t})} />
          <Text style={styles.label}>Longitude Offset</Text>
          <TextInput style={styles.input} value={form.homeLongitude} keyboardType="numeric" onChangeText={t => setForm({...form, homeLongitude: t})} />
          
          <TouchableOpacity style={styles.geoBtn} onPress={handleUpdateLocation} disabled={locating}>
            {locating ? <ActivityIndicator color="#fff" /> : <Text style={styles.geoBtnText}>Re-anchor to Current Location</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Rhythm</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Target Wake Time</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
            {WAKE_PRESETS.map(p => (
              <TouchableOpacity 
                key={p.minutes} 
                style={[
                  styles.choiceBtn, { flex: 0, paddingHorizontal: 14 },
                  parseInt(form.wakeTimeLmstMinutes) === p.minutes && styles.choiceBtnActive
                ]}
                onPress={() => setForm({...form, wakeTimeLmstMinutes: p.minutes.toString()})}
              >
                <Text style={[
                  styles.choiceText,
                  parseInt(form.wakeTimeLmstMinutes) === p.minutes && styles.choiceTextActive
                ]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.md }}>
            Solar time {formatLmst(wakeMin)} LMST at your longitude
          </Text>

          <Text style={styles.label}>Target Sleep Duration (Hours)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm }}>
            {[7, 7.5, 8, 8.5, 9, 9.5].map(h => (
              <TouchableOpacity 
                key={h} 
                style={[
                  styles.choiceBtn, { flex: 0, paddingHorizontal: 14 },
                  parseFloat(form.sleepHours) === h && styles.choiceBtnActive
                ]}
                onPress={() => setForm({...form, sleepHours: h.toString()})}
              >
                <Text style={[
                  styles.choiceText,
                  parseFloat(form.sleepHours) === h && styles.choiceTextActive
                ]}>
                  {h}h
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ backgroundColor: '#F7F7F7', padding: spacing.sm, borderRadius: radius.sm, marginTop: spacing.xs }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: 'center' }}>
              Bedtime {formatLmst(bedtimeMin)} -- Wake {formatLmst(wakeMin)} ({form.sleepHours || 8}h)
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <View style={{ flex: 1, paddingRight: spacing.sm }}>
              <Text style={styles.label}>Enable Planned Schedule</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>If disabled, Mittens will stop plotting rhythm blocks on your calendar and you will not get bedtime alerts.</Text>
            </View>
            <Switch 
              value={form.scheduleEnabled} 
              onValueChange={v => setForm({...form, scheduleEnabled: v})} 
            />
          </View>

          <Text style={styles.label}>Breakfast Offset (mins after wake)</Text>
          <TextInput style={styles.input} value={form.breakfastOffsetMinutes} keyboardType="numeric" onChangeText={t => setForm({...form, breakfastOffsetMinutes: t})} />
          
          <Text style={styles.label}>Dinner to Bed Gap (mins before bed)</Text>
          <TextInput style={styles.input} value={form.dinnerBeforeBedMinutes} keyboardType="numeric" onChangeText={t => setForm({...form, dinnerBeforeBedMinutes: t})} />
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { 
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', 
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border 
  },
  headerTitle: { fontFamily: fonts.heading, fontSize: 18, color: colors.textPrimary },
  backBtnText: { color: colors.textSecondary, fontSize: 16 },
  saveBtnText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  content: { padding: spacing.md },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.md, marginBottom: 4 },
  explainer: { fontSize: 14, color: colors.textSecondary, marginBottom: spacing.sm },
  card: { backgroundColor: '#fff', padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: spacing.sm, fontSize: 16, color: colors.textPrimary, backgroundColor: '#FAFAFA', marginBottom: spacing.sm
  },
  geoBtn: { backgroundColor: colors.accent, padding: spacing.sm, borderRadius: radius.sm, alignItems: 'center', marginTop: spacing.xs },
  geoBtnText: { color: '#FFF', fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.sm },
  choiceBtn: { flex: 1, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, alignItems: 'center' },
  choiceBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  choiceText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  choiceTextActive: { color: '#FFF' },
});
