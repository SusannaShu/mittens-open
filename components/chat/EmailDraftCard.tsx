/**
 * EmailDraftCard -- preview card for composed emails.
 * Shows to/subject/body with Send / Edit / Cancel actions.
 * Send is gated behind explicit user tap -- never auto-sends.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { EmailDraft } from '../../lib/pipelines/types';

interface EmailDraftCardProps {
  draft: EmailDraft;
  onSend?: (draft: EmailDraft) => void;
  onEdit?: (draft: EmailDraft) => void;
  onCancel?: () => void;
}

export default function EmailDraftCard({ draft, onSend, onEdit, onCancel }: EmailDraftCardProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(draft.body);
  const [editSubject, setEditSubject] = useState(draft.subject);

  if (cancelled) return null;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Feather name="send" size={14} color={colors.textPrimary} />
        <Text style={styles.headerText}>Email Draft</Text>
      </View>

      {/* To */}
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>To</Text>
        <Text style={styles.fieldValue} numberOfLines={1}>
          {draft.to || 'Unknown recipient'}
        </Text>
      </View>

      {/* Subject */}
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>Subject</Text>
        {editing ? (
          <TextInput
            style={styles.editInput}
            value={editSubject}
            onChangeText={setEditSubject}
            placeholder="Subject"
          />
        ) : (
          <Text style={styles.fieldValue} numberOfLines={1}>{draft.subject}</Text>
        )}
      </View>

      {/* Body */}
      <View style={styles.bodyContainer}>
        {editing ? (
          <TextInput
            style={[styles.editInput, styles.bodyInput]}
            value={editBody}
            onChangeText={setEditBody}
            placeholder="Message body"
            multiline
            textAlignVertical="top"
          />
        ) : (
          <Text style={styles.bodyText} numberOfLines={6}>{draft.body}</Text>
        )}
      </View>

      {/* Actions */}
      {!sent ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={() => {
              setCancelled(true);
              onCancel?.();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          {editing ? (
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => {
                setEditing(false);
                onEdit?.({ ...draft, subject: editSubject, body: editBody });
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.editBtnText}>Done</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => setEditing(true)}
              activeOpacity={0.7}
            >
              <Feather name="edit-2" size={12} color={colors.textPrimary} />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
            onPress={async () => {
              if (sending) return;
              setSending(true);
              try {
                const finalDraft = editing
                  ? { ...draft, subject: editSubject, body: editBody }
                  : draft;
                await onSend?.(finalDraft);
                setSent(true);
              } catch {
                setSending(false);
              }
            }}
            activeOpacity={0.7}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="send" size={12} color="#fff" />
                <Text style={styles.sendText}>Send</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.sentBadge}>
          <Feather name="check-circle" size={14} color="#4CAF50" />
          <Text style={styles.sentText}>Sent</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
  },
  fieldLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    width: 50,
  },
  fieldValue: {
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
  bodyContainer: {
    marginTop: 8,
  },
  bodyText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  editInput: {
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#fff',
  },
  bodyInput: {
    minHeight: 80,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editBtnText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  sentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sentText: {
    fontSize: 13,
    color: '#4CAF50',
    fontWeight: '600',
  },
});
