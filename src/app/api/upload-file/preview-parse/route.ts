import { rm } from "node:fs/promises";
import { Queue } from "bullmq";
import { createId } from "@paralleldrive/cuid2";
import { type NextRequest, NextResponse } from "next/server";
import { requestCsvParseCancellation } from "@/features/executions/server/csv-parse-cancel";
import { getExecutionDatasetsDirectory } from "@/features/executions/server/datasets/paths";
import { getRedisConnection } from "@/features/executions/server/redis-queue";
import {
  deleteWorkflowFileAsset,
  readWorkflowFileAssetMetadata,
  resolveWorkflowFileAssetContentPath,
} from "@/features/executions/server/workflow-file-assets";
import { auth } from "@/lib/auth";
import type { CsvParseJobData, CsvParseJobResult } from "@/workers/csv-parse.worker";

const connection = getRedisConnection();

const queue = new Queue<CsvParseJobData, CsvParseJobResult>("csv-parse", {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

const isPreviewFileTypeSupported = (name: string, mimeType: string) => {
  const normalizedName = name.toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase();

  return (
    normalizedName.endsWith(".csv") ||
    normalizedName.endsWith(".txt") ||
    normalizedMimeType.includes("csv") ||
    normalizedMimeType === "text/plain"
  );
};

const waitForTerminalState = async (
  jobId: string,
  timeoutMs = 3000,
  pollMs = 250,
): Promise<"completed" | "failed" | "removed" | "timeout"> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await queue.getJob(jobId);

    if (!job) {
      return "removed";
    }

    const state = await job.getState();
    if (state === "completed" || state === "failed") {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return "timeout";
};

const ensureSession = async (request: NextRequest) => {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return null;
  }
  return session;
};

export async function POST(request: NextRequest) {
  const session = await ensureSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { fileRef?: string; nodeId?: string };
  try {
    body = (await request.json()) as { fileRef?: string; nodeId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.fileRef) {
    return NextResponse.json({ error: "fileRef is required." }, { status: 400 });
  }

  try {
    const metadata = await readWorkflowFileAssetMetadata(body.fileRef);

    if (metadata.ownerUserId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (!isPreviewFileTypeSupported(metadata.name, metadata.mimeType)) {
      return NextResponse.json(
        {
          error:
            "Only .csv and .txt files are supported for preview parsing right now.",
        },
        { status: 422 },
      );
    }

    const fileBlobPath = await resolveWorkflowFileAssetContentPath(body.fileRef);
    const previewExecutionId = `preview_${createId()}`;
    const datasetId = `preview_${createId()}`;
    const variableName =
      typeof body.nodeId === "string" && body.nodeId.length > 0
        ? `preview_${body.nodeId.replace(/[^A-Za-z0-9_]/g, "_")}`
        : `preview_${createId()}`;

    const job = await queue.add(
      `preview-parse:${previewExecutionId}`,
      {
        fileBlobPath,
        executionId: previewExecutionId,
        datasetId,
        variableName,
        ownerUserId: session.user.id,
        hasHeader: true,
        mode: "metadata",
      },
      {
        jobId: `preview-${previewExecutionId}-${datasetId}`,
      },
    );

    return NextResponse.json(
      {
        jobId: String(job.id),
        previewExecutionId,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start preview parsing.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await ensureSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.data.ownerUserId && job.data.ownerUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const state = await job.getState();
  const progress =
    typeof job.progress === "object" && job.progress !== null
      ? job.progress
      : null;

  if (state === "completed") {
    return NextResponse.json({
      jobId,
      state,
      progress,
      result: job.returnvalue,
    });
  }

  if (state === "failed") {
    return NextResponse.json({
      jobId,
      state,
      progress,
      error: job.failedReason || "Preview parse failed.",
    });
  }

  return NextResponse.json({ jobId, state, progress });
}

export async function DELETE(request: NextRequest) {
  const session = await ensureSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    jobId?: string;
    fileRef?: string;
    previewExecutionId?: string;
  };

  try {
    body = (await request.json()) as {
      jobId?: string;
      fileRef?: string;
      previewExecutionId?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (body.jobId) {
      const job = await queue.getJob(body.jobId);

      if (job?.data.ownerUserId && job.data.ownerUserId !== session.user.id) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }

      await requestCsvParseCancellation(connection, body.jobId);

      if (job) {
        const state = await job.getState();

        if (
          state === "waiting" ||
          state === "delayed" ||
          state === "prioritized" ||
          state === "waiting-children"
        ) {
          await job.remove().catch(() => undefined);
        } else if (state === "active") {
          try {
            job.discard();
          } catch {
            // Ignore discard failures; cancellation is still requested via Redis.
          }
          const terminal = await waitForTerminalState(body.jobId, 3000, 250);

          if (terminal === "completed" || terminal === "failed") {
            const latestJob = await queue.getJob(body.jobId);
            await latestJob?.remove().catch(() => undefined);
          }
        }
      }
    }

    if (body.previewExecutionId) {
      await rm(getExecutionDatasetsDirectory(body.previewExecutionId), {
        recursive: true,
        force: true,
      }).catch(() => undefined);
    }

    if (body.fileRef) {
      try {
        const metadata = await readWorkflowFileAssetMetadata(body.fileRef);
        if (metadata.ownerUserId !== session.user.id) {
          return NextResponse.json({ error: "Forbidden." }, { status: 403 });
        }

        await deleteWorkflowFileAsset(body.fileRef);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ENOENT")) {
          throw error;
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to cancel preview.",
      },
      { status: 500 },
    );
  }
}
