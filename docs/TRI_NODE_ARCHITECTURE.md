# Tri Node Architecture

## Overview
The Tri Node is a specialized workflow node designed to accept and process three distinct input datasets or streams simultaneously. It serves as an advanced routing, merging, or conditional logic gate for situations where standard binary nodes (like joins or diffs) are insufficient.

## Key Features
- **Three Input Sockets**: Allows connecting data1, data2, and data3 (or uniquely named variables) into a single operational unit.
- **Tri-way Merging / Coalescing**: Can execute complex Venn-diagram logic (e.g., intersect all three, subtract data3 from the union of data1 and data2).
- **Advanced Routing**: Depending on the workflow state, it can route execution flow dynamically based on the evaluation of the three inputs.

## Planned Implementation
The execution logic will rely on a dedicated BullMQ worker (	ri-node.worker.ts) and an orchestrated executor (	ri-node/executor.ts). Like other heavy data nodes, it will leverage step.waitForEvent to safely await execution and use DatasetRefs to keep memory footprints low.
