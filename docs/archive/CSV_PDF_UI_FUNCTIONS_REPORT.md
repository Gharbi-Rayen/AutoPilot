# CSV and PDF Nodes UI Functions Report

Date: 2026-04-01

## Executive Summary

- Total CSV/PDF node types in schema: 12
- Nodes exposed in node selector UI: 12
- Fully working end-to-end (UI + executor logic): 7
- Builder-visible but execution still pending: 5

## Node Inventory and Status

| Node Type            | Selector                               | UI Node Component                                                                    | Dialog                                                           | Executor                                                                             | Status  |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------- |
| `CSV_PARSE`          | `src/components/node-selector.tsx:145` | `src/features/executions/components/csv-parse/node.tsx`                              | `src/features/executions/components/csv-parse/dialog.tsx`        | `src/features/executions/components/csv-parse/executor.ts`                           | Works   |
| `CSV_GENERATE`       | `src/components/node-selector.tsx:199` | `src/features/executions/components/csv-generate/node.tsx`                           | `src/features/executions/components/csv-generate/dialog.tsx`     | `src/features/executions/components/stubs/executors.ts` (`csvGenerateExecutor`)      | Works   |
| `CSV_FILTER`         | `src/components/node-selector.tsx:205` | `src/features/executions/components/csv-filter/node.tsx`                             | `src/features/executions/components/csv-filter/dialog.tsx`       | `src/features/executions/components/stubs/executors.ts` (`csvFilterExecutor`)        | Works   |
| `CSV_AGGREGATE`      | `src/components/node-selector.tsx:211` | `src/features/executions/components/csv-aggregate/node.tsx`                          | `src/features/executions/components/csv-aggregate/dialog.tsx`    | `src/features/executions/components/stubs/executors.ts` (`csvAggregateExecutor`)     | Works   |
| `CSV_JOIN`           | `src/components/node-selector.tsx:217` | `src/features/executions/components/csv-join/node.tsx`                               | `src/features/executions/components/csv-join/dialog.tsx`         | `src/features/executions/components/stubs/executors.ts` (`csvJoinExecutor`)          | Works   |
| `PDF_EXTRACT_TEXT`   | `src/components/node-selector.tsx:139` | `src/features/executions/components/pdf-extract-text/node.tsx`                       | `src/features/executions/components/pdf-extract-text/dialog.tsx` | `src/features/executions/components/pdf-extract-text/executor.ts`                    | Works   |
| `PDF_GENERATE`       | `src/components/node-selector.tsx:187` | `src/features/executions/components/pdf-generate/node.tsx`                           | `src/features/executions/components/pdf-generate/dialog.tsx`     | `src/features/executions/components/stubs/executors.ts` (`pdfGenerateExecutor`)      | Works   |
| `PDF_EXTRACT_TABLES` | `src/components/node-selector.tsx:163` | `src/features/executions/components/stubs/pending-node.tsx` (`PdfExtractTablesNode`) | No dedicated dialog                                              | `src/features/executions/components/stubs/executors.ts` (`pdfExtractTablesExecutor`) | Pending |
| `PDF_SPLIT`          | `src/components/node-selector.tsx:169` | `src/features/executions/components/stubs/pending-node.tsx` (`PdfSplitNode`)         | No dedicated dialog                                              | `src/features/executions/components/stubs/executors.ts` (`pdfSplitExecutor`)         | Pending |
| `PDF_MERGE`          | `src/components/node-selector.tsx:175` | `src/features/executions/components/stubs/pending-node.tsx` (`PdfMergeNode`)         | No dedicated dialog                                              | `src/features/executions/components/stubs/executors.ts` (`pdfMergeExecutor`)         | Pending |
| `PDF_FILL_FORM`      | `src/components/node-selector.tsx:181` | `src/features/executions/components/stubs/pending-node.tsx` (`PdfFillFormNode`)      | No dedicated dialog                                              | `src/features/executions/components/stubs/executors.ts` (`pdfFillFormExecutor`)      | Pending |
| `PDF_SIGN`           | `src/components/node-selector.tsx:193` | `src/features/executions/components/stubs/pending-node.tsx` (`PdfSignNode`)          | No dedicated dialog                                              | `src/features/executions/components/stubs/executors.ts` (`pdfSignExecutor`)          | Pending |

## What Works

### 1) CSV Parse

