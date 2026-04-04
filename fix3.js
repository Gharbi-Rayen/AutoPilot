const fs = require('fs');
const file = 'src/features/editor/components/workflow-progress-panel.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. shrink-0 fix
code = code.replace(
  '<Loader2Icon\n        className={cn("animate-spin", colorMap[status])}\n        size={size}\n      />',
  '<Loader2Icon className={cn("shrink-0 animate-spin", colorMap[status])} size={size} />'
);
code = code.replace(/<CheckCircle2Icon className=\{cn\(colorMap\[status\]\)\} size=\{size\} \/>/g, '<CheckCircle2Icon className={cn("shrink-0", colorMap[status])} size={size} />');
code = code.replace(/<XCircleIcon className=\{cn\(colorMap\[status\]\)\} size=\{size\} \/>/g, '<XCircleIcon className={cn("shrink-0", colorMap[status])} size={size} />');
code = code.replace(/<Clock3Icon className=\{cn\(colorMap\[status\]\)\} size=\{size\} \/>/g, '<Clock3Icon className={cn("shrink-0", colorMap[status])} size={size} />');

// 2. Add Maximize2Icon & Dialog imports
if (!code.includes('Maximize2Icon,')) code = code.replace('Loader2Icon,', 'Loader2Icon,\n  Maximize2Icon,');
if (!code.includes('DialogContent')) code = code.replace('import { Button } from "@/components/ui/button";', 'import { Button } from "@/components/ui/button";\nimport { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";');

// 3. Add expand state
code = code.replace('const [isMetadataCollapsed, setIsMetadataCollapsed] = useState(true);', 'const [isMetadataCollapsed, setIsMetadataCollapsed] = useState(true);\n  const [isOutputExpanded, setIsOutputExpanded] = useState(false);');

// 4. Constants for thresholds
code = code.replace(/const isOutputPayloadLarge =[\s\S]*?outputPayloadText\.split\("\\n"\)\.length > 220;/, `const isOutputTooLargeToRender = outputPayloadText.length > 500000;
  const isOutputPayloadLarge = outputPayloadText.length > 24000 || outputPayloadText.split("\\n").length > 400;`);

// 5. Remove "Load raw output" feature and rely entirely on auto-fetching
code = code.replace('const [isRawOutputRequested, setIsRawOutputRequested] = useState(false);', '');
code = code.replace('enabled: Boolean(activeExecutionId) && isRawOutputRequested,', 'enabled: Boolean(activeExecutionId),');
code = code.replace('setIsRawOutputRequested(false);', '');
code = code.replace(/    useEffect\(\(\) => \{\n      if \(!isRawOutputRequested\) \{\n        return;\n      \}\n\n      setExecutionResult\(executionRawOutputQuery\.data\?\.output \?\? null\);\n    \}, \[executionRawOutputQuery\.data, isRawOutputRequested, setExecutionResult\]\);\n/, `    useEffect(() => {
      setExecutionResult(executionRawOutputQuery.data?.output ?? null);
    }, [executionRawOutputQuery.data, setExecutionResult]);\n`);

// Remove handleLoadRawOutput entirely
code = code.replace(/  const handleLoadRawOutput = \(\) => \{\n    if \(!activeExecutionId\) \{\n      return;\n    \}\n\n    setIsRawOutputRequested\(true\);\n  \};\n/, '');

// Find block rendering manual load: `{requiresRawOutputForSelection && !isRawOutputRequested ... `
let blockToReplace = `{requiresRawOutputForSelection &&
                      !isRawOutputRequested &&
                      activeExecutionId ? (
                        <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                          <p>
                            Load raw output to inspect node payload details.
                          </p>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-3 h-8 text-xs"
                            onClick={handleLoadRawOutput}
                          >
                            <DownloadIcon className="size-3.5" />
                            Load output
                          </Button>
                        </div>
                      ) : `;
code = code.replace(blockToReplace, '');

// Update dataset viewer enabled attribute
code = code.replace('enabled={isRawOutputRequested}', 'enabled={true}');

// Replace outputPayloadText rendering entirely
let outputUIStart = `                      ) : outputPayloadText ? (
                        <div className="overflow-hidden rounded-md border border-border bg-muted/25">`;
let outputUIEnd = `                          <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-6 text-muted-foreground">
                            {outputPayloadPreview}
                          </pre>
                        </div>
                      ) : (`;

const newOutputUI = `                      ) : outputPayloadText ? (
                        <div className="overflow-hidden rounded-md border border-border bg-muted/25">
                          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                              Step output
                            </span>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setIsOutputExpanded(true)}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <Maximize2Icon className="size-3" />
                                Expand
                              </button>

                              <button
                                type="button"
                                onClick={() => handleCopy(outputPayloadText, "output")}
                                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <CopyIcon className="size-3" />
                                {copiedState === "output" ? "Copied" : "Copy"}
                              </button>

                              {isOutputPayloadLarge && (
                                <button
                                  type="button"
                                  onClick={handleDownloadOutput}
                                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  <DownloadIcon className="size-3" />
                                  Download
                                </button>
                              )}
                            </div>
                          </div>

                          {isOutputTooLargeToRender ? (
                            <div className="flex flex-col items-center justify-center p-8 border-t border-border/80 text-amber-500 bg-amber-950/10">
                              <div className="flex items-center gap-2 mb-4">
                                <AlertTriangleIcon className="size-5 shrink-0" />
                                <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                                  Output size is too large to render ( &gt; 1MB )
                                </span>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDownloadOutput}
                                className="h-8 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                              >
                                <DownloadIcon className="mr-1.5 size-3.5" />
                                Download Raw Data
                              </Button>
                            </div>
                          ) : (
                            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-6 text-muted-foreground">
                              {outputPayloadPreview}
                            </pre>
                          )}
                        </div>
                      ) : (`;

const idxOldStart = code.indexOf(outputUIStart);
const idxOldEnd = code.indexOf(outputUIEnd) + outputUIEnd.length;
if (idxOldStart !== -1 && idxOldEnd !== -1) {
  code = code.substring(0, idxOldStart) + newOutputUI + code.substring(idxOldEnd);
} else {
  console.log("Could not replace outputPayloadText UI"); 
}

const endMarker = '    </>\n  );\n};';
if (!code.includes('<DialogContent')) {
  const dialogCode = `      <Dialog open={isOutputExpanded} onOpenChange={setIsOutputExpanded}>
        <DialogContent className="max-w-[80vw] w-[1000px] h-[80vh] flex flex-col p-0 gap-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-muted/30">
            <DialogTitle className="text-sm font-medium m-0 p-0">Output Payload</DialogTitle>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(outputPayloadText, "output")}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <CopyIcon className="size-3.5" />
                {copiedState === "output" ? "Copied" : "Copy"}
              </button>
              {isOutputPayloadLarge && (
                <button
                  type="button"
                  onClick={handleDownloadOutput}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <DownloadIcon className="size-3.5" />
                  Download
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-background p-4 flex">
            {isOutputTooLargeToRender ? (
              <div className="m-auto flex flex-col items-center justify-center p-8 text-amber-500 bg-amber-950/10 rounded-md border border-amber-900/20">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangleIcon className="size-5 shrink-0" />
                  <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                    Output size is too large to render ( &gt; 1MB )
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadOutput}
                  className="h-8 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  <DownloadIcon className="mr-1.5 size-3.5" />
                  Download Raw Data
                </Button>
              </div>
            ) : (
              <pre className="font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">
                {outputPayloadText}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>\n  );\n};`;
  code = code.replace(endMarker, dialogCode);
}

fs.writeFileSync(file, code);
console.log("ALL DONE!");
