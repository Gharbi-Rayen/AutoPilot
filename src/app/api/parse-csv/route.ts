import { Queue } from "bullmq";
import { type NextRequest, NextResponse } from "next/server";
import { getRedisConnection } from "@/features/executions/server/redis-queue";
import type { CsvParseJobData } from "@/workers/csv-parse.worker";

const connection = getRedisConnection();

const queue = new Queue<CsvParseJobData>("csv-parse", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export async function POST(req: NextRequest) {
  let body: CsvParseJobData;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fileBlobPath, executionId, datasetId, variableName } = body;

  if (!fileBlobPath || !executionId || !datasetId || !variableName) {
    return NextResponse.json(
      {
        error:
          "Missing required fields: fileBlobPath, executionId, datasetId, variableName",
      },
      { status: 422 },
    );
  }

  const job = await queue.add(`parse:${executionId}`, body, {
    jobId: `${executionId}:${datasetId}`,
  });

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId)
    return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const job = await queue.getJob(jobId);
  if (!job)
    return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const state = await job.getState();
  const progress = job.progress;

  return NextResponse.json({ jobId, state, progress });
}
