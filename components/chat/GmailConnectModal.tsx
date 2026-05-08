/**
 * GmailConnectModal -- shown inline in chat when user triggers email action
 * but Gmail isn't connected. Prompts to connect with a brief explanation.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { connectGmail } from '../../lib/services/gmailService';

interface GmailConnectModalProps {
  onConnected?: () => void;
  onDismiss?: () => void;
}

export default function GmailConnectModal({ onConnected, onDismiss }: GmailConnectModalProps) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');

  if (connected) {
    return (
      <View style={styles.card}>
        <View style={styles.successRow}>
          <Feather name="check-circle" size={18} color="#4CAF50" />
          <Text style={styles.successText}>Gmail connected. Try your request again.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* Icon + title */}
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Feather name="mail" size={20} color={colors.textPrimary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Connect Gmail</Text>
          <Text style={styles.subtitle}>Mittens needs access to your Gmail to do this</Text>
        </View>
      </View>

      {/* Scope explanation */}
      <View style={styles.scopeList}>
        <View style={styles.scopeRow}>
          <Feather name="search" size={12} color={colors.textMuted} />
          <Text style={styles.scopeText}>Search and read your emails</Text>
        </View>
        <View style={styles.scopeRow}>
          <Feather name="send" size={12} color={colors.textMuted} />
          <Text style={styles.scopeText}>Send emails on your behalf</Text>
        </View>
        <View style={styles.scopeRow}>
          <Feather name="lock" size={12} color={colors.textMuted} />
          <Text style={styles.scopeText}>Data stays on your device</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.notNowBtn}
          onPress={onDismiss}
          activeOpacity={0.7}
        >
          <Text style={styles.notNowText}>Not now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.connectBtn, connecting && styles.connectBtnDisabled]}
          onPress={async () => {
            if (connecting) return;
            setConnecting(true);
            setError('');
            try {
              const ok = await connectGmail();
              if (ok) {
                setConnected(true);
                onConnected?.();
              } else {
                setError('Could not connect. Try again.');
              }
            } catch {
              setError('Connection failed. Check your network.');
            }
            setConnecting(false);
          }}
          activeOpacity={0.7}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="link" size={13} color="#fff" />
              <Text style={styles.connectText}>Connect Gmail</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#ECECEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  scopeList: {
    marginTop: 12,
    gap: 6,
    paddingLeft: 52,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scopeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 12,
    color: '#D32F2F',
    marginTop: 8,
    paddingLeft: 52,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  notNowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notNowText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  connectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  connectBtnDisabled: {
    opacity: 0.5,
  },
  connectText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    fontSize: 13,
    color: '#4CAF50',
    fontWeight: '600',
    flex: 1,
  },
});
