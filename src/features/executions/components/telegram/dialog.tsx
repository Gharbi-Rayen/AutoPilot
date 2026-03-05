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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { CredentialPicker } from "@/features/credentials/components/credential-picker";
import { CredentialType } from "@/generated/prisma";

const formSchema = z.object({
  credentialId: z
    .string()
    .min(1, { message: "Telegram Bot Token is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  chatId: z.string().min(1, { message: "Chat ID is required" }),
  text: z
    .string()
    .min(1, { message: "Message text is required" })
    .max(4096, { message: "Message must be 4096 characters or less" }),
  parseMode: z.enum(["none", "HTML", "MarkdownV2"]).optional(),
});

export type TelegramFormValues = z.infer<typeof formSchema>;

interface TelegramDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TelegramFormValues) => void;
  defaultValues?: Partial<TelegramFormValues>;
}

export const TelegramDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: TelegramDialogProps) => {
  const form = useForm<TelegramFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      credentialId: defaultValues.credentialId || "",
      variableName: defaultValues.variableName || "",
      chatId: defaultValues.chatId || "",
      text: defaultValues.text || "",
      parseMode: defaultValues.parseMode || "none",
    },
  });

  const watchVariableName = form.watch("variableName") || "telegramResult";
  const watchText = form.watch("text") || "";

  const handleSubmit = (values: TelegramFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        credentialId: defaultValues.credentialId || "",
        variableName: defaultValues.variableName || "",
        chatId: defaultValues.chatId || "",
        text: defaultValues.text || "",
        parseMode: defaultValues.parseMode || "none",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-sky-500/10 via-cyan-500/10 to-blue-500/10 px-6 pt-6 pb-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 shadow-sm">
                <Image
                  src="/logos/telegram.svg"
                  alt="Telegram"
                  width={18}
                  height={18}
                  className="brightness-0 invert"
                />
              </div>
              <div>
                <span className="text-base font-semibold">Telegram</span>
                <p className="text-xs font-normal text-muted-foreground mt-0.5">
                  Send messages via Bot API
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
                    <FormLabel>Bot Token</FormLabel>
                    <FormControl>
                      <CredentialPicker
                        type={CredentialType.TELEGRAM_BOT}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      Get it from @BotFather on Telegram → /newbot command
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="variableName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Variable Name</FormLabel>
                      <FormControl>
                        <Input placeholder="telegramResult" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="chatId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chat ID</FormLabel>
                      <FormControl>
                        <Input placeholder="-1001234567890" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="rounded-md bg-sky-500/5 border border-sky-500/10 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium mb-1">How to get your Chat ID:</p>
                <p>
                  Send /start to your bot, then message @userinfobot to get your
                  personal Chat ID. For group chats, add the bot to the group
                  and use @RawDataBot.
                </p>
              </div>

              <div className="rounded-md bg-sky-500/5 border border-sky-500/10 px-3 py-2 text-xs text-muted-foreground font-mono">
                Access result:{" "}
                <span className="text-sky-600 dark:text-sky-400">
                  {`{{${watchVariableName}.success}}`}
                </span>
                {" · "}
                <span className="text-sky-600 dark:text-sky-400">
                  {`{{${watchVariableName}.messageId}}`}
                </span>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="parseMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parse Mode</FormLabel>
                    <Select
                      defaultValue={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="None (plain text)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None (plain text)</SelectItem>
                        <SelectItem value="HTML">HTML</SelectItem>
                        <SelectItem value="MarkdownV2">MarkdownV2</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="text"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <span>Message Text</span>
                      <span
                        className={`text-xs font-normal ${watchText.length > 4096 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {watchText.length}/4096
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
                      for data from previous steps. Limit: 30 msgs/sec globally,
                      20 msgs/min per group.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                  className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white"
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
