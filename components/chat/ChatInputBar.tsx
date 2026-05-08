/**
 * ChatInputBar -- Pending photos preview, reply bar, text input, send/voice button.
 */

import React from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  Image, StyleSheet,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import PhotoCapture from '../common/PhotoCapture';
import VoiceMicButton from './VoiceMicButton';
import { ChatMessage } from './ChatBubble';
import { stopSpeaking } from '../../lib/services/ai/voiceService';

/** Resolve photo string to a displayable URI. */
function resolvePhotoUri(photo: string): string {
  if (photo.startsWith('http')) return photo;
  if (photo.startsWith('file://') || photo.startsWith('/')) return photo;
  return `data:image/jpeg;base64,${photo}`;
}

interface ChatInputBarProps {
  input: string;
  setInput: (text: string) => void;
  pendingPhotos: string[];
  maxPhotos: number;
  replyTo: { id: string; text: string } | null;
  sending: boolean;
  onSend: () => void;
  onPhotoCapture: (photos: string[], timestamps?: Date[]) => void;
  onRemovePhoto: (index: number) => void;
  onClearPhotos: () => void;
  onClearReply: () => void;
  onVoiceFinalResult: (text: string) => void;
}

export default function ChatInputBar({
  input, setInput, pendingPhotos, maxPhotos, replyTo, sending,
  onSend, onPhotoCapture, onRemovePhoto, onClearPhotos, onClearReply,
  onVoiceFinalResult,
}: ChatInputBarProps) {
  return (
    <>
      {/* Pending photos preview */}
      {pendingPhotos.length > 0 && (
        <View style={styles.pendingPhotoBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pendingScroll}>
            {pendingPhotos.map((photo, i) => (
              <View key={i} style={styles.pendingPhotoWrap}>
              <Image
                  source={{ uri: resolvePhotoUri(photo) }}
                  style={styles.pendingPhotoThumb}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => onRemovePhoto(i)}
                  style={styles.pendingRemoveBtn}
                >
                  <Feather name="x" size={12} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.pendingLabel}>
            {pendingPhotos.length} photo{pendingPhotos.length > 1 ? 's' : ''}
          </Text>
          <TouchableOpacity onPress={onClearPhotos} style={styles.pendingRemove}>
            <Feather name="x" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Reply preview bar */}
      {replyTo && (
        <View style={styles.replyBar}>
          <View style={styles.replyBarContent}>
            <View style={styles.replyBarLine} />
            <Text style={styles.replyBarText} numberOfLines={1}>{replyTo.text}</Text>
          </View>
          <TouchableOpacity onPress={onClearReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        {pendingPhotos.length < maxPhotos && (
          <PhotoCapture onCapture={onPhotoCapture} />
        )}
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={(t) => { stopSpeaking(); setInput(t); }}
          placeholder={pendingPhotos.length > 0 ? 'Add a caption...' : 'Message Mittens...'}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={onSend}
          blurOnSubmit
        />
        {(input.trim() || pendingPhotos.length > 0) ? (
          <TouchableOpacity
            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
            onPress={onSend}
            disabled={sending}
          >
            <Feather name="arrow-up" size={18} color="#FFF" />
          </TouchableOpacity>
        ) : (
          <VoiceMicButton
            disabled={sending}
            onTranscript={(text) => {
              stopSpeaking();
              setInput(text);
            }}
            onFinalResult={onVoiceFinalResult}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  pendingPhotoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  pendingScroll: {
    flexShrink: 1,
  },
  pendingPhotoWrap: {
    marginRight: 6,
    position: 'relative',
  },
  pendingPhotoThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
  },
  pendingRemoveBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingLabel: {
    marginLeft: spacing.sm,
    fontSize: 13,
    color: colors.textSecondary,
  },
  pendingRemove: {
    padding: spacing.sm,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: 4,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.3 },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.bgCard,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  replyBarContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyBarLine: {
    width: 3,
    height: 20,
    backgroundColor: colors.textPrimary,
    borderRadius: 2,
    marginRight: 8,
  },
  replyBarText: {
    flex: 1,
    fontSize: 13,
    color: colors.textMuted,
  },
});
