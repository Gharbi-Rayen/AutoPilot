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

const formSchema = z.object({
  leftVariable: z.string().min(1, { message: "Left variable is required" }),
  rightVariable: z.string().min(1, { message: "Right variable is required" }),
  leftKey: z.string().min(1, { message: "Left key is required" }),
  rightKey: z.string().min(1, { message: "Right key is required" }),
  joinType: z.enum(["inner", "left"]),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
});

export type CsvJoinFormValues = z.infer<typeof formSchema>;

interface CsvJoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvJoinFormValues) => void;
  defaultValues?: Partial<CsvJoinFormValues>;
}

export const CsvJoinDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: CsvJoinDialogProps) => {
  const form = useForm<CsvJoinFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      leftVariable: defaultValues.leftVariable || "",
      rightVariable: defaultValues.rightVariable || "",
      leftKey: defaultValues.leftKey || "",
      rightKey: defaultValues.rightKey || "",
      joinType: defaultValues.joinType || "inner",
      variableName: defaultValues.variableName || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "joinedData";

  const handleSubmit = (values: CsvJoinFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        leftVariable: defaultValues.leftVariable || "",
        rightVariable: defaultValues.rightVariable || "",
        leftKey: defaultValues.leftKey || "",
        rightKey: defaultValues.rightKey || "",
        joinType: defaultValues.joinType || "inner",
        variableName: defaultValues.variableName || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Join CSV Datasets</DialogTitle>
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
                      <Input placeholder="customersData" {...field} />
                    </FormControl>
                    <FormDescription>Primary dataset records</FormDescription>
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
                      <Input placeholder="ordersData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Dataset to merge with left
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="leftKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Left Key</FormLabel>
                      <FormControl>
                        <Input placeholder="customerId" {...field} />
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
              </div>

              <FormField
                control={form.control}
                name="joinType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Join Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select join type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="inner">Inner Join</SelectItem>
                        <SelectItem value="left">Left Join</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Inner keeps matches only. Left keeps all left rows.
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
                      <Input placeholder="joinedData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store joined rows as {`{{${watchVariableName}}}`}
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
