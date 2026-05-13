/**
 * LocationLogModal -- Shows map view for a location session.
 * Dot for stationary, trail polyline for moving.
 * Extracted from ActivityEditModal to keep files focused.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, Pressable, TouchableOpacity,
  StyleSheet, ScrollView, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { colors, radius, spacing } from '../../lib/theme';
import { LocationSession } from '../../lib/services/location/locationSessionApi';
import {
  KnownPlace,
  useAddKnownPlaceMutation,
  useDeleteKnownPlaceMutation,
  useGetKnownPlacesQuery,
  useUpdateKnownPlaceMutation,
} from '../../lib/services/location/knownPlaceApi';

interface Props {
  visible: boolean;
  session: LocationSession | null;
  existingActivity?: any;
  onClose: () => void;
  onConvertActivity?: (draft: any) => void;
  onViewActivity?: (act: any) => void;
}

const MOTION_LABELS: Record<string, string> = {
  stationary: 'Stationary', walking: 'Walking', running: 'Running', cycling: 'Biking',
  driving: 'Transit', unknown: 'Location',
};

const MOTION_ICONS: Record<string, string> = {
  stationary: 'map-pin', walking: 'navigation', running: 'trending-up', cycling: 'navigation',
  driving: 'truck', unknown: 'map-pin',
};

const MOTION_COLORS: Record<string, string> = {
  stationary: '#000', walking: '#757575', running: '#757575', cycling: '#757575',
  driving: '#757575', unknown: '#757575',
};

const PLACE_TYPES = ['home', 'work', 'gym', 'park', 'other'] as const;
type EditablePlaceType = typeof PLACE_TYPES[number];

export default function LocationLogModal({ visible, session, existingActivity, onClose, onConvertActivity, onViewActivity }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [newPlaceName, setNewPlaceName] = useState('');
  const [newPlaceType, setNewPlaceType] = useState<EditablePlaceType>('home');
  const [editPlaceName, setEditPlaceName] = useState('');
  const [editPlaceType, setEditPlaceType] = useState<EditablePlaceType>('other');
  const [duplicateWarning, setDuplicateWarning] = useState<{name: string, perform: () => void} | null>(null);
  const [addPlace, { isLoading: isAddingPlace }] = useAddKnownPlaceMutation();
  const [updatePlace, { isLoading: isUpdatingPlace }] = useUpdateKnownPlaceMutation();
  const [deletePlace, { isLoading: isDeletingPlace }] = useDeleteKnownPlaceMutation();
  const { data: places = [] } = useGetKnownPlacesQuery();

  useEffect(() => {
    if (!visible || !session) return;
    const path = session.path || [];
    const matchById = session.placeId ? places.find(p => p.id === session.placeId) : null;
    const matchByCoordinate = session.motionType === 'stationary' && path.length > 0
      ? places.find(p => Math.abs(p.latitude - path[0][0]) < 0.001 && Math.abs(p.longitude - path[0][1]) < 0.001)
      : null;
    const matchByName = session.placeName
      ? places.find(p => p.name.toLowerCase() === String(session.placeName).toLowerCase())
      : null;
    const place = matchById || matchByCoordinate || matchByName;
    if (!place) return;

    const editableType = PLACE_TYPES.includes(place.placeType as EditablePlaceType)
      ? place.placeType as EditablePlaceType
      : 'other';
    setEditPlaceType(editableType);
    setEditPlaceName(editableType === 'other' ? place.name : '');
  }, [visible, session, places]);

  if (!session) return null;

  const mt = session.motionType || 'unknown';
  const isStationary = mt === 'stationary';
  const path = session.path || [];
  const hasPath = path.length >= 2;

  let resolvedPlaceName = session.placeName;
  let knownPlace: KnownPlace | null = session.placeId ? places.find(p => p.id === session.placeId) || null : null;
  if (!knownPlace && isStationary && path.length > 0) {
    const threshold = 0.001;
    knownPlace = places.find(p => Math.abs(p.latitude - path[0][0]) < threshold && Math.abs(p.longitude - path[0][1]) < threshold) || null;
  }
  if (!knownPlace && session.placeName) {
    knownPlace = places.find(p => p.name.toLowerCase() === String(session.placeName).toLowerCase()) || null;
  }
  if (knownPlace) {
    resolvedPlaceName = knownPlace.name;
  } else if (isStationary && path.length > 0) {
    const threshold = 0.001;
    const coordinateMatch = places.find(p => Math.abs(p.latitude - path[0][0]) < threshold && Math.abs(p.longitude - path[0][1]) < threshold);
    if (coordinateMatch) resolvedPlaceName = coordinateMatch.name;
  }

  const getMotionLabel = () => {
    if (!isStationary && hasPath) {
      return MOTION_LABELS[mt] === 'Location' ? 'Trail' : MOTION_LABELS[mt];
    }
    if (resolvedPlaceName && String(resolvedPlaceName).includes(',')) {
      return `At ${resolvedPlaceName}`;
    }
    return resolvedPlaceName ? `At ${resolvedPlaceName}` : MOTION_LABELS[mt];
  };

  // Compute map region from path
  const getRegion = () => {
    if (path.length === 0) {
      return { latitude: 40.7128, longitude: -74.006, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    }
    if (path.length === 1 || isStationary) {
      return {
        latitude: path[0][0],
        longitude: path[0][1],
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      };
    }
    const lats = path.map(p => p[0]);
    const lons = path.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(maxLat - minLat, 0.005) * 1.4,
      longitudeDelta: Math.max(maxLon - minLon, 0.005) * 1.4,
    };
  };

  const startTime = new Date(session.startedAt);
  const endTime = session.endedAt ? new Date(session.endedAt) : null;
  const isOngoing = !session.endedAt;
  const durationMin = session.duration_min ??
    Math.round(((endTime || new Date()).getTime() - startTime.getTime()) / 60000);

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const formatDuration = (min: number) => {
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  };

  const handleUpdateKnownPlace = async () => {
    if (!knownPlace) return;
    const finalName = editPlaceType === 'other'
      ? editPlaceName.trim()
      : editPlaceType.charAt(0).toUpperCase() + editPlaceType.slice(1);
    if (!finalName) {
      Alert.alert('Name Required', 'Please enter a name for this place.');
      return;
    }

    try {
      await updatePlace({
        id: knownPlace.id,
        name: finalName,
        placeType: editPlaceType,
      }).unwrap();
    } catch (err) {
      Alert.alert('Error', 'Failed to update known place');
    }
  };

  const handleDeleteKnownPlace = () => {
    if (!knownPlace) return;
    Alert.alert(
      'Delete Place',
      `Delete ${knownPlace.name}? Future location logs will no longer use this label.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePlace(knownPlace.id).unwrap();
            } catch (err) {
              Alert.alert('Error', 'Failed to delete known place');
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={st.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={st.sheet}>
          {/* Header */}
          <View style={st.header}>
            <View style={st.handle} />
            <TouchableOpacity style={st.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            style={st.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={st.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {/* Title row */}
            <View style={st.titleRow}>
              <View style={[st.motionBadge, { backgroundColor: MOTION_COLORS[mt] }]}>
                <Feather name={MOTION_ICONS[mt] as any} size={14} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.title}>
                  {getMotionLabel()}
                </Text>
                <Text style={st.subtitle}>
                  {formatTime(startTime)}
                  {endTime ? ` - ${formatTime(endTime)}` : ' - now'}
                  {'  '}
                  {isOngoing ? '(ongoing)' : `(${formatDuration(durationMin)})`}
                </Text>
              </View>
            </View>

            {/* Map */}
            <View style={st.mapContainer}>
              <MapView
                style={st.map}
                initialRegion={getRegion()}
                scrollEnabled={false}
                zoomEnabled={true}
                pitchEnabled={false}
                rotateEnabled={false}
              >
                {/* Stationary dot */}
                {isStationary && path.length > 0 && (
                  <Marker
                    coordinate={{ latitude: path[0][0], longitude: path[0][1] }}
                  >
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#000', borderWidth: 2, borderColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } }} />
                  </Marker>
                )}

                {/* Trail polyline */}
                {hasPath && !isStationary && (
                  <>
                    <Polyline
                      coordinates={path.map(p => ({ latitude: p[0], longitude: p[1] }))}
                      strokeColor={MOTION_COLORS[mt] || '#757575'}
                      strokeWidth={5}
                      lineCap="round"
                      lineJoin="round"
                    />



                    {/* Start/End markers for trails */}
                    <Marker
                      coordinate={{ latitude: path[0][0], longitude: path[0][1] }}
                      pinColor="#9E9E9E"
                      title="Start"
                    />
                    <Marker
                      coordinate={{ latitude: path[path.length - 1][0], longitude: path[path.length - 1][1] }}
                      pinColor="#000000"
                      title={isOngoing ? 'Current' : 'End'}
                    />
                  </>
                )}
              </MapView>
            </View>

            {/* Stats */}
            <View style={st.statsRow}>
              <View style={st.statItem}>
                <Feather name="clock" size={14} color={colors.textMuted} />
                <Text style={st.statLabel}>Duration</Text>
                <Text style={st.statValue}>
                  {isOngoing ? `${formatDuration(durationMin)}+` : formatDuration(durationMin)}
                </Text>
              </View>
              <View style={st.statItem}>
                <Feather name={MOTION_ICONS[mt] as any} size={14} color={colors.textMuted} />
                <Text style={st.statLabel}>Type</Text>
                <Text style={st.statValue}>{MOTION_LABELS[mt]}</Text>
              </View>
              {path.length > 1 && (
                <View style={st.statItem}>
                  <Feather name="map" size={14} color={colors.textMuted} />
                  <Text style={st.statLabel}>Points</Text>
                  <Text style={st.statValue}>{path.length}</Text>
                </View>
              )}
            </View>

            {/* Convert to Activity Button */}
            {existingActivity && onViewActivity ? (
              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
                  paddingVertical: 12, marginBottom: spacing.md, marginTop: spacing.xs,
                }}
                onPress={() => {
                  onClose();
                  onViewActivity(existingActivity);
                }}
                activeOpacity={0.8}
              >
                <Feather name="edit-2" size={16} color={colors.textPrimary} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>View Log</Text>
              </TouchableOpacity>
            ) : onConvertActivity ? (
              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: colors.textPrimary, borderRadius: radius.md,
                  paddingVertical: 12, marginBottom: spacing.md, marginTop: spacing.xs,
                }}
                onPress={() => {
                  onClose();
                  let activityType = 'other';
                  if (mt === 'walking') activityType = 'walk';
                  else if (mt === 'running') activityType = 'run';
                  else if (mt === 'cycling') activityType = 'bike';
                  else if (mt === 'driving') activityType = 'commute';
                  
                  onConvertActivity({
                    id: -1,
                    activityType,
                    logName: isStationary ? `At ${resolvedPlaceName || 'a place'}` : `Traveling (${Math.round(durationMin)} min)`,
                    duration_min: Math.round(durationMin),
                    loggedAt: session.startedAt,
                    location: resolvedPlaceName || '',
                  });
                }}
                activeOpacity={0.8}
              >
                <Feather name="activity" size={16} color={colors.bg} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.bg }}>Convert to Activity</Text>
              </TouchableOpacity>
            ) : null}

            {/* Manage or Add Known Place */}
            {isStationary && knownPlace && (
              <View style={st.addPlaceCard}>
                <View style={st.manageHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.addPlaceTitle}>Update this place?</Text>
                    <Text style={st.addPlaceDesc}>Currently saved as {knownPlace.name}.</Text>
                  </View>
                  <TouchableOpacity
                    style={st.deletePlaceBtn}
                    onPress={handleDeleteKnownPlace}
                    disabled={isDeletingPlace || isUpdatingPlace}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="trash-2" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={st.addPlaceTypesRow}>
                  {PLACE_TYPES.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[st.placeTypeBtn, editPlaceType === t && st.placeTypeBtnActive]}
                      onPress={() => {
                        setEditPlaceType(t);
                        if (t !== 'other') setEditPlaceName('');
                      }}
                    >
                      <Text style={[st.placeTypeText, editPlaceType === t && st.placeTypeTextActive]}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {editPlaceType === 'other' && (
                  <TextInput
                    style={st.addPlaceInput}
                    value={editPlaceName}
                    onChangeText={setEditPlaceName}
                    placeholder="Enter custom name..."
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="done"
                    onFocus={() => {
                      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
                    }}
                  />
                )}

                <TouchableOpacity
                  style={[st.addPlaceBtn, editPlaceType === 'other' && !editPlaceName.trim() && { opacity: 0.5 }]}
                  disabled={(editPlaceType === 'other' && !editPlaceName.trim()) || isUpdatingPlace || isDeletingPlace}
                  onPress={handleUpdateKnownPlace}
                >
                  {isUpdatingPlace ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.addPlaceBtnText}>Update</Text>}
                </TouchableOpacity>
              </View>
            )}

            {isStationary && !knownPlace && path.length > 0 && (
              <View style={st.addPlaceCard}>
                <Text style={st.addPlaceTitle}>Save this location?</Text>
                <Text style={st.addPlaceDesc}>Mittens will remember this place for future activities.</Text>
                <View style={st.addPlaceTypesRow}>
                  {PLACE_TYPES.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[st.placeTypeBtn, newPlaceType === t && st.placeTypeBtnActive]}
                      onPress={() => {
                        setNewPlaceType(t as any);
                        if (t !== 'other') setNewPlaceName('');
                      }}
                    >
                      <Text style={[st.placeTypeText, newPlaceType === t && st.placeTypeTextActive]}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                
                {newPlaceType === 'other' && (
                  <TextInput
                    style={st.addPlaceInput}
                    value={newPlaceName}
                    onChangeText={setNewPlaceName}
                    placeholder="Enter custom name..."
                    placeholderTextColor={colors.textMuted}
                    returnKeyType="done"
                    onFocus={() => {
                      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
                    }}
                  />
                )}
                
                <TouchableOpacity
                  style={[st.addPlaceBtn, newPlaceType === 'other' && !newPlaceName.trim() && { opacity: 0.5 }]}
                  disabled={(newPlaceType === 'other' && !newPlaceName.trim()) || isAddingPlace}
                  onPress={async () => {
                    const finalName = newPlaceType === 'other' ? newPlaceName.trim() : newPlaceType.charAt(0).toUpperCase() + newPlaceType.slice(1);
                    if (!finalName) return;

                    const performSave = async () => {
                      try {
                        await addPlace({
                          name: finalName,
                          latitude: path[0][0],
                          longitude: path[0][1],
                          radius: 100,
                          placeType: newPlaceType,
                        }).unwrap();
                        
                        setNewPlaceName('');
                        setNewPlaceType('home');
                        onClose();
                      } catch (err) {
                        Alert.alert('Error', 'Failed to add known place');
                      }
                    };

                    if (newPlaceType !== 'other' && newPlaceType !== 'park') {
                      const existing = places.find(p => p.placeType === newPlaceType);
                      if (existing && (Math.abs(existing.latitude - path[0][0]) > 0.001 || Math.abs(existing.longitude - path[0][1]) > 0.001)) {
                        setDuplicateWarning({ name: finalName, perform: performSave });
                        return;
                      }
                    }

                    await performSave();
                  }}
                  >
                    {isAddingPlace ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.addPlaceBtnText}>Save</Text>}
                  </TouchableOpacity>
              </View>
            )}
            
            {duplicateWarning && (
              <View style={st.warnContainer}>
                <Feather name="alert-circle" size={32} color="#F59E0B" style={{ alignSelf: 'center', marginBottom: 12 }} />
                <Text style={st.warnTitle}>Update {duplicateWarning.name}?</Text>
                <Text style={st.warnText}>You already have a {duplicateWarning.name} saved at another location. Do you want to update it to this new location?</Text>
                
                <View style={st.warnActions}>
                  <TouchableOpacity style={st.warnCancelBtn} onPress={() => setDuplicateWarning(null)} disabled={isAddingPlace}>
                    <Text style={st.warnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={st.warnSaveBtn} 
                    onPress={duplicateWarning.perform}
                    disabled={isAddingPlace}
                  >
                    {isAddingPlace ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={st.warnSaveText}>Update</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingHorizontal: spacing.lg,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  header: {
    alignItems: 'center', paddingTop: 8, paddingBottom: 4,
  },
  handle: {
    width: 36, height: 4, backgroundColor: colors.border,
    borderRadius: 2,
  },
  closeBtn: {
    position: 'absolute', right: 0, top: 8,
  },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: spacing.md, marginBottom: spacing.md,
  },
  motionBadge: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  title: {
    fontSize: 18, fontWeight: '700', color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 13, color: colors.textSecondary, marginTop: 2,
  },
  mapContainer: {
    height: 240, borderRadius: radius.md, overflow: 'hidden',
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  map: {
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row', gap: spacing.md,
  },
  statItem: {
    flex: 1, alignItems: 'center', gap: 4,
    padding: spacing.sm, backgroundColor: '#FAFAFA',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  statLabel: {
    fontSize: 10, color: colors.textMuted, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 14, fontWeight: '700', color: colors.textPrimary,
  },
  addPlaceCard: {
    marginTop: spacing.md, backgroundColor: '#FAFAFA',
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  addPlaceTitle: {
    fontSize: 14, fontWeight: '700', color: colors.textPrimary,
  },
  addPlaceDesc: {
    fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8,
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  deletePlaceBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPlaceTypesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
  },
  placeTypeBtn: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeTypeBtnActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  placeTypeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  placeTypeTextActive: {
    color: colors.bg,
  },
  addPlaceRow: {
    flexDirection: 'row', gap: 8,
  },
  addPlaceInput: {
    height: 40, backgroundColor: '#FFF',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 12, fontSize: 14, color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  addPlaceBtn: {
    backgroundColor: '#000', paddingHorizontal: 16, height: 44,
    justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm,
  },
  addPlaceBtnText: {
    color: '#FFF', fontSize: 14, fontWeight: '600',
  },
  warnContainer: {
    marginTop: spacing.md,
    backgroundColor: '#FFFBEB',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warnTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  warnText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  warnActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  warnCancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  warnCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  warnSaveBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
  },
  warnSaveText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.bg,
  },
});
