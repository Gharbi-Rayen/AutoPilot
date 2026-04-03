import Handlebars from "handlebars";
import { NonRetriableError } from "inngest";
import nodemailer from "nodemailer";
import type { NodeExecutor } from "@/features/executions/components/types";
import { EmailChannel } from "@/inngest/channels/email";
import prisma from "@/lib/db";

Handlebars.registerHelper("json", (context: unknown) => {
  return new Handlebars.SafeString(JSON.stringify(context, null, 2));
});

type EmailData = {
  credentialId?: string;
  variableName?: string;
  smtpService?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpSecure?: boolean;
  fromEmail?: string;
  toEmail?: string;
  subject?: string;
  body?: string;
  isHtml?: boolean;
};

export const EmailExecutor: NodeExecutor<EmailData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  userId,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      EmailChannel().status({
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

  if (!data.fromEmail) {
    await updateStatePublish("error");
    throw new NonRetriableError("From email address is required");
  }

  if (!data.toEmail) {
    await updateStatePublish("error");
    throw new NonRetriableError("To email address is required");
  }

  if (!data.subject) {
    await updateStatePublish("error");
    throw new NonRetriableError("Email subject is required");
  }

  if (!data.body) {
    await updateStatePublish("error");
    throw new NonRetriableError("Email body is required");
  }

  if (!data.credentialId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "SMTP password/app password is required. Please configure an email credential in the node settings.",
    );
  }

  const credential = await step.run("fetch-email-credential", async () => {
    const cred = await prisma.credentials.findUnique({
      where: { id: data.credentialId, userId },
    });
    if (!cred) {
      throw new NonRetriableError(
        "Email credential not found or access denied. It may have been deleted.",
      );
    }
    return cred;
  });

  const toEmail = Handlebars.compile(data.toEmail)(context);
  const subject = Handlebars.compile(data.subject)(context);
  const body = Handlebars.compile(data.body)(context);

  try {
    const result = await step.run("email-send", async () => {
      // Build transporter config based on service or custom SMTP
      let transportConfig: nodemailer.TransportOptions;

      if (data.smtpService && data.smtpService !== "custom") {
        transportConfig = {
          service: data.smtpService,
          auth: {
            user: data.fromEmail,
            pass: credential.value,
          },
        } as nodemailer.TransportOptions;
      } else {
        const port = data.smtpPort ? Number.parseInt(data.smtpPort, 10) : 587;
        transportConfig = {
          host: data.smtpHost || "smtp.gmail.com",
          port,
          secure: data.smtpSecure ?? port === 465,
          auth: {
            user: data.fromEmail,
            pass: credential.value,
          },
        } as nodemailer.TransportOptions;
      }

      const transporter = nodemailer.createTransport(transportConfig);

      const mailOptions: nodemailer.SendMailOptions = {
        from: data.fromEmail,
        to: toEmail,
        subject,
      };

      if (data.isHtml) {
        mailOptions.html = body;
      } else {
        mailOptions.text = body;
      }

      const info = await transporter.sendMail(mailOptions);

      const timestamp = new Date().toISOString();

      return {
        success: true,
        messageId: info.messageId,
        to: toEmail,
        subject,
        timestamp,
        provider: "email",
      };
    });

    await updateStatePublish("success");

    return {
      [data.variableName]: result,
    };
  } catch (error) {
    await updateStatePublish("error");
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new NonRetriableError(`Failed to send email: ${errorMessage}`);
  }
};
