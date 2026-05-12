import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, RefreshControl, ActivityIndicator,
  TextInput, TouchableOpacity, Alert, Switch,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getWeeklySummary, getProfile, updateProfile, dislikeFood } from '../../lib/api';
import { getUserDisplayName } from '../../lib/userContext';
import { WeeklySummary } from '../../lib/types';
import { colors, radius, spacing } from '../../lib/theme';
import { Feather } from '@expo/vector-icons';
import { PendantSection } from '../../components/pendant/PendantSection';

import { ProfileBioSection } from '../../components/profile/ProfileBioSection';
import { MittensBrainSection } from '../../components/profile/MittensBrainSection';
import { ProfileConnectionsSection } from '../../components/profile/ProfileConnectionsSection';
import { ActivityTypeEditor } from '../../components/profile/ActivityTypeEditor';
import { PeopleSection } from '../../components/profile/PeopleSection';
import { profileStyles as styles } from '../../components/profile/profileStyles';
import { VoicePickerSection } from '../../components/profile/VoicePickerSection';
import SyncProgressOverlay from '../../components/reflect/SyncProgressOverlay';
import { syncLocalToCloud, SyncProgress } from '../../lib/services/syncEngine';

export default function ProfileScreen() {
  const router = useRouter();
  const [data, setData] = useState<WeeklySummary | null>(null);
  const [profileContext, setProfileContext] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [preferences, setPreferences] = useState('');
  const [dislikedFoods, setDislikedFoods] = useState<Array<{ food: string; reason?: string | null }>>([]);
  const [memory, setMemory] = useState<Record<string, string[]>>({});
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Section collapse state -- all collapsed by default
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    mittens: true, health: true, lifeDesign: true, connections: true, settings: true,
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    bio: true, pendant: true, brain: true, voice: true, memory: true, odyssey: true, team: true, activities: true, integrations: true, notifications: true,
  });

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSyncRequired = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncProgress(null);
    try {
      const result = await syncLocalToCloud((progress) => {
        setSyncProgress(progress);
      });
      if (!result.success && result.errors.length > 0) {
        setSyncError(result.errors[0]);
      }
      // Wait a moment so user sees "100% Done" before closing
      await new Promise(r => setTimeout(r, 1500));
      fetchData();
    } catch (e: any) {
      setSyncError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Notification toggle state
  const [bedtimeNotif, setBedtimeNotif] = useState(true);
  const [departureNotif, setDepartureNotif] = useState(true);
  const [proactiveNotif, setProactiveNotif] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [result, profResult] = await Promise.all([
        getWeeklySummary(),
        getProfile().catch(() => null)
      ]);
      setData(result);
      setProfileContext(profResult);
      if (profResult && typeof profResult.dietaryPreferences === 'string') {
        setPreferences(profResult.dietaryPreferences);
      }
      if (profResult && profResult.memory && typeof profResult.memory === 'object') {
        setMemory(profResult.memory);
      }
      if (profResult && Array.isArray(profResult.dislikedFoods)) {
        setDislikedFoods(profResult.dislikedFoods.map((f: any) =>
          typeof f === 'string' ? { food: f, reason: null } : f
        ));
      }
      if (profResult) {
        setBedtimeNotif(profResult.bedtimeEnabled !== false);
        setDepartureNotif(profResult.departureAlarmsEnabled !== false);
        setProactiveNotif(profResult.proactiveCheckins !== false);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchData();
    }, [fetchData])
  );

  if (loading && !data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const handleSavePrefs = async () => {
    setSavingPrefs(true);
    try {
      await updateProfile({ dietaryPreferences: preferences });
      Alert.alert('Saved', 'Memory updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingPrefs(false);
    }
  };

  const toggleSection = (key: string) => setCollapsed(p => ({ ...p, [key]: !p[key] }));
  const toggleGroup = (key: string) => setCollapsedGroups(p => ({ ...p, [key]: !p[key] }));

  return (
    <View style={styles.fullContainer}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.accent} />
        }
      >
        {/* Header */}
        <Text style={styles.greeting}>{profileContext?.name || 'Your'}'s Profile</Text>
        <Text style={styles.date}>Life design tools and identity</Text>

        
        {/* ─── TOP LEVEL CARDS ─── */}
        <ProfileBioSection
          profileContext={profileContext}
          collapsed={collapsed.bio}
          onToggle={() => toggleSection('bio')}
          onSaved={fetchData}
        />
        <ActivityTypeEditor
          collapsed={collapsed.activities}
          onToggle={() => toggleSection('activities')}
        />
        <PendantSection
          collapsed={collapsed.pendant}
          onToggle={() => toggleSection('pendant')}
          onOpenFeed={() => router.push('/pendant-feed')}
        />

        {/* ─── GROUP 1: MITTENS ─── */}
        <View style={styles.section}>
          <TouchableOpacity style={[styles.sectionHeader, !collapsedGroups.mittens && { marginBottom: 16 }]} onPress={() => toggleGroup('mittens')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="cpu" size={16} color={colors.textPrimary} />
              <Text style={styles.sectionTitle}>MITTENS</Text>
            </View>
            <Feather name={collapsedGroups.mittens ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
          
          {!collapsedGroups.mittens && (
            <View style={{ marginTop: 12 }}>
              <MittensBrainSection
                profileContext={profileContext}
                collapsed={collapsed.brain}
                onToggle={() => toggleSection('brain')}
              />

              <VoicePickerSection
                collapsed={collapsed.voice}
                onToggle={() => toggleSection('voice')}
              />

              

              {/* Memory */}
              <View style={styles.card}>
                <TouchableOpacity style={[styles.sectionHeader, !collapsed.memory && { marginBottom: 16 }]} onPress={() => toggleSection('memory')} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="book-open" size={16} color={colors.textPrimary} />
                    <Text style={styles.cardTitle}>MEMORY</Text>
                  </View>
                  <Feather name={collapsed.memory ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
                </TouchableOpacity>

                {!collapsed.memory && (
                  <>
                    <Text style={styles.cardBody}>
                      Things Mittens remembers about you. Auto-saved from conversations.
                    </Text>

                    {Object.entries(memory).filter(([, notes]) => Array.isArray(notes) && notes.length > 0).map(([cat, notes]) => (
                      <View key={cat} style={{ marginBottom: 16 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 6, textTransform: 'uppercase' }}>{cat}</Text>
                        {(notes as string[]).map((note, idx) => (
                          <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                            <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary }}>- {note}</Text>
                            <TouchableOpacity
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              onPress={async () => {
                                try {
                                  const updated = { ...memory };
                                  updated[cat] = (updated[cat] || []).filter((_, i) => i !== idx);
                                  if (updated[cat].length === 0) delete updated[cat];
                                  await updateProfile({ memory: updated });
                                  setMemory(updated);
                                } catch { /* ignore */ }
                              }}
                            >
                              <Text style={{ fontSize: 12, color: '#D32F2F', fontWeight: '700' }}>x</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    ))}

                    {Object.keys(memory).length === 0 && (
                      <Text style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: 8 }}>
                        No memories yet. Chat with Mittens and share your habits -- Mittens will remember.
                      </Text>
                    )}

                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginTop: 8, marginBottom: 6 }}>MANUAL NOTES</Text>
                    <TextInput
                      style={{ backgroundColor: '#F8F9FA', borderRadius: 8, padding: 12, fontSize: 14, color: colors.textPrimary, minHeight: 80, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, marginBottom: 16 }}
                      value={preferences}
                      onChangeText={setPreferences}
                      placeholder="Type your notes here..."
                      placeholderTextColor={colors.textMuted}
                      multiline
                    />

                    {dislikedFoods.length > 0 && (
                      <View style={{ marginBottom: 16 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 6 }}>DISLIKED FOODS</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                          {dislikedFoods.map((item, idx) => (
                            <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FFCDD2', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
                              <Text style={{ fontSize: 13, color: colors.textPrimary, marginRight: 6, textTransform: 'capitalize' }}>
                                {item.food}{item.reason ? ` -- ${item.reason}` : ''}
                              </Text>
                              <TouchableOpacity
                                onPress={() => {
                                  Alert.alert(
                                    `Like ${item.food} again?`,
                                    'This will show it in recommendations.',
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: 'Restore',
                                        onPress: async () => {
                                          try {
                                            const result = await dislikeFood(item.food);
                                            setDislikedFoods(result.dislikedFoods.map((f: any) =>
                                              typeof f === 'string' ? { food: f, reason: null } : f
                                            ));
                                          } catch { /* ignore */ }
                                        },
                                      },
                                    ]
                                  );
                                }}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Text style={{ fontSize: 12, color: '#D32F2F', fontWeight: '700' }}>x</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    <TouchableOpacity style={{ backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 }} onPress={handleSavePrefs} disabled={savingPrefs}>
                      {savingPrefs ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 14 }}>Save</Text>}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          )}
        </View>



        {/* ─── GROUP 3: LIFE DESIGN ─── */}
        <View style={styles.section}>
          <TouchableOpacity style={[styles.sectionHeader, !collapsedGroups.lifeDesign && { marginBottom: 16 }]} onPress={() => toggleGroup('lifeDesign')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="compass" size={16} color={colors.textPrimary} />
              <Text style={styles.sectionTitle}>LIFE DESIGN</Text>
            </View>
            <Feather name={collapsedGroups.lifeDesign ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {!collapsedGroups.lifeDesign && (
            <View style={{ marginTop: 12 }}>
              {/* Odyssey Plan */}
              <View style={styles.card}>
                <TouchableOpacity style={[styles.sectionHeader, !collapsed.odyssey && { marginBottom: 16 }]} onPress={() => toggleSection('odyssey')} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="map" size={16} color={colors.textPrimary} />
                    <Text style={styles.cardTitle}>ODYSSEY PLAN</Text>
                  </View>
                  <Feather name={collapsed.odyssey ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
                </TouchableOpacity>
                {!collapsed.odyssey && (
                  <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12, padding: 16, alignItems: 'center' }}>
                    <Feather name="map" size={24} color={colors.textMuted} />
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: 8 }}>3 Alternative Life Plans</Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 18 }}>
                      Design 3 versions of your next 5 years. Rate each on Resources, Excitement, Confidence, and Coherence. Coming soon.
                    </Text>
                  </View>
                )}
              </View>

              <PeopleSection
                collapsed={collapsed.team}
                onToggle={() => toggleSection('team')}
              />
            </View>
          )}
        </View>

        {/* ─── GROUP 4: CONNECTIONS ─── */}
        <View style={styles.section}>
          <TouchableOpacity style={[styles.sectionHeader, !collapsedGroups.connections && { marginBottom: 16 }]} onPress={() => toggleGroup('connections')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="link" size={16} color={colors.textPrimary} />
              <Text style={styles.sectionTitle}>CONNECTIONS</Text>
            </View>
            <Feather name={collapsedGroups.connections ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {!collapsedGroups.connections && (
            <View style={{ marginTop: 12 }}>
              <ProfileConnectionsSection
                profileContext={profileContext}
                onRefresh={fetchData}
              />
            </View>
          )}
        </View>

        {/* ─── GROUP 5: SETTINGS ─── */}
        <View style={styles.section}>
          <TouchableOpacity style={[styles.sectionHeader, !collapsedGroups.settings && { marginBottom: 16 }]} onPress={() => toggleGroup('settings')} activeOpacity={0.7}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Feather name="settings" size={16} color={colors.textPrimary} />
              <Text style={styles.sectionTitle}>SETTINGS</Text>
            </View>
            <Feather name={collapsedGroups.settings ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {!collapsedGroups.settings && (
            <View style={{ marginTop: 12 }}>
              {/* Notifications */}
              <View style={styles.card}>
                <TouchableOpacity style={[styles.sectionHeader, !collapsed.notifications && { marginBottom: 16 }]} onPress={() => toggleSection('notifications')} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="bell" size={16} color={colors.textPrimary} />
                    <Text style={styles.cardTitle}>NOTIFICATIONS</Text>
                  </View>
                  <Feather name={collapsed.notifications ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
                </TouchableOpacity>
                {!collapsed.notifications && (
                  <View style={{ gap: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Bedtime Reminder</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Wind-down and sleep reminders</Text>
                      </View>
                      <Switch
                        value={bedtimeNotif}
                        onValueChange={(val) => { setBedtimeNotif(val); updateProfile({ bedtimeEnabled: val }).catch(() => setBedtimeNotif(!val)); }}
                        trackColor={{ false: colors.border, true: colors.textPrimary }}
                        thumbColor="#FFF"
                      />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Proactive Check-ins</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Mittens asks about sleep and meals</Text>
                      </View>
                      <Switch
                        value={proactiveNotif}
                        onValueChange={(val) => { setProactiveNotif(val); updateProfile({ proactiveCheckins: val }).catch(() => setProactiveNotif(!val)); }}
                        trackColor={{ false: colors.border, true: colors.textPrimary }}
                        thumbColor="#FFF"
                      />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Departure Alarms</Text>
                        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 1 }}>Leave-by alerts for calendar events</Text>
                      </View>
                      <Switch
                        value={departureNotif}
                        onValueChange={(val) => { setDepartureNotif(val); updateProfile({ departureAlarmsEnabled: val }).catch(() => setDepartureNotif(!val)); }}
                        trackColor={{ false: colors.border, true: colors.textPrimary }}
                        thumbColor="#FFF"
                      />
                    </View>
                    {departureNotif && (
                      <View style={{ paddingHorizontal: 0, paddingVertical: 8, marginTop: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 8 }}>TRAVEL MODE (FOR ALARMS)</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {(['transit', 'bicycling', 'walking', 'driving'] as const).map(mode => (
                            <TouchableOpacity
                              key={mode}
                              style={[styles.actBtn, (profileContext?.travelMode || 'transit') === mode && styles.actBtnActive]}
                              onPress={() => updateProfile({ travelMode: mode }).then(fetchData)}
                            >
                              <Text style={[styles.actText, (profileContext?.travelMode || 'transit') === mode && styles.actTextActive]}>
                                {mode}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Dev Hub */}
              <View style={styles.card}>
                <TouchableOpacity style={styles.sectionHeader} onPress={() => router.push('/dev-hub')} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="terminal" size={16} color={colors.textPrimary} />
                    <Text style={styles.cardTitle}>DEV HUB</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Outreach Hub */}
              <View style={styles.card}>
                <TouchableOpacity style={styles.sectionHeader} onPress={() => router.push('/outreach-hub')} activeOpacity={0.7}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Feather name="users" size={16} color={colors.textPrimary} />
                    <Text style={styles.cardTitle}>OUTREACH HUB</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Sync progress overlay */}
      <SyncProgressOverlay
        visible={syncing}
        progress={syncProgress}
        error={syncError}
      />
    </View>
  );
}
