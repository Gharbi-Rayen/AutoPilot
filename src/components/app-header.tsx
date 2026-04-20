"use client";

import { format } from "date-fns";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";

const LiveClock = () => {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  return (
    <span className="text-xs text-muted-foreground tabular-nums select-none">
      {format(now, "MMM d, yyyy · HH:mm:ss")}
    </span>
  );
};

export const AppHeader = () => {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 bg-background">
      <SidebarTrigger />
      <LiveClock />
      <ThemeToggle />
    </header>
  );
};
