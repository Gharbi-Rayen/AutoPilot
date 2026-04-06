const fs = require('fs');
let code = fs.readFileSync('src/features/executions/components/csv-join/dialog.tsx', 'utf8');

const injectionRegex = /(<\/form>)/;
const injectionStr = `
                {estimate && estimate.estimatedOutputRows >= 0 && (
                  <div className="my-4 rounded-md border p-3 flex justify-between items-center bg-muted/30">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">Estimated Output</span>
                      <span className="text-xs text-muted-foreground">~{estimate.estimatedOutputRows.toLocaleString()} rows</span>
                    </div>
                    {estimate.riskLevel !== "low" && (
                      <div className={\`px-2 py-1 rounded text-xs font-semibold border \${estimate.riskLevel === 'high' ? 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300' : 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300'}\`}>
                        {estimate.riskLevel.toUpperCase()} RISK
                      </div>
                    )}
                  </div>
                )}
              </form>`;

code = code.replace(injectionRegex, injectionStr);
fs.writeFileSync('src/features/executions/components/csv-join/dialog.tsx', code);
