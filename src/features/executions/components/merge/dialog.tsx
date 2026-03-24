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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const strategies = ["concat", "zip", "by_key"] as const;

const formSchema = z
  .object({
    leftVariable: z.string().min(1, { message: "Left variable is required" }),
    rightVariable: z.string().min(1, { message: "Right variable is required" }),
    strategy: z.enum(strategies),
    leftKey: z.string().optional(),
    rightKey: z.string().optional(),
    variableName: z
      .string()
      .min(1, { message: "Variable name is required" })
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
        message:
          "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
      }),
  })
  .superRefine((values, ctx) => {
    if (values.strategy === "by_key") {
      if (!values.leftKey || values.leftKey.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Left key is required for by_key strategy",
          path: ["leftKey"],
        });
      }
      if (!values.rightKey || values.rightKey.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Right key is required for by_key strategy",
          path: ["rightKey"],
        });
      }
    }
  });

export type MergeFormValues = z.infer<typeof formSchema>;

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: MergeFormValues) => void;
  defaultValues?: Partial<MergeFormValues>;
}

export const MergeDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: MergeDialogProps) => {
  const form = useForm<MergeFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      leftVariable: defaultValues.leftVariable || "",
      rightVariable: defaultValues.rightVariable || "",
      strategy: defaultValues.strategy || "concat",
      leftKey: defaultValues.leftKey || "",
      rightKey: defaultValues.rightKey || "",
      variableName: defaultValues.variableName || "",
    },
  });

  const strategy = form.watch("strategy");
  const watchVariableName = form.watch("variableName") || "mergedData";

  const handleSubmit = (values: MergeFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        leftVariable: defaultValues.leftVariable || "",
        rightVariable: defaultValues.rightVariable || "",
        strategy: defaultValues.strategy || "concat",
        leftKey: defaultValues.leftKey || "",
        rightKey: defaultValues.rightKey || "",
        variableName: defaultValues.variableName || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge Data</DialogTitle>
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
                      <Input placeholder="leftRecords" {...field} />
                    </FormControl>
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
                      <Input placeholder="rightRecords" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="strategy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Strategy</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select strategy" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="concat">Concatenate</SelectItem>
                        <SelectItem value="zip">Zip by index</SelectItem>
                        <SelectItem value="by_key">Join by key</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Concat appends lists, zip pairs index-to-index, by_key
                      merges matching rows
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {strategy === "by_key" && (
                <>
                  <FormField
                    control={form.control}
                    name="leftKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Left Key</FormLabel>
                        <FormControl>
                          <Input placeholder="id" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="rightKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Right Key</FormLabel>
                        <FormControl>
                          <Input placeholder="id" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={form.control}
                name="variableName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output Variable Name</FormLabel>
                    <FormControl>
                      <Input placeholder="mergedData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Merged output stored as {`{{${watchVariableName}}}`}
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
