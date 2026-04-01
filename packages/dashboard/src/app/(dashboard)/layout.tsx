import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Sidebar />
      <MobileNav />
      <main className="min-h-screen pt-14 md:ml-64 md:pt-0">
        <div className="p-6">{children}</div>
      </main>
    </>
  );
}
