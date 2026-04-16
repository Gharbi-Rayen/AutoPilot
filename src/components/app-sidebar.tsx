"use client";

import { FolderOpenIcon, HistoryIcon, Loader2Icon, SettingsIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState } from "react";
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
  useSidebar,
} from "@/components/ui/sidebar";

const menuItems = [
  { title: "Workflows", icon: FolderOpenIcon, url: "/workflows" },
  { title: "Executions", icon: HistoryIcon, url: "/executions" },
];

export const AppSidebar = () => {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  React.useEffect(() => {
    if (pathname) {
      setNavigatingTo(null);
      setOpenMobile(false);
    }
  }, [pathname, setOpenMobile]);

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
            <Link href="/workflows" prefetch>
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = pathname.startsWith(item.url);
                const isNavigating = navigatingTo === item.url && !isActive;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={isActive}
                      asChild
                      className="gap-x-4 h-10 px-4"
                    >
                      <Link
                        href={item.url}
                        onClick={() => {
                          if (!isActive) setNavigatingTo(item.url);
                        }}
                      >
                        {isNavigating ? (
                          <Loader2Icon className="size-4 animate-spin" />
                        ) : (
                          <item.icon className="size-4" />
                        )}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              isActive={pathname.startsWith("/settings")}
              asChild
              className="gap-x-4 h-10 px-4"
            >
              <Link href="/settings">
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
