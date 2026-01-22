"use client";

import { EntityContainer, EntityHeader, EntityPagination, EntitySearch } from "@/components/entity-components";
import { useCreateWorkflow, useSuspenseWorkflows } from "../hooks/use-workflows"
import { useUpgradeModal } from "@/hooks/use-upgrade-modal";
import { useRouter } from "next/navigation";
import { useWorkflowsParams } from "../hooks/use-workflows-params";
import { useEntitySearch } from "@/hooks/use-entity-search";


export const WorkflowsSearch = () => {

    const [params , setParams] = useWorkflowsParams();
    const {searchvalue , onSearchChange} = useEntitySearch({params, setParams});
    return(
        <EntitySearch 
        placeholder="Search workflows..."
        value={searchvalue}
        onChange ={onSearchChange}
        />
    )
}

export const WorkflowsList = () => {

    const workflows = useSuspenseWorkflows();
    return (

        <p>
            {JSON.stringify(workflows.data , null, 2)}
        </p>

    )
};

export const WorkflowsHeader = ({disabled} : {disabled?: boolean}) =>
{   
    const router = useRouter();

    const createWorkflow = useCreateWorkflow();
    const {handleError, modal} = useUpgradeModal();

    const handleCreateWorkflow = () => {
        createWorkflow.mutate(undefined , {
            onSuccess : (data) =>{
                router.push(`/workflows/${data.id}`);
            },
            // todo : open upgrade modal 
            onError : (error) => {
                handleError(error);
            }
        });
    }

    return (
    
    <>
     {modal}
    <EntityHeader
        title="workflows"
        description = "create and manage your workflows"
        newButtonLabel="New Workflow"
        disabled={disabled}
        onNew={()=>{handleCreateWorkflow();}}
        //newButtonHref={}
        isCreating = {createWorkflow.isPending}
    />
   
    </>
    
    );
};

export const WorkflowsPagination = () => {
    const workflows = useSuspenseWorkflows();
    const [params , setParams] = useWorkflowsParams();

    return(
        <EntityPagination
            page={workflows.data.page}
            totalPages={workflows.data.totalPages}
            disabled={workflows.isFetching}
            onPageChange={(page) => setParams({...params, page})}
        />
    )

}

export const WorkflowsContainer = ({
    children
}: {
    children: React.ReactNode;
}) => {
    return (
    
        <EntityContainer
        header = {<WorkflowsHeader />}
        search = {<WorkflowsSearch />}
        pagination = {<WorkflowsPagination/>}
        >

        {children}    
            
        </EntityContainer>
    
    )
};

