const fs = require('fs');
let s = fs.readFileSync('lib/pipelines/food/mealPlanPipeline.ts', 'utf8');

// Fix lines 282-295 by replacing real newlines with '\\n' inside the result += statements
s = s.replace(/result \+= '=== MACRO TARGETS \(HIGHEST PRIORITY\) ===\n';/g, "result += '=== MACRO TARGETS (HIGHEST PRIORITY) ===\\n';\n");
s = s.replace(/result \+= macroGaps\.map\(formatGap\)\.join\('\n'\);/g, "result += macroGaps.map(formatGap).join('\\n');\n");
s = s.replace(/result \+= '\n\n';/g, "result += '\\n\\n';\n");
s = s.replace(/result \+= '=== MICRONUTRIENT TARGETS ===\n';/g, "result += '=== MICRONUTRIENT TARGETS ===\\n';\n");
s = s.replace(/result \+= microGaps\.map\(formatGap\)\.join\('\n'\);/g, "result += microGaps.map(formatGap).join('\\n');\n");

// Fix ALREADY EATEN TODAY newlines
s = s.replace(/ALREADY EATEN TODAY:\n\$\{todayMeals/g, "ALREADY EATEN TODAY:\\n\\${todayMeals");
s = s.replace(/\}\)\.join\('\n'\)\}\n\nDo NOT/g, "}).join('\\n')}\\n\\nDo NOT");

// Fix Prompt literal braces
s = s.replace(/\\$\{/g, '${');

fs.writeFileSync('lib/pipelines/food/mealPlanPipeline.ts', s);
