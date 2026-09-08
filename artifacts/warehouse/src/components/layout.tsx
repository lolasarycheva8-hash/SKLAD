import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Package,
  LayoutDashboard,
  PackagePlus,
  Warehouse,
  Building2,
  Truck,
  Users,
  ClipboardList,
  Send,
  ShieldCheck,
  ScrollText,
  Tag,
  LogOut,
  Menu,
  CheckCircle2,
  ClipboardCheck,
  Boxes,
} from "lucide-react";
import { useClerk } from "@clerk/react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/use-permissions";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import type { Section } from "@workspace/api-client-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  section?: Section;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Сводный отчет", icon: LayoutDashboard },
  { href: "/inventory", label: "Инвентарь", icon: Boxes, section: "inventory" },
  { href: "/shipments", label: "Отгрузки", icon: Send, section: "shipments" },
  { href: "/orders", label: "Заказы клиентов", icon: ClipboardList, section: "orders" },
  { href: "/deliveries", label: "График доставок", icon: Truck, section: "deliveries" },
  { href: "/receipts", label: "Поступление товара", icon: PackagePlus, section: "receipts" },
  { href: "/clients", label: "Клиенты", icon: Users, section: "clients" },
  { href: "/sites", label: "Объекты", icon: Building2, section: "sites" },
  { href: "/delivery-types", label: "Типы поставки", icon: Truck, section: "sites" },
  { href: "/products", label: "Товары", icon: Package, section: "products" },
  { href: "/categories", label: "Категории", icon: Tag, section: "products" },
];

const ADMIN_NAV_ITEM: NavItem = { href: "/users", label: "Пользователи", icon: ShieldCheck };
const AUDIT_NAV_ITEM: NavItem = { href: "/audit", label: "Журнал действий", icon: ScrollText };
const MY_DELIVERIES_ITEM: NavItem = { href: "/my", label: "Мои доставки", icon: CheckCircle2 };
const MY_SITES_ITEM: NavItem = { href: "/my-sites", label: "Мои объекты", icon: ClipboardCheck };

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isAdmin, isDriver, canView, user } = usePermissions();
  const { signOut } = useClerk();
  const [mobileOpen, setMobileOpen] = useState(false);

  const hasSites = (user?.assignedSiteIds?.length ?? 0) > 0;
  const isFieldUser = !isAdmin && isDriver;

  let navItems: NavItem[];
  if (isFieldUser) {
    // Водитель видит только свои полевые экраны.
    navItems = [
      MY_DELIVERIES_ITEM,
      ...(hasSites ? [MY_SITES_ITEM] : []),
    ];
  } else {
    navItems = [
      ...NAV_ITEMS.filter(
        (item) => isAdmin || (!!item.section && canView(item.section)),
      ),
      ...(isAdmin ? [ADMIN_NAV_ITEM, AUDIT_NAV_ITEM] : []),
    ];
  }

  const nav = (
    <>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive =
            location === item.href || (item.href !== "/" && location.startsWith(item.href + "/"));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              data-testid={`link-nav-${item.href === "/" ? "dashboard" : item.href.slice(1)}`}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
        {user?.email && (
          <div
            className="px-2 text-xs text-sidebar-foreground/60 truncate"
            title={user.email}
            data-testid="text-current-user-email"
          >
            {user.email}
          </div>
        )}
        <button
          onClick={() => signOut()}
          data-testid="button-sign-out"
          className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
        <div className="px-2 text-xs text-sidebar-foreground/50">
          Складской учёт v1.0
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 h-14 flex items-center gap-3 px-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <button
              className="p-2 -ml-2 rounded-md hover:bg-sidebar-accent"
              data-testid="button-mobile-menu"
              aria-label="Меню"
            >
              <Menu className="h-6 w-6 text-white" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col"
          >
            <SheetTitle className="sr-only">Меню</SheetTitle>
            <div className="h-14 flex items-center gap-2 px-5 border-b border-sidebar-border">
              <Warehouse className="h-6 w-6 text-sidebar-primary" />
              <span className="font-bold text-lg text-white">Склад</span>
            </div>
            {nav}
          </SheetContent>
        </Sheet>
        <Warehouse className="h-5 w-5 text-sidebar-primary" />
        <span className="font-bold text-white">Склад</span>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-sidebar-border">
          <Warehouse className="h-6 w-6 text-sidebar-primary" />
          <span className="font-bold text-lg text-white">Склад</span>
        </div>
        {nav}
      </aside>

      <main className="flex-1 min-w-0">
        <div className="px-4 py-4 md:px-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
