import Image from "next/image";
import { AppHeader } from "@/components/app-header";

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <AppHeader />
      <main className="flex-1">{children}</main>
      <footer className="shrink-0 border-t">
        <div className="flex h-10 items-center justify-center gap-2 px-4">
          <span
            className="text-[10px] text-muted-foreground opacity-50 select-none"
            style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}
          >
            Powered by
          </span>
          <Image
            src="/logos/logoTT.png"
            alt="Tunisie Telecom"
            width={36}
            height={12}
            className="object-contain opacity-40"
          />
          <span
            className="text-[10px] text-muted-foreground opacity-50 select-none"
            style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)" }}
          >
            Tunisie Telecom
          </span>
        </div>
      </footer>
    </>
  );
};

export default Layout;
