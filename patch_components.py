import glob
import os

files = glob.glob('/Users/susannahuang/Documents/GitHub/mittens-app/components/**/*.tsx', recursive=True)

for file in files:
    with open(file, 'r') as f:
        content = f.read()
    
    # We want to replace "profileStyles.section" with "profileStyles.card"
    # and "styles.section" with "styles.card"
    # and "sectionTitle" with "cardTitle" in these specific sections
    if 'profileStyles.' in content or 'styles.' in content:
        new_content = content.replace('profileStyles.section', 'profileStyles.card')
        new_content = new_content.replace('styles.section', 'styles.card')
        
        new_content = new_content.replace('profileStyles.sectionHeader', 'profileStyles.sectionHeader')
        
        # we do want to replace sectionTitle with cardTitle
        new_content = new_content.replace('profileStyles.sectionTitle', 'profileStyles.cardTitle')
        new_content = new_content.replace('styles.sectionTitle', 'styles.cardTitle')
        
        if content != new_content:
            with open(file, 'w') as f:
                f.write(new_content)
            print(f"Patched {file}")

