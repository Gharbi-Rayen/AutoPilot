const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/features/editor/components/workflow-progress-panel.tsx');
let code = fs.readFileSync(file, 'utf8');

const marker = ') : selectedDatasetVariable && activeExecutionId ? (';
const startIdx = code.indexOf(marker);

const endMarkerStr = '                  )}\n                </div>';
const endIdx = code.indexOf(endMarkerStr, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `) : selectedDatasetVariable && activeExecutionId ? (
                        <div className="rounded-md border border-border bg-muted/20 p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">
                              Dataset: {selectedDatasetVariable}
                            </span>
                          </div>
                          <ExecutionDatasetViewer
                            executionId={activeExecutionId}
                            variable={selectedDatasetVariable}
                            enabled={true}
                          />
                        </div>
                      ) : outputPayloadText ? (
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
                      ) : (
                        <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 text-xs text-muted-foreground">
                          <Clock3Icon className="size-5" />
                          No output for this selection.
                        </div>
                      )\n`;

  code = code.substring(0, startIdx) + replacement + code.substring(endIdx);
  fs.writeFileSync(file, code, 'utf8');
  console.log('REPLACED CORRECTLY!');
} else {
  console.log('NOT FOUND!', startIdx, endIdx);
}
