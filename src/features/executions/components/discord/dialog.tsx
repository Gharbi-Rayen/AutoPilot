"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import z from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CredentialPicker } from "@/features/credentials/components/credential-picker";
import { CredentialType } from "@/generated/prisma";

const formSchema = z.object({
  credentialId: z
    .string()
    .min(1, { message: "Discord Webhook URL is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  content: z
    .string()
    .min(1, { message: "Message content is required" })
    .max(2000, { message: "Message must be 2000 characters or less" }),
  username: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export type DiscordFormValues = z.infer<typeof formSchema>;

interface DiscordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DiscordFormValues) => void;
  defaultValues?: Partial<DiscordFormValues>;
}

export const DiscordDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: DiscordDialogProps) => {
  const form = useForm<DiscordFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      credentialId: defaultValues.credentialId || "",
      variableName: defaultValues.variableName || "",
      content: defaultValues.content || "",
      username: defaultValues.username || "",
      avatarUrl: defaultValues.avatarUrl || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "discordResult";
  const watchContent = form.watch("content") || "";

  const handleSubmit = (values: DiscordFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        credentialId: defaultValues.credentialId || "",
        variableName: defaultValues.variableName || "",
        content: defaultValues.content || "",
        username: defaultValues.username || "",
        avatarUrl: defaultValues.avatarUrl || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-purple-500/10 px-6 pt-6 pb-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                <Image
                  src="/logos/discord.svg"
                  alt="Discord"
                  width={18}
                  height={18}
                  className="brightness-0 invert"
                />
              </div>
              <div>
                <span className="text-base font-semibold">Discord</span>
                <p className="text-xs font-normal text-muted-foreground mt-0.5">
                  Send messages via webhook
                </p>
              </div>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 overflow-y-auto flex-1">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="credentialId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Webhook URL</FormLabel>
                    <FormControl>
                      <CredentialPicker
                        type={CredentialType.DISCORD_WEBHOOK}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      Get it from Discord → Server Settings → Integrations →
                      Webhooks
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="variableName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Variable Name</FormLabel>
                    <FormControl>
                      <Input placeholder="discordResult" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md bg-indigo-500/5 border border-indigo-500/10 px-3 py-2 text-xs text-muted-foreground font-mono">
                Access result:{" "}
                <span className="text-indigo-600 dark:text-indigo-400">
                  {`{{${watchVariableName}.success}}`}
                </span>
                {" · "}
                <span className="text-indigo-600 dark:text-indigo-400">
                  {`{{${watchVariableName}.messageId}}`}
                </span>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <span>Message Content</span>
                      <span
                        className={`text-xs font-normal ${watchContent.length > 2000 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {watchContent.length}/2000
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[100px] font-mono text-sm resize-none"
                        placeholder="Hello from AutoPilot! {{previousStep.data}}"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Use{" "}
                      <code className="text-[10px] bg-muted px-1 rounded">
                        {"{{variable}}"}
                      </code>{" "}
                      to insert data from previous steps. Rate limit: 5
                      requests/5 seconds.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Username Override{" "}
                        <span className="text-muted-foreground font-normal">
                          (optional)
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="AutoPilot Bot" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="avatarUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Avatar URL{" "}
                        <span className="text-muted-foreground font-normal">
                          (optional)
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com/avatar.png"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  className="bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white"
                >
                  {form.formState.isSubmitting
                    ? "Saving..."
                    : "Save Configuration"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
