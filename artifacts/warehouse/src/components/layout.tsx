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
  UserRoundCog,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useClerk } from "@clerk/react";
import { cn } from "@/lib/utils";
import { queueSessionSwitch } from "@/lib/session-switch";
import { usePermissions } from "@/hooks/use-permissions";
import { useStoredToggle } from "@/hooks/use-stored-toggle";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  useCreateImpersonationReturnUrl,
  type Section,
} from "@workspace/api-client-react";

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
  { href: "/order-summaries", label: "Итоговые заказы", icon: ClipboardList, section: "orders" },
  { href: "/deliveries", label: "График доставок", icon: Truck, section: "deliveries" },
  { href: "/receipts", label: "Поступление товара", icon: PackagePlus, section: "receipts" },
  { href: "/clients", label: "Клиенты", icon: Users, section: "clients" },
  { href: "/sites", label: "Объекты", icon: Building2, section: "sites" },
  { href: "/products", label: "Товары", icon: Package, section: "products" },
  { href: "/categories", label: "Категории", icon: Tag, section: "products" },
];

const DELIVERY_TYPES_NAV_ITEM: NavItem = {
  href: "/delivery-types",
  label: "Типы поставки",
  icon: Truck,
};
const STOCK_NAV_ITEM: NavItem = { href: "/stock", label: "Склад", icon: Warehouse };
const ADMIN_NAV_ITEM: NavItem = { href: "/users", label: "Пользователи", icon: ShieldCheck };
const AUDIT_NAV_ITEM: NavItem = { href: "/audit", label: "Журнал действий", icon: ScrollText };
const MY_DELIVERIES_ITEM: NavItem = { href: "/my", label: "Мои доставки", icon: CheckCircle2 };
const MY_SITES_ITEM: NavItem = { href: "/my-sites", label: "Мои объекты", icon: ClipboardCheck };

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isOrdersList = location === "/orders" || location === "/orders/" || location === "/order-summaries" || location === "/order-summaries/";
  const { isAdmin, isDriver, canView, user } = usePermissions();
  const { signOut, session } = useClerk();
  const returnFromImpersonation = useCreateImpersonationReturnUrl();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredToggle(
    "lexitd.sidebar-collapsed",
  );

  const hasSites = (user?.assignedSiteIds?.length ?? 0) > 0;
  const isFieldUser = !isAdmin && isDriver;
  const isImpersonating = Boolean(session?.actor);

  async function stopImpersonation() {
    try {
      const { token } = await returnFromImpersonation.mutateAsync();
      queueSessionSwitch(token);
    } catch {
      await signOut({ redirectUrl: `${import.meta.env.BASE_URL}sign-in` });
    }
  }

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
      ...(isAdmin
        ? [STOCK_NAV_ITEM, DELIVERY_TYPES_NAV_ITEM, ADMIN_NAV_ITEM, AUDIT_NAV_ITEM]
        : []),
    ];
  }

  const renderNav = (collapsed: boolean) => (
    <>
      <nav className={cn("flex-1 py-4 space-y-1 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
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
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center rounded-md py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center px-2" : "gap-3 px-3",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>
      <div className={cn("py-3 border-t border-sidebar-border space-y-2", collapsed ? "px-2" : "px-3")}>
        {user?.email && !collapsed && (
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
          title={collapsed ? "Выйти" : undefined}
          aria-label={collapsed ? "Выйти" : undefined}
          className={cn(
            "w-full flex items-center rounded-md py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
            collapsed ? "justify-center px-2" : "gap-3 px-2",
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && "Выйти"}
        </button>
        {!collapsed && (
          <div className="px-2 text-xs text-sidebar-foreground/50">
            ЛексиТД v1.0
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={cn(
      "min-h-screen flex flex-col md:flex-row bg-background",
      isOrdersList && "h-dvh min-h-0 overflow-hidden",
    )}>
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-40 h-14 shrink-0 flex items-center gap-3 px-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
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
              <span className="font-bold text-lg text-white">ЛексиТД</span>
            </div>
            {renderNav(false)}
          </SheetContent>
        </Sheet>
        <Warehouse className="h-5 w-5 text-sidebar-primary" />
        <span className="font-bold text-white">ЛексиТД</span>
      </header>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex-col transition-[width] duration-200",
          sidebarCollapsed ? "w-16" : "w-64",
        )}
        data-testid="sidebar-desktop"
        data-collapsed={sidebarCollapsed}
      >
        <div
          className={cn(
            "h-16 flex items-center border-b border-sidebar-border",
            sidebarCollapsed ? "justify-center px-2" : "gap-2 px-5",
          )}
        >
          {!sidebarCollapsed && (
            <>
              <Warehouse className="h-6 w-6 shrink-0 text-sidebar-primary" />
              <span className="flex-1 font-bold text-lg text-white">ЛексиТД</span>
            </>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            className="rounded-md p-1.5 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
            title={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-expanded={!sidebarCollapsed}
            data-testid="button-toggle-sidebar"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        </div>
        {renderNav(sidebarCollapsed)}
      </aside>

      <main className={cn(
        "flex-1 min-w-0",
        isOrdersList && "flex flex-col min-h-0 overflow-hidden",
      )}>
        {isImpersonating && (
          <div
            className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-orange-300 bg-orange-100 px-4 py-2 text-sm text-orange-950 md:px-6"
            data-testid="banner-impersonation"
          >
            <div className="flex items-center gap-2">
              <UserRoundCog className="h-4 w-4" />
              <span>
                Вы вошли как{" "}
                <strong>{user?.name || user?.email || "пользователь"}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={stopImpersonation}
              className="font-medium underline underline-offset-2 hover:no-underline"
              data-testid="button-stop-impersonation"
            >
              Вернуться в учётную запись администратора
            </button>
          </div>
        )}
        <div className={cn(
          "px-4 py-4 md:px-6 md:py-8",
          isOrdersList && "flex-1 min-h-0 overflow-hidden",
        )}>{children}</div>
      </main>
    </div>
  );
}
