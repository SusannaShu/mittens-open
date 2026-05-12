/**
 * VoicePickerSection -- Voice selection for Mittens' TTS output.
 *
 * Shows available Kokoro neural voices as selectable pills.
 * Includes a "Preview" button to hear a sample of each voice.
 * Falls back to displaying "Native TTS" if Kokoro is unavailable.
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { profileStyles as styles } from './profileStyles';
import {
  KOKORO_VOICES,
  getKokoroVoice,
  setKokoroVoice,
  isKokoroReady,
  type KokoroVoiceId,
  type KokoroVoiceOption,
} from '../../lib/services/ai/kokoroVoice';
import { speak } from '../../lib/services/ai/voiceService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Constants ───

const STORAGE_KEY = '@mittens_voice_id';

const PREVIEW_PHRASES: Record<string, string> = {
  af_heart: "Hey, looks like you're having a good day.",
  af_bella: "What should we do today?",
  af_nicole: "I've got your schedule ready.",
  af_sarah: "Just checking in, how are you feeling?",
  af_sky: "The weather looks beautiful outside.",
  am_adam: "Ready when you are.",
  am_michael: "Let's get started on that.",
  am_liam: "That sounds like a plan to me.",
};

// ─── Props ───

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

// ─── Component ───

export function VoicePickerSection({ collapsed, onToggle }: Props) {
  const [selectedVoice, setSelectedVoice] = useState<KokoroVoiceId>(getKokoroVoice());
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [kokoroAvailable, setKokoroAvailable] = useState(false);

  // Load saved voice on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved && KOKORO_VOICES.some((v) => v.id === saved)) {
          setSelectedVoice(saved as KokoroVoiceId);
          setKokoroVoice(saved as KokoroVoiceId);
        }
      } catch { /* ignore */ }

      // Check if Kokoro is ready
      setKokoroAvailable(isKokoroReady());
    })();
  }, []);

  const handleSelectVoice = useCallback(async (voiceId: KokoroVoiceId) => {
    setSelectedVoice(voiceId);
    setKokoroVoice(voiceId);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, voiceId);
    } catch { /* ignore */ }
  }, []);

  const handlePreview = useCallback((voice: KokoroVoiceOption) => {
    setPreviewing(voice.id);
    const phrase = PREVIEW_PHRASES[voice.id] || "Hello, I'm Mittens.";

    // Temporarily set this voice for the preview
    setKokoroVoice(voice.id);
    speak(phrase, () => {
      setPreviewing(null);
      // Restore the actual selected voice after preview
      setKokoroVoice(selectedVoice);
    });
  }, [selectedVoice]);

  const renderVoicePill = (voice: KokoroVoiceOption) => {
    const isActive = selectedVoice === voice.id;
    const isPreviewing = previewing === voice.id;

    return (
      <TouchableOpacity
        key={voice.id}
        style={[
          styles.actBtn,
          {
            minWidth: 72,
            alignItems: 'center',
            paddingVertical: 6,
            paddingHorizontal: 10,
          },
          isActive && styles.actBtnActive,
        ]}
        onPress={() => handleSelectVoice(voice.id)}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.actText,
            { fontSize: 11 },
            isActive && styles.actTextActive,
          ]}
        >
          {voice.label}
        </Text>
        <Text
          style={[
            { fontSize: 9, color: colors.textMuted, marginTop: 1 },
            isActive && { color: 'rgba(255,255,255,0.7)' },
          ]}
        >
          {voice.style}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={[styles.sectionHeader, !collapsed && { marginBottom: spacing.sm }]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="mic" size={16} color={colors.textPrimary} />
          <Text style={styles.cardTitle}>MITTENS' VOICE</Text>
          {kokoroAvailable && (
            <View
              style={{
                backgroundColor: '#E8F5E9',
                borderRadius: radius.full,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ fontSize: 9, color: '#2E7D32', fontWeight: '600' }}>
                Neural
              </Text>
            </View>
          )}
        </View>
        <Feather
          name={collapsed ? 'chevron-right' : 'chevron-down'}
          size={16}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      {!collapsed && (
        <>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.md }}>
            {kokoroAvailable
              ? 'Kokoro on-device neural voice. Runs locally, no internet needed.'
              : 'Using native iOS voice. Install Kokoro for natural speech.'}
          </Text>

          {/* Female voices */}
          <View style={{ marginBottom: 8 }}>
            <Text style={styles.rowLabel}>FEMALE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {KOKORO_VOICES.filter((v) => v.gender === 'female').map(renderVoicePill)}
            </ScrollView>
          </View>

          {/* Male voices */}
          <View style={{ marginBottom: 8 }}>
            <Text style={styles.rowLabel}>MALE</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {KOKORO_VOICES.filter((v) => v.gender === 'male').map(renderVoicePill)}
            </ScrollView>
          </View>

          {/* Preview button */}
          <TouchableOpacity
            onPress={() => {
              const voice = KOKORO_VOICES.find((v) => v.id === selectedVoice);
              if (voice) handlePreview(voice);
            }}
            disabled={!!previewing}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              backgroundColor: previewing ? colors.border : colors.textPrimary,
              borderRadius: radius.full,
              paddingVertical: 8,
              paddingHorizontal: 16,
              alignSelf: 'flex-start',
              marginTop: 4,
              opacity: previewing ? 0.6 : 1,
            }}
          >
            <Feather
              name={previewing ? 'loader' : 'play'}
              size={12}
              color={previewing ? colors.textMuted : '#fff'}
            />
            <Text
              style={{
                fontSize: 12,
                color: previewing ? colors.textMuted : '#fff',
                fontWeight: '600',
              }}
            >
              {previewing ? 'Playing...' : `Preview "${KOKORO_VOICES.find((v) => v.id === selectedVoice)?.label}"`}
            </Text>
          </TouchableOpacity>

          {/* Info line */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm }}>
            <Feather name="volume-2" size={12} color={colors.textMuted} />
            <Text style={{ flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16 }}>
              {kokoroAvailable
                ? '82M parameter Kokoro model. Processes speech entirely on your device.'
                : 'Kokoro model will download (~100 MB) on first use. After that, fully offline.'}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
