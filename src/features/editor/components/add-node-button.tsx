"use client";

import { memo  } from "react";
import { PlusIcon} from "lucide-react";
import { Button } from "@/components/ui/button";
import { add } from "date-fns";


export const AddNodeButton = memo(() => {

return (
    <Button 
    onClick={()=>{}}
    size="icon"
    variant="outline" 
    className="bg-background">
        <PlusIcon />
    </Button>
    )
});

AddNodeButton.displayName = "AddNodeButton";