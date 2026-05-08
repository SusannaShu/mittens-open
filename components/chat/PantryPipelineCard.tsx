/**
 * PantryPipelineCard -- Inline card for pantry items identified from photos.
 *
 * Shows each identified item with name, quantity, confidence, and edit controls.
 * Mirrors the MealPipelineCard pattern for consistency.
 */

import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';

// ──────────── Types ────────────

export type PantryPipelineStatus = 'identifying' | 'freshness' | 'complete' | 'error';

export interface PantryPipelineItem {
  name: string;
  quantity: string;
  confidence: number;
  status: PantryPipelineStatus;
  freshness?: 'fresh' | 'good' | 'use_soon' | 'questionable';
  storageLocation?: string;
  checkBy?: string;
}

interface PantryPipelineCardProps {
  items: PantryPipelineItem[];
  status: PantryPipelineStatus;
  onItemEdit?: (index: number, newName: string) => void;
  onItemRemove?: (index: number) => void;
  onAddItem?: (name: string) => void;
}

// ──────────── Freshness helpers ────────────

const FRESHNESS_COLORS: Record<string, string> = {
  fresh: '#2ECC71', good: '#27AE60', use_soon: '#F39C12', questionable: '#E74C3C',
};
const FRESHNESS_LABELS: Record<string, string> = {
  fresh: 'Fresh', good: 'Good', use_soon: 'Use Soon', questionable: 'Check',
};

// ──────────── Item Row ────────────

function PantryItemRow({ item, index, onEdit, onRemove }: {
  item: PantryPipelineItem;
  index: number;
  onEdit?: (index: number, newName: string) => void;
  onRemove?: (index: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);

  const handleSubmit = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) {
      onEdit?.(index, trimmed);
    }
    setEditing(false);
  }, [editName, item.name, index, onEdit]);

  const freshColor = item.freshness ? FRESHNESS_COLORS[item.freshness] || '#999' : undefined;
  const freshLabel = item.freshness ? FRESHNESS_LABELS[item.freshness] || item.freshness : undefined;

  return (
    <View style={s.itemRow}>
      {/* Freshness dot or status */}
      {item.status === 'complete' && freshColor ? (
        <View style={[s.freshDot, { backgroundColor: freshColor }]} />
      ) : item.status === 'freshness' ? (
        <ActivityIndicator size="small" color={colors.textMuted} style={{ width: 18 }} />
      ) : (
        <View style={[s.freshDot, { backgroundColor: '#E8E8E8' }]} />
      )}

      {/* Name + quantity */}
      <View style={s.itemInfo}>
        {editing ? (
          <TextInput
            style={s.editInput}
            value={editName}
            onChangeText={setEditName}
            onSubmitEditing={handleSubmit}
            onBlur={handleSubmit}
            autoFocus
            selectTextOnFocus
          />
        ) : (
          <TouchableOpacity
            onPress={() => { setEditName(item.name); setEditing(true); }}
            activeOpacity={0.7}
            disabled={item.status !== 'complete'}
          >
            <View style={s.nameRow}>
              <Text style={item.status === 'complete' ? s.itemNameEditable : s.itemName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.confidence !== undefined && (
                <View style={[
                  s.confBadge,
                  { backgroundColor: item.confidence >= 0.8 ? '#dcfce7' : item.confidence >= 0.5 ? '#fef08a' : '#fee2e2' },
                ]}>
                  <Text style={[
                    s.confText,
                    { color: item.confidence >= 0.8 ? '#166534' : item.confidence >= 0.5 ? '#854d0e' : '#991b1b' },
                  ]}>
                    {Math.round(item.confidence * 100)}%
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}
        <View style={s.detailRow}>
          {item.quantity ? <Text style={s.itemQty}>{item.quantity}</Text> : null}
          {freshLabel && item.status === 'complete' ? (
            <Text style={[s.freshTag, { color: freshColor }]}>{freshLabel}</Text>
          ) : null}
          {item.checkBy && item.status === 'complete' ? (
            <Text style={s.checkBy}>use by {item.checkBy}</Text>
          ) : null}
        </View>
      </View>

      {/* Remove button */}
      {onRemove && (
        <TouchableOpacity
          onPress={() => onRemove(index)}
          style={s.removeBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="x" size={14} color="#CCC" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ──────────── Main Component ────────────

export default function PantryPipelineCard({
  items, status, onItemEdit, onItemRemove, onAddItem,
}: PantryPipelineCardProps) {
  const [addingItem, setAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');

  if (items.length === 0) return null;

  const allComplete = status === 'complete';
  const isIdentifying = status === 'identifying';

  const handleAddSubmit = () => {
    const trimmed = newItemName.trim();
    if (trimmed) {
      onAddItem?.(trimmed);
      setNewItemName('');
      setAddingItem(false);
    }
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Feather name="package" size={13} color={colors.textSecondary} />
        <Text style={s.headerTitle}>
          {allComplete
            ? `${items.length} pantry items`
            : isIdentifying
              ? 'Identifying items...'
              : 'Assessing freshness...'
          }
        </Text>
        {!allComplete && (
          <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 4 }} />
        )}
      </View>

      {/* Item list */}
      <View style={s.itemList}>
        {items.map((item, i) => (
          <PantryItemRow
            key={`${item.name}-${i}`}
            item={item}
            index={i}
            onEdit={onItemEdit}
            onRemove={onItemRemove}
          />
        ))}

        {/* Add item inline */}
        {addingItem ? (
          <View style={s.addItemRow}>
            <Feather name="plus" size={14} color={colors.textMuted} />
            <TextInput
              style={s.addItemInput}
              value={newItemName}
              onChangeText={setNewItemName}
              onSubmitEditing={handleAddSubmit}
              onBlur={() => { if (!newItemName.trim()) setAddingItem(false); }}
              placeholder="Item name..."
              autoFocus
              returnKeyType="done"
            />
            <TouchableOpacity onPress={handleAddSubmit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="check" size={16} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        ) : onAddItem && allComplete ? (
          <TouchableOpacity style={s.addItemBtn} onPress={() => setAddingItem(true)} activeOpacity={0.7}>
            <Feather name="plus" size={13} color={colors.textMuted} />
            <Text style={s.addItemText}>Add item</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Progress bar when not complete */}
      {!allComplete && (
        <View style={s.progressBar}>
          <View style={[
            s.progressFill,
            { width: isIdentifying ? '30%' : '70%' },
          ]} />
        </View>
      )}
    </View>
  );
}

// ──────────── Styles ────────────

const s = StyleSheet.create({
  container: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  itemList: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },

  freshDot: {
    width: 8, height: 8, borderRadius: 4,
  },

  itemInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  itemNameEditable: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'capitalize',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },
  confBadge: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  confText: {
    fontSize: 9,
    fontWeight: 'bold',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 1,
  },
  itemQty: {
    fontSize: 11,
    color: colors.textMuted,
  },
  freshTag: {
    fontSize: 10,
    fontWeight: '600',
  },
  checkBy: {
    fontSize: 10,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  editInput: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.textPrimary,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  removeBtn: {
    padding: 2,
  },

  progressBar: {
    height: 2,
    backgroundColor: '#ECECEC',
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.textPrimary,
  },

  // Add item
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  addItemInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    borderBottomWidth: 1,
    borderBottomColor: colors.textMuted,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    opacity: 0.6,
  },
  addItemText: {
    fontSize: 11,
    color: colors.textMuted,
  },
});
