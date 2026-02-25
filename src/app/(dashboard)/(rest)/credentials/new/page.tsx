import { CredentialForm } from "@/features/credentials/components/credential";
import { requireAuth } from "@/lib/auth-utils";

interface PageProps {
  searchParams: Promise<{ redirect?: string }>;
}

const Page = async ({ searchParams }: PageProps) => {
    await requireAuth();
    const { redirect } = await searchParams;

 return (
    <div className="p-4 md:px-10 md:py-6 h-full">
        <div className="mx-auto max-w-screen-md w-full flex flex-col gap-y-8 h-full">
          <CredentialForm redirectTo={redirect} />
        </div>
            
    </div>
 );


}

export default Page;