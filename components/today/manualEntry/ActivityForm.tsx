import { useState, useEffect, useCallback } from 'react';
import { Feather } from '@expo/vector-icons';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { colors, spacing } from '../../../lib/theme';
import PhotoCapture from '../../common/PhotoCapture';
import { PillRow } from './PillRow';
import { COVERAGE_PRESETS } from './constants';
import { ActivityTypeService } from '../../../lib/services/activityTypeService';
import { PersonService } from '../../../lib/services/personService';
import type { ActivityTypeModel, Person } from '../../../lib/pipelines/types';
import { s } from '../TodayModals';

/* Small inline autocomplete for people names */
function PeopleAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [suggestions, setSuggestions] = useState<Person[]>([]);

  // Get the last name being typed (after last comma)
  const getCurrentToken = useCallback(() => {
    const parts = value.split(',');
    return parts[parts.length - 1].trim();
  }, [value]);

  useEffect(() => {
    const token = getCurrentToken();
    if (token.length >= 1) {
      PersonService.search(token).then(setSuggestions).catch(() => setSuggestions([]));
    } else {
      setSuggestions([]);
    }
  }, [getCurrentToken]);

  const handleSelect = (name: string) => {
    const parts = value.split(',').map(s => s.trim()).filter(Boolean);
    parts[parts.length - 1] = name;
    onChange(parts.join(', ') + ', ');
    setSuggestions([]);
  };

  return (
    <View style={{ marginTop: -spacing.sm, marginBottom: spacing.sm }}>
      <TextInput
        style={[s.modalInput, { minHeight: 40, paddingVertical: 8, marginBottom: 0 }]}
        value={value}
        onChangeText={onChange}
        placeholder="Who was there? e.g. Jake, Mom"
        placeholderTextColor={colors.textMuted}
      />
      {suggestions.length > 0 && (
        <View style={{ backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, maxHeight: 120 }}>
          {suggestions.slice(0, 4).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}
              onPress={() => handleSelect(p.name)}
            >
              <Text style={{ fontSize: 13, color: colors.textPrimary }}>{p.name}{p.nickname ? ` (${p.nickname})` : ''}</Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>{p.interactionCount} interactions</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

interface ActivityFormProps {
  onActivitySubmit: (data: {
    logName: string; activityType: string; duration_min?: number; loggedAt?: string;
    location?: string; intensity?: string; outdoors?: boolean;
    photos?: string[]; engagement?: number; energy?: number;
    aeiou?: Record<string, string>;
  }) => void;
  loggedAt: Date;
  onClose: () => void;
  isFuture: boolean;
}

export function ActivityForm({ onActivitySubmit, loggedAt, onClose, isFuture }: ActivityFormProps) {
  const [activityTypes, setActivityTypes] = useState<ActivityTypeModel[]>([]);
  const [actName, setActName] = useState('');
  const [actType, setActType] = useState('other');

  useEffect(() => {
    ActivityTypeService.getAll().then(all =>
      setActivityTypes(all.filter(t => t.showInManualLog))
    );
  }, []);
  const [actLocation, setActLocation] = useState('');
  const [actPhotos, setActPhotos] = useState<string[]>([]);
  const [actEngagement, setActEngagement] = useState<number | null>(null);
  const [actEnergy, setActEnergy] = useState<number | null>(null);
  const [actAeiou, setActAeiou] = useState<Record<string, string>>({});
  const [actCoveragePct, setActCoveragePct] = useState<number | null>(null);
  const [actSunscreen, setActSunscreen] = useState(false);
  const [actSubmitting, setActSubmitting] = useState(false);

  const handleActivitySubmit = async () => {
    if (!actName.trim()) return;
    setActSubmitting(true);
    try {
      await onActivitySubmit({
        logName: actName.trim(),
        activityType: actType,
        loggedAt: loggedAt.toISOString(),
        location: actLocation.trim() || undefined,
        outdoors: actAeiou.E === 'Outdoor' || actAeiou.E === 'Nature' || undefined,
        coverage_pct: actCoveragePct ?? undefined,
        sunscreen: actSunscreen,
        photos: actPhotos.length > 0 ? actPhotos : undefined,
        engagement: actEngagement ?? undefined,
        energy: actEnergy ?? undefined,
        aeiou: Object.keys(actAeiou).length > 0 ? actAeiou : undefined,
      } as any);
      onClose();
    } finally {
      setActSubmitting(false);
    }
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
            onPress={() => setActType(t.key)}
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
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 }}>How did it feel?</Text>

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Engagement (1-10)</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            {[1,2,3,4,5,6,7,8,9,10].map((n) => (
              <TouchableOpacity
                key={n}
                style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }, actEngagement === n && { backgroundColor: colors.textPrimary }]}
                onPress={() => setActEngagement(actEngagement === n ? null : n)}
                activeOpacity={0.6}
              >
                <Text style={[{ fontSize: 8, fontWeight: '600', color: colors.textMuted }, actEngagement === n && { color: colors.bg }]}>{n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Lo</Text>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Flow</Text>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Hi</Text>
          </View>

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Energy after (-5 to +5)</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
            {[-5,-4,-3,-2,-1,0,1,2,3,4,5].map((n) => (
              <TouchableOpacity
                key={n}
                style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }, actEnergy === n && { backgroundColor: colors.textPrimary }]}
                onPress={() => setActEnergy(actEnergy === n ? null : n)}
                activeOpacity={0.6}
              >
                <Text style={[{ fontSize: 8, fontWeight: '600', color: colors.textMuted }, actEnergy === n && { color: colors.bg }]}>{n > 0 ? `+${n}` : n}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Drained</Text>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>0</Text>
            <Text style={{ fontSize: 8, color: colors.textMuted }}>Energized</Text>
          </View>

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Environment</Text>
          <PillRow
            pills={['Indoor', 'Outdoor', 'Nature', 'Urban', 'Home', 'Office'].map(v => ({ key: v, label: v }))}
            value={actAeiou.E || ''}
            onChange={(v: string) => setActAeiou(prev => ({ ...prev, E: prev.E === v ? '' : v }))}
          />

          {(actType === 'sun' || ((actAeiou.E === 'Outdoor' || actAeiou.E === 'Nature') && actType !== 'sleep')) && (
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

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Interactions</Text>
          <PillRow
            pills={['Solo', '1-2 people', 'Small group', 'Large group'].map(v => ({ key: v, label: v }))}
            value={actAeiou.I || ''}
            onChange={(v: string) => setActAeiou(prev => ({ ...prev, I: prev.I === v ? '' : v }))}
          />
          {actAeiou.I && actAeiou.I !== 'Solo' && (
            <PeopleAutocomplete
              value={actAeiou.users || ''}
              onChange={(t) => setActAeiou(prev => ({ ...prev, users: t }))}
            />
          )}

          <Text style={{ fontSize: 10, color: colors.textMuted, marginBottom: 4 }}>Objects</Text>
          <PillRow
            pills={['Screen', 'Physical', 'Nature', 'Mixed'].map(v => ({ key: v, label: v }))}
            value={actAeiou.O || ''}
            onChange={(v: string) => setActAeiou(prev => ({ ...prev, O: prev.O === v ? '' : v }))}
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
