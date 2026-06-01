"use client";

import {
  BookOpenIcon,
  FolderOpenIcon,
  HistoryIcon,
  Loader2Icon,
  SettingsIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState } from "react";
import { LogoOrb } from "@/components/logo-orb";
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
  const { setOpenMobile, open } = useSidebar();
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
            className="gap-x-3 h-10 px-3"
          >
            <Link href="/workflows" prefetch>
              <LogoOrb size={26} spin />
              <span className="font-semibold text-sm tracking-tight">AutoPilot</span>
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
              tooltip="Documentation"
              isActive={pathname.startsWith("/settings/documentation")}
              asChild
              className="gap-x-4 h-10 px-4"
            >
              <Link href="/settings/documentation">
                <BookOpenIcon className="size-4" />
                <span>Documentation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              isActive={pathname === "/settings"}
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

        {/* Tunisie Telecom attribution — only shown when sidebar is expanded */}
        {open && (
          <div className="flex items-center gap-2 px-3 pb-2 pt-1">
            <Image
              src="/logos/logoTT.png"
              alt="Tunisie Telecom"
              width={28}
              height={19}
              className="object-contain opacity-50"
            />
            <span
              className="text-[10px] leading-tight text-muted-foreground opacity-60"
              style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}
            >
              Powered by<br />Tunisie Telecom
            </span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};
