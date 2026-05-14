import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

interface DetectedPerson {
  name: string;
  timestamp: number;
  imageUri: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  detectedPeopleDetails: DetectedPerson[];
}

export default function UsersEvidenceModal({ visible, onClose, detectedPeopleDetails }: Props) {
  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.headerTitle}>People Detected</Text>
            <TouchableOpacity onPress={onClose} activeOpacity={0.6} style={s.closeBtn}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
            {detectedPeopleDetails.length === 0 ? (
              <Text style={s.emptyText}>No visual evidence captured.</Text>
            ) : (
              detectedPeopleDetails.map((person, index) => (
                <View key={`${person.name}-${index}`} style={s.personCard}>
                  <Image source={{ uri: person.imageUri }} style={s.image} />
                  <View style={s.info}>
                    <Text style={s.name}>{person.name}</Text>
                    <Text style={s.time}>
                      {new Date(person.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    minHeight: '50%',
    maxHeight: '80%',
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  image: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: '#333',
  },
  info: {
    marginLeft: spacing.md,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  time: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
