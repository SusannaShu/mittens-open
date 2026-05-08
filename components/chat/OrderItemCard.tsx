/**
 * OrderItemCard -- displays parsed order items from email pipeline.
 * Horizontally scrollable when multiple items. "Add to closet" saves to wardrobe_items.
 */

import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import type { EmailOrderItem } from '../../lib/pipelines/types';

const CATEGORY_ICONS: Record<string, string> = {
  dress: 'sun',
  top: 'triangle',
  bottom: 'minus',
  shoes: 'navigation',
  bag: 'shopping-bag',
  accessory: 'star',
  other: 'circle',
};

function formatPrice(price?: { amount: number; currency: string }): string {
  if (!price) return '';
  const symbol = price.currency === 'USD' ? '$' : price.currency === 'EUR' ? '\u20AC' : price.currency === 'GBP' ? '\u00A3' : '';
  return `${symbol}${price.amount.toFixed(2)}`;
}

interface OrderItemCardProps {
  items: EmailOrderItem[];
  onAddToCloset?: (item: EmailOrderItem, index: number) => void;
  onSkip?: (index: number) => void;
}

function SingleOrderCard({ item, index, onAddToCloset, onSkip }: {
  item: EmailOrderItem;
  index: number;
  onAddToCloset?: (item: EmailOrderItem, index: number) => void;
  onSkip?: (index: number) => void;
}) {
  const [added, setAdded] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const iconName = CATEGORY_ICONS[item.category] || 'circle';
  const priceStr = formatPrice(item.price);

  if (skipped) return null;

  return (
    <View style={styles.card}>
      {/* Header row: icon + name + image */}
      <View style={styles.cardHeader}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.itemImage} />
        ) : (
          <View style={styles.iconBox}>
            <Feather name={iconName as any} size={18} color={colors.textPrimary} />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.itemName} numberOfLines={2}>{item.itemName}</Text>
          {item.brand ? <Text style={styles.itemBrand}>{item.brand}</Text> : null}
        </View>
      </View>

      {/* Details row */}
      <View style={styles.detailsRow}>
        {priceStr ? (
          <View style={styles.detailBadge}>
            <Text style={styles.detailText}>{priceStr}</Text>
          </View>
        ) : null}
        {item.size ? (
          <View style={styles.detailBadge}>
            <Text style={styles.detailText}>Size {item.size}</Text>
          </View>
        ) : null}
        {item.color ? (
          <View style={styles.detailBadge}>
            <Text style={styles.detailText}>{item.color}</Text>
          </View>
        ) : null}
        {item.category !== 'other' ? (
          <View style={styles.detailBadge}>
            <Text style={styles.detailText}>{item.category}</Text>
          </View>
        ) : null}
      </View>

      {/* Retailer + date */}
      <View style={styles.metaRow}>
        {item.retailer ? (
          <Text style={styles.metaText}>{item.retailer}</Text>
        ) : null}
        {item.orderDate ? (
          <Text style={styles.metaText}>{item.orderDate}</Text>
        ) : null}
        {item.status ? (
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, item.status === 'delivered' && styles.statusDelivered]} />
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        ) : null}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {!added ? (
          <>
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={() => {
                setSkipped(true);
                onSkip?.(index);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                setAdded(true);
                onAddToCloset?.(item, index);
              }}
              activeOpacity={0.7}
            >
              <Feather name="plus" size={13} color="#fff" />
              <Text style={styles.addText}>Add to closet</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.addedBadge}>
            <Feather name="check" size={13} color="#4CAF50" />
            <Text style={styles.addedText}>Added to closet</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function OrderItemCard({ items, onAddToCloset, onSkip }: OrderItemCardProps) {
  if (items.length === 0) return null;

  const useHorizontal = items.length >= 2;

  const cards = items.map((item, i) => (
    <View key={i} style={useHorizontal ? styles.hCard : undefined}>
      <SingleOrderCard
        item={item}
        index={i}
        onAddToCloset={onAddToCloset}
        onSkip={onSkip}
      />
    </View>
  ));

  return (
    <View style={styles.container}>
      {useHorizontal ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hScroll}
        >
          {cards}
        </ScrollView>
      ) : (
        cards
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  hScroll: {
    gap: 8,
    paddingRight: 8,
  },
  hCard: {
    width: 240,
  },
  card: {
    backgroundColor: '#F8F8F8',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemImage: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#ECECEC',
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#ECECEC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 18,
  },
  itemBrand: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
  },
  detailBadge: {
    backgroundColor: '#ECECEC',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  detailText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  metaText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },
  statusDelivered: {
    backgroundColor: '#4CAF50',
  },
  statusText: {
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'capitalize',
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
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  addText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  addedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addedText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '500',
  },
});
