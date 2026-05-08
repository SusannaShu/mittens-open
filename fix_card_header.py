import glob

files = glob.glob('/Users/susannahuang/Documents/GitHub/mittens-app/components/**/*.tsx', recursive=True)

for file in files:
    try:
        with open(file, 'r') as f:
            content = f.read()
            
        new_content = content.replace('cardHeader', 'sectionHeader')
        
        if 'MittensBrainSection.tsx' in file:
            new_content = new_content.replace('name="cpu"', 'name="hard-drive"')
            
        if content != new_content:
            with open(file, 'w') as f:
                f.write(new_content)
            print(f"Patched {file}")
    except Exception as e:
        pass
