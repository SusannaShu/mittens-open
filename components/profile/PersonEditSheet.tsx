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
    let currentPersonId = draft.id;

    if (!currentPersonId || currentPersonId === 0) {
      if (!draft.name.trim()) {
        Alert.alert('Name Required', 'Please enter a name first so we can save the person before adding photos.');
        return;
      }
      try {
        const { PersonService } = require('../../lib/services/personService');
        const newPerson = await PersonService.create(draft);
        currentPersonId = newPerson.id;
        setDraft(prev => ({ ...prev, id: currentPersonId }));
      } catch (e) {
        Alert.alert('Error', 'Failed to save person.');
        return;
      }
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
        const { getFaceRecognitionModule } = require('../../modules/expo-face-recognition/src');
        const mod = getFaceRecognitionModule();
        if (mod) {
          faces = await mod.detectFaces(photoUri);
        } else {
          console.warn('[FaceRec:Upload] Native module returned null');
        }
      } catch (modErr: any) {
        console.warn('[FaceRec:Upload] Native module not available:', modErr?.message);
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

      let finalPhotoUri = photoUri;
      if (face.boundingBox) {
        try {
          const { Image } = require('react-native');
          const ImageManipulator = require('expo-image-manipulator');
          
          const { width: imgW, height: imgH } = await new Promise<{width: number, height: number}>((resolve, reject) => {
            Image.getSize(photoUri, (w: number, h: number) => resolve({ width: w, height: h }), reject);
          });

          const bbox = face.boundingBox;
          const rectX = bbox.x * imgW;
          const rectY = (1.0 - (bbox.y + bbox.height)) * imgH;
          const rectW = bbox.width * imgW;
          const rectH = bbox.height * imgH;

          // Add 30% margin around face
          const margin = Math.max(rectW, rectH) * 0.3;

          const cropX = Math.max(0, rectX - margin);
          const cropY = Math.max(0, rectY - margin);
          const cropW = Math.min(imgW - cropX, rectW + margin * 2);
          const cropH = Math.min(imgH - cropY, rectH + margin * 2);

          const cx = cropX + cropW / 2;
          const cy = cropY + cropH / 2;
          let sqSize = Math.max(cropW, cropH);

          if (cx - sqSize / 2 < 0) sqSize = cx * 2;
          if (cy - sqSize / 2 < 0) sqSize = cy * 2;
          if (cx + sqSize / 2 > imgW) sqSize = (imgW - cx) * 2;
          if (cy + sqSize / 2 > imgH) sqSize = (imgH - cy) * 2;

          const finalX = Math.max(0, cx - sqSize / 2);
          const finalY = Math.max(0, cy - sqSize / 2);

          const manipResult = await ImageManipulator.manipulateAsync(
            photoUri,
            [{ crop: { originX: finalX, originY: finalY, width: sqSize, height: sqSize } }],
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 }
          );
          finalPhotoUri = manipResult.uri;
          console.log('[FaceRec:Upload] Auto-cropped image to bounding box');
        } catch (cropErr) {
          console.warn('[FaceRec:Upload] Failed to auto-crop:', cropErr);
        }
      }

      // Save embedding
      saveEmbedding(currentPersonId, face.embedding, face.confidence, finalPhotoUri);
      console.log(`[FaceRec:Upload] Saved embedding for person ${currentPersonId}`);

      // Refresh embeddings list
      const loaded = getEmbeddingsForPerson(currentPersonId);
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
    <Modal visible transparent animationType="fade">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
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

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={true} style={{ flexShrink: 1 }}>
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
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    maxHeight: '85%',
    width: '100%',
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
