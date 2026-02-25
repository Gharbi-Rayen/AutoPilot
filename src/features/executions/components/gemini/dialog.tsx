"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useAIModels } from "@/features/executions/hooks/use-ai-models";
import { CredentialPicker } from "@/features/credentials/components/credential-picker";
import { CredentialType } from "@/generated/prisma";

export const DEFAULT_MODEL = "gemini-2.5-flash";

const formSchema = z.object({
  credentialId: z.string().min(1, { message: "API key is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  model: z.string().min(1, { message: "Model is required" }),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1, { message: "User prompt is required" }),
});

export type GeminiFormValues = z.infer<typeof formSchema>;

interface GeminiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: GeminiFormValues) => void;
  defaultValues?: Partial<GeminiFormValues>;
}

export const GeminiDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: GeminiDialogProps) => {
  const { data: models, isLoading: modelsLoading } = useAIModels("google");

  const form = useForm<GeminiFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      credentialId: defaultValues.credentialId || "",
      variableName: defaultValues.variableName || "",
      model: defaultValues.model || DEFAULT_MODEL,
      systemPrompt: defaultValues.systemPrompt || "",
      userPrompt: defaultValues.userPrompt || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "geminiResult";

  const handleSubmit = (values: GeminiFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        credentialId: defaultValues.credentialId || "",
        variableName: defaultValues.variableName || "",
        model: defaultValues.model || DEFAULT_MODEL,
        systemPrompt: defaultValues.systemPrompt || "",
        userPrompt: defaultValues.userPrompt || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 px-6 pt-6 pb-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-sm">
                <Image
                  src="/logos/gemini.svg"
                  alt="Gemini"
                  width={18}
                  height={18}
                  className="brightness-0 invert"
                />
              </div>
              <div>
                <span className="text-base font-semibold">Gemini</span>
                <p className="text-xs font-normal text-muted-foreground mt-0.5">
                  Google AI text generation
                </p>
              </div>
            </DialogTitle>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6">
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
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <CredentialPicker
                        type={CredentialType.GEMINI}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <Select
                        defaultValue={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a model" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Available Models</SelectLabel>
                            {modelsLoading ? (
                              <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Loading models...
                              </div>
                            ) : (
                              models?.map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
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
                        <Input placeholder="geminiResult" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="rounded-md bg-blue-500/5 border border-blue-500/10 px-3 py-2 text-xs text-muted-foreground font-mono">
                Access response:{" "}
                <span className="text-blue-600 dark:text-blue-400">
                  {`{{${watchVariableName}.aiResponse}}`}
                </span>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="systemPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      System Prompt{" "}
                      <span className="text-muted-foreground font-normal">
                        (optional)
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[80px] font-mono text-sm resize-none"
                        placeholder="You are a helpful assistant that..."
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Set the AI behavior. Supports{" "}
                      <code className="text-[10px] bg-muted px-1 rounded">
                        {"{{variable}}"}
                      </code>{" "}
                      and{" "}
                      <code className="text-[10px] bg-muted px-1 rounded">
                        {"{{json variable}}"}
                      </code>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="userPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>User Prompt</FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[100px] font-mono text-sm resize-none"
                        placeholder="Summarize the following text: {{previousStep.data}}"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      The main input for Gemini. Reference previous outputs with{" "}
                      <code className="text-[10px] bg-muted px-1 rounded">
                        {"{{variableName.field}}"}
                      </code>
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
                  className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
                >
                  {form.formState.isSubmitting ? "Saving..." : "Save Configuration"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
