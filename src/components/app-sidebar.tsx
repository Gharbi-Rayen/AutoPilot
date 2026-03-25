"use client";

import {
  CreditCardIcon,
  FolderOpenIcon,
  HistoryIcon,
  KeyIcon,
  Loader2Icon,
  LogOutIcon,
  SettingsIcon,
  StarIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useState } from "react";
import { useTranslations } from "@/features/settings/hooks/use-translations";
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
import { useHasActiveSubscription } from "@/features/subscriptions/hooks/use-subscription";
import { authClient } from "@/lib/auth-client";

type PolarAuthClient = {
  checkout?: (input: { slug: string }) => Promise<unknown>;
  customer?: {
    portal?: () => Promise<unknown>;
  };
};

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
  const polarAuthClient = authClient as PolarAuthClient;
  const router = useRouter();
  const pathname = usePathname();
  const { hasActiveSubscription, isLoading } = useHasActiveSubscription();
  const { setOpenMobile } = useSidebar();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [isBilling, setIsBilling] = useState(false);
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
                          <span className="capitalize">{t(`nav.${item.title}`)}</span>
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
          {!hasActiveSubscription && !isLoading && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={t("nav.upgradeToPro")}
                isActive={false}
                className="gap-x-4 h-10 px-4"
              >
                <button
                  type="button"
                  disabled={isUpgrading || !polarAuthClient.checkout}
                  onClick={async () => {
                    if (!polarAuthClient.checkout) {
                      return;
                    }
                    setIsUpgrading(true);
                    try {
                      await polarAuthClient.checkout({ slug: "pro" });
                    } finally {
                      setIsUpgrading(false);
                    }
                  }}
                >
                  {isUpgrading ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <StarIcon className="size-4" />
                  )}
                  <span>{isUpgrading ? t("nav.loading") : t("nav.upgradeToPro")}</span>
                </button>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}

          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("nav.billingPortal")}
              isActive={false}
              className="gap-x-4 h-10 px-4"
            >
              <button
                type="button"
                disabled={isBilling || !polarAuthClient.customer?.portal}
                onClick={async () => {
                  if (!polarAuthClient.customer?.portal) {
                    return;
                  }
                  setIsBilling(true);
                  try {
                    await polarAuthClient.customer.portal();
                  } finally {
                    setIsBilling(false);
                  }
                }}
              >
                {isBilling ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <CreditCardIcon className="size-4" />
                )}
                <span>{isBilling ? t("nav.loading") : t("nav.billingPortal")}</span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
                <span>{isLoggingOut ? t("nav.loggingOut") : t("nav.logOut")}</span>
              </button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};
