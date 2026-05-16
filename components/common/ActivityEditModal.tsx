/**
 * ActivityEditModal -- Edit activity details + reflection.
 * Editable: title, time, duration, engagement, energy,
 *           life categories (work/health/play/love), location, AEIOU.
 *
 * For pendant/location-anchored logs, shows:
 *  - Timeline row (tappable, opens LocationTimelineModal)
 *  - Auto-aggregated AEIOU from child observations
 *  - Duration-based Life Design weights
 *  - Trail map for movement sessions
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity,
  TextInput, StyleSheet, ScrollView, Alert, Image
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { ActivityEntry } from '../../lib/services/activityApi';
import ImpactLedgerView from '../today/ImpactLedgerView';
import ActivityTimeInputs from './ActivityTimeInputs';
import ActivityContextToggles from './ActivityContextToggles';
import UsersEvidenceModal from './UsersEvidenceModal';
import { TimelineRow, LocationField, LocationTimeline } from './LocationEditSection';
import LocationLogModal from '../places/LocationLogModal';
import { activityEditStyles as s } from './activityEditStyles';
import { ActivityTypeService } from '../../lib/services/activityTypeService';
import { getChildActivitiesForSession } from '../../lib/services/location/locationBlockTitle';
import { calculateLocationLifeDesign, generateActivityNarrative, aggregateAEIOU } from '../../lib/services/location/locationLifeDesign';
import { getTodayCaptures } from '../../lib/services/pendant/pendantStore';
import { getDb } from '../../lib/database';

interface Props {
  visible: boolean;
  activity: ActivityEntry | null;
  onClose: () => void;
  onSave: (id: number, data: any) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}

const ACT_ICONS: Record<string, string> = {
  work: 'monitor', workout: 'zap', bike: 'navigation', run: 'trending-up',
  walk: 'map-pin', sun: 'sun', social: 'users', rest: 'moon',
  stress: 'alert-circle', soul: 'heart', commute: 'truck', cooking: 'coffee', other: 'circle',
};

const LIFE_CATS = ['work', 'health', 'play', 'love'] as const;
const LIFE_ICONS: Record<string, string> = {
  work: 'monitor', health: 'activity', play: 'music', love: 'heart',
};

const AEIOU_LABELS: Record<string, string> = {
  activity: 'Activity', environment: 'Environment',
  interactions: 'Interactions', objects: 'Objects', users: 'Users',
};
const AEIOU_HINTS: Record<string, string> = {
  activity: 'What were you doing? Structured or free-form? What role did you play?',
  environment: 'Where were you? How did the setting make you feel?',
  interactions: 'Who or what did you interact with? Formal or casual?',
  objects: 'What devices, tools, or items were you using?',
  users: 'Who else was there? Did they add to or take from the experience?',
};
const AEIOU_KEYS = Object.keys(AEIOU_LABELS);

const COVERAGE_PRESETS = [
  { value: 10, label: 'Face' },
  { value: 25, label: '+Arms' },
  { value: 50, label: '+Legs' },
  { value: 75, label: 'Swim' },
  { value: 90, label: 'Full' },
];

export default function ActivityEditModal({ visible, activity, onClose, onSave, onDelete }: Props) {
  const [logName, setLogName] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [engagement, setEngagement] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [loggedAt, setLoggedAt] = useState<Date>(new Date());
  const [saving, setSaving] = useState(false);
  const [isOutdoors, setIsOutdoors] = useState(false);
  const [isNature, setIsNature] = useState(false);
  const [showUsersEvidence, setShowUsersEvidence] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showMap, setShowMap] = useState(false);

  // Location session data for pendant/location-anchored logs
  const locationSession = activity?.meta?.locationSession || null;
  const isLocationAnchored = !!locationSession;

  // Count observations for the timeline row
  const observationCount = useMemo(() => {
    if (!locationSession) return 0;
    try {
      const startMs = new Date(locationSession.startedAt).getTime();
      const endMs = locationSession.endedAt ? new Date(locationSession.endedAt).getTime() : Date.now();
      const captures = getTodayCaptures().filter(c => c.timestamp >= startMs && c.timestamp <= endMs);
      return captures.length;
    } catch { return 0; }
  }, [locationSession]);

  // Movement context
  const [isMovement, setIsMovement] = useState(false);
  const [metValue, setMetValue] = useState<number | null>(null);

  // Sun exposure
  const [coveragePct, setCoveragePct] = useState(50);
  const [hasSunscreen, setHasSunscreen] = useState(false);

  // Life categories weights (0-10 scale, normalized to 0-1 on save)
  const [lifeCats, setLifeCats] = useState<Record<string, number>>({});

  // AEIOU fields
  const [aeiou, setAeiou] = useState<Record<string, string>>({});

  useEffect(() => {
    if (activity) {
      setLogName(activity.logName || '');
      setDurationMin(String(activity.duration_min || ''));
      setEngagement(activity.engagement ?? null);
      setEnergy(activity.energy ?? null);
      setLocation(activity.location || '');
      setLoggedAt(new Date(activity.loggedAt));
      setIsOutdoors(activity.outdoors || false);
      setIsNature(activity.isNature || false);

      // For location-anchored logs, auto-populate from child observations
      const session = activity.meta?.locationSession;
      if (session) {
        const children = getChildActivitiesForSession(session);
        // Life Design from durations
        const durationCats = calculateLocationLifeDesign(children);
        const cats: Record<string, number> = {};
        for (const [k, v] of Object.entries(durationCats)) {
          cats[k] = Math.round(v * 10);
        }
        setLifeCats(cats);

        // AEIOU: aggregate from child observations
        const childAeious = getChildAEIOUs(session);
        const merged = aggregateAEIOU(childAeious);
        // Auto-populate Activity field with narrative
        const narrative = generateActivityNarrative(children);
        if (narrative) merged.activity = narrative;
        setAeiou(merged);
      } else {
        // Standard activity: use stored values
        const cats: Record<string, number> = {};
        if (activity.lifeCategories) {
          for (const [k, v] of Object.entries(activity.lifeCategories)) {
            cats[k] = Math.round((v as number) * 10);
          }
        }
        setLifeCats(cats);
        setAeiou(activity.aeiou ? { ...activity.aeiou } : {});
      }

      // Sun exposure
      setCoveragePct(activity.meta?.coverage_pct ?? 50);
      setHasSunscreen(activity.meta?.sunscreen ?? false);

      // Movement + Brain Hygiene from activity type metadata
      setMetValue(activity.mets ?? null);
      loadActivityTypeMeta(activity.activityType);
    }
  }, [activity]);

  const loadActivityTypeMeta = async (typeKey: string) => {
    try {
      const typeDef = await ActivityTypeService.getByKey(typeKey);
      if (!typeDef) return;
      const subs = typeDef.subCategories || [];
      setIsMovement(subs.includes('movement'));
      if (metValue == null && typeDef.defaultMets) {
        setMetValue(typeDef.defaultMets);
      }
    } catch { /* type not found, use defaults */ }
  };

  if (!activity) return null;

  const iconName = ACT_ICONS[activity.activityType] || 'circle';
  const showSunSection = activity.activityType === 'sun' || isOutdoors;

  const handleSave = async () => {
    setSaving(true);
    try {
      const totalWeight = Object.values(lifeCats).reduce((sum, v) => sum + v, 0);
      const normalizedCats: Record<string, number> = {};
      if (totalWeight > 0) {
        for (const [k, v] of Object.entries(lifeCats)) {
          if (v > 0) normalizedCats[k] = Math.round((v / totalWeight) * 100) / 100;
        }
      }

      await onSave(activity.id, {
        activityType: activity.activityType || 'other',
        logName: logName.trim() || activity.logName,
        duration_min: parseInt(durationMin, 10) || activity.duration_min,
        engagement,
        energy,
        location: location.trim() || undefined,
        loggedAt: loggedAt.toISOString(),
        outdoors: isOutdoors,
        isNature: isNature,
        aeiou: Object.keys(aeiou).length > 0 ? aeiou : undefined,
        lifeCategories: Object.keys(normalizedCats).length > 0 ? normalizedCats : undefined,
        ...(showSunSection ? { coverage_pct: coveragePct, sunscreen: hasSunscreen } : {}),
        ...(isMovement && metValue != null ? { mets: metValue } : {}),
      });
      onClose();
    } catch {
      // handled upstream
    }
    setSaving(false);
  };

  const handleDelete = () => {
    Alert.alert('Delete Activity', `Remove "${activity.logName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (onDelete) {
          await onDelete(activity.id);
          onClose();
        }
      }},
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {/* Header */}
            <View style={s.header}>
              <Feather name={iconName as any} size={18} color={colors.textPrimary} />
              <Text style={s.headerTitle}>{activity.activityType}</Text>
              <TouchableOpacity onPress={onClose} activeOpacity={0.6}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Title */}
            <Text style={s.label}>Title</Text>
            <TextInput
              style={[s.input, { marginBottom: spacing.md }]}
              value={logName}
              onChangeText={setLogName}
              placeholder="Activity name"
              placeholderTextColor={colors.textMuted}
            />

            {/* Start / Duration / End */}
            <ActivityTimeInputs
              loggedAt={loggedAt}
              setLoggedAt={setLoggedAt}
              durationMin={durationMin}
              setDurationMin={setDurationMin}
            />

            {/* Visual Evidence */}
            {activity?.image && activity.image.length > 0 && (
              <View style={{ marginBottom: spacing.md }}>
                <Text style={s.label}>Visual Evidence</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row', gap: 8 }}>
                  {activity.image.map((img: any, i: number) => (
                    <Image
                      key={img.id || i}
                      source={{ uri: img.url.startsWith('/') ? `file://${img.url}` : img.url }}
                      style={{ width: 120, height: 120, borderRadius: radius.md, marginRight: spacing.sm, backgroundColor: '#111' }}
                    />
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Timeline row -- pendant/location-anchored logs only */}
            {isLocationAnchored && (
              <TimelineRow
                observationCount={observationCount}
                onPress={() => setShowTimeline(true)}
              />
            )}

            {/* Context toggles row: Outdoors, Nature, Movement */}
            <View style={s.contextToggleRow}>
              <TouchableOpacity
                style={[s.sunscreenToggle, isOutdoors && s.sunscreenToggleActive]}
                onPress={() => setIsOutdoors(!isOutdoors)}
                activeOpacity={0.6}
              >
                <Text style={[s.sunscreenToggleText, isOutdoors && s.sunscreenToggleTextActive]}>
                  <Feather name="sun" size={11} /> Outdoors
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sunscreenToggle, isNature && s.sunscreenToggleActive]}
                onPress={() => setIsNature(!isNature)}
                activeOpacity={0.6}
              >
                <Text style={[s.sunscreenToggleText, isNature && s.sunscreenToggleTextActive]}>
                  <Feather name="cloud" size={11} /> Nature
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sunscreenToggle, isMovement && s.sunscreenToggleActive]}
                onPress={() => setIsMovement(!isMovement)}
                activeOpacity={0.6}
              >
                <Text style={[s.sunscreenToggleText, isMovement && s.sunscreenToggleTextActive]}>
                  <Feather name="activity" size={11} /> Movement
                </Text>
              </TouchableOpacity>
            </View>

            {/* Movement expanded: MET value */}
            <ActivityContextToggles
              isMovement={isMovement}
              setIsMovement={setIsMovement}
              metValue={metValue}
              setMetValue={setMetValue}
              durationMin={durationMin}
            />

            {/* Sun Exposure -- coverage & sunscreen (only for sun/outdoor) */}
            {showSunSection && (
              <View style={s.sunSection}>
                <Text style={s.label}>Skin Exposed</Text>
                <View style={s.coverageRow}>
                  {COVERAGE_PRESETS.map(({ value, label }) => (
                    <TouchableOpacity
                      key={value}
                      style={[s.coverageChip, coveragePct === value && s.coverageChipActive]}
                      onPress={() => setCoveragePct(value)}
                      activeOpacity={0.6}
                    >
                      <Text style={[s.coverageChipPct, coveragePct === value && s.coverageChipPctActive]}>{value}%</Text>
                      <Text style={[s.coverageChipLabel, coveragePct === value && s.coverageChipLabelActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={s.sunscreenRow}>
                  <Text style={s.sunscreenLabel}>Sunscreen?</Text>
                  <TouchableOpacity
                    style={[s.sunscreenToggle, hasSunscreen && s.sunscreenToggleActive]}
                    onPress={() => setHasSunscreen(!hasSunscreen)}
                    activeOpacity={0.6}
                  >
                    <Text style={[s.sunscreenToggleText, hasSunscreen && s.sunscreenToggleTextActive]}>
                      {hasSunscreen ? 'Yes' : 'No'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {activity?.nutrientImpact?.vitamin_d != null && (
                  <Text style={s.vitDNote}>
                    Vitamin D produced: ~{Math.round(activity.nutrientImpact.vitamin_d)} mcg
                    {activity.meta?.uvIndex != null && ` (Local UV Index: ${activity.meta.uvIndex})`}
                    {activity.meta?.reasoning ? `\n(${activity.meta.reasoning})` : ''}
                  </Text>
                )}
              </View>
            )}

            {/* Engagement */}
            <Text style={s.label}>Engagement (1-10)</Text>
            <View style={s.scaleRow}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[s.scaleDot, engagement === v && s.scaleDotActive]}
                  onPress={() => setEngagement(v)}
                  activeOpacity={0.6}
                >
                  <Text style={[s.scaleDotText, engagement === v && s.scaleDotTextActive]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.scaleLabels}>
              <Text style={s.scaleLabel}>Lo</Text>
              <Text style={s.scaleLabel}>Flow</Text>
              <Text style={s.scaleLabel}>Hi</Text>
            </View>

            {/* Energy */}
            <Text style={s.label}>Energy (-5 to +5)</Text>
            <View style={s.scaleRow}>
              {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[s.scaleDot, energy === v && s.scaleDotActive]}
                  onPress={() => setEnergy(v)}
                  activeOpacity={0.6}
                >
                  <Text style={[s.scaleDotText, energy === v && s.scaleDotTextActive]}>
                    {v > 0 ? `+${v}` : v}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.scaleLabels}>
              <Text style={s.scaleLabel}>Drained</Text>
              <Text style={s.scaleLabel}>0</Text>
              <Text style={s.scaleLabel}>Energized</Text>
            </View>

            {/* Life Categories */}
            <Text style={s.label}>Life Design</Text>
            <View style={s.lifeCatContainer}>
              {LIFE_CATS.map((cat) => {
                const val = lifeCats[cat] || 0;
                return (
                  <View key={cat} style={s.lifeCatRow}>
                    <Feather name={LIFE_ICONS[cat] as any} size={14} color={colors.textSecondary} />
                    <Text style={s.lifeCatLabel}>{cat}</Text>
                    <View style={s.lifeCatBar}>
                      {[0, 2, 4, 6, 8, 10].map((v) => (
                        <TouchableOpacity
                          key={v}
                          style={[s.lifeCatDot, val >= v && v > 0 && s.lifeCatDotActive]}
                          onPress={() => {
                            setLifeCats(prev => ({ ...prev, [cat]: v === prev[cat] ? 0 : v }));
                          }}
                          activeOpacity={0.6}
                        >
                          <Text style={[s.lifeCatDotText, val >= v && v > 0 && s.lifeCatDotTextActive]}>
                            {v === 0 ? '-' : v / 2}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Location -- trail map for movement sessions, text input for stationary */}
            <Text style={s.label}>Location</Text>
            {isLocationAnchored ? (
              <LocationField
                locationSession={locationSession}
                location={location}
                setLocation={setLocation}
                onPressMap={() => setShowMap(true)}
              />
            ) : (
              <TextInput
                style={s.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Where did this happen?"
                placeholderTextColor={colors.textMuted}
              />
            )}

            {/* AEIOU -- editable with descriptive hints */}
            <Text style={s.label}>AEIOU Reflection</Text>
            {AEIOU_KEYS.map((key) => (
              <View key={key} style={s.aeiouRow}>
                <Text style={s.aeiouKey}>{key.charAt(0).toUpperCase()}</Text>
                <View style={s.aeiouInputWrap}>
                  <Text style={s.aeiouLabel}>{AEIOU_LABELS[key]}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <TextInput
                      style={[s.aeiouInput, { flex: 1, minHeight: 56, textAlignVertical: 'top' }]}
                      value={aeiou[key] || ''}
                      onChangeText={(text) => setAeiou(prev => ({ ...prev, [key]: text }))}
                      placeholder={AEIOU_HINTS[key]}
                      placeholderTextColor={colors.textMuted}
                      multiline
                      numberOfLines={3}
                    />
                    {key === 'users' && activity?.meta?.detectedPeopleDetails && (
                      <TouchableOpacity onPress={() => setShowUsersEvidence(true)} style={{ padding: 8, paddingRight: 0 }}>
                        <Feather name="chevron-right" size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))}

            {/* Reflect with Mittens */}
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: colors.bg, borderRadius: radius.md,
                paddingVertical: 10, marginTop: spacing.md,
                borderWidth: 1, borderColor: colors.border,
              }}
              onPress={() => {
                const router = require('expo-router').router;
                onClose();
                setTimeout(() => {
                  router.push({ pathname: '/(tabs)/chat', params: { prompt: `Let's reflect on my ${logName || 'activity'}` } });
                }, 300);
              }}
              activeOpacity={0.7}
            >
              <Feather name="message-circle" size={16} color={colors.textPrimary} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>Reflect with Mittens</Text>
            </TouchableOpacity>

            {/* Impact Ledger */}
            <ImpactLedgerView
              ledger={activity?.impactLedger}
              activityName={logName}
            />

            {/* Failure Logs Insight */}
            {activity?.failure_logs && activity.failure_logs.length > 0 && (
              <View style={{ marginTop: spacing.md, padding: spacing.sm, backgroundColor: '#FFF0F0', borderRadius: radius.md, borderWidth: 1, borderColor: '#FFCDD2' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#D32F2F', marginBottom: spacing.xs }}>
                  <Feather name="target" size={12} /> FAILURE INSIGHTS
                </Text>
                {activity.failure_logs.map((f: any) => (
                  <View key={f.id} style={{ marginTop: 4 }}>
                    <Text style={{ fontSize: 13, color: '#D32F2F', fontWeight: '600' }}>
                      {f.category === 'screwup' ? 'Screwup' : f.category === 'weakness' ? 'Weakness' : 'Opportunity'}: {f.failure}
                    </Text>
                    {f.insight && (
                      <Text style={{ fontSize: 12, color: '#D32F2F', fontStyle: 'italic', marginTop: 2 }}>{f.insight}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Sticky Actions */}
          <View style={s.stickyActions}>
            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={s.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>

            {onDelete && (
              <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} activeOpacity={0.6}>
                <Feather name="trash-2" size={14} color={colors.textMuted} />
                <Text style={s.deleteBtnText}>Delete Activity</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <UsersEvidenceModal
        visible={showUsersEvidence}
        onClose={() => setShowUsersEvidence(false)}
        detectedPeopleDetails={activity?.meta?.detectedPeopleDetails || []}
      />

      <LocationTimeline
        visible={showTimeline}
        session={locationSession}
        title={logName || 'Location Timeline'}
        onClose={() => setShowTimeline(false)}
      />

      <LocationLogModal
        visible={showMap}
        session={locationSession}
        onClose={() => setShowMap(false)}
      />
    </Modal>
  );
}

/** Query child AEIOU records with durations from activity_logs for aggregation. */
function getChildAEIOUs(
  session: { startedAt: string; endedAt: string | null },
): Array<{ aeiou: Record<string, string> | null; duration_min: number }> {
  try {
    const db = getDb();
    const startIso = new Date(session.startedAt).toISOString();
    const endIso = session.endedAt
      ? new Date(session.endedAt).toISOString()
      : new Date().toISOString();
    const rows = db.getAllSync(
      `SELECT aeiou, duration_min FROM activity_logs
       WHERE source IN ('pendant', 'trail')
         AND logged_at >= ? AND logged_at <= ?
         AND aeiou IS NOT NULL`,
      [startIso, endIso],
    ) as any[];
    return rows.map(r => ({
      aeiou: JSON.parse(r.aeiou),
      duration_min: r.duration_min || 0,
    }));
  } catch {
    return [];
  }
}

