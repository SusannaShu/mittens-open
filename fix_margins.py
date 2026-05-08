import re

files = [
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/profile/ProfileBioSection.tsx',
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/profile/ProfileIntegrationsSection.tsx',
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/profile/ActivityTypeEditor.tsx',
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/profile/PeopleSection.tsx',
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/pendant/PendantSection.tsx',
]

for file in files:
    with open(file, 'r') as f:
        content = f.read()
    # Find style={styles.sectionHeader} or style={ps.sectionHeader} or style={profileStyles.sectionHeader}
    content = re.sub(r'style=\{styles\.sectionHeader\}', r'style={[styles.sectionHeader, !collapsed && { marginBottom: 16 }]}', content)
    content = re.sub(r'style=\{ps\.sectionHeader\}', r'style={[ps.sectionHeader, !collapsed && { marginBottom: 16 }]}', content)
    content = re.sub(r'style=\{profileStyles\.sectionHeader\}', r'style={[profileStyles.sectionHeader, !collapsed && { marginBottom: 16 }]}', content)
    
    # Normalize existing ones
    content = content.replace("!collapsed && { marginBottom: spacing.sm }", "!collapsed && { marginBottom: 16 }")
    
    with open(file, 'w') as f:
        f.write(content)

# Now schedule.tsx
schedule_file = '/Users/susannahuang/Documents/GitHub/mittens-app/app/(tabs)/schedule.tsx'
with open(schedule_file, 'r') as f:
    sched_content = f.read()

# Top level groups
groups = ['mittens', 'health', 'lifeDesign', 'connections', 'settings']
for g in groups:
    pattern = r"style=\{styles\.sectionHeader\}\s+onPress=\{\(\) => toggleGroup\('" + g + r"'\)\}"
    repl = f"style={{[styles.sectionHeader, !collapsedGroups.{g} && {{ marginBottom: 16 }}]}} onPress={{() => toggleGroup('{g}')}}"
    sched_content = re.sub(pattern, repl, sched_content)

# Dev hub and outreach hub don't have collapsed state, they just route. 
# But wait, they are single items inside the settings group. They shouldn't have marginBottom if they are just links! 
# Let's check them. 

with open(schedule_file, 'w') as f:
    f.write(sched_content)

print("Done")
