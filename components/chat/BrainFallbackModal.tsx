import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { colors, radius, spacing } from '../../lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { canRunModel } from '../../lib/services/ai/tierSelector';

interface BrainOption {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  sub: string;
  /** If set, this is a local model — check canRunModel before enabling */
  localModelId?: string;
}

interface BrainGroup {
  label: string;
  options: BrainOption[];
}

interface BrainFallbackModalProps {
  visible: boolean;
  errorMsg: string;
  failedBrain: string;
  onSelectBrain: (brainId: string) => void;
  onClose: () => void;
}

const BRAIN_GROUPS: BrainGroup[] = [
  {
    label: 'Cloud',
    options: [
      { id: 'groq-free', name: 'Groq', icon: 'flash', sub: 'Llama 4 Scout' },
      { id: 'openrouter-free', name: 'OpenRouter', icon: 'planet', sub: 'Gemma 4 free' },
    ],
  },
  {
    label: 'Private',
    options: [
      { id: 'ollama-selfhost', name: 'Self-Hosted', icon: 'server', sub: 'Ollama' },
      { id: 'ollama-byok', name: 'BYOK', icon: 'key', sub: 'Own key' },
    ],
  },
  {
    label: 'On-Device',
    options: [
      { id: 'smolvlm2-256m', name: 'SmolVLM2', icon: 'hardware-chip', sub: '256M', localModelId: 'smolvlm2-256m' },
      { id: 'fastvlm-0.5b', name: 'FastVLM', icon: 'hardware-chip', sub: '0.5B', localModelId: 'fastvlm-0.5b' },
      { id: 'moondream2', name: 'Moondream', icon: 'hardware-chip', sub: '1.9B', localModelId: 'moondream2' },
      { id: 'gemma-e2b', name: 'Gemma E2B', icon: 'hardware-chip', sub: '4B', localModelId: 'gemma-e2b' },
    ],
  },
];

export default function BrainFallbackModal({
  visible,
  errorMsg,
  failedBrain,
  onSelectBrain,
  onClose,
}: BrainFallbackModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name="warning" size={20} color={colors.textPrimary} />
            </View>
            <Text style={styles.title}>Brain Had Trouble</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.errorText} numberOfLines={2}>
            {errorMsg}
          </Text>

          <Text style={styles.subtitle}>Switch to:</Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {BRAIN_GROUPS.map((group) => {
              const filtered = group.options.filter((b) => b.id !== failedBrain);
              if (filtered.length === 0) return null;
              return (
                <View key={group.label}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={styles.chipRow}>
                    {filtered.map((brain) => {
                      // Smart capability check for local models
                      const capability = brain.localModelId
                        ? canRunModel(brain.localModelId)
                        : { canRun: true };
                      const isDisabled = !capability.canRun;

                      if (isDisabled && capability.reason === 'soon') return null;

                      return (
                        <TouchableOpacity
                          key={brain.id}
                          style={[styles.chip, isDisabled && styles.chipDisabled]}
                          onPress={() => !isDisabled && onSelectBrain(brain.id)}
                          disabled={isDisabled}
                        >
                          <Ionicons
                            name={brain.icon}
                            size={16}
                            color={isDisabled ? colors.textMuted : colors.textPrimary}
                            style={{ marginRight: 6 }}
                          />
                          <View>
                            <Text style={[styles.chipName, isDisabled && styles.chipNameDisabled]}>
                              {brain.name}
                            </Text>
                            <Text style={styles.chipSub}>
                              {isDisabled ? capability.reason : brain.sub}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  container: {
    backgroundColor: colors.bg,
    borderRadius: radius.xl,
    width: '100%',
    maxWidth: 360,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.textPrimary + '12',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
  },
  errorText: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.md,
    backgroundColor: colors.bgCard,
    padding: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  list: {
    maxHeight: 320,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: spacing.sm,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border + '40',
  },
  chipDisabled: {
    opacity: 0.35,
  },
  chipName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 16,
  },
  chipNameDisabled: {
    color: colors.textMuted,
  },
  chipSub: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 14,
  },
  cancelBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
