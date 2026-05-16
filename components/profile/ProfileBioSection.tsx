import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { updateProfile } from '../../lib/api';
import { colors, radius, spacing } from '../../lib/theme';
import { profileStyles as styles } from './profileStyles';

const FITZPATRICK_COLORS: Record<number, string> = {
  1: '#FAE0D0', 2: '#F5CBA7', 3: '#E5B280',
  4: '#C68642', 5: '#8D5524', 6: '#3C2218',
};

function calculateTDEE(profile: any): number {
  if (profile.tdeeKcal) return profile.tdeeKcal;
  const wKg = profile.weightKg || (profile.weightLb ? profile.weightLb * 0.453592 : 0);
  const hCm = profile.heightCm || (profile.heightIn ? profile.heightIn * 2.54 : 0);
  if (!wKg || !hCm || !profile.age) return 0;
  
  let bmr = 10 * wKg + 6.25 * hCm - 5 * profile.age;
  bmr += profile.sex === 'male' ? 5 : -161;
  
  const activityMultipliers: Record<string, number> = {
    sedentary: 1.2, lightly_active: 1.375, moderately_active: 1.55, very_active: 1.725
  };
  return Math.round(bmr * (activityMultipliers[profile.activityLevel] || 1.2));
}

interface Props {
  profileContext: any;
  collapsed: boolean;
  onToggle: () => void;
  onSaved: () => void;
}

