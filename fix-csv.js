const fs = require('fs');
let code = fs.readFileSync('src/features/executions/components/csv-column-stats/executor.ts', 'utf8');

const replacement = `            const serialized = String(value);
            if (entry.uniqueValues.size < MAX_UNIQUE_VALUES_TRACKED) {
              entry.uniqueValues.add(serialized);
              entry.frequencies.set(
                serialized,
                (entry.frequencies.get(serialized) || 0) + 1,
              );
            } else {
              entry.overflowed = true;
            }`;

code = code.replace(/\s*const serialized = String\(value\);\s*entry\.uniqueValues\.add\(serialized\);\s*entry\.frequencies\.set\(\s*serialized,\s*\(entry\.frequencies\.get\(serialized\) \|\| 0\) \+ 1,\s*\);/, "\n" + replacement);

const replacement2 = `
          let uniqueValueCount: string | number;
          let frequencyTableTruncated: boolean;
          let note: string | undefined;

          if (entry.overflowed) {
            uniqueValueCount = \`\${MAX_UNIQUE_VALUES_TRACKED}+\`;
            frequencyTableTruncated = true;
            note = "Frequency table truncated at 10,000 unique values. Column has high cardinality — stats are approximate.";
          } else {
            uniqueValueCount = entry.uniqueValues.size;
            frequencyTableTruncated = false;
          }

          return {
            field,
            total: entry.total,
            nonNull: entry.nonNull,
            nullCount: entry.nullCount,
            uniqueCount: uniqueValueCount,
            frequencyTableTruncated,
            ... (note ? { note } : {}),
            numericCount: entry.numericCount,
`;

code = code.replace(/\s*return \{\s*field,\s*total: entry\.total,\s*nonNull: entry\.nonNull,\s*nullCount: entry\.nullCount,\s*uniqueCount: entry\.uniqueValues\.size,\s*numericCount: entry\.numericCount,/, replacement2);

fs.writeFileSync('src/features/executions/components/csv-column-stats/executor.ts', code);
