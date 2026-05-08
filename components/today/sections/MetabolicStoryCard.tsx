import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../../../lib/theme';
import { todayStyles as styles } from '../../../styles/todayStyles';

interface Props {
  metabolicStory: string;
  activitySummary: { activities: string[] } | null;
  collapsed: boolean;
  onToggle: () => void;
}

export default function MetabolicStoryCard({ metabolicStory, activitySummary, collapsed, onToggle }: Props) {
  return (
    <View style={styles.storyCard}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        onPress={onToggle}
        activeOpacity={0.6}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Feather name="activity" size={14} color={colors.textSecondary} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginLeft: 6 }}>METABOLIC STORY</Text>
        </View>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {!collapsed && (
        <>
          <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginTop: 6 }}>
            {metabolicStory}
          </Text>
          {activitySummary && activitySummary.activities.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
              {activitySummary.activities.map((act: string, i: number) => (
                <View key={i} style={{ backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '500' }}>{act}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
