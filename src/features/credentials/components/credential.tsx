"use client";

import { CredentialType } from "@/generated/prisma";
import { useRouter  } from "next/router";
import { useCreateCredential, useUpdateCredential , useSuspenseCredential } from "../hooks/use-credentials";
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
        logo : "logos/openai.svg",
    } ,
    {
        value : CredentialType.ANTHROPIC,
        label : "Anthropic",
        logo : "logos/anthropic.svg",
    },
    {
        value : CredentialType.GEMINI,
        label : "Gemini",
        logo : "logos/gemini.svg",
    }
]



interface CredentialFormProps {
    initialData?:{
        id?: string;
        name : string;
        type :CredentialType;
        value : string;

    };
};

export const CredentialForm = ({initialData}:CredentialFormProps) => {

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
        if (isEdit && initialData?.id ){

            await updateCredential.mutateAsync({
                id : initialData.id,
                ...values,
            })
        }else {
            await createCredential.mutateAsync(values , {
                onError : (error) => {handleError(error);}
            });
        }

    }


    return (
        <>
         {modal}
        <Card className="shadow-none">
            <CardHeader>
                <CardTitle>
                    {isEdit ? "Edit Credential" : "Create Credential"}
                </CardTitle>
                <CardDescription>
                    {isEdit ? "Update your API key or credential information" 
                    : "Add a new API key to your account"}
                </CardDescription>
                <CardContent>
                    <Form {...form}> 

                        <form onSubmit={form.handleSubmit(onSubmit)} 
                        className = "space-y-6"
                        >
                        <FormField 
                        control={form.control}
                        name = "name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="My API Key" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                        <FormField 
                         control={form.control}
                         name = "type"
                         render={({ field }) => (
                            <FormItem>
                                <FormLabel>Type</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select a credential type" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {credentialTypeOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                <div className="flex items-center gap-2">
                                                    <Image src={option.logo} alt={option.label}
                                                     width={16} 
                                                     height={16} 
                                                     className="mr-2" />
                                                    {option.label}
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
                    name = "value"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>API Key</FormLabel>
                                <FormControl>
                                    <Input placeholder="sk-..." {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                   <div className = "flex gap-4">
                        <Button type="submit" disabled={createCredential.isPending || updateCredential.isPending}>
                          {isEdit ? "Update Credential" : "Create Credential"}
                        </Button>
                        <Button type="button" 
                        variant="outline"
                        asChild
                        >
                          <Link href="/credentials">Cancel</Link>  
                        </Button>
                    </div>


                        </form>


                    </Form>

                </CardContent>

            </CardHeader>
        </Card>
        </>
    )

};