import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable, TouchableOpacity, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { colors, fonts, radius, spacing } from '../../lib/theme';

/* ───────────── Types ───────────── */

interface ItemNutritionModalProps {
  visible: boolean;
  onClose: () => void;
  item: any | null;
}

/* ───────────── Nutrient display config ───────────── */

const NUTRIENT_LABELS: Record<string, { label: string; unit: string; group: 'macro' | 'vitamin' | 'mineral' }> = {
  calories:    { label: 'Calories',     unit: 'kcal', group: 'macro' },
  protein:     { label: 'Protein',      unit: 'g',    group: 'macro' },
  carbs:       { label: 'Carbs',        unit: 'g',    group: 'macro' },
  fat:         { label: 'Fat',          unit: 'g',    group: 'macro' },
  fiber:       { label: 'Fiber',        unit: 'g',    group: 'macro' },
  vitamin_a:   { label: 'Vitamin A',    unit: 'mcg',  group: 'vitamin' },
  vitamin_c:   { label: 'Vitamin C',    unit: 'mg',   group: 'vitamin' },
  vitamin_d:   { label: 'Vitamin D',    unit: 'mcg',  group: 'vitamin' },
  vitamin_e:   { label: 'Vitamin E',    unit: 'mg',   group: 'vitamin' },
  vitamin_k:   { label: 'Vitamin K',    unit: 'mcg',  group: 'vitamin' },
  vitamin_b6:  { label: 'Vitamin B6',   unit: 'mg',   group: 'vitamin' },
  vitamin_b12: { label: 'Vitamin B12',  unit: 'mcg',  group: 'vitamin' },
  folate:      { label: 'Folate (B9)',  unit: 'mcg',  group: 'vitamin' },
  calcium:     { label: 'Calcium',      unit: 'mg',   group: 'mineral' },
  iron:        { label: 'Iron',         unit: 'mg',   group: 'mineral' },
  magnesium:   { label: 'Magnesium',    unit: 'mg',   group: 'mineral' },
  potassium:   { label: 'Potassium',    unit: 'mg',   group: 'mineral' },
  zinc:        { label: 'Zinc',         unit: 'mg',   group: 'mineral' },
  omega3:      { label: 'Omega-3',      unit: 'mg',   group: 'mineral' },
};

const SOURCE_CONFIG: Record<string, { label: string; description: string; bg: string; text: string }> = {
  usda:            { label: 'USDA',            description: 'USDA FoodData Central -- lab-tested, verified data',   bg: '#E8F5E9', text: '#2E7D32' },
  open_food_facts: { label: 'Open Food Facts', description: 'Open Food Facts -- crowdsourced, community-verified', bg: '#FFF3E0', text: '#E65100' },
  database:        { label: 'Local DB',        description: 'Previously verified entry in our database',           bg: '#E3F2FD', text: '#1565C0' },
  ai_estimate:     { label: 'AI Estimate',     description: 'Estimated by AI -- may vary from actual values',      bg: '#F5F5F5', text: '#9E9E9E' },
};

/* ───────────── Component ───────────── */

