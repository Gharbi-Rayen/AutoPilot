const fs = require('fs');
let code = fs.readFileSync('src/features/executions/components/csv-column-stats/executor.ts', 'utf8');

const oldStr = `        const records = Array.from(stats.entries()).map(([field, entry]) => {
          const topValues = Array.from(entry.frequencies.entries())
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5)
            .map(([value, count]) => ({ value, count }));

          return {
            field,
            total: entry.total,
            nonNull: entry.nonNull,
            nullCount: entry.nullCount,
            uniqueCount: entry.uniqueValues.size,
            numericCount: entry.numericCount,
            min: entry.min,
            max: entry.max,
            sum: entry.numericCount > 0 ? entry.sum : null,
            avg: entry.numericCount > 0 ? entry.sum / entry.numericCount : null,
            topValues,
          };
        });`;

const newStr = `        const records = Array.from(stats.entries()).map(([field, entry]) => {
          const topValues = Array.from(entry.frequencies.entries())
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5)
            .map(([value, count]) => ({ value, count }));

          let uniqueValueCount: number | string = entry.uniqueValues.size;
          let frequencyTableTruncated = false;
          let note: string | undefined;

          if (entry.overflowed) {
             uniqueValueCount = \`\${MAX_UNIQUE_VALUES_TRACKED}+\`;
             frequencyTableTruncated = true;
             note = "Frequency table truncated at 10,000 unique values. Column has high cardinality — stats are approximate.";
          }

          return {
            field,
            total: entry.total,
            nonNull: entry.nonNull,
            nullCount: entry.nullCount,
            uniqueCount: uniqueValueCount,
            frequencyTableTruncated,
            ...(note ? { note } : {}),
            numericCount: entry.numericCount,
            min: entry.min,
            max: entry.max,
            sum: entry.numericCount > 0 ? entry.sum : null,
            avg: entry.numericCount > 0 ? entry.sum / entry.numericCount : null,
            topValues,
          };
        });`;

code = code.replace(oldStr, newStr);
if (!code.includes("frequencyTableTruncated")) {
  // Try regex if exact literal match failed due to whitespace
  code = code.replace(/const records = Array\.from\(stats\.entries\(\)\)\.map\(\(\[field,\s*entry\]\) => \{[\s\S]*?return \{[\s\S]*?topValues,\s*\};\s*\}\);/, newStr);
  console.log("Used regex for map replacement");
}
fs.writeFileSync('src/features/executions/components/csv-column-stats/executor.ts', code);
