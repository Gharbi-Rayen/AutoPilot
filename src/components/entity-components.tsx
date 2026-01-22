import {  AlertTriangleIcon, FolderOpenIcon, Loader2Icon,
     MoreVerticalIcon,
     PackageOpenIcon,
     Plus, PlusIcon,
     Search, SearchIcon, 
     TrashIcon} from "lucide-react";
import { Button } from "./ui/button";
import Link from "next/link";
import { Input } from "./ui/input";

import {Empty ,
    EmptyTitle,
    EmptyContent,
    EmptyMedia,
    EmptyHeader,
    EmptyDescription
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

import {
Card,
CardTitle,
CardDescription,
CardContent,
} from "@/components/ui/card";

import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";



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
            <Input
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



interface StateViewProps {
    message ?: string;
}




export const LoadingView = ({
    message,
}: StateViewProps) =>    {

    return (
        <div className="flex justify-center items-center h-full flex-1 flex-col gap-y-4" >
            <Loader2Icon className="size-6 animate-spin 
            text-primary"/>
            {!!(message) && (
            <p className=" text-sm text-muted-foreground">
                {message}
            </p>
            )}
        </div>
    )
};







export const ErrorView = ({
    message,
}: StateViewProps) =>    {

    return (
        <div className="flex justify-center items-center h-full flex-1 flex-col gap-y-4" >
            <AlertTriangleIcon className="size-6  
            text-primary"/>
            {!!(message) && (
            <p className=" text-sm text-muted-foreground">
                {message}
            </p>
            )}
        </div>
    )
};

interface EmptyViewProps extends StateViewProps{
    onNew?:() => void;
};


export const EmptyView = ({
    message,
    onNew
}: EmptyViewProps) => {
    return (
        <Empty className="border border-dashed bg-white">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <PackageOpenIcon />
                </EmptyMedia>
            </EmptyHeader>
                
                    <EmptyTitle>No items found</EmptyTitle>
                    {message && (
                        <EmptyDescription>{message}</EmptyDescription>
                    )}
                    {!!onNew && (
                       <EmptyContent>
                            <Button  onClick={onNew} >
                               
                            Add item</Button>
                        </EmptyContent>
                    )}
                
            
        </Empty>
    );  
};

interface EntityListProps<T>{
    items : T[];
    renderItem : (item : T , index : number) => React.ReactNode;
    getKey?: (item : T , index : number) => string | number;
    emptyView ?: React.ReactNode;
    className?  : string;
}

export function EntityList<T>({
    items,
    renderItem,
    getKey,
    emptyView,
    className,
} : EntityListProps<T>)  {

    if(items.length === 0 && emptyView){
        return(
            <div className="flex-1 flex justify-center items-center ">
              <div className="max-w-sm mx-auto"> {emptyView}</div>
            </div>
        );
    }

    return(
        <div className={cn("flex flex-col gap-y-4" , className)}>

            {items.map((item , index) => (
                <div key={getKey ? getKey(item , index) : index}>
                    {renderItem(item , index)}
                </div>
            ))}

        </div>


    );
}

interface EntityItemProps{
    href: string;
    title: string;
    subtitle?: React.ReactNode;
    image?: React.ReactNode;
    actions?: React.ReactNode;
    onRemove?: () => void | Promise<void>;
    isRemoving?: boolean;
    className?: string;
} 

export const EntityItem = ({
    href,
    title,
    subtitle,
    image,
    actions,
    onRemove,
    isRemoving,
    className,
}: EntityItemProps) => {

    const handleRemove =async (e : React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if(isRemoving){
            return;
        }

        if (onRemove) {
            await onRemove();
        }
    };

return(
    <Link href={href} prefetch>
    
    <Card className={cn("p-4 shadow-none hover:shadow cursor-pointer"
        , isRemoving && "opacity-50 cursor-not-allowed",
        className,
    )}>
        <CardContent className="flex flex-row item-center justify-between p-0">

        <div className="flex items-center gap-3">
            {image }
            <div>
            <CardTitle className="text-base font-medium">
              {title}  
            </CardTitle>
            {!!subtitle && (
            <CardDescription className="text-xs ">
                {subtitle}
            </CardDescription>
            )}

            </div>

        </div>

        {(actions || onRemove) && (
        <div className="flex gap-x-4 items-center ">
            {actions}
            {!!onRemove && (
            
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
            <Button 
            variant="ghost"
            size="icon"
            disabled={isRemoving}
            onClick={ (e) => {
                e.stopPropagation();  
            }}>
                <MoreVerticalIcon className="size-4"/>
            </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end"
            onClick={(e)=> {e.stopPropagation();}}
            >
                <DropdownMenuItem onClick={handleRemove}>
                    <TrashIcon className="size-4"/>
                      Delete
                    </DropdownMenuItem>
            </DropdownMenuContent>

            </DropdownMenu>
            )}

        </div>
        )}
        </CardContent>


    </Card>

    </Link>
);

};