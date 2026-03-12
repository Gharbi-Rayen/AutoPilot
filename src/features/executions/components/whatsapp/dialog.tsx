"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    .min(1, { message: "WhatsApp Access Token is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  phoneNumberId: z.string().min(1, { message: "Phone Number ID is required" }),
  recipientPhone: z
    .string()
    .min(1, { message: "Recipient phone number is required" }),
  text: z
    .string()
    .min(1, { message: "Message text is required" })
    .max(4096, { message: "Message must be 4096 characters or less" }),
  enablePreview: z.boolean().optional(),
});

export type WhatsAppFormValues = z.infer<typeof formSchema>;

interface WhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: WhatsAppFormValues) => void;
  defaultValues?: Partial<WhatsAppFormValues>;
}

export const WhatsAppDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: WhatsAppDialogProps) => {
  const form = useForm<WhatsAppFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      credentialId: defaultValues.credentialId || "",
      variableName: defaultValues.variableName || "",
      phoneNumberId: defaultValues.phoneNumberId || "",
      recipientPhone: defaultValues.recipientPhone || "",
      text: defaultValues.text || "",
      enablePreview: defaultValues.enablePreview ?? false,
    },
  });

  const watchVariableName = form.watch("variableName") || "whatsappResult";
  const watchText = form.watch("text") || "";

  const handleSubmit = (values: WhatsAppFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        credentialId: defaultValues.credentialId || "",
        variableName: defaultValues.variableName || "",
        phoneNumberId: defaultValues.phoneNumberId || "",
        recipientPhone: defaultValues.recipientPhone || "",
        text: defaultValues.text || "",
        enablePreview: defaultValues.enablePreview ?? false,
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-green-500/10 via-emerald-500/10 to-teal-500/10 px-6 pt-6 pb-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-sm">
                <Image
                  src="/logos/whatsapp.svg"
                  alt="WhatsApp"
                  width={18}
                  height={18}
                  className="brightness-0 invert"
                />
              </div>
              <div>
                <span className="text-base font-semibold">WhatsApp</span>
                <p className="text-xs font-normal text-muted-foreground mt-0.5">
                  Send messages via Cloud API
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
                    <FormLabel>Access Token</FormLabel>
                    <FormControl>
                      <CredentialPicker
                        type={CredentialType.WHATSAPP_TOKEN}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      Get it from Meta Business → WhatsApp → API Setup
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
                      <Input placeholder="whatsappResult" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phoneNumberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number ID</FormLabel>
                    <FormControl>
                      <Input placeholder="123456789012345" {...field} />
                    </FormControl>
                    <FormDescription>
                      Your WhatsApp Business Phone Number ID from Meta Business
                      dashboard
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="recipientPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1234567890" {...field} />
                    </FormControl>
                    <FormDescription>
                      Full international format including country code (e.g.
                      +1234567890)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md bg-green-500/5 border border-green-500/10 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium mb-1">
                  How to get your Phone Number ID:
                </p>
                <p>
                  Go to Meta Business Suite → WhatsApp → API Setup. Your Phone
                  Number ID is shown under the phone number you registered.
                </p>
              </div>

              <div className="rounded-md bg-green-500/5 border border-green-500/10 px-3 py-2 text-xs text-muted-foreground font-mono">
                Access result:{" "}
                <span className="text-green-600 dark:text-green-400">
                  {`{{${watchVariableName}.success}}`}
                </span>
                {" · "}
                <span className="text-green-600 dark:text-green-400">
                  {`{{${watchVariableName}.messageId}}`}
                </span>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="enablePreview"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Enable Link Preview</FormLabel>
                      <FormDescription>
                        Show a preview for any URLs in the message
                      </FormDescription>
                    </div>
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
                      for data from previous steps. Max 4096 characters per
                      message.
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
                  className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white"
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
