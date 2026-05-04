import { SettingsIcon } from "lucide-react";
import { AppInfoFooter, PerformanceSettingsForm } from "@/features/settings/components/performance-settings-form";

export default function SettingsPage() {
  return (
    <div className="p-4 md:px-10 md:py-6 h-full">
      <div className="mx-auto max-w-2xl w-full flex flex-col gap-y-6">
        <div className="flex items-center gap-3">
          <SettingsIcon className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Tune AutoPilot to match your hardware
            </p>
          </div>
        </div>

        <section className="flex flex-col gap-y-2">
          <h2 className="text-base font-medium">Performance</h2>
          <p className="text-sm text-muted-foreground">
            Adjust processing limits based on your computer's RAM. Higher values unlock
            larger datasets and faster processing but require more memory.
          </p>
        </section>

        <PerformanceSettingsForm />
        <AppInfoFooter />
      </div>
    </div>
  );
}
