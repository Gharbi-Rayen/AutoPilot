import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { CodeChannel } from "@/inngest/channels/code";
import type { CodeLanguage } from "./dialog";

const CODE_TIMEOUT_MS = 30_000;

type CodeData = {
  language?: CodeLanguage;
  variableName?: string;
  code?: string;
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

function execCommand(
  cmd: string,
  args: string[],
  options: { timeout: number; cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function executeJavaCode(
  code: string,
  contextJson: string,
): Promise<unknown> {
  // Extract the class name from the code (look for "public class <Name>")
  const classNameMatch = code.match(/public\s+class\s+(\w+)/);
  const className = classNameMatch?.[1] ?? "Main";

  const workDir = join(tmpdir(), `autopilot-java-${Date.now()}`);
  const sourceFile = join(workDir, `${className}.java`);

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(sourceFile, code, "utf-8");

    // Compile
    await execCommand("javac", [sourceFile], {
      timeout: CODE_TIMEOUT_MS,
      cwd: workDir,
    });

    // Run — pass context JSON as first argument
    const stdout = await execCommand(
      "java",
      ["-cp", workDir, className, contextJson],
      { timeout: CODE_TIMEOUT_MS, cwd: workDir },
    );

    const trimmed = stdout.trim();
    if (!trimmed) return null;

    // Try to parse as JSON; if it isn't JSON, return as plain string
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  } finally {
    // Clean up temp directory
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function executeJavaScriptCode(
  code: string,
  context: Record<string, unknown>,
): Promise<unknown> {
  const fn = new AsyncFunction("context", code);

  const executionResult = await Promise.race([
    fn(context),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Code execution timed out after ${CODE_TIMEOUT_MS / 1000} seconds`,
            ),
          ),
        CODE_TIMEOUT_MS,
      ),
    ),
  ]);

  return executionResult ?? null;
}

export const CodeExecutor: NodeExecutor<CodeData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      CodeChannel().status({
        nodeId,
        status: state,
      }),
    );
  };

  await updateStatePublish("loading");

  if (!data.variableName) {
    await updateStatePublish("error");
    throw new NonRetriableError("Variable name is required");
  }

  if (!data.code) {
    await updateStatePublish("error");
    throw new NonRetriableError("Code is required");
  }

  const language = data.language ?? "javascript";

  try {
    const result = await step.run("code-execute", async () => {
      if (language === "java") {
        return executeJavaCode(data.code as string, JSON.stringify(context));
      }
      return executeJavaScriptCode(data.code as string, context);
    });

    await updateStatePublish("success");

    return {
      ...context,
      [data.variableName]: result,
    };
  } catch (error) {
    await updateStatePublish("error");
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new NonRetriableError(`Code execution failed: ${errorMessage}`);
  }
};
