import React, { useState, useEffect } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { KnownPlace, useUpdateKnownPlaceMutation, useDeleteKnownPlaceMutation, useGetKnownPlacesQuery } from '../../lib/services/location/knownPlaceApi';
import { ScrollView } from 'react-native';

const PLACE_TYPES = ['home', 'work', 'gym', 'park', 'other'] as const;
const ICONS = ['map-pin', 'home', 'briefcase', 'activity', 'sun', 'star', 'coffee', 'heart', 'shopping-bag', 'user', 'music', 'book', 'moon', 'zap', 'anchor', 'truck'];

interface Props {
  visible: boolean;
  place: KnownPlace | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PlaceDetailsModal({ visible, place, onClose, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [placeType, setPlaceType] = useState<typeof PLACE_TYPES[number]>('other');
  const [icon, setIcon] = useState('map-pin');
  
  const [updatePlace, { isLoading: isUpdating }] = useUpdateKnownPlaceMutation();
  const [deletePlace, { isLoading: isDeleting }] = useDeleteKnownPlaceMutation();
  const { data: places = [] } = useGetKnownPlacesQuery();

  useEffect(() => {
    if (visible && place) {
      setName(place.name);
      setPlaceType((PLACE_TYPES.includes(place.placeType as any) ? place.placeType : 'other') as any);
      setIcon(place.icon || 'map-pin');
    }
  }, [visible, place]);

  if (!place) return null;

  const handleUpdate = async () => {
    const finalName = placeType === 'other' ? name.trim() : placeType.charAt(0).toUpperCase() + placeType.slice(1);
    if (placeType === 'other' && !finalName) {
      Alert.alert('Name Required', 'Please enter a name for this place.');
      return;
    }

    try {
      await updatePlace({
        id: place.id,
        name: finalName,
        placeType,
        icon,
      }).unwrap();
      
      onClose();
      if (onSuccess) onSuccess();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update place');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Place',
      `Are you sure you want to delete ${place.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            try {
              await deletePlace(place.id).unwrap();
              onClose();
              if (onSuccess) onSuccess();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to delete place');
            }
          }
        }
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <Pressable style={st.card} onPress={(e) => e.stopPropagation()}>
            <View style={st.header}>
              <Text style={st.title}>Manage Place</Text>
              <TouchableOpacity onPress={handleDelete} disabled={isDeleting || isUpdating}>
                <Feather name="trash-2" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>

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
                style={st.input}
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
              <TouchableOpacity style={st.cancelBtn} onPress={onClose} disabled={isUpdating}>
                <Text style={st.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.saveBtn, placeType === 'other' && !name.trim() && { opacity: 0.5 }]}
                onPress={handleUpdate}
                disabled={isUpdating || (placeType === 'other' && !name.trim())}
              >
                {isUpdating ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={st.saveText}>Update</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bg, borderRadius: 20, padding: 24, width: '100%', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 10,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
  },
  title: {
    fontSize: 20, fontWeight: '700', color: colors.textPrimary,
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
  input: {
    backgroundColor: colors.bgSecondary, borderRadius: 12, padding: 14, fontSize: 16, color: colors.textPrimary, borderWidth: 1, borderColor: colors.border, marginBottom: 16,
  },
  iconLabel: {
    fontSize: 14, fontWeight: '600', color: colors.textSecondary, marginBottom: 8, marginTop: 4,
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
  }
});
