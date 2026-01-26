"use client";
import {createId} from "@paralleldrive/cuid2";

import { useReactFlow } from "@xyflow/react";

import { useCallback } from "react";

import { NodeType } from "@/generated/prisma";

import{GlobeIcon , MousePointerIcon}from "lucide-react";

import { toast } from "sonner";

import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetDescription
}from "@/components/ui/sheet";

import { Separator } from "./ui/separator";

export type NodeTypeOption ={
    type : NodeType;
    label : string;
    description : string;
    icon : React.ComponentType<{className ?: string}> | string;
};


const triggerNodes : NodeTypeOption []=[
{

    type : NodeType.MANUAL_TRIGGER,
    label : "Manual Trigger",
    description : "Start the workflow manually.",
    icon : MousePointerIcon
},
];


const executionNodes : NodeTypeOption []=[
{
    type : NodeType.HTTP_REQUEST,
    label : "HTTP Request",
    description : "Make an HTTP request to an external API.",
    icon : GlobeIcon
},

];


interface NodeSelectorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children?: React.ReactNode;
}


export function NodeSelector({open, onOpenChange, children} : NodeSelectorProps) {

    const {setNodes , getNodes ,screenToFlowPosition } = useReactFlow();
    const handleNodeSelect = useCallback((selection: NodeTypeOption) => {
    if(selection.type === NodeType.MANUAL_TRIGGER) {
        const nodes = getNodes();
        const hasManualTrigger = nodes.some((node) => node.type === NodeType.MANUAL_TRIGGER);

        if (hasManualTrigger) {
         toast.error("Only one manual trigger is allowed per workflow.");
         return;
        }
        
    }
    setNodes((nodes) => {
            const hasInitialTrigger = nodes.some((node) => node.type === NodeType.INITIAL,);
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            const flowPosition = screenToFlowPosition({x: centerX + (Math.random()-0.5 * 200), y: centerY + (Math.random()-0.5 * 200)});
            const newNode = {
                id: createId(),
                data: {},
                position: flowPosition,
                type: selection.type,
            };

            if (hasInitialTrigger) {
                return [newNode];
            }

            return  [...nodes, newNode];
        });

        onOpenChange(false);

},[onOpenChange, setNodes, getNodes, screenToFlowPosition]);
   

    
    return(
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetTrigger asChild>
                {children}
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                <SheetHeader>
                
                    <SheetTitle>What triggers this workflow?</SheetTitle>
                    <SheetDescription>
                        A trigger is a step that starts your workflow.
                    </SheetDescription>
                </SheetHeader>

                <div>
                    {triggerNodes.map((nodeType) => {
                        const Icon = nodeType.icon;
                       return(
                        <div
                        key={nodeType.type}
                        className="w-full justify-start h-auto py-5 px-4 rounded-none cursor-pointer
                        border-l-2 border-transparent hover:border-l-primary"
                        onClick={()=>{handleNodeSelect(nodeType)}}
                        >

                            <div className="flex items-center gap-6 w-full overflow-hidden">
                                {typeof nodeType.icon === "string" ? (
                                    <img src={nodeType.icon} alt={nodeType.label} className="size-5 object-contain rounded-sm"/>
                                ) : (
                                    <Icon className="size-5 text-muted-foreground"/>
                                )}
                                <div className="flex flex-col overflow-hidden">
                                    <span className="font-medium text-sm text-foreground leading-tight">
                                        {nodeType.label}
                                    </span>
                                    <span className="text-xs text-muted-foreground leading-tight
                                    overflow-hidden text-ellipsis">
                                        {nodeType.description}
                                    </span>
                                </div>
                            </div>

                        </div>
                       )
                    })}
                </div>
                 <div>
                    {executionNodes.map((nodeType) => {
                        const Icon = nodeType.icon;
                       return(
                        <div
                        key={nodeType.type}
                        className="w-full justify-start h-auto py-5 px-4 rounded-none cursor-pointer
                        border-l-2 border-transparent hover:border-l-primary"
                        onClick={()=>{handleNodeSelect(nodeType)}}
                        >

                            <div className="flex items-center gap-6 w-full overflow-hidden">
                                {typeof nodeType.icon === "string" ? (
                                    <img src={nodeType.icon} alt={nodeType.label} className="size-5 object-contain rounded-sm"/>
                                ) : (
                                    <Icon className="size-5 text-muted-foreground"/>
                                )}
                                <div className="flex flex-col overflow-hidden">
                                    <span className="font-medium text-sm text-foreground leading-tight">
                                        {nodeType.label}
                                    </span>
                                    <span className="text-xs text-muted-foreground leading-tight
                                    overflow-hidden text-ellipsis">
                                        {nodeType.description}
                                    </span>
                                </div>
                            </div>

                        </div>
                       )
                    })}
                </div>
            </SheetContent>
        </Sheet>
    );
};