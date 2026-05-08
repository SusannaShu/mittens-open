/**
 * PantryEditModal -- Edit a pantry item's name, quantity, and freshness.
 * Matches the EditModal style from TodayModals.
 */

import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TextInput,
  TouchableOpacity, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { colors, fonts, radius, spacing } from '../../lib/theme';

interface PantryEditModalProps {
  visible: boolean;
  onClose: () => void;
  item: { id: number; foodName: string; quantity?: string; freshness: string } | null;
  onSave: (id: number, data: { foodName: string; quantity: string; freshness: string }) => void;
  onDelete: (id: number) => void;
}

const FRESHNESS_OPTIONS = [
  { value: 'fresh', label: 'Fresh', color: '#2ECC71' },
  { value: 'good', label: 'Good', color: '#27AE60' },
  { value: 'use_soon', label: 'Use Soon', color: '#F39C12' },
  { value: 'questionable', label: 'Check', color: '#E74C3C' },
];

export default function PantryEditModal({ visible, onClose, item, onSave, onDelete }: PantryEditModalProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [freshness, setFreshness] = useState('fresh');

  useEffect(() => {
    if (item) {
      setName(item.foodName || '');
      setQuantity(item.quantity || '');
      setFreshness(item.freshness || 'fresh');
    }
  }, [item]);

  if (!item) return null;

  const hasChanges = name !== item.foodName || quantity !== (item.quantity || '') || freshness !== item.freshness;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={s.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%', alignItems: 'center' }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={s.content}>
              <Text style={s.title}>Edit Pantry Item</Text>

              {/* Name */}
              <Text style={s.label}>NAME</Text>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Item name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />

              {/* Quantity */}
              <Text style={s.label}>QUANTITY</Text>
              <TextInput
                style={s.input}
                value={quantity}
                onChangeText={setQuantity}
                placeholder="e.g. 2 cups, 1 bag"
                placeholderTextColor={colors.textMuted}
              />

              {/* Freshness picker */}
              <Text style={s.label}>FRESHNESS</Text>
              <View style={s.freshnessRow}>
                {FRESHNESS_OPTIONS.map((opt) => {
                  const isActive = freshness === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[s.freshnessBtn, isActive && { backgroundColor: opt.color, borderColor: opt.color }]}
                      onPress={() => setFreshness(opt.value)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.freshnessBtnText, isActive && { color: '#FFF' }]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Save */}
              <TouchableOpacity
                style={[s.saveBtn, !name.trim() && { opacity: 0.4 }]}
                onPress={() => {
                  if (name.trim()) {
                    onSave(item.id, { foodName: name.trim(), quantity: quantity.trim(), freshness });
                  }
                }}
                disabled={!name.trim()}
              >
                <Text style={s.saveBtnText}>Save Changes</Text>
              </TouchableOpacity>

              {/* Bottom actions */}
              <View style={s.bottomRow}>
                <TouchableOpacity onPress={() => onDelete(item.id)}>
                  <Text style={s.deleteText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  content: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: 340,
    maxWidth: '100%',
  },
  title: {
    fontFamily: fonts.heading,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    backgroundColor: '#FAFAFA',
  },
  freshnessRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.lg,
    flexWrap: 'wrap',
  },
  freshnessBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  freshnessBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  saveBtn: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.full,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  saveBtnText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '700',
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#D32F2F',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
});
