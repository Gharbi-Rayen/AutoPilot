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
              tooltip="How It Works"
              isActive={pathname.startsWith("/settings/how-it-works")}
              asChild
              className="gap-x-4 h-10 px-4"
            >
              <Link href="/settings/how-it-works">
                <BookOpenIcon className="size-4" />
                <span>How It Works</span>
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

        {/* Tunisie Telecom attribution */}
        {open ? (
          <div className="mx-2 mb-1 flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2">
            <Image
              src="/logos/logoTT.png"
              alt="Tunisie Telecom logo"
              width={36}
              height={24}
              className="object-contain shrink-0"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                Powered by
              </span>
              <span
                className="text-xs font-semibold text-foreground truncate"
                style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}
              >
                Tunisie Telecom
              </span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center pb-1">
            <Image
              src="/logos/logoTT.png"
              alt="Tunisie Telecom"
              width={28}
              height={19}
              className="object-contain"
            />
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
};
