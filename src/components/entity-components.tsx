import {  Plus, PlusIcon, Search, SearchIcon } from "lucide-react";
import { Button } from "./ui/button";
import Link from "next/link";

type EntityHeaderProps = {
    title: string;
    description?: string;
    newButtonLabel: string;
    disabled?: boolean;
    isCreating?: boolean;

} & (

    | { onNew : () => void; newButtonHref?: never }
    | {newButtonHref : string; onNew?: never}
    | {onNew?: never; newButtonHref?: never}
);

export const EntityHeader = ({
    title,
    description,
    newButtonLabel,
    disabled,
    isCreating,
    onNew,
    newButtonHref,
}: EntityHeaderProps) => {
    return (
        <div className="flex flex-row items-center justify-between gap-x-4">            <div className="flex flex-col">
                <h1 className="text-lg md:text-xl font-semibold ">{title}</h1>
                {description && (
                    <p className="text-xs md:text-sm text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            {(onNew || !newButtonHref) && (
               <Button 
                disabled = {disabled || isCreating}
                onClick={onNew}  size="sm" >
                <PlusIcon
                className="size-4"
                />
                {newButtonLabel}
               </Button>
            )}
            {!onNew || newButtonHref && (
               <Button 
                size="sm"
                asChild
                >
                <Link href={newButtonHref} prefetch>
                <PlusIcon
                className="size-4"
                />
                {newButtonLabel}
                </Link>

               </Button>
            )}
        </div>
    );
};


type EntityContainerProps = {
children: React.ReactNode;
header?: React.ReactNode;
search?: React.ReactNode;
pagination?: React.ReactNode;

} 


export const EntityContainer = ({
    children,
    header,
    search,
    pagination,
} : EntityContainerProps) =>{

    return (
     <div className="p-4 md:px-10 md:py-6 h-full">
        <div className="mx-auto max-w-screen-xl w-full flex flex-col gap-y-8 h-full">            {header}
        
        <div className="flex flex-col gap-y-4 h-full">
            {search}
            {children}
        </div>
        <div>
            {pagination}
        </div>
        </div>
     </div>   
    )
};

interface EntitySearchProps {
    value : string;
    onChange : (value : string) => void;
    placeholder?: string;
};

export const EntitySearch = ({
    value,
    onChange,
    placeholder,
} : EntitySearchProps) => {

    return (
        <div className="relative ml-auto">
            <SearchIcon className="size-3.5 absolute top-1/2 left-3 -translate-y-1/2 
            text-muted-foreground"/>
            <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            aria-label={`Search ${placeholder || 'entities'}`}
            className="max-w-[200px] bg-background shadow-none pl-8 pr-4 py-2 border border-border rounded-md 
            focus:outline-none focus:ring-2 focus:ring-primary 
            focus:border-transparent w-full md:w-64"
            />
        </div>

    )
};

interface EntityPaginationProps {
    page : number;
    totalPages : number;
    disabled : boolean;
    onPageChange : (page : number) => void;
};

export const EntityPagination = ({
    page,
    totalPages,
    disabled,
    onPageChange,
} : EntityPaginationProps) => { 
    return (
        <div className="flex items-center justify-between gap-x-2 w-full">
            <div className="flex-1 text-sm text-muted-foreground">
                Page {page} of {totalPages ||  1}
            </div>
            <div className="flex items-center justify-end space-x-2 py-4">
             <Button disabled={disabled || page <= 1} 
             size="sm"
             variant="outline"
             onClick={() => onPageChange(Math.max(page - 1, 1))}>
                Previous
             </Button> 
             <Button disabled={disabled || page >= totalPages || totalPages === 0}
              size="sm"
              variant="outline"
              onClick={() => onPageChange(Math.min(page + 1, totalPages))}>
                Next
             </Button> 
            </div>
        </div>
    )
};