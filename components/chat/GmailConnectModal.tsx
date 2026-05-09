/**
 * GmailConnectModal -- Stub for open-source version.
 * Gmail integration not available in local-only mode.
 */

import { View, Text, Modal, Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../../lib/theme';

interface GmailConnectModalProps {
  onConnected?: () => void;
  onDismiss?: () => void;
}

export default function GmailConnectModal({ onDismiss }: GmailConnectModalProps) {
  return (
    <Modal visible transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.card}>
          <Text style={s.title}>Gmail Integration</Text>
          <Text style={s.body}>
            Gmail integration is not available in the open-source version.
          </Text>
          <Pressable style={s.button} onPress={onDismiss}>
            <Text style={s.buttonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
  },
  buttonText: {
    color: colors.bg,
    fontWeight: '600',
    fontSize: 14,
  },
});
