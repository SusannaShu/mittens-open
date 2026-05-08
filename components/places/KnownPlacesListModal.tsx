import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { KnownPlace, useGetKnownPlacesQuery } from '../../lib/services/location/knownPlaceApi';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectPlace: (place: KnownPlace) => void;
}

const PLACE_ICONS: Record<string, string> = {
  home: 'home', work: 'briefcase', gym: 'activity', 
  park: 'sun', other: 'map-pin'
};

export default function KnownPlacesListModal({ visible, onClose, onSelectPlace }: Props) {
  const { data: places = [], isLoading } = useGetKnownPlacesQuery();

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={st.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={st.header}>
            <View style={st.handle} />
            <Text style={st.title}>Saved Places</Text>
            <TouchableOpacity style={st.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
             <ActivityIndicator style={{ padding: 40 }} />
          ) : places.length === 0 ? (
             <Text style={st.empty}>No saved places yet.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.list}>
              {places.map((p) => (
                <TouchableOpacity 
                  key={p.id} 
                  style={st.row}
                  onPress={() => {
                    onSelectPlace(p);
                    onClose();
                  }}
                >
                  <View style={st.iconBox}>
                    <Feather name={(p.icon || 'map-pin') as any} size={16} color="#FFF" />
                  </View>
                  <View style={st.info}>
                    <Text style={st.rowTitle}>{p.name}</Text>
                    <Text style={st.rowDesc}>{p.placeType.charAt(0).toUpperCase() + p.placeType.slice(1)}</Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%', paddingHorizontal: spacing.lg, paddingBottom: 24,
  },
  header: {
    alignItems: 'center', paddingTop: 8, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    marginBottom: 8,
  },
  handle: {
    width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, marginBottom: 12,
  },
  title: {
    fontSize: 18, fontWeight: '700', color: colors.textPrimary,
  },
  closeBtn: {
    position: 'absolute', right: 0, top: 16,
  },
  empty: {
    textAlign: 'center', color: colors.textSecondary, marginTop: 40,
  },
  list: {
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#000',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  info: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16, fontWeight: '600', color: colors.textPrimary,
  },
  rowDesc: {
    fontSize: 13, color: colors.textSecondary, marginTop: 2,
  }
});
