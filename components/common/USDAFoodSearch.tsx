import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../lib/theme';
import { lookupUSDAAll, USDAReference } from '../../lib/services/food/nutrientEstimator';

interface USDAFoodSearchProps {
  onAddFood: (food: USDAReference & { amountGram: number, customName?: string }) => void;
}

export default function USDAFoodSearch({ onAddFood }: USDAFoodSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<USDAReference[]>([]);
  const [selectedFood, setSelectedFood] = useState<USDAReference | null>(null);
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
    setSelectedFood(null);
  };

  const handleSelect = (food: USDAReference) => {
    setSelectedFood(food);
    setResults([]);
    setCustomName(food.name.split(',')[0]); // Simple base name
  };

  const handleAdd = () => {
    if (selectedFood) {
      const g = parseInt(amountGram, 10) || 100;
      onAddFood({
        ...selectedFood,
        amountGram: g,
        customName: customName || selectedFood.name
      });
      setQuery('');
      setSelectedFood(null);
      setAmountGram('100');
    }
  };

  if (selectedFood) {
    return (
      <View style={styles.selectedContainer}>
        <View style={styles.selectedHeader}>
          <Text style={styles.selectedTitle} numberOfLines={1}>{selectedFood.name}</Text>
          <TouchableOpacity onPress={() => setSelectedFood(null)}>
            <Feather name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { flex: 2 }]}
            value={customName}
            onChangeText={setCustomName}
            placeholder="Display name"
          />
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={amountGram}
            onChangeText={setAmountGram}
            keyboardType="number-pad"
            placeholder="Grams"
          />
          <Text style={styles.unitText}>g</Text>
          <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
            <Feather name="plus" size={16} color={colors.bg} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Feather name="search" size={14} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={handleSearch}
          placeholder="Search exact USDA foods (manual log)..."
          placeholderTextColor={colors.textMuted}
        />
      </View>
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
    marginBottom: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 40,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.xs,
    fontSize: 13,
    color: colors.textPrimary,
  },
  resultsList: {
    maxHeight: 150,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    borderTopWidth: 0,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
  },
  resultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  resultName: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  resultCals: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  selectedContainer: {
    backgroundColor: '#f8f9fa',
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  selectedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  selectedTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: radius.sm,
    height: 36,
    paddingHorizontal: spacing.sm,
    fontSize: 13,
  },
  unitText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  addBtn: {
    width: 36,
    height: 36,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  }
});
