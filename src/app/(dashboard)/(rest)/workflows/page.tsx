import { requireAuth } from "@/lib/auth-utils";

const page = async () => {
    await requireAuth();

    return <p>workflows</p>;
   

};

export default page;
