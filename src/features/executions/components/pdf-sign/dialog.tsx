"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

const formSchema = z.object({
  pdfVariable: z
    .string()
    .min(1, { message: "Source PDF variable is required" }),
  certificateVariable: z
    .string()
    .min(1, { message: "Certificate variable is required" }),
  certificatePasswordVariable: z.string().optional(),
  signatureReason: z.string().optional(),
  signatureLocation: z.string().optional(),
  fileName: z.string().optional(),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
});

export type PdfSignFormValues = z.infer<typeof formSchema>;

interface PdfSignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PdfSignFormValues) => void;
  defaultValues?: Partial<PdfSignFormValues>;
  nodeId: string;
}

export const PdfSignDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: PdfSignDialogProps) => {
  const form = useForm<PdfSignFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pdfVariable: defaultValues.pdfVariable || "",
      certificateVariable: defaultValues.certificateVariable || "",
      certificatePasswordVariable:
        defaultValues.certificatePasswordVariable || "",
      signatureReason: defaultValues.signatureReason || "",
      signatureLocation: defaultValues.signatureLocation || "",
      fileName: defaultValues.fileName || "",
      variableName: defaultValues.variableName || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "signedPdf";
  const watchPdfVariable = form.watch("pdfVariable");
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchPdfVariable, suffix: "signed", open });

  const handleSubmit = (values: PdfSignFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        pdfVariable: defaultValues.pdfVariable || "",
        certificateVariable: defaultValues.certificateVariable || "",
        certificatePasswordVariable:
          defaultValues.certificatePasswordVariable || "",
        signatureReason: defaultValues.signatureReason || "",
        signatureLocation: defaultValues.signatureLocation || "",
        fileName: defaultValues.fileName || "",
        variableName: defaultValues.variableName || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDF Sign</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="pdfVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source PDF Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="generatedContractPdf" />
                    </FormControl>
                    <FormDescription>PDF variable to sign</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="certificateVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Certificate Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="signingCertificate" />
                    </FormControl>
                    <FormDescription>
                      Variable containing your signing certificate file
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="certificatePasswordVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Certificate Password Variable (Optional)
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="certificatePassword" {...field} />
                    </FormControl>
                    <FormDescription>
                      Variable containing certificate passphrase, when required
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="signatureReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Signature Reason (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Approved by finance team"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="signatureLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Signature Location (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Paris, France" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fileName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output File Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="signed-contract.pdf" {...field} />
                    </FormControl>
                    <FormDescription>
                      Defaults to [variableName].pdf when empty
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
                      <VariableNameInput value={field.value} onChange={field.onChange} suggestion={suggestion} open={open} />
                    </FormControl>
                    <FormDescription>
                      Store generated file as {`{{${watchVariableName}}}`}
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
