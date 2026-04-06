const fs = require('fs');
let code = fs.readFileSync('src/features/executions/components/csv-column-stats/executor.ts', 'utf8');

code = code.replace(
  /const serialized = String\(value\);\s*entry\.uniqueValues\.add\(serialized\);\s*entry\.frequencies\.set\(\s*serialized,\s*\(entry\.frequencies\.get\(serialized\) \|\| 0\) \+ 1,\s*\);/,
  `const serialized = String(value);
            if (entry.uniqueValues.size < MAX_UNIQUE_VALUES_TRACKED || entry.uniqueValues.has(serialized)) {
              entry.uniqueValues.add(serialized);
              entry.frequencies.set(
                serialized,
                (entry.frequencies.get(serialized) || 0) + 1,
              );
            } else {
              entry.overflowed = true;
            }`
);

fs.writeFileSync('src/features/executions/components/csv-column-stats/executor.ts', code);
