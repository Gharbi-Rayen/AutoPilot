"use client";

import { zodResolver } from "@hookform/resolvers/zod";
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

const formSchema = z.object({
  sourceVariable: z.string().min(1, { message: "Source variable is required" }),
  variablePrefix: z
    .string()
    .min(1, { message: "Variable prefix is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  chunkSize: z.coerce
    .number()
    .int({ message: "Chunk size must be an integer" })
    .min(1, { message: "Chunk size must be at least 1" }),
});

export type SplitFormValues = z.infer<typeof formSchema>;

interface SplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SplitFormValues) => void;
  defaultValues?: Partial<SplitFormValues>;
}

export const SplitDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: SplitDialogProps) => {
  const form = useForm<SplitFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variablePrefix: defaultValues.variablePrefix || "split",
      chunkSize: defaultValues.chunkSize || 100,
    },
  });

  const watchVariablePrefix = form.watch("variablePrefix") || "split";

  const handleSubmit = (values: SplitFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variablePrefix: defaultValues.variablePrefix || "split",
        chunkSize: defaultValues.chunkSize || 100,
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Split Data</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="sourceVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Variable</FormLabel>
                    <FormControl>
                      <Input placeholder="records" {...field} />
                    </FormControl>
                    <FormDescription>Array or records payload to split</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chunkSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chunk Size</FormLabel>
                    <FormControl>
                      <Input type="number" min={1} placeholder="100" {...field} />
                    </FormControl>
                    <FormDescription>Maximum items per generated chunk</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="variablePrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Variable Prefix</FormLabel>
                    <FormControl>
                      <Input placeholder="split" {...field} />
                    </FormControl>
                    <FormDescription>
                      Chunks will be created as {`{{${watchVariablePrefix}_1}}`}, {`{{${watchVariablePrefix}_2}}`}, etc.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
