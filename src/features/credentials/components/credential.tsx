"use client";

import { CredentialType } from "@/generated/prisma";
import { useRouter  } from "next/navigation";
import { useCreateCredential, useSuspenseCredential, useUpdateCredential } from "../hooks/use-credentials";
import { useUpgradeModal } from "@/hooks/use-upgrade-modal";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import z from "zod";
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
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
}
from "@/components/ui/select";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import Link from "next/link";



const formSchema = z.object({
    name : z.string().min(1, "Name is required"),
    type : z.enum(CredentialType),
    value : z.string().min(1, "API key is required"),
});

type FormValues = z.infer<typeof formSchema>;

const credentialTypeOptions = [
    {
        value : CredentialType.OPENAI,
        label : "OpenAI",
        logo : "/logos/openai.svg",
    } ,
    {
        value : CredentialType.ANTHROPIC,
        label : "Anthropic",
        logo : "/logos/anthropic.svg",
    },
    {
        value : CredentialType.GEMINI,
        label : "Gemini",
        logo : "/logos/gemini.svg",
    }
]



interface CredentialFormProps {
    initialData?:{
        id?: string;
        name : string;
        type :CredentialType;
        value : string;

    };
    redirectTo?: string;
};

export const CredentialForm = ({initialData, redirectTo}:CredentialFormProps) => {

    const router = useRouter();
    const createCredential = useCreateCredential();
    const updateCredential = useUpdateCredential();
    const { handleError , modal } =  useUpgradeModal();
    
    const isEdit = !!initialData?.id;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues : initialData || {
            name:"",
            type: CredentialType.OPENAI,
            value:"",
        }
    })

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
    }


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
                        {isEdit ? "Update your API key or credential details" 
                        : "Add a new API key to your account"}
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent className="space-y-8">
                <Form {...form}> 
                    <form onSubmit={form.handleSubmit(onSubmit)} 
                    className="space-y-6"
                    >
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
                        <FormItem className="space-y-2">
                            <FormLabel className="text-sm font-medium">Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger className="h-10">
                                        <SelectValue placeholder="Select a credential type" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {credentialTypeOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                            <div className="flex items-center gap-3">
                                                <Image 
                                                    src={option.logo} 
                                                    alt={option.label}
                                                    width={20} 
                                                    height={20} 
                                                    className="rounded-sm" 
                                                />
                                                <span className="font-medium">{option.label}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                    />

            <FormField
                control={form.control}
                name="value"
                render={({ field }) => (
                    <FormItem className="space-y-2">
                        <FormLabel className="text-sm font-medium">API Key</FormLabel>
                        <FormControl>
                            <Input 
                                placeholder="sk-..." 
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
                    disabled={createCredential.isPending || updateCredential.isPending}
                    className="flex-1 h-10"
                >
                  {(createCredential.isPending || updateCredential.isPending) && (
                    <Loader2Icon className="size-4 animate-spin" />
                  )}
                  {isEdit 
                    ? (updateCredential.isPending ? "Updating..." : "Update") 
                    : (createCredential.isPending ? "Creating..." : "Create Credential")}
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
    )

};


export const CredentialView = ({ credentialId }: { credentialId: string }) => {

    const { data: credential } = useSuspenseCredential(credentialId);


    return <CredentialForm initialData={credential} />
};