import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { lookupUSDAAll, USDAReference } from '../../lib/services/food/nutrientEstimator';

interface USDAFoodSearchProps {
  onAddFood: (food: USDAReference & { amountGram: number, customName?: string }) => void;
}

/**
 * USDA food search -- always shows the search box so users
 * can add multiple items sequentially.
 */
export default function USDAFoodSearch({ onAddFood }: USDAFoodSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<USDAReference[]>([]);
  const [pendingFood, setPendingFood] = useState<USDAReference | null>(null);
  const [amountGram, setAmountGram] = useState('100');
  const [customName, setCustomName] = useState('');

  const handleSearch = (text: string) => {
    setQuery(text);
    if (text.length > 2) {
      const hits = lookupUSDAAll(text, 0.2).slice(0, 5);
      setResults(hits);
    } else {
      setResults([]);
    }
    setPendingFood(null);
  };

  const handleSelect = (food: USDAReference) => {
    setPendingFood(food);
    setResults([]);
    setCustomName(food.name.split(',')[0]);
    setAmountGram('100');
  };

  const handleAdd = () => {
    if (pendingFood) {
      const g = parseInt(amountGram, 10) || 100;
      onAddFood({
        ...pendingFood,
        amountGram: g,
        customName: customName || pendingFood.name
      });
      // Reset for next search
      setQuery('');
      setPendingFood(null);
      setAmountGram('100');
      setCustomName('');
    }
  };

  return (
    <View style={styles.container}>
      {/* Inline edit for selected food */}
      {pendingFood && (
        <View style={styles.pendingRow}>
          <View style={styles.pendingInfo}>
            <Text style={styles.pendingName} numberOfLines={1}>{pendingFood.name}</Text>
            <View style={styles.pendingInputs}>
              <TextInput
                style={[styles.input, { flex: 2 }]}
                value={customName}
                onChangeText={setCustomName}
                placeholder="Display name"
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={amountGram}
                onChangeText={setAmountGram}
                keyboardType="number-pad"
                placeholder="g"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.unitText}>g</Text>
              
              <TouchableOpacity
                style={styles.cancelCircle}
                onPress={() => setPendingFood(null)}
              >
                <Feather name="x" size={14} color={colors.textMuted} />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.addCircle} onPress={handleAdd}>
                <Feather name="plus" size={14} color={colors.bg} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Search box -- always visible */}
      <View style={styles.searchBox}>
        <Feather name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={handleSearch}
          placeholder="Search USDA foods..."
          placeholderTextColor={colors.textMuted}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
            <Feather name="x" size={14} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Dropdown results */}
      {results.length > 0 && (
        <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
          {results.map((r) => (
            <TouchableOpacity key={r.fdcId} style={styles.resultItem} onPress={() => handleSelect(r)}>
              <Text style={styles.resultName} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.resultCals}>{Math.round(r.per100g.calories || 0)} kcal/100g</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.xs,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 36,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.xs,
    fontSize: 12,
    color: colors.textPrimary,
  },
  resultsList: {
    maxHeight: 140,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderTopWidth: 0,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
  },
  resultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  resultName: {
    flex: 1,
    fontSize: 12,
    color: colors.textPrimary,
  },
  resultCals: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  pendingRow: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: spacing.xs,
  },
  pendingInfo: { flex: 1 },
  pendingName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  pendingInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#CED4DA',
    borderRadius: 6,
    height: 32,
    paddingHorizontal: 8,
    fontSize: 12,
    color: colors.textPrimary,
  },
  unitText: {
    fontSize: 12,
    color: colors.textMuted,
    marginRight: 2,
  },
  addCircle: {
    width: 32,
    height: 32,
    backgroundColor: colors.textPrimary,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  cancelCircle: {
    width: 32,
    height: 32,
    backgroundColor: '#E9ECEF',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
