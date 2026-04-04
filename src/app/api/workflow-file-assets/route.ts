import { NextResponse } from "next/server";
import { saveWorkflowFileAsset } from "@/features/executions/server/workflow-file-assets";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const asset = await saveWorkflowFileAsset({
      ownerUserId: session.user.id,
      file: {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        lastModified: file.lastModified,
        buffer,
      },
    });

    return NextResponse.json({ asset });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to store uploaded file.",
      },
      { status: 500 },
    );
  }
}
