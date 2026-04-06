const fs = require('fs');
let code = fs.readFileSync('src/features/executions/components/csv-column-stats/executor.ts', 'utf8');

code = code.replace(
  'type CsvColumnStatsData = {',
  'const MAX_UNIQUE_VALUES_TRACKED = 10_000;\n\ntype CsvColumnStatsData = {'
);

code = code.replace(
  'uniqueValues: Set<string>;\n            frequencies: Map<string, number>;\n          }\n        >();',
  'uniqueValues: Set<string>;\n            frequencies: Map<string, number>;\n            overflowed: boolean;\n          }\n        >();'
);

code = code.replace(
  'uniqueValues: new Set<string>(),\n            frequencies: new Map<string, number>(),\n          });',
  'uniqueValues: new Set<string>(),\n            frequencies: new Map<string, number>(),\n            overflowed: false,\n          });'
);

const consumeOld = `const serialized = String(value);
            entry.uniqueValues.add(serialized);
            entry.frequencies.set(
              serialized,
              (entry.frequencies.get(serialized) || 0) + 1,
            );`;

const consumeNew = `const serialized = String(value);
            if (entry.uniqueValues.size < MAX_UNIQUE_VALUES_TRACKED || entry.uniqueValues.has(serialized)) {
              entry.uniqueValues.add(serialized);
              entry.frequencies.set(
                serialized,
                (entry.frequencies.get(serialized) || 0) + 1,
              );
            } else {
              entry.overflowed = true;
            }`;

if (!code.includes(consumeOld)) {
  console.log("Could not find consume row logic. Using loose regex.");
  code = code.replace(/const serialized = String\(value\);\s*entry\.uniqueValues\.add\(serialized\);\s*entry\.frequencies\.set\(\s*serialized,\s*\(entry\.frequencies\.get\(serialized\) \|\| 0\) \+ 1,\s*\);/, "\n" + consumeNew);
} else {
  code = code.replace(consumeOld, consumeNew);
}

const mapOutputOld = `return {
            field,
            total: entry.total,
            nonNull: entry.nonNull,
            nullCount: entry.nullCount,
            uniqueCount: entry.uniqueValues.size,
            numericCount: entry.numericCount,`;

const mapOutputNew = `
          let uniqueCountValue: number | string = entry.uniqueValues.size;
          let frequencyTableTruncated = false;
          let note: string | undefined;

          if (entry.overflowed) {
             uniqueCountValue = \`\${MAX_UNIQUE_VALUES_TRACKED}+\`;
             frequencyTableTruncated = true;
             note = "Frequency table truncated at 10,000 unique values. Column has high cardinality — stats are approximate.";
          }

          return {
            field,
            total: entry.total,
            nonNull: entry.nonNull,
            nullCount: entry.nullCount,
            uniqueCount: uniqueCountValue,
            frequencyTableTruncated,
            ...(note ? { note } : {}),
            numericCount: entry.numericCount,`;

if (!code.includes(mapOutputOld)) {
    console.error("Could not find map output old.");
} else {
    code = code.replace(mapOutputOld, mapOutputNew);
}

fs.writeFileSync('src/features/executions/components/csv-column-stats/executor.ts', code);
console.log("Done");
