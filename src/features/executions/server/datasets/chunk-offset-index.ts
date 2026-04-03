import { DATASET_STORAGE } from "@/config/constants";

export interface ChunkOffsetAnchor {
  rowOffset: number;
  byteOffset: number;
}

const resolveAnchorStride = () => {
  const configured = DATASET_STORAGE.CHUNK_OFFSET_STRIDE_ROWS;
  return Number.isInteger(configured) && configured > 0 ? configured : 100;
};

export const buildChunkOffsetAnchors = (
  serializedRows: string[],
  stride = resolveAnchorStride(),
): ChunkOffsetAnchor[] => {
  const anchors: ChunkOffsetAnchor[] = [];
  let currentByteOffset = 0;

  for (let rowOffset = 0; rowOffset < serializedRows.length; rowOffset += 1) {
    if (rowOffset % stride === 0) {
      anchors.push({
        rowOffset,
        byteOffset: currentByteOffset,
      });
    }

    const row = serializedRows[rowOffset] ?? "";
    currentByteOffset += Buffer.byteLength(row) + 1;
  }

  if (anchors.length === 0) {
    anchors.push({ rowOffset: 0, byteOffset: 0 });
  }

  return anchors;
};

export const resolveChunkOffsetAnchor = (
  anchors: ChunkOffsetAnchor[] | undefined,
  targetRowOffset: number,
): ChunkOffsetAnchor => {
  const safeTarget = Math.max(0, targetRowOffset);
  const availableAnchors = Array.isArray(anchors) ? anchors : [];

  if (availableAnchors.length === 0) {
    return {
      rowOffset: 0,
      byteOffset: 0,
    };
  }

  let left = 0;
  let right = availableAnchors.length - 1;
  let bestIndex = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const anchor = availableAnchors[mid];

    if (anchor.rowOffset <= safeTarget) {
      bestIndex = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return availableAnchors[bestIndex] ?? { rowOffset: 0, byteOffset: 0 };
};