- Validates required variables.
- Accepts string CSV, buffer CSV, serialized buffer (`{ type: "Buffer", data: [] }`), URL, or `content`.
- Parses with delimiter and header options.

Location:

- `src/features/executions/components/csv-parse/executor.ts`

Snippet:

```ts
const records = parse(csvText, {
  columns: hasHeader,
  delimiter,
  trim: true,
  skip_empty_lines: true,
});

return {
  records,
  rowCount: Array.isArray(records) ? records.length : 0,
  fileName: csv.fileName || csv.name || "data.csv",
};
```

### 2) PDF Extract Text

- Validates required variables.
- Accepts PDF via `buffer` or `url`.
- Uses `pdf-parse` + `pdf-parse/worker` and returns text plus optional metadata.

Location:

- `src/features/executions/components/pdf-extract-text/executor.ts`

Snippet:

```ts
const { CanvasFactory } = (await import("pdf-parse/worker")) as PdfWorkerModule;
const { PDFParse } = (await import("pdf-parse")) as PdfParseModule;

const parser = new PDFParse({
  data: buffer,
  CanvasFactory,
});

const [textResult, infoResult] = await Promise.all([
  parser.getText(),
  data.includeMetadata ? parser.getInfo() : Promise.resolve(undefined),
]);
```

### 3) CSV Generate / Filter / Aggregate / Join

- All four are implemented in `stubs/executors.ts` (despite the filename).
- They perform real validation and transformations, and return structured outputs.

Locations:

- `src/features/executions/components/stubs/executors.ts:488` (`csvGenerateExecutor`)
- `src/features/executions/components/stubs/executors.ts:564` (`csvFilterExecutor`)
- `src/features/executions/components/stubs/executors.ts:616` (`csvAggregateExecutor`)
- `src/features/executions/components/stubs/executors.ts:739` (`csvJoinExecutor`)

Snippet (aggregate):

```ts
const aggregated = await step.run("csv-aggregate", async () => {
  const groups = new Map<string, Record<string, unknown>[]>();
  // ... group and aggregate logic for count/sum/avg/min/max
  return {
    records,
    rowCount: records.length,
  };
});
```

### 4) PDF Generate

- Implemented in `stubs/executors.ts` as real generation logic using `pdf-lib`.
- Produces a real PDF file object (`name`, `mimeType`, `buffer`, `size`).

Location:

- `src/features/executions/components/stubs/executors.ts:280`

Snippet:

```ts
const pdfBuffer = await step.run("generate-pdf", async () => {
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage();
  // ... writes title and wrapped text lines
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
});

return {
  [data.variableName]: {
    name: data.fileName || `${data.variableName}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBuffer.data),
    size: pdfBuffer.data.length,
  },
};
```

## What Does Not Work Yet

The following nodes are intentionally placeholder-only today:

- `PDF_EXTRACT_TABLES`
- `PDF_SPLIT`
- `PDF_MERGE`
- `PDF_FILL_FORM`
- `PDF_SIGN`

Evidence:

- Pending UI marker in `pending-node.tsx`:

```ts
data: {
  ...node.data,
  __pending: true,
  __note: "Ready in builder. Execution implementation in progress.",
},
```

- Pending executor output in `stubs/executors.ts`:

```ts
const pendingExecutor = (name: string): NodeExecutor => {
  return async ({ data }) => {
    return {
      [`${name}_pending`]: {
        implemented: false,
        node: name,
        data,
      },
    };
  };
};
```

## Important Runtime Behavior

- Even pending nodes can still let the workflow finish with overall `SUCCESS` if no exception is thrown.
- Reason: execution engine marks success when node loop completes.

Location:

- `src/inngest/functions.ts:178`

Snippet:

```ts
await prisma.execution.update({
  where: { id: executionId },
  data: {
    status: "SUCCESS",
    finishedAt: new Date(),
    output: context,
  },
});
```

## Related Files

- Node type enum: `prisma/schema.prisma:135-147`
- Selector labels: `src/components/node-selector.tsx`
- Node component registry: `src/config/node-components.ts`
- Executor registry: `src/features/executions/components/lib/executor-registry.ts`
- CSV/PDF testing guides:
  - `docs/CSV_AND_PDF_TESTING_WORKFLOW.md`
  - `docs/CSV_AGGREGATE_INVESTIGATION_REPORT.md`
