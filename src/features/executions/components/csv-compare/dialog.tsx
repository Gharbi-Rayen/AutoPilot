"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
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
import { FieldSuggestionInput } from "../csv-shared/field-suggestion-input";
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useUpstreamVariableMetadata } from "../csv-shared/use-upstream-variable-metadata";

const formSchema = z.object({
  leftVariable: z.string().min(1, { message: "Left variable is required" }),
  rightVariable: z.string().min(1, { message: "Right variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  keyField: z.string().optional(),
  compareFields: z.string().optional(),
});

export type CsvCompareFormValues = z.infer<typeof formSchema>;

interface CsvCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvCompareFormValues) => void;
  defaultValues?: Partial<CsvCompareFormValues>;
  nodeId: string;
}

export const CsvCompareDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvCompareDialogProps) => {
  const form = useForm<CsvCompareFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      leftVariable: defaultValues.leftVariable || "",
      rightVariable: defaultValues.rightVariable || "",
      variableName: defaultValues.variableName || "",
      keyField: defaultValues.keyField || "",
      compareFields: defaultValues.compareFields || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "comparisonResult";
  const watchLeftVariable = form.watch("leftVariable");
  const watchRightVariable = form.watch("rightVariable");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);

  const leftSuggestions = getColumns(watchLeftVariable);
  const rightSuggestions = getColumns(watchRightVariable);
  const compareFieldSuggestions = useMemo(() => {
    if (leftSuggestions.length === 0) {
      return rightSuggestions;
    }

    if (rightSuggestions.length === 0) {
      return leftSuggestions;
    }

    const rightSet = new Set(rightSuggestions);
    return leftSuggestions.filter((column) => rightSet.has(column));
  }, [leftSuggestions, rightSuggestions]);

  const handleSubmit = (values: CsvCompareFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        leftVariable: defaultValues.leftVariable || "",
        rightVariable: defaultValues.rightVariable || "",
        variableName: defaultValues.variableName || "",
        keyField: defaultValues.keyField || "",
        compareFields: defaultValues.compareFields || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compare CSV Datasets</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="leftVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Left Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="baselineData" />
                    </FormControl>
                    <FormDescription>
                      Baseline dataset to compare from
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rightVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Right Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="incomingData" />
                    </FormControl>
                    <FormDescription>
                      New dataset to compare against
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="keyField"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key Field (Optional)</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="id"
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        suggestions={compareFieldSuggestions}
                        mode="single"
                      />
                    </FormControl>
                    <FormDescription>
                      Compare records by this field. Leave empty for full-row
                      comparison.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="compareFields"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Compare Fields (Optional)</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="status,amount,updatedAt"
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        suggestions={compareFieldSuggestions}
                        mode="multi"
                      />
                    </FormControl>
                    <FormDescription>
                      Comma-separated fields. Leave empty to compare all shared
                      fields.
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
                    <FormLabel>Output Variable Name</FormLabel>
                    <FormControl>
                      <Input placeholder="comparisonResult" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store diff summary as {`{{${watchVariableName}}}`}
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
