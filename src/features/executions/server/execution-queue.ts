import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDirectory, getExecutionQueueDirectory } from "./datasets/paths";
import {
  type ExecutionResourceProfile,
  getExecutionQueuePolicy,
} from "./queue-policy";

type QueueLifecycleState = "QUEUED" | "RUNNING";

interface QueueState {
  runningHeavy: string[];
  queuedHeavy: string[];
  executionStates: Record<
    string,
    {
      profile: ExecutionResourceProfile;
      state: QueueLifecycleState;
    }
  >;
}

const STATE_FILE_NAME = "queue-state.json";

const EMPTY_QUEUE_STATE: QueueState = {
  runningHeavy: [],
  queuedHeavy: [],
  executionStates: {},
};

let mutationChain: Promise<void> = Promise.resolve();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const getQueueStatePath = () => {
  return join(getExecutionQueueDirectory(), STATE_FILE_NAME);
};

const loadQueueState = async (): Promise<QueueState> => {
  await ensureDirectory(getExecutionQueueDirectory());

  try {
    const raw = await readFile(getQueueStatePath(), "utf-8");
    const parsed = JSON.parse(raw) as QueueState;

    return {
      runningHeavy: Array.isArray(parsed.runningHeavy)
        ? [...new Set(parsed.runningHeavy)]
        : [],
      queuedHeavy: Array.isArray(parsed.queuedHeavy)
        ? [...new Set(parsed.queuedHeavy)]
        : [],
      executionStates:
        parsed.executionStates && typeof parsed.executionStates === "object"
          ? parsed.executionStates
          : {},
    };
  } catch {
    return { ...EMPTY_QUEUE_STATE };
  }
};

const saveQueueState = async (state: QueueState) => {
  await ensureDirectory(getExecutionQueueDirectory());
  await writeFile(getQueueStatePath(), JSON.stringify(state, null, 2), "utf-8");
};

const mutateQueueState = async <T>(
  mutate: (state: QueueState) => T | Promise<T>,
): Promise<T> => {
  const next = mutationChain.then(async () => {
    const state = await loadQueueState();
    const result = await mutate(state);
    await saveQueueState(state);
    return result;
  });

  mutationChain = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
};

const ensureRegistered = (
  state: QueueState,
  executionId: string,
  profile: ExecutionResourceProfile,
) => {
  if (profile === "heavy") {
    state.executionStates[executionId] = {
      profile,
      state: state.runningHeavy.includes(executionId) ? "RUNNING" : "QUEUED",
    };

    if (
      !state.queuedHeavy.includes(executionId) &&
      !state.runningHeavy.includes(executionId)
    ) {
      state.queuedHeavy.push(executionId);
    }

    return;
  }

  state.executionStates[executionId] = {
    profile,
    state: "RUNNING",
  };
};

export const registerExecutionInQueue = async ({
  executionId,
  profile,
}: {
  executionId: string;
  profile: ExecutionResourceProfile;
}) => {
  return mutateQueueState((state) => {
    ensureRegistered(state, executionId, profile);
    return state.executionStates[executionId]?.state ?? "QUEUED";
  });
};

export const acquireExecutionSlot = async ({
  executionId,
  profile,
}: {
  executionId: string;
  profile: ExecutionResourceProfile;
}): Promise<{ release: () => Promise<void> }> => {
  const policy = getExecutionQueuePolicy();

  if (profile === "standard") {
    await mutateQueueState((state) => {
      state.executionStates[executionId] = {
        profile,
        state: "RUNNING",
      };
    });

    return {
      release: () => releaseExecutionSlot(executionId),
    };
  }

  const deadline = Date.now() + policy.maxQueueWaitMs;

  while (true) {
    const granted = await mutateQueueState((state) => {
      ensureRegistered(state, executionId, profile);

      const alreadyRunning = state.runningHeavy.includes(executionId);
      if (alreadyRunning) {
        state.executionStates[executionId] = {
          profile,
          state: "RUNNING",
        };
        return true;
      }

      const queueHead = state.queuedHeavy[0];
      const hasCapacity =
        state.runningHeavy.length < policy.maxConcurrentHeavyExecutions;

      if (queueHead === executionId && hasCapacity) {
        state.queuedHeavy = state.queuedHeavy.filter(
          (id) => id !== executionId,
        );
        state.runningHeavy.push(executionId);
        state.executionStates[executionId] = {
          profile,
          state: "RUNNING",
        };
        return true;
      }

      state.executionStates[executionId] = {
        profile,
        state: "QUEUED",
      };

      return false;
    });

    if (granted) {
      return {
        release: () => releaseExecutionSlot(executionId),
      };
    }

    if (Date.now() >= deadline) {
      throw new Error(
        "Execution queue wait time exceeded. Please retry after current heavy runs complete.",
      );
    }

    await sleep(policy.queuePollIntervalMs);
  }
};

export const releaseExecutionSlot = async (executionId: string) => {
  await mutateQueueState((state) => {
    state.runningHeavy = state.runningHeavy.filter((id) => id !== executionId);
    state.queuedHeavy = state.queuedHeavy.filter((id) => id !== executionId);
    delete state.executionStates[executionId];
  });
};

export const getExecutionQueueState = async (
  executionId: string,
): Promise<QueueLifecycleState | null> => {
  const state = await loadQueueState();
  return state.executionStates[executionId]?.state ?? null;
};

export const getExecutionQueueStates = async (executionIds: string[]) => {
  const state = await loadQueueState();

  return Object.fromEntries(
    executionIds.map((executionId) => [
      executionId,
      state.executionStates[executionId]?.state ?? null,
    ]),
  );
};
