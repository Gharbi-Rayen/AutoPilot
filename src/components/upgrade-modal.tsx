"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { authClient } from "@/lib/auth-client";

type PolarAuthClient = {
  checkout?: (input: { slug: string }) => Promise<unknown>;
};

interface upgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const UpgradeModal = ({ open, onOpenChange }: upgradeModalProps) => {
  const polarAuthClient = authClient as PolarAuthClient;
  const [isLoading, setIsLoading] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Upgrade to pro</AlertDialogTitle>
          <AlertDialogDescription>
            You need to upgrade your plan to access this feature.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isLoading || !polarAuthClient.checkout}
            onClick={async () => {
              if (!polarAuthClient.checkout) {
                return;
              }
              setIsLoading(true);
              try {
                await polarAuthClient.checkout({ slug: "pro" });
              } finally {
                setIsLoading(false);
              }
            }}
          >
            {isLoading && <Loader2Icon className="size-4 animate-spin" />}
            {isLoading ? "Redirecting..." : "Upgrade"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
