import glob

files = [
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/profile/ActivityTypeEditor.tsx',
    '/Users/susannahuang/Documents/GitHub/mittens-app/components/profile/PeopleSection.tsx'
]

for file in files:
    try:
        with open(file, 'r') as f:
            content = f.read()
            
        new_content = content.replace('ps.section', 'ps.card')
        new_content = new_content.replace('ps.sectionTitle', 'ps.cardTitle')
        new_content = new_content.replace('styles.section', 'styles.card')
        new_content = new_content.replace('styles.sectionTitle', 'styles.cardTitle')
        
        if content != new_content:
            with open(file, 'w') as f:
                f.write(new_content)
            print(f"Patched {file}")
    except Exception as e:
        print(f"Failed {file} {e}")

