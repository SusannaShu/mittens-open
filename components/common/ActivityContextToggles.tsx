/**
 * ActivityContextToggles -- Movement (MET) and Brain Hygiene context toggles.
 *
 * Follows the same visual pattern as Outdoors/Nature toggles in the
 * ActivityEditModal. Movement expands to show MET chip selector with
 * calorie estimation. Brain Hygiene shows polarity (positive for meditation/
 * journal, negative for scrolling) with expandable scrolling-minutes input
 * and peer-reviewed citations.
 */

import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../lib/theme';
import { activityEditStyles as s } from './activityEditStyles';

const MET_PRESETS = [
  { value: 1.0, label: 'Yoga' },
  { value: 2.5, label: 'Dance' },
  { value: 3.5, label: 'Walk' },
  { value: 5.0, label: 'Gym' },
  { value: 8.0, label: 'Run' },
];

interface Props {
  isMovement: boolean;
  setIsMovement: (v: boolean) => void;
  metValue: number | null;
  setMetValue: (v: number) => void;
  durationMin: string;

  isBrainHygiene: boolean;
  setIsBrainHygiene: (v: boolean) => void;
  brainHygienePolarity: 'positive' | 'negative' | null;
  scrollingMin: string;
  setScrollingMin: (v: string) => void;
}

export default function ActivityContextToggles({
  isMovement, setIsMovement, metValue, setMetValue, durationMin,
  isBrainHygiene, setIsBrainHygiene, brainHygienePolarity,
  scrollingMin, setScrollingMin,
}: Props) {
  return (
    <>
      {/* Toggle chips: Movement & Brain Hygiene */}
      <View style={s.contextToggleRow}>
        <TouchableOpacity
          style={[s.sunscreenToggle, isMovement && s.sunscreenToggleActive]}
          onPress={() => setIsMovement(!isMovement)}
          activeOpacity={0.6}
        >
          <Text style={[s.sunscreenToggleText, isMovement && s.sunscreenToggleTextActive]}>
            <Feather name="activity" size={11} /> Movement
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            s.sunscreenToggle,
            isBrainHygiene && (brainHygienePolarity === 'negative'
              ? s.brainHygieneNegToggle
              : s.sunscreenToggleActive),
          ]}
          onPress={() => setIsBrainHygiene(!isBrainHygiene)}
          activeOpacity={0.6}
        >
          <Text style={[
            s.sunscreenToggleText,
            isBrainHygiene && (brainHygienePolarity === 'negative'
              ? s.brainHygieneNegText
              : s.sunscreenToggleTextActive),
          ]}>
            <Feather name="cpu" size={11} /> Brain Hygiene
          </Text>
        </TouchableOpacity>
      </View>

      {/* Movement expanded: MET value */}
      {isMovement && (
        <View style={s.sunSection}>
          <Text style={s.label}>Metabolic Equivalent (MET)</Text>
          <View style={s.coverageRow}>
            {MET_PRESETS.map(({ value, label }) => (
              <TouchableOpacity
                key={value}
                style={[s.coverageChip, metValue === value && s.coverageChipActive]}
                onPress={() => setMetValue(value)}
                activeOpacity={0.6}
              >
                <Text style={[s.coverageChipPct, metValue === value && s.coverageChipPctActive]}>{value}</Text>
                <Text style={[s.coverageChipLabel, metValue === value && s.coverageChipLabelActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {metValue != null && (
            <Text style={s.vitDNote}>
              {metValue} MET x {durationMin || '0'}min = ~{Math.round((metValue || 1) * parseInt(durationMin || '0', 10) * 0.0175 * 70)} kcal burned
            </Text>
          )}
        </View>
      )}

      {/* Brain Hygiene expanded */}
      {isBrainHygiene && (
        <View style={s.sunSection}>
          <View style={s.sunscreenRow}>
            <Text style={s.sunscreenLabel}>
              {brainHygienePolarity === 'positive' ? 'Mindful practice' : 'Screen / multitasking'}
            </Text>
            <View style={[s.brainPolarityBadge, brainHygienePolarity === 'negative' && s.brainPolarityBadgeNeg]}>
              <Text style={s.brainPolarityText}>
                {brainHygienePolarity === 'positive' ? '+' : '-'}
              </Text>
            </View>
          </View>
          {brainHygienePolarity === 'negative' && (
            <View style={{ marginTop: spacing.sm }}>
              <Text style={s.label}>Scrolling minutes</Text>
              <TextInput
                style={[s.input, { width: 80 }]}
                value={scrollingMin}
                onChangeText={setScrollingMin}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={s.vitDNote}>
                Ophir et al. (2009): media multitasking reduces cognitive control.
                Each minute of task-switching costs up to 40% of productive time.
              </Text>
            </View>
          )}
          {brainHygienePolarity === 'positive' && (
            <Text style={s.vitDNote}>
              Pennebaker (1997): expressive writing improves immune function
              and cognitive processing. Journaling and meditation strengthen
              prefrontal regulation.
            </Text>
          )}
        </View>
      )}
    </>
  );
}