export function ProfileBioSection({ profileContext, collapsed, onToggle, onSaved }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editUnit, setEditUnit] = useState<'metric' | 'imperial'>('metric');
  const [editHeight, setEditHeight] = useState('');
  const [editHeightFt, setEditHeightFt] = useState('');
  const [editHeightIn, setEditHeightIn] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editSex, setEditSex] = useState<'female' | 'male'>('female');
  const [editActivity, setEditActivity] = useState('sedentary');
  const [editSkinType, setEditSkinType] = useState('fitzpatrick-4');
  const [editWorkIntervalMins, setEditWorkIntervalMins] = useState(45);
  const [editPhysicalGoal, setEditPhysicalGoal] = useState('');
  const [saving, setSaving] = useState(false);

  const handleEdit = () => {
    const unit = profileContext?.preferredUnit || 'imperial';
    setEditUnit(unit);
    if (unit === 'imperial') {
      const inches = profileContext?.heightIn || 0;
      setEditHeightFt(inches ? String(Math.floor(inches / 12)) : '');
      setEditHeightIn(inches ? String(inches % 12) : '');
      setEditWeight(String(profileContext?.weightLb || ''));
    } else {
      setEditHeight(String(profileContext?.heightCm || ''));
      setEditWeight(String(profileContext?.weightKg || ''));
    }
    setEditAge(String(profileContext?.age || ''));
    setEditSex(profileContext?.sex || 'female');
    setEditActivity(profileContext?.activityLevel || 'sedentary');
    setEditSkinType(profileContext?.skinType || 'fitzpatrick-4');
    setEditWorkIntervalMins(profileContext?.workIntervalMins || 45);
    setEditPhysicalGoal(profileContext?.breakPhysicalGoal || '');
    setIsEditing(true);
  };

  const handleUnitToggle = (unit: 'metric' | 'imperial') => {
    if (unit === editUnit) return;
    const currentH = parseFloat(editHeight) || 0;
    const currentW = parseFloat(editWeight) || 0;
    const totalInches = (parseInt(editHeightFt) || 0) * 12 + (parseInt(editHeightIn) || 0);
    if (unit === 'imperial') {
      const computedInches = currentH ? Math.round(currentH / 2.54) : 0;
      setEditHeightFt(computedInches ? String(Math.floor(computedInches / 12)) : '');
      setEditHeightIn(computedInches ? String(computedInches % 12) : '');
      setEditWeight(currentW ? Math.round(currentW * 2.20462).toString() : '');
    } else {
      setEditHeight(totalInches ? Math.round(totalInches * 2.54).toString() : '');
      setEditWeight(currentW ? parseFloat((currentW / 2.20462).toFixed(1)).toString() : '');
    }
    setEditUnit(unit);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        age: parseInt(editAge, 10), sex: editSex, activityLevel: editActivity,
        skinType: editSkinType, preferredUnit: editUnit, workIntervalMins: editWorkIntervalMins,
        breakPhysicalGoal: editPhysicalGoal,
      };
      if (editUnit === 'imperial') {
        payload.heightIn = (parseInt(editHeightFt, 10) || 0) * 12 + (parseInt(editHeightIn, 10) || 0);
        payload.weightLb = parseFloat(editWeight);
      } else {
        payload.heightCm = parseInt(editHeight, 10);
        payload.weightKg = parseFloat(editWeight);
      }
      await updateProfile(payload);
      setIsEditing(false);
      onSaved();
    } catch (e: any) {
      require('react-native').Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!profileContext) return null;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={[styles.sectionHeader, !collapsed && { marginBottom: 16 }]} onPress={onToggle} activeOpacity={0.7}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="activity" size={16} color={colors.textPrimary} />
          <Text style={styles.cardTitle}>BIOLOGICAL PROFILE</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!isEditing && collapsed && (
            <TouchableOpacity onPress={(e) => { e.stopPropagation(); handleEdit(); if (collapsed) onToggle(); }}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          )}
          <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          {!isEditing && (
            <TouchableOpacity onPress={handleEdit} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          )}

          {isEditing ? (
            <View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Unit</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => handleUnitToggle('metric')} style={[styles.choiceBtn, { width: undefined, paddingHorizontal: 8 }, editUnit === 'metric' && styles.choiceBtnActive]}><Text style={[styles.choiceText, editUnit === 'metric' && styles.choiceTextActive]}>Metric</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => handleUnitToggle('imperial')} style={[styles.choiceBtn, { width: undefined, paddingHorizontal: 8 }, editUnit === 'imperial' && styles.choiceBtnActive]}><Text style={[styles.choiceText, editUnit === 'imperial' && styles.choiceTextActive]}>Imperial</Text></TouchableOpacity>
                </View>
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Sex</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setEditSex('female')} style={[styles.choiceBtn, editSex === 'female' && styles.choiceBtnActive]}><Text style={[styles.choiceText, editSex === 'female' && styles.choiceTextActive]}>F</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setEditSex('male')} style={[styles.choiceBtn, editSex === 'male' && styles.choiceBtnActive]}><Text style={[styles.choiceText, editSex === 'male' && styles.choiceTextActive]}>M</Text></TouchableOpacity>
                </View>
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Age</Text>
                <TextInput style={styles.editInput} value={editAge} onChangeText={setEditAge} keyboardType="numeric" />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>{editUnit === 'imperial' ? 'Height' : 'Height (cm)'}</Text>
                {editUnit === 'imperial' ? (
                  <View style={{ flexDirection: 'row', gap: 6, width: 90 }}>
                    <TextInput style={[styles.editInput, { flex: 1, paddingHorizontal: 2 }]} value={editHeightFt} onChangeText={setEditHeightFt} keyboardType="numeric" placeholder="ft" />
                    <TextInput style={[styles.editInput, { flex: 1, paddingHorizontal: 2 }]} value={editHeightIn} onChangeText={setEditHeightIn} keyboardType="numeric" placeholder="in" />
                  </View>
                ) : (
                  <TextInput style={styles.editInput} value={editHeight} onChangeText={setEditHeight} keyboardType="numeric" />
                )}
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>{editUnit === 'imperial' ? 'Weight (lbs)' : 'Weight (kg)'}</Text>
                <TextInput style={styles.editInput} value={editWeight} onChangeText={setEditWeight} keyboardType="numeric" />
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Activity</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
                  {['sedentary', 'lightly_active', 'moderately_active', 'very_active'].map(act => {
                    const label = act === 'lightly_active' ? 'Light' : 
                                  act === 'moderately_active' ? 'Moderate' : 
                                  act === 'very_active' ? 'Very' : 'Sedentary';
                    return (
                    <TouchableOpacity key={act} style={[styles.actBtn, editActivity === act && styles.actBtnActive]} onPress={() => setEditActivity(act)}>
                      <Text style={[styles.actText, editActivity === act && styles.actTextActive]}>{label}</Text>
                    </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Skin Type</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6].map(level => {
                    const val = `fitzpatrick-${level}`;
                    const selected = editSkinType === val;
                    return (
                      <TouchableOpacity key={val} onPress={() => setEditSkinType(val)}
                        style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: FITZPATRICK_COLORS[level] || '#CCC', borderWidth: selected ? 2 : 1, borderColor: selected ? colors.textPrimary : 'rgba(0,0,0,0.1)' }}
                      />
                    );
                  })}
                </View>
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Focus Timer (m)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
                  {[15, 30, 45, 60, 90].map(mins => (
                    <TouchableOpacity key={mins} style={[styles.actBtn, editWorkIntervalMins === mins && styles.actBtnActive]} onPress={() => setEditWorkIntervalMins(mins)}>
                      <Text style={[styles.actText, editWorkIntervalMins === mins && styles.actTextActive]}>{mins}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.editRow}>
                <Text style={styles.profileKey}>Physical Break Goal</Text>
                <TextInput
                  style={[styles.input, { flex: 1, textAlign: 'right' }]}
                  placeholder="e.g. 30 pushups and 10 pull ups"
                  placeholderTextColor={colors.textMuted}
                  value={editPhysicalGoal}
                  onChangeText={setEditPhysicalGoal}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: '#EEE' }]} onPress={() => setIsEditing(false)} disabled={saving}>
                  <Text style={[styles.saveBtnText, { color: colors.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View>
              {profileContext.preferredUnit === 'imperial' ? (
                <>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileKey}>HEIGHT:</Text>
                    <Text style={styles.profileVal}>
                      {Math.floor((profileContext.heightIn || 0) / 12)}'{((profileContext.heightIn || 0) % 12)}" ({profileContext.heightIn} in)
                    </Text>
                  </View>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileKey}>WEIGHT:</Text>
                    <Text style={styles.profileVal}>{profileContext.weightLb} lbs</Text>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileKey}>HEIGHT:</Text>
                    <Text style={styles.profileVal}>{profileContext.heightCm} cm</Text>
                  </View>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileKey}>WEIGHT:</Text>
                    <Text style={styles.profileVal}>{profileContext.weightKg} kg</Text>
                  </View>
                </>
              )}
              <View style={styles.profileRow}>
                <Text style={styles.profileKey}>SEX & AGE:</Text>
                <Text style={styles.profileVal}>{String(profileContext.sex).toUpperCase()}, {profileContext.age} yrs</Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileKey}>ACTIVITY:</Text>
                <Text style={styles.profileVal}>{String(profileContext.activityLevel || 'SEDENTARY').replace('_', ' ').toUpperCase()}</Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileKey}>ESTIMATED TDEE:</Text>
                <Text style={styles.profileVal}>~{calculateTDEE(profileContext) || '?'} kcal/day</Text>
              </View>
              <View style={styles.profileRow}>
                <Text style={styles.profileKey}>FOCUS TIMER:</Text>
                <Text style={styles.profileVal}>{profileContext.workIntervalMins || 45} mins</Text>
              </View>
              {profileContext.breakPhysicalGoal ? (
                <View style={styles.profileRow}>
                  <Text style={styles.profileKey}>BREAK GOAL:</Text>
                  <Text style={styles.profileVal}>{profileContext.breakPhysicalGoal}</Text>
                </View>
              ) : null}
              <View style={[styles.profileRow, { alignItems: 'center' }]}>
                <Text style={styles.profileKey}>DAILY RHYTHMS:</Text>
                <TouchableOpacity onPress={() => require('expo-router').router.push('/settings/schedule')}>
                  <Text style={[styles.editLink, { color: colors.accent }]}>Manage Schedule &gt;</Text>
                </TouchableOpacity>
              </View>
              {profileContext.skinType && (
                <View style={styles.profileRow}>
                  <Text style={styles.profileKey}>SKIN TYPE:</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{
                      width: 14, height: 14, borderRadius: 7,
                      backgroundColor: FITZPATRICK_COLORS[parseInt(profileContext.skinType.split('-')[1]) as keyof typeof FITZPATRICK_COLORS] || '#CCC',
                      borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
                    }} />
                    <Text style={styles.profileVal}>Type {profileContext.skinType.split('-')[1]}</Text>
                  </View>
                </View>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}
