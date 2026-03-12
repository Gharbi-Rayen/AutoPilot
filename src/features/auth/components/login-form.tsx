"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
  rememberMe: z.boolean().default(false),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const [loadingProvider, setLoadingProvider] = useState<
    "github" | "google" | null
  >(null);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    await authClient.signIn.email(
      {
        email: data.email,
        password: data.password,
        callbackURL: "/",
        rememberMe: data.rememberMe,
      },
      {
        onSuccess: () => {
          router.push("/");
        },
        onError: (ctx) => {
          toast.error(ctx.error.message || "Failed to login");
        },
      },
    );
  };

  const handleSocialLogin = async (provider: "github" | "google") => {
    setLoadingProvider(provider);
    await authClient.signIn.social(
      {
        provider,
        callbackURL: "/",
      },
      {
        onError: (ctx) => {
          toast.error(
            ctx.error.message || `Failed to sign in with ${provider}`,
          );
          setLoadingProvider(null);
        },
      },
    );
  };

  const isSubmitting = form.formState.isSubmitting;
  const isAnyLoading = isSubmitting || loadingProvider !== null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Login to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div className="grid gap-6">
                <div className=" flex flex-col gap-4">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={isAnyLoading}
                    type="button"
                    onClick={() => handleSocialLogin("github")}
                  >
                    {loadingProvider === "github" ? (
                      <Loader2Icon className="size-5 animate-spin" />
                    ) : (
                      <Image
                        src="/logos/github.svg"
                        alt="GitHub"
                        width={20}
                        height={20}
                      />
                    )}
                    Continue with Github
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={isAnyLoading}
                    type="button"
                    onClick={() => handleSocialLogin("google")}
                  >
                    {loadingProvider === "google" ? (
                      <Loader2Icon className="size-5 animate-spin" />
                    ) : (
                      <Image
                        src="/logos/google.svg"
                        alt="Google"
                        width={20}
                        height={20}
                      />
                    )}
                    Continue with Google
                  </Button>
                </div>
                <div className="grid gap-6">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="an@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="********"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="rememberMe"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          Remember me
                        </FormLabel>
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isAnyLoading}
                  >
                    {isSubmitting && (
                      <Loader2Icon className="size-4 animate-spin" />
                    )}
                    {isSubmitting ? "Signing in..." : "Login"}
                  </Button>
                </div>

                <div className="text-center text-sm">
                  Don't have an account?{" "}
                  <Link href="/signup" className="underline underline-offset-4">
                    Sign up
                  </Link>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
