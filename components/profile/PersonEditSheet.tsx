/**
 * PersonEditSheet -- Modal sheet for editing a person profile.
 *
 * Features:
 *   - Name, nickname, team role, context editing
 *   - "This is me" owner toggle
 *   - Photo gallery with "Not X" per-photo false-positive removal
 *   - Delete person with full confirmation
 */

import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Alert, Modal,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Image,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius } from '../../lib/theme';
import {
  getEmbeddingsForPerson,
  deleteEmbedding,
  setOwner,
  saveEmbedding,
} from '../../lib/services/faceRecognition/faceRecognitionApi';
import type { Person } from '../../lib/pipelines/types';
import type { FaceEmbedding } from '../../lib/services/faceRecognition/types';

const TEAM_ROLES = ['supporter', 'player', 'intimate', 'mentor', 'collaborator'] as const;

interface Props {
  person: Person;
  onSave: (p: Person) => void;
  onClose: () => void;
  onDelete: (id: number) => void;
}

export function PersonEditSheet({ person, onSave, onClose, onDelete }: Props) {
  const [draft, setDraft] = useState<Person>({ ...person });
  const [embeddings, setEmbeddings] = useState<FaceEmbedding[]>([]);
  const [uploading, setUploading] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (person.id && person.id > 0) {
      try {
        const loaded = getEmbeddingsForPerson(person.id);
        setEmbeddings(loaded);
      } catch (e) {
        console.warn('Failed to load embeddings for person', e);
      }
    }
  }, [person.id]);

  const handleRemoveEmbedding = (embId: number) => {
    Alert.alert(
      `Remove Photo`,
      `Mittens won't use this photo to remember ${draft.name}. Remove it?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            deleteEmbedding(embId);
            setEmbeddings(prev => prev.filter(e => e.id !== embId));
          },
        },
      ],
    );
  };

  const handleToggleIsMe = () => {
    const newVal = !draft.isMe;
    setDraft(p => ({ ...p, isMe: newVal, teamRole: newVal ? 'self' : p.teamRole }));
    if (newVal && person.id && person.id > 0) {
      setOwner(person.id);
    }
  };

  const handleUploadPhoto = async () => {
    if (!person.id || person.id === 0) {
      Alert.alert('Save First', 'Save this person before uploading face photos.');
      return;
    }

    try {
      const ImagePicker = require('expo-image-picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const photoUri = result.assets[0].uri;
      setUploading(true);
      console.log(`[FaceRec:Upload] Starting face detection on: ${photoUri.slice(-40)}`);

      // Detect faces in the uploaded photo
      let faces: any[] = [];
      try {
        const { getFaceRecognitionModule } = require('../../lib/services/faceRecognition/nativeModule');
        const mod = getFaceRecognitionModule?.();
        if (mod) {
          faces = await mod.detectFaces(photoUri);
        }
      } catch {
        // Native module might not be at that path -- try direct import
        try {
          const mod = require('../../../modules/expo-face-recognition/src');
          const faceModule = mod.getFaceRecognitionModule();
          if (faceModule) {
            faces = await faceModule.detectFaces(photoUri);
          }
        } catch (innerErr: any) {
          console.warn('[FaceRec:Upload] Native module not available:', innerErr?.message);
        }
      }

      if (!faces || faces.length === 0) {
        Alert.alert('No Face Found', 'Could not detect a face in this photo. Try a clearer photo with a visible face.');
        setUploading(false);
        return;
      }

      const face = faces[0];
      console.log(
        `[FaceRec:Upload] Detected face: dim=${face.embedding.length}` +
        `, conf=${face.confidence.toFixed(3)}`,
      );

      // Save embedding
      saveEmbedding(person.id, face.embedding, face.confidence, photoUri);
      console.log(`[FaceRec:Upload] Saved embedding for person ${person.id}`);

      // Refresh embeddings list
      const loaded = getEmbeddingsForPerson(person.id);
      setEmbeddings(loaded);

      Alert.alert('Face Learned', `Mittens will use this photo to remember ${draft.name}.`);
    } catch (err: any) {
      console.error('[FaceRec:Upload] Failed:', err?.message);
      Alert.alert('Upload Failed', err?.message || 'Something went wrong.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePerson = () => {
    if (!person.id || person.id === 0) return;
    Alert.alert(
      'Delete Person',
      `Delete ${person.name} and all face recognition data? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(person.id!),
        },
      ],
    );
  };

  return (
    <Modal visible transparent animationType="slide">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Backdrop */}
        <TouchableOpacity style={st.overlay} activeOpacity={1} onPress={onClose} />

        {/* Sheet */}
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={st.dragHandle} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>
              {person.id === 0 ? 'Add Person' : 'Edit Person'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Feather name="x" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={true} style={{ flex: 1 }}>
            <Text style={st.fieldLabel}>Name</Text>
            <TextInput
              style={st.input}
              value={draft.name}
              onChangeText={(v) => setDraft(p => ({ ...p, name: v }))}
              placeholder="Name"
              placeholderTextColor={colors.textMuted}
              autoFocus={person.id === 0}
            />

            <Text style={st.fieldLabel}>Nickname</Text>
            <TextInput
              style={st.input}
              value={draft.nickname || ''}
              onChangeText={(v) => setDraft(p => ({ ...p, nickname: v }))}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
            />

            {/* "This is me" toggle */}
            {person.id !== 0 && (
              <TouchableOpacity
                style={[st.isMeToggle, draft.isMe && st.isMeToggleActive]}
                onPress={handleToggleIsMe}
                activeOpacity={0.7}
              >
                <Feather name={draft.isMe ? 'check-circle' : 'circle'} size={16} color={draft.isMe ? '#fff' : colors.textMuted} />
                <Text style={[st.isMeText, draft.isMe && { color: '#fff' }]}>This is me</Text>
              </TouchableOpacity>
            )}

            <Text style={st.fieldLabel}>Team Role</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md }}>
              {TEAM_ROLES.map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[st.toggle, draft.teamRole === role && st.toggleActive]}
                  onPress={() => setDraft(p => ({ ...p, teamRole: p.teamRole === role ? undefined : role }))}
                >
                  <Text style={[st.toggleText, draft.teamRole === role && st.toggleTextActive]}>
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={st.fieldLabel}>Context</Text>
            <TextInput
              style={[st.input, { minHeight: 60 }]}
              value={draft.context || ''}
              onChangeText={(v) => setDraft(p => ({ ...p, context: v }))}
              placeholder="How do you know them?"
              placeholderTextColor={colors.textMuted}
              multiline
            />

            {/* Photo gallery with upload + "Not X" per photo */}
            {person.id && person.id > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={st.fieldLabel}>Pictures Used to Remember ({embeddings.length})</Text>

                {/* Upload Photo button */}
                <TouchableOpacity
                  style={st.uploadBtn}
                  onPress={handleUploadPhoto}
                  activeOpacity={0.7}
                  disabled={uploading}
                >
                  {uploading ? (
                    <ActivityIndicator size="small" color={colors.textPrimary} />
                  ) : (
                    <>
                      <Feather name="upload" size={14} color={colors.textPrimary} />
                      <Text style={st.uploadText}>Upload Face Photo</Text>
                    </>
                  )}
                </TouchableOpacity>

                {embeddings.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.xs }}>
                    {embeddings.map((emb, idx) => (
                      emb.imageUri ? (
                        <View key={emb.id || idx} style={st.galleryItem}>
                          <Image source={{ uri: emb.imageUri }} style={st.galleryImage} />
                          <Text style={st.galleryDate}>
                            {new Date(emb.capturedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </Text>
                          <TouchableOpacity
                            style={st.notMeBtn}
                            onPress={() => emb.id && handleRemoveEmbedding(emb.id)}
                          >
                            <Feather name="x" size={10} color="#FF4444" />
                            <Text style={st.notMeText}>Not {draft.name.split(' ')[0]}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null
                    ))}
                  </ScrollView>
                ) : null}
              </View>
            ) : null}

            {/* Delete person */}
            {person.id && person.id > 0 ? (
              <TouchableOpacity style={st.deletePersonBtn} onPress={handleDeletePerson} activeOpacity={0.7}>
                <Feather name="trash-2" size={14} color="#FF4444" />
                <Text style={st.deletePersonText}>Delete Person</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ height: 60 }} />
          </ScrollView>

          {/* Actions -- pinned */}
          <View style={st.actionBar}>
            <TouchableOpacity style={st.cancelBtn} onPress={onClose}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.saveBtn, !draft.name.trim() && { opacity: 0.4 }]}
              onPress={() => draft.name.trim() && onSave(draft)}
              disabled={!draft.name.trim()}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Styles ── */

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '70%',
    position: 'absolute', bottom: 0, left: 0, right: 0,
  },
  dragHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDD',
    alignSelf: 'center', marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: colors.textPrimary, marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6,
  },
  toggle: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff',
  },
  toggleActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  toggleText: { fontSize: 12, fontWeight: '500', color: colors.textPrimary },
  toggleTextActive: { color: '#fff' },
  actionBar: {
    flexDirection: 'row', gap: 10, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  saveBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    backgroundColor: colors.textPrimary, borderRadius: radius.md,
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  galleryItem: {
    marginRight: spacing.sm,
    alignItems: 'center',
  },
  galleryImage: {
    width: 80, height: 80,
    borderRadius: radius.sm,
    backgroundColor: '#EAEAEA',
  },
  galleryDate: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
  },
  notMeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FF4444',
  },
  notMeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FF4444',
  },
  isMeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  isMeToggleActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  isMeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
  },
  uploadText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  deletePersonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: '#FF4444',
    borderRadius: radius.md,
  },
  deletePersonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FF4444',
  },
});
