import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, ActivityIndicator, TouchableOpacity, Alert, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { useAddKnownPlaceMutation, KnownPlace, useGetKnownPlacesQuery } from '../../lib/services/location/knownPlaceApi';
import { updateProfile, getApiBase, getAuthToken } from '../../lib/api';
import * as Location from 'expo-location';

interface Props {
  visible: boolean;
  coordinate: { latitude: number; longitude: number } | null;
  onCancel: () => void;
  onSuccess: () => void;
  onSearchSelect: (coord: { latitude: number; longitude: number }) => void;
  initialType?: string;
  initialName?: string;
}

const PLACE_TYPES = ['home', 'work', 'gym', 'park', 'other'] as const;
const ICONS = ['map-pin', 'home', 'briefcase', 'activity', 'sun', 'star', 'coffee', 'heart', 'shopping-bag', 'user', 'music', 'book', 'moon', 'zap', 'anchor', 'truck'];

export default function PlaceDraftOverlay({ visible, coordinate, onCancel, onSuccess, onSearchSelect, initialType = 'other', initialName = '' }: Props) {
  const [name, setName] = useState(initialName);
  const [placeType, setPlaceType] = useState<typeof PLACE_TYPES[number]>(
    PLACE_TYPES.includes(initialType as any) ? (initialType as any) : 'other'
  );
  const [icon, setIcon] = useState('map-pin');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{name: string, perform: () => void} | null>(null);
  
  const [addPlace, { isLoading }] = useAddKnownPlaceMutation();
  const { data: places = [] } = useGetKnownPlacesQuery();

  useEffect(() => {
    if (coordinate) {
      if (placeType === 'home') setIcon('home');
      else if (placeType === 'work') setIcon('briefcase');
      else if (placeType === 'gym') setIcon('activity');
      else if (placeType === 'park') setIcon('sun');
      else setIcon('map-pin');
    }
  }, [coordinate, placeType]);

  if (!visible) return null;

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results && results.length > 0) {
        onSearchSelect({ latitude: results[0].latitude, longitude: results[0].longitude });
      } else {
        Alert.alert('Not Found', 'Could not find that address.');
      }
    } catch (e) {
      console.warn("Geocode error", e);
      Alert.alert('Error', 'Failed to search address.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSave = async () => {
    const finalName = placeType === 'other' ? name.trim() : placeType.charAt(0).toUpperCase() + placeType.slice(1);
    if (placeType === 'other' && !finalName) {
      Alert.alert('Name Required', 'Please enter a name for this place.');
      return;
    }

    const performSave = async () => {
      try {
        await addPlace({
          name: finalName,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          radius: 100,
          placeType: placeType as KnownPlace['placeType'],
          icon: icon,
        }).unwrap();

        if (placeType === 'home') {
          await updateProfile({
            homeLatitude: coordinate.latitude,
            homeLongitude: coordinate.longitude,
            homeLabel: finalName,
          });
        }

        // Auto-log enter event
        try {
          const token = getAuthToken();
          if (token) {
            await fetch(`${getApiBase()}/location-logs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                latitude: coordinate.latitude, longitude: coordinate.longitude,
                eventType: 'enter',
                motionType: 'stationary',
                placeName: finalName,
                loggedAt: new Date().toISOString()
              })
            });
          }
        } catch (e) {
          console.warn('Failed to auto-log enter event', e);
        }

        onSuccess();
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to add place');
      }
    };

    if (placeType !== 'other' && placeType !== 'park') {
      const existing = places.find(p => p.placeType === placeType);
      if (existing && (Math.abs(existing.latitude - coordinate.latitude) > 0.001 || Math.abs(existing.longitude - coordinate.longitude) > 0.001)) {
        setDuplicateWarning({ name: finalName, perform: performSave });
        return;
      }
    }

    await performSave();
  };

  return (
    <View style={st.container} pointerEvents="box-none">
      
      {/* Top Search Bar */}
      <View style={st.topFloat}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
          <View style={[st.searchContainer, { flex: 1 }]}>
            <Feather name="search" size={20} color={colors.textMuted} style={st.searchIcon} />
            <TextInput
              style={st.searchInput}
              placeholder="Search address..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {isSearching && <ActivityIndicator size="small" style={{ marginRight: 12 }} />}
          </View>
          
          {!coordinate && (
            <TouchableOpacity style={st.topCancelBtn} onPress={onCancel}>
              <Text style={st.topCancelText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={st.pinHint}>
          {coordinate ? "Drag the map pin to precisely adjust location." : "Tap anywhere on the map to place a pin."}
        </Text>
      </View>

      {/* Bottom Floating Form Card */}
      {coordinate && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={st.bottomFloat} pointerEvents="box-none">
          <View style={st.card}>
          <Text style={st.title}>Save Place Details</Text>
          
          {duplicateWarning ? (
              <View style={st.warnContainer}>
                <Feather name="alert-circle" size={32} color="#F59E0B" style={{ alignSelf: 'center', marginBottom: 12 }} />
                <Text style={st.warnTitle}>Update {duplicateWarning.name}?</Text>
                <Text style={st.warnText}>You already have a {duplicateWarning.name} saved at another location. Do you want to update it to this new location?</Text>
                
                <View style={st.actions}>
                  <TouchableOpacity style={st.cancelBtn} onPress={() => setDuplicateWarning(null)} disabled={isLoading}>
                    <Text style={st.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={st.saveBtn} 
                    onPress={duplicateWarning.perform}
                    disabled={isLoading}
                  >
                    {isLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={st.saveText}>Update</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <View style={st.typesRow}>
                  {PLACE_TYPES.map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[st.typeBtn, placeType === t && st.typeBtnActive]}
                      onPress={() => {
                        setPlaceType(t);
                        if (t !== 'other') setName('');
                      }}
                    >
                      <Text style={[st.typeText, placeType === t && st.typeTextActive]}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {placeType === 'other' && (
                  <TextInput
                    style={st.nameInput}
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter custom name..."
                    placeholderTextColor={colors.textMuted}
                  />
                )}

                <Text style={st.iconLabel}>Choose an Icon</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.iconsRow}>
                  {ICONS.map(i => (
                    <TouchableOpacity
                      key={i}
                      style={[st.iconBtn, icon === i && st.iconBtnActive]}
                      onPress={() => setIcon(i)}
                    >
                      <Feather name={i as any} size={20} color={icon === i ? '#FFF' : colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={st.actions}>
                  <TouchableOpacity style={st.cancelBtn} onPress={onCancel} disabled={isLoading}>
                    <Text style={st.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[st.saveBtn, placeType === 'other' && !name.trim() && { opacity: 0.5 }]}
                    onPress={handleSave}
                    disabled={isLoading || (placeType === 'other' && !name.trim())}
                  >
                    {isLoading ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={st.saveText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}

        </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    zIndex: 100,
  },
  topFloat: {
    marginTop: Platform.OS === 'ios' ? 60 : 40,
    marginHorizontal: spacing.md,
  },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFF', borderRadius: 12,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  searchIcon: {
    paddingLeft: 16, paddingRight: 8,
  },
  searchInput: {
    flex: 1, paddingVertical: 14, fontSize: 16, color: colors.textPrimary,
  },
  pinHint: {
    textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#1E88E5', marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.9)', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, alignSelf: 'center', overflow: 'hidden'
  },
  topCancelBtn: {
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, backgroundColor: '#FFF', borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  topCancelText: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary,
  },
  bottomFloat: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 10,
  },
  title: {
    fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 16,
  },
  typesRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  typeBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border,
  },
  typeBtnActive: {
    backgroundColor: '#000', borderColor: '#000',
  },
  typeText: {
    fontSize: 14, fontWeight: '500', color: colors.textSecondary,
  },
  typeTextActive: {
    color: '#FFF',
  },
  nameInput: {
    backgroundColor: colors.bgSecondary, borderRadius: 12, padding: 14, fontSize: 16, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  iconLabel: {
    fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginBottom: 8,
  },
  iconsRow: {
    gap: 12, paddingBottom: 16,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bgSecondary, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  iconBtnActive: {
    backgroundColor: '#000', borderColor: '#000',
  },
  actions: {
    flexDirection: 'row', gap: 12, marginTop: 12,
  },
  cancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center',
  },
  cancelText: {
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
  },
  saveBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#000', alignItems: 'center',
  },
  saveText: {
    fontSize: 16, fontWeight: '600', color: '#FFF',
  },
  warnContainer: {
    padding: 16, backgroundColor: colors.bgSecondary, borderRadius: 12, marginBottom: 16,
  },
  warnTitle: {
    fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8,
  },
  warnText: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 20,
  }
});
