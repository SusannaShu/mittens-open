import { useState, useMemo } from 'react';
import { Feather } from '@expo/vector-icons';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../../../lib/theme';
import PhotoCapture from '../../common/PhotoCapture';
import { COVERAGE_PRESETS } from './constants';
import { useGetActivityTypesQuery } from '../../../lib/services/activityTypeApi';
import type { ActivityTypeModel, Person } from '../../../lib/pipelines/types';
import { s } from '../TodayModals';

// New Shared Components
import { ScaleSelector } from '../../common/ScaleSelector';
import { LifeDesignSelector } from '../../common/LifeDesignSelector';
import { AeiouEditor } from '../../common/AeiouEditor';

interface ActivityFormProps {
  onActivitySubmit: (data: {
    logName: string; activityType: string; duration_min?: number; loggedAt?: string;
    location?: string; intensity?: string; outdoors?: boolean;
    photos?: string[]; engagement?: number; energy?: number;
    aeiou?: Record<string, string>; lifeCategories?: Record<string, number>;
  }) => void;
  loggedAt: Date;
  onClose: () => void;
  isFuture: boolean;
}

export function ActivityForm({ onActivitySubmit, loggedAt, onClose, isFuture }: ActivityFormProps) {
  const { data: activityTypesData } = useGetActivityTypesQuery();
  const activityTypes = useMemo(() => {
    if (!activityTypesData?.types) return [];
    return activityTypesData.types.filter(t => t.showInManualLog);
  }, [activityTypesData]);
  const [actName, setActName] = useState('');
  const [actType, setActType] = useState('other');
  const [actLocation, setActLocation] = useState('');
  const [actPhotos, setActPhotos] = useState<string[]>([]);
  const [actEngagement, setActEngagement] = useState<number | null>(null);
  const [actEnergy, setActEnergy] = useState<number | null>(null);
  const [actAeiou, setActAeiou] = useState<Record<string, string>>({});
  const [actLifeCats, setActLifeCats] = useState<Record<string, number>>({});
  const [actCoveragePct, setActCoveragePct] = useState<number | null>(null);
  const [actSunscreen, setActSunscreen] = useState(false);
  const [actSubmitting, setActSubmitting] = useState(false);
  const [actBhScale, setActBhScale] = useState<number | null>(null);

  const selectedTypeDef = useMemo(() => {
    return activityTypes.find(t => t.key === actType);
  }, [activityTypes, actType]);

  const isBrainHygiene = useMemo(() => {
    if (!selectedTypeDef) return ['meditation', 'journal', 'scrolling'].includes(actType);
    const subs = selectedTypeDef.subCategories || [];
    return subs.includes('brain_hygiene') || ['meditation', 'journal', 'scrolling'].includes(actType);
  }, [selectedTypeDef, actType]);

  // Track linked users
  const [linkedUsers, setLinkedUsers] = useState<Person[]>([]);

  const handleActivitySubmit = async () => {
    if (!actName.trim()) return;
    setActSubmitting(true);
    try {
      const meta: any = {};
      if (isBrainHygiene) {
        meta.brain_hygiene_scale = actBhScale ?? 0;
      }

      await onActivitySubmit({
        logName: actName.trim(),
        activityType: actType,
        duration_min: 30, // Default manual activities to 30 min duration
        loggedAt: loggedAt.toISOString(),
        location: actLocation.trim() || undefined,
        outdoors: actAeiou.environment ? /outdoor|nature/i.test(actAeiou.environment) : undefined,
        coverage_pct: actCoveragePct ?? undefined,
        sunscreen: actSunscreen,
        photos: actPhotos.length > 0 ? actPhotos : undefined,
        engagement: actEngagement ?? undefined,
        energy: actEnergy ?? undefined,
        aeiou: Object.keys(actAeiou).length > 0 ? actAeiou : undefined,
        lifeCategories: Object.keys(actLifeCats).length > 0 ? actLifeCats : undefined,
        meta,
      } as any);
      onClose();
    } finally {
      setActSubmitting(false);
    }
  };

  const handleAeiouChange = (key: string, val: string) => {
    setActAeiou(prev => ({ ...prev, [key]: val }));
  };

  return (
    <>
      <Text style={s.modalSub}>Log an activity to track your day.</Text>

      {/* Activity type pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }} contentContainerStyle={{ gap: 6 }}>
        {activityTypes.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[s.typePill, actType === t.key && s.typePillActive]}
            onPress={() => {
              setActType(t.key);
              if (!actName) setActName(t.label);
              if (t.defaultLifeCategories && Object.keys(actLifeCats).length === 0) {
                setActLifeCats(t.defaultLifeCategories);
              }
              const envAeiou = t.defaultOutdoors ? 'outdoor' : (t.isNature ? 'nature' : '');
              if (envAeiou && !actAeiou.environment) {
                setActAeiou(prev => ({ ...prev, environment: envAeiou }));
              }
              if (t.exposureExtent && actCoveragePct === null) {
                setActCoveragePct(t.exposureExtent);
              }
              
              const isBH = t.subCategories?.includes('brain_hygiene') || ['meditation', 'journal', 'scrolling'].includes(t.key);
              if (isBH) {
                let defaultScale = t.brainHygieneScale ?? 0;
                if (defaultScale === 0) {
                  if (t.key === 'meditation' || t.key === 'journal') defaultScale = 2;
                  else if (t.key === 'scrolling') defaultScale = -2;
                  else defaultScale = 2;
                }
                setActBhScale(defaultScale);
              } else {
                setActBhScale(null);
              }
            }}
          >
            <Feather name={(t.icon || 'circle') as any} size={12} color={actType === t.key ? colors.bg : colors.textSecondary} />
            <Text style={[s.typePillText, actType === t.key && s.typePillTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Photo capture */}
      <PhotoCapture
        photos={actPhotos}
        onCapture={(photo) => setActPhotos(prev => [...prev, photo])}
        onRemove={(idx) => setActPhotos(prev => prev.filter((_, i) => i !== idx))}
        maxPhotos={3}
      />

      <TextInput
        style={[s.modalInput, { minHeight: 44 }]}
        value={actName}
        onChangeText={setActName}
        placeholder="e.g. Morning jog in the park"
        placeholderTextColor={colors.textMuted}
      />

      {/* Location row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
        <Feather name="map-pin" size={14} color={colors.textMuted} />
        <TextInput
          style={[s.modalInput, { flex: 1, minHeight: 40, marginBottom: 0 }]}
          value={actLocation}
          onChangeText={setActLocation}
          placeholder="Location"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {/* Activity reflection -- only for past events */}
      {!isFuture && (
        <>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>How did it feel?</Text>

          {isBrainHygiene && (
            <View style={{ backgroundColor: '#FAFAFA', borderRadius: 8, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Brain Hygiene Impact</Text>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                {([-3, -2, -1, 0, 1, 2, 3]).map((val) => {
                  const current = actBhScale ?? 0;
                  const selected = current === val;
                  let bg = colors.border;
                  if (selected && val < 0) bg = '#EF4444';
                  if (selected && val > 0) bg = '#10B981';
                  if (selected && val === 0) bg = colors.textMuted;
                  return (
                    <TouchableOpacity
                      key={val}
                      style={[{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 4, backgroundColor: colors.border }, selected && { backgroundColor: bg }]}
                      onPress={() => setActBhScale(val)}
                    >
                      <Text style={[{ fontSize: 10, fontWeight: '600', color: colors.textMuted }, selected && { color: '#fff' }]}>
                        {val > 0 ? `+${val}` : String(val)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                <Text style={{ fontSize: 9, color: '#EF4444' }}>harmful</Text>
                <Text style={{ fontSize: 9, color: '#10B981' }}>restorative</Text>
              </View>
            </View>
          )}

          <ScaleSelector
            label="Engagement (1-10)"
            value={actEngagement}
            onChange={setActEngagement}
            min={1}
            max={10}
            labels={{ start: 'Lo', center: 'Flow', end: 'Hi' }}
          />

          <ScaleSelector
            label="Energy after (-5 to +5)"
            value={actEnergy}
            onChange={setActEnergy}
            min={-5}
            max={5}
            labels={{ start: 'Drained', center: '0', end: 'Energized' }}
            formatValue={(v) => v > 0 ? `+${v}` : `${v}`}
          />

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }}>Life Design</Text>
          <LifeDesignSelector
            lifeCats={actLifeCats}
            onChange={(cat, val) => setActLifeCats(prev => ({ ...prev, [cat]: val }))}
          />

          {(actType === 'sun' || ((/outdoor|nature/i.test(actAeiou.environment || '')) && actType !== 'sleep')) && (
            <View style={{ marginBottom: spacing.md, backgroundColor: colors.border, padding: spacing.sm, borderRadius: 8 }}>
              <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 6, fontWeight: '600', textTransform: 'uppercase' }}>Skin Exposed</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: spacing.sm }}>
                {COVERAGE_PRESETS.map(opt => {
                  const isSel = actCoveragePct === opt.value;
                  return (
                    <TouchableOpacity key={opt.value} style={[s.typePill, { flex: 1, alignItems: 'center', paddingHorizontal: 0, paddingVertical: 8, backgroundColor: isSel ? colors.textPrimary : '#FFF', borderColor: isSel ? colors.textPrimary : colors.border }]} onPress={() => setActCoveragePct(isSel ? null : opt.value)}>
                      <Text style={[s.typePillText, { fontSize: 13, fontWeight: '700', color: isSel ? '#FFF' : colors.textPrimary }]}>{opt.value}%</Text>
                      <Text style={{ fontSize: 9, color: isSel ? '#FFF' : colors.textMuted, marginTop: 2 }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: colors.textPrimary, fontWeight: '500' }}>Sunscreen?</Text>
                <TouchableOpacity style={[s.typePill, { minWidth: 60, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0, paddingVertical: 6, backgroundColor: actSunscreen ? colors.textPrimary : '#FFF', borderColor: actSunscreen ? colors.textPrimary : colors.border }]} onPress={() => setActSunscreen(!actSunscreen)}>
                  <Text style={[s.typePillText, { color: actSunscreen ? '#FFF' : colors.textMuted }]}>{actSunscreen ? 'Yes' : 'No'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' }}>AEIOU Reflection</Text>
          <AeiouEditor
            aeiou={actAeiou}
            onChange={handleAeiouChange}
            linkedUsers={linkedUsers}
            onAddLinkedUser={(p) => setLinkedUsers(prev => [...prev, p])}
            onRemoveLinkedUser={(id) => setLinkedUsers(prev => prev.filter(p => p.id !== id))}
          />
        </>
      )}

      <View style={s.modalActions}>
        <TouchableOpacity style={s.modalBtnCancel} onPress={onClose} disabled={actSubmitting}>
          <Text style={s.modalBtnTextCancel}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.modalBtnSave} onPress={handleActivitySubmit} disabled={actSubmitting || !actName.trim()}>
          {actSubmitting ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={s.modalBtnTextSave}>Log</Text>}
        </TouchableOpacity>
      </View>
    </>
  );
}

