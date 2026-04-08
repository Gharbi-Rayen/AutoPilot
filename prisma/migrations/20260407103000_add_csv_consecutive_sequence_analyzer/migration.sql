-- Add new node type for worker-based consecutive sequence analysis
ALTER TYPE "NodeType" ADD VALUE IF NOT EXISTS 'CSV_CONSECUTIVE_SEQUENCE_ANALYZER';
