"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import z from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CredentialType } from "@/generated/prisma";
import { useUpgradeModal } from "@/hooks/use-upgrade-modal";
import { cn } from "@/lib/utils";
import {
  useCreateCredential,
  useSuspenseCredential,
  useUpdateCredential,
} from "../hooks/use-credentials";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.nativeEnum(CredentialType),
  value: z.string().min(1, "API key is required"),
});

type FormValues = z.infer<typeof formSchema>;

const credentialTypeOptions = [
  {
    value: CredentialType.WHATSAPP_TOKEN,
    label: "WhatsApp",
    logo: "/logos/whatsapp.svg",
    valueLabel: "Token",
    valuePlaceholder: "EAAX...",
  },
];

interface CredentialFormProps {
  initialData?: {
    id?: string;
    name: string;
    type: CredentialType;
    value: string;
  };
  redirectTo?: string;
  defaultType?: string;
}

export const CredentialForm = ({
  initialData,
  redirectTo,
  defaultType,
}: CredentialFormProps) => {
  const router = useRouter();
  const createCredential = useCreateCredential();
  const updateCredential = useUpdateCredential();
  const { handleError, modal } = useUpgradeModal();
  const [typePopoverOpen, setTypePopoverOpen] = useState(false);

  const isEdit = !!initialData?.id;

  // Resolve default type from URL param if provided and valid
  const resolvedDefaultType =
    defaultType && credentialTypeOptions.some((o) => o.value === defaultType)
      ? (defaultType as CredentialType)
      : CredentialType.WHATSAPP_TOKEN;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData || {
      name: "",
      type: resolvedDefaultType,
      value: "",
    },
  });

  const watchType = form.watch("type");
  const currentTypeOption =
    credentialTypeOptions.find((o) => o.value === watchType) ||
    credentialTypeOptions[0];

  const onSubmit = async (values: FormValues) => {
    try {
      if (isEdit && initialData?.id) {
        await updateCredential.mutateAsync({
          id: initialData.id,
          ...values,
        });
        router.push("/credentials");
      } else {
        await createCredential.mutateAsync(values);
        if (redirectTo) {
          router.push(redirectTo);
        } else {
          router.push("/credentials");
        }
      }
    } catch (error) {
      // Show upgrade modal if the error is a FORBIDDEN (subscription required)
      handleError(error);
    }
  };

  return (
    <>
      {modal}
      {(isEdit || redirectTo) && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground w-fit -ml-2 mb-2"
          asChild
        >
          <Link href={redirectTo || "/credentials"}>
            <ArrowLeftIcon className="size-4" />
            {redirectTo ? "Back to Workflow" : "Back to Credentials"}
          </Link>
        </Button>
      )}
      <Card className="shadow-none border-border/40">
        <CardHeader className="space-y-4">
          <div className="space-y-2">
            <CardTitle className="text-2xl font-semibold">
              {isEdit ? "Edit Credential" : "Create Credential"}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {isEdit
                ? "Update your API key or credential details"
                : "Add a new API key to your account"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="text-sm font-medium">Name</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="My API Key"
                        className="h-10"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem className="space-y-2 flex flex-col">
                    <FormLabel className="text-sm font-medium">Type</FormLabel>
                    <Popover
                      open={typePopoverOpen}
                      onOpenChange={setTypePopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={typePopoverOpen}
                            className={cn(
                              "h-10 w-full justify-between font-normal",
                              !field.value && "text-muted-foreground",
                            )}
                          >
                            {field.value ? (
                              <div className="flex items-center gap-3">
                                <Image
                                  src={
                                    credentialTypeOptions.find(
                                      (o) => o.value === field.value,
                                    )?.logo || ""
                                  }
                                  alt=""
                                  width={20}
                                  height={20}
                                  className="rounded-sm"
                                />
                                <span>
                                  {
                                    credentialTypeOptions.find(
                                      (o) => o.value === field.value,
                                    )?.label
                                  }
                                </span>
                              </div>
                            ) : (
                              "Select a credential type"
                            )}
                            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[--radix-popover-trigger-width] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput placeholder="Search credential type..." />
                          <CommandList className="max-h-[180px]">
                            <CommandEmpty>
                              No credential type found.
                            </CommandEmpty>
                            <CommandGroup>
                              {credentialTypeOptions.map((option) => (
                                <CommandItem
                                  key={option.value}
                                  value={option.label}
                                  onSelect={() => {
                                    field.onChange(option.value);
                                    setTypePopoverOpen(false);
                                  }}
                                  className="cursor-pointer"
                                >
                                  <div className="flex items-center gap-3 flex-1">
                                    <Image
                                      src={option.logo}
                                      alt={option.label}
                                      width={20}
                                      height={20}
                                      className="rounded-sm"
                                    />
                                    <span className="font-medium">
                                      {option.label}
                                    </span>
                                  </div>
                                  <CheckIcon
                                    className={cn(
                                      "size-4 shrink-0",
                                      field.value === option.value
                                        ? "opacity-100"
                                        : "opacity-0",
                                    )}
                                  />
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="text-sm font-medium">
                      {currentTypeOption.valueLabel}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={currentTypeOption.valuePlaceholder}
                        type="password"
                        className="h-10"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  disabled={
                    createCredential.isPending || updateCredential.isPending
                  }
                  className="flex-1 h-10"
                >
                  {(createCredential.isPending ||
                    updateCredential.isPending) && (
                    <Loader2Icon className="size-4 animate-spin" />
                  )}
                  {isEdit
                    ? updateCredential.isPending
                      ? "Updating..."
                      : "Update"
                    : createCredential.isPending
                      ? "Creating..."
                      : "Create Credential"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="px-8 h-10"
                  asChild
                >
                  <Link href={redirectTo || "/credentials"}>Cancel</Link>
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </>
  );
};

export const CredentialView = ({ credentialId }: { credentialId: string }) => {
  const { data: credential } = useSuspenseCredential(credentialId);

  return <CredentialForm initialData={credential} />;
};
