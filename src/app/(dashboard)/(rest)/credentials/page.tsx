import { requireAuth } from "@/lib/auth-utils";

const page = async () => {
    await requireAuth();
    
    return <p>credentials</p>;
   

};

export default page;
