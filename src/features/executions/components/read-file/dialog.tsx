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
  fileVariable: z.string().min(1, { message: "Source file variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  encoding: z.string().optional(),
});

export type ReadFileFormValues = z.infer<typeof formSchema>;

interface ReadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ReadFileFormValues) => void;
  defaultValues?: Partial<ReadFileFormValues>;
}

export const ReadFileDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: ReadFileDialogProps) => {
  const form = useForm<ReadFileFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fileVariable: defaultValues.fileVariable || "",
      variableName: defaultValues.variableName || "",
      encoding: defaultValues.encoding || "utf-8",
    },
  });

  const watchVariableName = form.watch("variableName") || "fileContent";

  const handleSubmit = (values: ReadFileFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        fileVariable: defaultValues.fileVariable || "",
        variableName: defaultValues.variableName || "",
        encoding: defaultValues.encoding || "utf-8",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Read File</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="fileVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source File Variable</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="downloadedFile"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Reference to file object from previous node (e.g., downloadedFile)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="encoding"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Encoding</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select encoding" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="utf-8">UTF-8</SelectItem>
                        <SelectItem value="utf-16">UTF-16</SelectItem>
                        <SelectItem value="ascii">ASCII</SelectItem>
                        <SelectItem value="binary">Binary</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Character encoding for reading file content
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
                      <Input
                        placeholder="fileContent"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Name to store the file content. Use as {`{{${watchVariableName}}}`}
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
