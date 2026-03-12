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

export const CODE_LANGUAGES = ["javascript", "java"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

const formSchema = z.object({
  language: z.enum(CODE_LANGUAGES, { message: "Language is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  code: z
    .string()
    .min(1, { message: "Code is required" })
    .max(50000, { message: "Code must be 50,000 characters or less" }),
});

export type CodeFormValues = z.infer<typeof formSchema>;

interface CodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CodeFormValues) => void;
  defaultValues?: Partial<CodeFormValues>;
}

export const CodeDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: CodeDialogProps) => {
  const form = useForm<CodeFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      language: defaultValues.language || "javascript",
      variableName: defaultValues.variableName || "",
      code: defaultValues.code || "",
    },
  });

  const watchLanguage = form.watch("language") || "javascript";
  const watchVariableName = form.watch("variableName") || "codeResult";
  const watchCode = form.watch("code") || "";

  const isJava = watchLanguage === "java";

  const handleSubmit = (values: CodeFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        language: defaultValues.language || "javascript",
        variableName: defaultValues.variableName || "",
        code: defaultValues.code || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-orange-500/10 px-6 pt-6 pb-4 shrink-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex items-center justify-center size-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm">
                <Image
                  src="/logos/code.svg"
                  alt="Code"
                  width={18}
                  height={18}
                  className="brightness-0 invert"
                />
              </div>
              <div>
                <span className="text-base font-semibold">Code</span>
                <p className="text-xs font-normal text-muted-foreground mt-0.5">
                  Run custom {isJava ? "Java" : "JavaScript"} code
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
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a language" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="javascript">JavaScript</SelectItem>
                        <SelectItem value="java">Java</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Choose which language your code is written in
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
                      <Input placeholder="codeResult" {...field} />
                    </FormControl>
                    <FormDescription>
                      The return value will be stored under this name
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-md bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium mb-1">How it works:</p>
                {isJava ? (
                  <p>
                    Your code runs as a Java program. The{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      context
                    </code>{" "}
                    is passed as a JSON string in{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      args[0]
                    </code>
                    . Print your JSON result to{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      System.out
                    </code>
                    .
                  </p>
                ) : (
                  <p>
                    Your code receives a{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      context
                    </code>{" "}
                    object containing data from previous steps. Use{" "}
                    <code className="text-[10px] bg-muted px-1 rounded">
                      return
                    </code>{" "}
                    to output a value for the next step.
                  </p>
                )}
              </div>

              <div className="rounded-md bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-xs text-muted-foreground font-mono">
                Access result:{" "}
                <span className="text-amber-600 dark:text-amber-400">
                  {`{{${watchVariableName}}}`}
                </span>
              </div>

              <Separator />

              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <span>{isJava ? "Java" : "JavaScript"} Code</span>
                      <span
                        className={`text-xs font-normal ${watchCode.length > 50000 ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {watchCode.length}/50000
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        className="min-h-[200px] font-mono text-sm resize-none"
                        placeholder={
                          isJava
                            ? `public class Main {\n  public static void main(String[] args) {\n    // args[0] contains the context as JSON\n    System.out.println("{\\"message\\": \\"Hello from Java!\\"}");\n  }\n}`
                            : `// Access data from previous steps via context\nconst data = context.previousStep;\n\n// Process the data\nconst result = {\n  message: "Hello from Code node!",\n  timestamp: new Date().toISOString(),\n};\n\nreturn result;`
                        }
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {isJava ? (
                        <>
                          Write Java code with a{" "}
                          <code className="text-[10px] bg-muted px-1 rounded">
                            public static void main(String[] args)
                          </code>{" "}
                          method. Context is passed as JSON in{" "}
                          <code className="text-[10px] bg-muted px-1 rounded">
                            args[0]
                          </code>
                          . Print JSON to stdout. 30s timeout.
                        </>
                      ) : (
                        <>
                          Write JavaScript code. Use{" "}
                          <code className="text-[10px] bg-muted px-1 rounded">
                            context.variableName
                          </code>{" "}
                          to access previous step results. Async/await is
                          supported. 30s timeout.
                        </>
                      )}
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
                  className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white"
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
