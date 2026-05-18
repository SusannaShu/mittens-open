const fs = require('fs');
const file = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');

// The block to extract:
const blockRegex = /\n  \/\/ Generate meal plan via local brain[\s\S]*?}, 1500\);\n  };\n/m;
const match = file.match(blockRegex);
if (match) {
  let newFile = file.replace(blockRegex, '\n');
  const hIndex = newFile.indexOf('const h = useTodayHandlers(refetch);');
  if (hIndex !== -1) {
    newFile = newFile.slice(0, hIndex) + match[0].trim() + '\n\n  const h = useTodayHandlers(refetch, triggerMealPlanRegeneration);\n' + newFile.slice(hIndex + 'const h = useTodayHandlers(refetch);'.length);
    fs.writeFileSync('app/(tabs)/index.tsx', newFile);
    console.log("Success");
  } else {
    console.log("Could not find h = useTodayHandlers");
  }
} else {
  console.log("Could not find block");
}
