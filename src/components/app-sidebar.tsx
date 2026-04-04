"use client";

import {
  FolderOpenIcon,
  HistoryIcon,
  KeyIcon,
  Loader2Icon,
  LogOutIcon,
  SettingsIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { useTranslations } from "@/features/settings/hooks/use-translations";
import { authClient } from "@/lib/auth-client";

const menuItems = [
  {
    title: "Home",
    items: [
      {
        title: "workflows",
        icon: FolderOpenIcon,
        url: "/workflows",
      },
      {
        title: "credentials",
        icon: KeyIcon,
        url: "/credentials",
      },
      {
        title: "executions",
        icon: HistoryIcon,
        url: "/executions",
      },
      {
        title: "settings",
        icon: SettingsIcon,
        url: "/settings",
      },
    ],
  },
];

export const AppSidebar = () => {
  const { t } = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  // Clear the loading state and close mobile sidebar when navigation completes
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
        {menuItems.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    item.url === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.url);
                  const isNavigating = navigatingTo === item.url && !isActive;

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        tooltip={t(`nav.${item.title}`)}
                        isActive={isActive}
                        asChild
                        className="gap-x-4 h-10 px-4"
                      >
                        <Link
                          href={item.url}
                          onClick={() => {
                            if (!isActive) {
                              setNavigatingTo(item.url);
                            }
                          }}
                        >
                          {isNavigating ? (
                            <Loader2Icon className="size-4 animate-spin" />
                          ) : (
                            <item.icon className="size-4" />
                          )}
                          <span className="capitalize">
                            {t(`nav.${item.title}`)}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("nav.logOut")}
              isActive={false}
              className="gap-x-4 h-10 px-4"
            >
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={() => {
                  setIsLoggingOut(true);
                  authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        router.push("/login");
                      },
                    },
                  });
                }}
              >
                {isLoggingOut ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <LogOutIcon className="size-4" />
                )}
                <span>
                  {isLoggingOut ? t("nav.loggingOut") : t("nav.logOut")}
                </span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
