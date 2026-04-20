"use client";

import { formatDistanceToNow } from "date-fns";
import { WorkflowIcon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmptyView,
  EntityContainer,
  EntityHeader,
  EntityItem,
  EntityList,
  EntityPagination,
  EntitySearch,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import type { WorkflowRecord } from "@/lib/db";
import { useEntitySearch } from "@/hooks/use-entity-search";
import {
  useCreateWorkflow,
  useRemoveWorkflow,
  useSuspenseWorkflows,
} from "../hooks/use-workflows";
import { useWorkflowsParams } from "../hooks/use-workflows-params";
import { CreateWorkflowDialog } from "./create-workflow-dialog";

export const WorkflowsSearch = () => {
  const [params, setParams] = useWorkflowsParams();
  const { searchvalue, onSearchChange } = useEntitySearch({
    params,
    setParams,
  });
  return (
    <EntitySearch
      placeholder="Search workflows..."
      value={searchvalue}
      onChange={onSearchChange}
    />
  );
};

export const WorkflowsList = () => {
  const workflows = useSuspenseWorkflows();
  return (
    <EntityList
      items={workflows.data.items}
      getKey={(workflow) => workflow.id}
      renderItem={(workflow) => <WorkflowItem data={workflow} />}
      emptyView={<WorkflowsEmpty />}
    />
  );
};

export const WorkflowsHeader = ({ disabled }: { disabled?: boolean }) => {
  const router = useRouter();
  const createWorkflow = useCreateWorkflow();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleCreate = (name: string) => {
    createWorkflow.mutate(name, {
      onSuccess: (data) => {
        setDialogOpen(false);
        if (data) router.push(`/workflows/editor?id=${data.id}`);
      },
      onError: (error) => { console.error(error); },
    });
  };

  return (
    <>
      <EntityHeader
        title="workflows"
        description="create and manage your workflows"
        newButtonLabel="New Workflow"
        disabled={disabled}
        onNew={() => setDialogOpen(true)}
        isCreating={createWorkflow.isPending}
      />
      <CreateWorkflowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
        isPending={createWorkflow.isPending}
      />
    </>
  );
};

export const WorkflowsPagination = () => {
  const workflows = useSuspenseWorkflows();
  const [params, setParams] = useWorkflowsParams();

  return (
    <EntityPagination
      page={workflows.data.page}
      totalPages={workflows.data.totalPages}
      disabled={workflows.isFetching}
      onPageChange={(page) => setParams({ ...params, page })}
    />
  );
};

export const WorkflowsContainer = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <EntityContainer
      header={<WorkflowsHeader />}
      search={<WorkflowsSearch />}
      pagination={<WorkflowsPagination />}
    >
      {children}
    </EntityContainer>
  );
};

export const WorkflowsLoading = () => {
  return <LoadingView message="Loading workflows ..." />;
};

export const WorkflowsError = () => {
  return <ErrorView message="Error Loading workflows ..." />;
};

export const WorkflowsEmpty = () => {
  const createWorkflow = useCreateWorkflow();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleCreate = (name: string) => {
    createWorkflow.mutate(name, {
      onError: (error) => { console.error(error); },
      onSuccess: (data) => {
        setDialogOpen(false);
        if (data) router.push(`/workflows/editor?id=${data.id}`);
      },
    });
  };

  return (
    <>
      <EmptyView
        onNew={() => setDialogOpen(true)}
        message="you haven't created any workflows yet. get started by creating your first workflow."
      />
      <CreateWorkflowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
        isPending={createWorkflow.isPending}
      />
    </>
  );
};

export const WorkflowsSearchEmpty = () => {
  const createWorkflow = useCreateWorkflow();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleCreate = (name: string) => {
    createWorkflow.mutate(name, {
      onError: (error) => { console.error(error); },
      onSuccess: (data) => {
        setDialogOpen(false);
        if (data) router.push(`/workflows/editor?id=${data.id}`);
      },
    });
  };

  return (
    <>
      <EmptyView
        message="No workflows found matching your search."
        onNew={() => setDialogOpen(true)}
      />
      <CreateWorkflowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
        isPending={createWorkflow.isPending}
      />
    </>
  );
};

export const WorkflowItem = ({ data }: { data: WorkflowRecord }) => {
  const removeWorkflow = useRemoveWorkflow();

  const handleRemove = () => {
    removeWorkflow.mutate(data.id);
  };

  return (
    <EntityItem
      href={`/workflows/editor?id=${data.id}`}
      title={data.name}
      subtitle={
        <>
          Updated {formatDistanceToNow(new Date(data.updatedAt), { addSuffix: true })}{" "}
          &bull; created{" "}
          {formatDistanceToNow(new Date(data.createdAt), { addSuffix: true })}
        </>
      }
      image={
        <div className="size-8 flex items-center justify-center">
          <WorkflowIcon className="size-5 text-muted-foreground" />
        </div>
      }
      onRemove={handleRemove}
      isRemoving={removeWorkflow.isPending}
    />
  );
};

export const WorkflowsComponent = () => (
  <WorkflowsContainer>
    <WorkflowsList />
  </WorkflowsContainer>
);
