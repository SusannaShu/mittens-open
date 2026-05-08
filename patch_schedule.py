import re

file_path = '/Users/susannahuang/Documents/GitHub/mittens-app/app/(tabs)/schedule.tsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Promote Bio and Activity to top level groups instead of HEALTH
health_group_pattern = r"\{/\* ─── GROUP 2: HEALTH ─── \*/\}(.*?)\{/\* ─── GROUP 3: LIFE DESIGN ─── \*/\}"
health_group_match = re.search(health_group_pattern, content, re.DOTALL)
if health_group_match:
    health_content = health_group_match.group(1)
    
    # We replace GROUP 2 with:
    # GROUP 2: BIOLOGICAL PROFILE
    # GROUP 3: ACTIVITY TYPES
    # And push LIFE DESIGN to GROUP 4, etc.
    new_health = """        {/* ─── GROUP 2: BIOLOGICAL PROFILE ─── */}
        <View style={styles.section}>
          <ProfileBioSection
            profileContext={profileContext}
            collapsed={collapsed.bio}
            onToggle={() => toggleSection('bio')}
            onSaved={fetchData}
          />
        </View>

        {/* ─── GROUP 3: ACTIVITY TYPES ─── */}
        <View style={styles.section}>
          <ActivityTypeEditor
            collapsed={collapsed.activities}
            onToggle={() => toggleSection('activities')}
          />
        </View>

        """
    content = content.replace(health_content, new_health)

# 2. Fix Connections Props
connections_pattern = r"<ProfileConnectionsSection\s*profileContext=\{profileContext\}\s*collapsed=\{collapsed\.integrations\}\s*onToggle=\{\(\) => toggleSection\('integrations'\)\}\s*onRefresh=\{fetchData\}\s*/>"
new_connections = """<ProfileConnectionsSection
                profileContext={profileContext}
                onRefresh={fetchData}
              />"""
content = re.sub(connections_pattern, new_connections, content, flags=re.DOTALL)

# 3. Add Travel Mode to Notifications
travel_mode_code = """
                    {departureNotif && (
                      <View style={{ paddingHorizontal: 0, paddingVertical: 8, marginTop: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 8 }}>TRAVEL MODE (FOR ALARMS)</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {(['transit', 'bicycling', 'walking', 'driving'] as const).map(mode => (
                            <TouchableOpacity
                              key={mode}
                              style={[profileStyles.actBtn, (profileContext?.travelMode || 'transit') === mode && profileStyles.actBtnActive]}
                              onPress={() => updateProfile({ travelMode: mode }).then(fetchData)}
                            >
                              <Text style={[profileStyles.actText, (profileContext?.travelMode || 'transit') === mode && profileStyles.actTextActive]}>
                                {mode}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}"""

notifications_end_pattern = r"</View>\s*\)\}\s*</View>\s*\{/\* Dev Hub \*/\}"
# Wait, let's find the exact place.
# It is under Departure Alarms switch.
departure_pattern = r"(<Text style=\{\{ fontSize: 12, color: colors\.textMuted, marginTop: 1 \}\}>Leave-by alerts for calendar events</Text>\s*</View>\s*<Switch\s*value=\{departureNotif\}[^>]*>\s*</View>)"
new_departure = r"\1" + travel_mode_code

content = re.sub(departure_pattern, new_departure, content, flags=re.DOTALL)

# Also need to import profileStyles in schedule.tsx if not already there, for travel mode buttons.
# Let's check if profileStyles is imported.
if "import { profileStyles" not in content:
    content = content.replace("import { StyleSheet, ", "import { profileStyles } from '../components/profile/profileStyles';\nimport { StyleSheet, ")

# Remove `collapsed` from Props in ProfileConnectionsSection if not done
with open(file_path, 'w') as f:
    f.write(content)

print("schedule.tsx patched.")
