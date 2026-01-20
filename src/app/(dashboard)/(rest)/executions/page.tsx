import { requireAuth } from "@/lib/auth-utils";

const page = async () => {
    await requireAuth();
    
    return <p>executions</p>;
   

};

export default page;