export default function ItemNutritionModal({ visible, onClose, item }: ItemNutritionModalProps) {
  const [atBottom, setAtBottom] = useState(false);
  const [needsScroll, setNeedsScroll] = useState(false);

  if (!item) return null;

  const name = item.name || item.foodName || 'Unknown';
  const portionG = item.portion_g || item.portionG || 0;
  const cooking = item.cooking || null;
  const householdPortion = item.household_portion || null;
  const nutrients = item.nutrients || {};
  const source = item.nutrient_source || 'ai_estimate';
  const verified = item.verified ?? false;
  const sourceInfo = SOURCE_CONFIG[source] || SOURCE_CONFIG.ai_estimate;

  // Group nutrients
  const macros = Object.entries(NUTRIENT_LABELS).filter(([, v]) => v.group === 'macro');
  const vitamins = Object.entries(NUTRIENT_LABELS).filter(([, v]) => v.group === 'vitamin');
  const minerals = Object.entries(NUTRIENT_LABELS).filter(([, v]) => v.group === 'mineral');

  const formatValue = (key: string, val: number | undefined) => {
    if (val === undefined || val === null) return '--';
    if (key === 'calories') return Math.round(val).toString();
    if (val < 0.1) return '<0.1';
    if (val < 1) return val.toFixed(1);
    return Math.round(val * 10) / 10 + '';
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const isAtBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 10;
    setAtBottom(isAtBottom);
  };

  const handleContentSizeChange = (_w: number, contentH: number) => {
    // We'll compare against the fixed scroll area later
    setNeedsScroll(contentH > 320);
  };

  const renderGroup = (title: string, entries: [string, { label: string; unit: string }][]) => {
    const nonZero = entries.filter(([key]) => nutrients[key] !== undefined && nutrients[key] > 0);
    if (nonZero.length === 0) return null;

    return (
      <View style={ms.group}>
        <Text style={ms.groupTitle}>{title}</Text>
        {nonZero.map(([key, def]) => (
          <View key={key} style={ms.nutrientRow}>
            <Text style={ms.nutrientLabel}>{def.label}</Text>
            <Text style={ms.nutrientValue}>
              {formatValue(key, nutrients[key])}{' '}
              <Text style={ms.nutrientUnit}>{def.unit}</Text>
            </Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Overlay: split into dismiss zone + sheet */}
      <View style={ms.overlay}>
        {/* Tappable background to dismiss */}
        <Pressable style={{ flex: 1 }} onPress={onClose} />

        {/* Sheet -- plain View so it doesn't eat scroll gestures */}
        <View style={ms.sheet}>
          <View style={ms.handle} />

          {/* Food name + portion */}
          <Text style={ms.foodName}>{name}</Text>
          <Text style={ms.portion}>
            {householdPortion ? `${householdPortion} / ` : ''}{portionG}g
            {cooking ? ` -- ${cooking}` : ''}
          </Text>

          {/* Data source badge */}
          <View style={ms.sourceBadgeRow}>
            <View style={[ms.sourceBadge, { backgroundColor: sourceInfo.bg }]}>
              <Text style={[ms.sourceBadgeText, { color: sourceInfo.text }]}>{sourceInfo.label}</Text>
              {verified && <Text style={[ms.verifiedDot, { color: sourceInfo.text }]}> (verified)</Text>}
            </View>
          </View>
          <Text style={ms.sourceDescription}>{sourceInfo.description}</Text>

          <View style={ms.divider} />

          {/* Scrollable nutrients */}
          <View style={{ maxHeight: 360 }}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              onScroll={handleScroll}
              onContentSizeChange={handleContentSizeChange}
              scrollEventThrottle={16}
              bounces={true}
            >
              {renderGroup('MACRONUTRIENTS', macros)}
              {renderGroup('VITAMINS', vitamins)}
              {renderGroup('MINERALS', minerals)}

              {/* Unknown nutrient keys */}
              {Object.entries(nutrients)
                .filter(([key]) => !NUTRIENT_LABELS[key] && typeof nutrients[key] === 'number' && nutrients[key] > 0)
                .length > 0 && (
                <View style={ms.group}>
                  <Text style={ms.groupTitle}>OTHER</Text>
                  {Object.entries(nutrients)
                    .filter(([key]) => !NUTRIENT_LABELS[key] && typeof nutrients[key] === 'number' && nutrients[key] > 0)
                    .map(([key, val]) => (
                      <View key={key} style={ms.nutrientRow}>
                        <Text style={ms.nutrientLabel}>{key.replace(/_/g, ' ')}</Text>
                        <Text style={ms.nutrientValue}>{Math.round((val as number) * 10) / 10}</Text>
                      </View>
                    ))}
                </View>
              )}

              {/* Bottom padding for fade */}
              <View style={{ height: 8 }} />
            </ScrollView>

            {/* Fade overlay to hint more content below */}
            {needsScroll && !atBottom && (
              <View style={ms.fadeOverlay} pointerEvents="none">
                <View style={[ms.fadeBand, { opacity: 0.08 }]} />
                <View style={[ms.fadeBand, { opacity: 0.2 }]} />
                <View style={[ms.fadeBand, { opacity: 0.4 }]} />
                <View style={[ms.fadeBand, { opacity: 0.6 }]} />
                <View style={[ms.fadeBand, { opacity: 0.85 }]} />
                <View style={[ms.fadeBand, { opacity: 1 }]} />
              </View>
            )}
          </View>

          <TouchableOpacity style={ms.closeBtn} onPress={onClose}>
            <Text style={ms.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ───────────── Styles ───────────── */

const ms = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingBottom: 40,
    maxHeight: '72%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  foodName: {
    fontFamily: fonts.heading,
    fontSize: 20,
    color: colors.textPrimary,
    textTransform: 'capitalize',
    marginBottom: 4,
  },
  portion: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  sourceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sourceBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  verifiedDot: {
    fontSize: 11,
    fontWeight: '600',
  },
  sourceDescription: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 12,
    lineHeight: 15,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  group: {
    marginBottom: 16,
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  nutrientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  nutrientLabel: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  nutrientValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  nutrientUnit: {
    fontSize: 11,
    fontWeight: '400',
    color: colors.textMuted,
  },
  fadeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 36,
  },
  fadeBand: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  closeBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: radius.full,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
