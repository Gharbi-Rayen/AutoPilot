"use client"; 

import { authClient } from "@/lib/auth-client";
import {useHasActiveSubscription} from "@/features/subscriptions/hooks/use-subscription";
import {
    CreditCardIcon,
    FolderOpenIcon,
    HistoryIcon,
    icons,
    Key,
    KeyIcon,
    LogOutIcon,
    StarIcon,
} from "lucide-react";

import Image from "next/image";
import Link from "next/link";
import { usePathname,useRouter } from "next/navigation";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import { title } from "process";


const menuItems = [
    {
        title:"Home",
        items : [
            {
            
                title : "Workflows",
                icon : FolderOpenIcon,
                url : "/workflows",

            },
              {
            
                title : "credentials",
                icon : KeyIcon,
                url : "/credentials",

            },
            {
            
                title : "executions",
                icon : HistoryIcon,
                url : "/executions",

            },
        ]
    }
];

export const AppSidebar = () => {
const router = useRouter();
const pathname = usePathname();
const {hasActiveSubscription , isLoading} = useHasActiveSubscription();

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip="AutoPilot"
                      isActive={false}
                      className="gap-x-4 h-10 px-4"
                     >
                    <Link 
                    href="/workflows"
                    prefetch>
                        <Image 
                        src="/logos/logo.svg"
                        alt="AutoPilot Logo"
                        width={30}
                        height={30}
                        />
                        <span className="font-semibold text-sm">AutoPilot</span>

                    </Link>
                </SidebarMenuButton>
             </SidebarMenuItem>
           </SidebarHeader>

            <SidebarContent>
                {menuItems.map((group)=>(

                    <SidebarGroup key={(group.title)}>

                        <SidebarGroupContent>
                         <SidebarMenu>
                            {group.items.map((item)=>(
                                
                                <SidebarMenuItem key={item.title}>

                                    <SidebarMenuButton
                                    tooltip={item.title}
                                    isActive={
                                    item.url==="/"
                                     ? pathname === "/"
                                     : pathname.startsWith(item.url)
                                    }
                                    asChild
                                    className="gap-x-4 h-10 px-4"
                                    >
                                        <Link href={item.url}>
                                        <item.icon  className="size-4"/>
                                        <span>{item.title}</span>
                                        </Link>

                                    </SidebarMenuButton>

                                </SidebarMenuItem>

                            ))}
                            
                        </SidebarMenu>
                        </SidebarGroupContent>  
                    </SidebarGroup>

                ))}
            </SidebarContent>

            <SidebarFooter>
                <SidebarMenu>
                    {!hasActiveSubscription && !isLoading &&(
                    <SidebarMenuItem>
                        <SidebarMenuButton
                        asChild
                        tooltip="Upgrade to Pro"
                        isActive={false}
                        className="gap-x-4 h-10 px-4"
                        >
                            <button onClick={()=>  authClient.checkout({ slug : "pro"})}>
                                <StarIcon className="size-4"/>
                                <span>Upgrade to Pro</span>
                            </button>
                        </SidebarMenuButton>
                        </SidebarMenuItem>
                    )}
                   
                   <SidebarMenuItem>
                           <SidebarMenuButton
                        asChild
                        tooltip="Billing portal"
                        isActive={false}
                        className="gap-x-4 h-10 px-4"
                        >
                            <button onClick={()=>{  
                               authClient.customer.portal()
                            }}>
                                <CreditCardIcon className="size-4"/>
                                <span>Billing portal</span>
                            </button>
                        </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                        <SidebarMenuButton
                        asChild
                        tooltip="Log out"
                        isActive={false}
                        className="gap-x-4 h-10 px-4"
                        >
                            <button 
                            
                            onClick={()=>{  
                                authClient.signOut(
                                    {

                                        fetchOptions:{
                                            onSuccess: () => {
                                                router.push("/login");
                                            },

                                        }
                                    }
                                );
                               
                            }}>
                                <LogOutIcon className="size-4"/>
                                <span>Log out</span>
                            </button>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>

        </Sidebar>
    )

}