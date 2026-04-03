import type { DatasetChunkMetadata, DatasetPageAdapterWindow } from "./types";

const toPositiveInteger = (value: number, fallback: number) => {
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }

  return value;
};

const normalizeOffsetAnchors = (
  anchors: DatasetChunkMetadata["offsetAnchors"],
  rowCount: number,
) => {
  const safeAnchors = Array.isArray(anchors)
    ? anchors
        .filter(
          (anchor) =>
            Number.isInteger(anchor.rowOffset) &&
            Number.isInteger(anchor.byteOffset) &&
            anchor.rowOffset >= 0 &&
            anchor.byteOffset >= 0 &&
            anchor.rowOffset < rowCount,
        )
        .sort((left, right) => left.rowOffset - right.rowOffset)
    : [];

  if (rowCount > 0 && safeAnchors.length === 0) {
    return [{ rowOffset: 0, byteOffset: 0 }];
  }

  if (rowCount > 0 && safeAnchors[0]?.rowOffset !== 0) {
    return [{ rowOffset: 0, byteOffset: 0 }, ...safeAnchors];
  }

  return safeAnchors.length > 0 ? safeAnchors : undefined;
};

export const normalizeChunkMetadata = (
  chunks: DatasetChunkMetadata[],
): DatasetChunkMetadata[] => {
  const sorted = [...chunks].sort(
    (left, right) => left.chunkIndex - right.chunkIndex,
  );

  let cumulativeRows = 0;

  return sorted.map((chunk, index) => {
    const rowCount =
      Number.isInteger(chunk.rowCount) && chunk.rowCount >= 0
        ? chunk.rowCount
        : 0;

    const rowStart = rowCount > 0 ? cumulativeRows + 1 : cumulativeRows;
    const rowEnd = cumulativeRows + rowCount;

    cumulativeRows = rowEnd;

    return {
      ...chunk,
      chunkIndex: Number.isInteger(chunk.chunkIndex) ? chunk.chunkIndex : index,
      rowStart,
      rowEnd,
      rowCount,
      cumulativeRowCount: cumulativeRows,
      offsetAnchors: normalizeOffsetAnchors(chunk.offsetAnchors, rowCount),
    };
  });
};

export const getChunkByIndex = (
  chunks: DatasetChunkMetadata[],
  chunkIndex: number,
): DatasetChunkMetadata | undefined => {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return undefined;
  }

  const direct = chunks[chunkIndex];
  if (direct && direct.chunkIndex === chunkIndex) {
    return direct;
  }

  return chunks.find((chunk) => chunk.chunkIndex === chunkIndex);
};

export const getTotalRowsFromChunks = (
  chunks: DatasetChunkMetadata[],
): number => {
  if (chunks.length === 0) {
    return 0;
  }

  return chunks[chunks.length - 1]?.cumulativeRowCount ?? 0;
};

export const resolveChunkWindowByOffset = ({
  chunks,
  globalOffset,
  limit,
}: {
  chunks: DatasetChunkMetadata[];
  globalOffset: number;
  limit: number;
}): DatasetPageAdapterWindow | null => {
  const safeOffset = Math.max(0, globalOffset);
  const safeLimit = Math.max(0, limit);

  if (safeLimit === 0 || chunks.length === 0) {
    return null;
  }

  const totalRows = getTotalRowsFromChunks(chunks);
  if (safeOffset >= totalRows) {
    return null;
  }

  let left = 0;
  let right = chunks.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    const chunk = chunks[mid];

    if (chunk.cumulativeRowCount <= safeOffset) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  const targetChunk = chunks[left];
  const previousCumulative =
    left === 0 ? 0 : (chunks[left - 1]?.cumulativeRowCount ?? 0);
  const offset = safeOffset - previousCumulative;
  const maxLimit = Math.max(targetChunk.rowCount - offset, 0);

  return {
    chunkIndex: targetChunk.chunkIndex,
    offset,
    limit: Math.min(safeLimit, maxLimit),
    globalOffset: safeOffset,
  };
};

export const resolveChunkWindowByPage = ({
  chunks,
  page,
  pageSize,
}: {
  chunks: DatasetChunkMetadata[];
  page: number;
  pageSize: number;
}) => {
  const safePage = toPositiveInteger(page, 1);
  const safePageSize = toPositiveInteger(pageSize, 1);
  const globalOffset = (safePage - 1) * safePageSize;
  const totalRows = getTotalRowsFromChunks(chunks);

  return {
    page: safePage,
    pageSize: safePageSize,
    totalRows,
    totalPages: totalRows === 0 ? 0 : Math.ceil(totalRows / safePageSize),
    window: resolveChunkWindowByOffset({
      chunks,
      globalOffset,
      limit: safePageSize,
    }),
  };
};
