import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../lib/theme';
import { getPantryHistory } from '../../lib/services/ambient/smartPantry';

interface Props {
  visible: boolean;
  onClose: () => void;
  itemId: number | null;
  itemName: string;
}

interface HistoryItem {
  id: number;
  qtyChange: number;
  reason: string;
  framePath?: string;
  createdAt: string;
}

export default function PantryEvidenceModal({ visible, onClose, itemId, itemName }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (visible && itemId) {
      const data = getPantryHistory(itemId);
      setHistory(data);
    }
  }, [visible, itemId]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{itemName} History</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
          {history.length === 0 ? (
            <Text style={styles.emptyText}>No update history found.</Text>
          ) : (
            history.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.dateText}>
                    {new Date(item.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </Text>
                  <Text style={[styles.qtyText, { color: item.qtyChange > 0 ? '#34C759' : colors.textPrimary }]}>
                    {item.qtyChange > 0 ? '+' : ''}{item.qtyChange}
                  </Text>
                </View>
                <Text style={styles.reasonText}>{item.reason}</Text>
                {item.framePath ? (
                  <Image source={{ uri: item.framePath }} style={styles.evidenceImage} />
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: spacing.xl,
    fontSize: 15,
  },
  historyCard: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  qtyText: {
    fontSize: 16,
    fontWeight: '700',
  },
  reasonText: {
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 12,
    lineHeight: 20,
  },
  evidenceImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#E5E5EA',
    resizeMode: 'cover',
  },
});
