/**
 * IdentifyPersonSheet -- Modal sheet for assigning a name to an unknown face.
 *
 * Allows the user to select an existing person or create a new one.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Image,
  ActivityIndicator, Alert
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../lib/theme';
import {
  getAllPeople,
  setOwner,
} from '../../lib/services/faceRecognition/faceRecognitionApi';
import { introduceFace } from '../../lib/services/faceRecognition/faceRecognitionService';

interface DetectedFace {
  embedding: number[];
  confidence: number;
  boundingBox: any;
  cropUri: string;
}

interface Props {
  face: DetectedFace | null;
  onIdentified: (name: string) => void;
  onClose: () => void;
}

export function IdentifyPersonSheet({ face, onIdentified, onClose }: Props) {
  const [name, setName] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (face) {
      setPeople(getAllPeople());
      setName('');
    }
  }, [face]);

  if (!face) return null;

  const handleSave = async (personName: string, isOwner: boolean = false) => {
    if (!personName.trim()) return;
    setSaving(true);
    try {
      const result = await introduceFace(
        personName.trim(),
        face.embedding,
        face.confidence,
        face.cropUri
      );
      
      if (result && isOwner) {
        setOwner(result.personId);
      }
      
      onIdentified(result?.name || personName);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to identify person');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />

        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={st.dragHandle} />

          <View style={st.header}>
            <Text style={st.title}>Identify Person</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={st.faceContainer}>
              <Image source={{ uri: face.cropUri }} style={st.faceImage} />
            </View>

            <TouchableOpacity
              style={st.isMeBtn}
              onPress={() => handleSave('Susanna', true)} // Hardcode default or allow setting later
              activeOpacity={0.7}
            >
              <Feather name="user-check" size={16} color="#fff" />
              <Text style={st.isMeText}>This is me</Text>
            </TouchableOpacity>

            <Text style={st.fieldLabel}>Create New Person</Text>
            <View style={st.inputRow}>
              <TextInput
                style={st.input}
                value={name}
                onChangeText={setName}
                placeholder="Name"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity
                style={[st.saveBtn, !name.trim() && { opacity: 0.5 }]}
                onPress={() => handleSave(name)}
                disabled={!name.trim() || saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={st.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>

            {people.length > 0 && (
              <>
                <Text style={st.fieldLabel}>Or Select Existing</Text>
                <View style={st.peopleGrid}>
                  {people.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={st.personChip}
                      onPress={() => handleSave(p.name)}
                      disabled={saving}
                    >
                      <Feather name="user" size={14} color={colors.textPrimary} />
                      <Text style={st.personChipText}>{p.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '85%', width: '100%',
  },
  dragHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD',
    alignSelf: 'center', marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  faceContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  faceImage: {
    width: 120, height: 120,
    borderRadius: 60,
    backgroundColor: '#EAEAEA',
    borderWidth: 2,
    borderColor: colors.border,
  },
  isMeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.textPrimary,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  isMeText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row', gap: 10,
    marginBottom: spacing.lg,
  },
  input: {
    flex: 1,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: colors.textPrimary,
  },
  saveBtn: {
    backgroundColor: colors.textPrimary,
    paddingHorizontal: 20,
    justifyContent: 'center', alignItems: 'center',
    borderRadius: radius.md,
  },
  saveBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  peopleGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  personChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  personChipText: { fontSize: 13, fontWeight: '500', color: colors.textPrimary },
});
