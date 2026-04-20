import { AppHeader } from "@/components/app-header";

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <AppHeader />
      <main className="flex-1">{children}</main>
      <footer className="h-10 shrink-0 border-t" />
    </>
  );
};

export default Layout;
