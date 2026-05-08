import re

file_path = '/Users/susannahuang/Documents/GitHub/mittens-app/app/(tabs)/schedule.tsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Remove Bio and Activity Types from their current position
bio_pattern = r"\{/\* ─── GROUP 2: BIOLOGICAL PROFILE ─── \*/\}\s*<View style=\{styles\.section\}>\s*<ProfileBioSection\s*profileContext=\{profileContext\}\s*collapsed=\{collapsed\.bio\}\s*onToggle=\{\(\) => toggleSection\('bio'\)\}\s*onSaved=\{fetchData\}\s*/>\s*</View>"
activity_pattern = r"\{/\* ─── GROUP 3: ACTIVITY TYPES ─── \*/\}\s*<View style=\{styles\.section\}>\s*<ActivityTypeEditor\s*collapsed=\{collapsed\.activities\}\s*onToggle=\{\(\) => toggleSection\('activities'\)\}\s*/>\s*</View>"

content = re.sub(bio_pattern, "", content)
content = re.sub(activity_pattern, "", content)

# 2. Extract PendantSection
pendant_pattern = r"<PendantSection\s*collapsed=\{collapsed\.pendant\}\s*onToggle=\{\(\) => toggleSection\('pendant'\)\}\s*onOpenFeed=\{\(\) => router\.push\('/pendant-feed'\)\}\s*/>"
content = re.sub(pendant_pattern, "", content)

# 3. Insert them above GROUP 1: MITTENS
# Wait, let's locate GROUP 1
group1_pattern = r"\{/\* ─── GROUP 1: MITTENS ─── \*/\}"
new_sections = """
        {/* ─── TOP LEVEL CARDS ─── */}
        <ProfileBioSection
          profileContext={profileContext}
          collapsed={collapsed.bio}
          onToggle={() => toggleSection('bio')}
          onSaved={fetchData}
        />
        <ActivityTypeEditor
          collapsed={collapsed.activities}
          onToggle={() => toggleSection('activities')}
        />
        <PendantSection
          collapsed={collapsed.pendant}
          onToggle={() => toggleSection('pendant')}
          onOpenFeed={() => router.push('/pendant-feed')}
        />

        {/* ─── GROUP 1: MITTENS ─── */}"""

content = content.replace("{/* ─── GROUP 1: MITTENS ─── */}", new_sections)

# 4. Inject Travel Mode into Notifications
# Let's see how Notifications section looks right now
# We want it right after the Departure Alarms <Switch /> inside its <View style={{ flexDirection: 'row', ...}}>...
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
                    )}
                  </View>"""

# Find the end of the notifications View (gap: 12) block
# Wait, we can just replace `</View>\n                )}` that closes the `gap: 12` view.
# Let's find exactly: `thumbColor="#FFF"\n                      />\n                    </View>\n                  </View>\n                )}`
end_notif_pattern = r'thumbColor="#FFF"\s*/>\s*</View>\s*</View>\s*\)\}'
repl_notif = 'thumbColor="#FFF"\n                      />\n                    </View>' + travel_mode_code + '\n                )}'
content = re.sub(end_notif_pattern, repl_notif, content)

with open(file_path, 'w') as f:
    f.write(content)

print("schedule.tsx patched.")
