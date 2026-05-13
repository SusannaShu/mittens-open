/**
 * ActivityContextToggles -- Movement (MET) context toggle.
 *
 * Follows the same visual pattern as Outdoors/Nature toggles in the
 * ActivityEditModal. Movement expands to show MET chip selector with
 * calorie estimation based on Compendium of Physical Activities (Ainsworth 2011).
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
}

export default function ActivityContextToggles({
  isMovement, setIsMovement, metValue, setMetValue, durationMin,
}: Props) {
  return (
    <>
      {/* Movement toggle chip */}
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
    </>
  );
}
