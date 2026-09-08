import { useEffect, useRef, useState } from "react";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { ruRU } from "@clerk/localizations";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Products from "@/pages/products";
import Categories from "@/pages/categories";
import GoodsReceipts from "@/pages/goods-receipts";
import Sites from "@/pages/sites";
import DeliveryTypes from "@/pages/delivery-types";
import SiteDetail from "@/pages/site-detail";
import GoodsReceiptDetail from "@/pages/goods-receipt-detail";
import GoodsReceiptPrint from "@/pages/goods-receipt-print";
import Deliveries from "@/pages/deliveries";
import DeliveryRun from "@/pages/delivery-run";
import Clients from "@/pages/clients";
import Orders from "@/pages/orders";
import OrderDetail from "@/pages/order-detail";
import Shipments from "@/pages/shipments";
import ShipmentDetail from "@/pages/shipment-detail";
import ShipmentPrint from "@/pages/shipment-print";
import OrderPrint from "@/pages/order-print";
import Users from "@/pages/users";
import Audit from "@/pages/audit";
import MyDeliveries from "@/pages/my-deliveries";
import MySites from "@/pages/my-sites";
import Inventory from "@/pages/inventory";
import { PermissionsProvider, usePermissions } from "@/hooks/use-permissions";
import type { Section } from "@workspace/api-client-react";

const queryClient = new QueryClient();

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains. Do not inline the env var, leave
// publishableKey undefined, or replace publishableKeyFromHost with anything else.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — copy verbatim. Empty in dev (Clerk hits dev FAPI directly), auto-set
// in prod. Do NOT gate on import.meta.env.PROD / NODE_ENV — the empty dev value
// is intentional, and any branching breaks the prod proxy.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(24 100% 50%)",
    colorForeground: "hsl(220 10% 15%)",
    colorMutedForeground: "hsl(220 10% 40%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(220 10% 15%)",
    colorNeutral: "hsl(220 10% 85%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-xl font-bold text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground font-medium",
    footerActionLink: "text-primary font-medium hover:text-primary/80",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary",
    formFieldSuccessText: "text-foreground",
    alertText: "text-foreground",
    logoBox: "flex justify-center py-2",
    logoImage: "h-10 w-10",
    socialButtonsBlockButton: "border-border",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 normal-case",
    formFieldInput: "bg-white border-border text-foreground",
    footerAction: "text-muted-foreground",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive/30",
    otpCodeFieldInput: "border-border text-foreground",
    formFieldRow: "",
    main: "gap-4",
  },
};

function SignInPage() {
  const [bootstrapRegistrationAllowed, setBootstrapRegistrationAllowed] =
    useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${basePath}/api/auth/registration-status`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Registration status request failed");
        return response.json();
      })
      .then((data) => {
        setBootstrapRegistrationAllowed(
          data.bootstrapRegistrationAllowed === true,
        );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setBootstrapRegistrationAllowed(false);
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        {...(bootstrapRegistrationAllowed
          ? { signUpUrl: `${basePath}/sign-up` }
          : {
              appearance: {
                elements: { footerAction: "hidden" },
              },
            })}
      />
    </div>
  );
}

function SignUpPage() {
  const [bootstrapRegistrationAllowed, setBootstrapRegistrationAllowed] =
    useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${basePath}/api/auth/registration-status`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Registration status request failed");
        return response.json();
      })
      .then((data) => {
        setBootstrapRegistrationAllowed(
          data.bootstrapRegistrationAllowed === true,
        );
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setBootstrapRegistrationAllowed(false);
        }
      });
    return () => controller.abort();
  }, []);

  if (bootstrapRegistrationAllowed === null) return null;
  if (!bootstrapRegistrationAllowed) return <Redirect to="/sign-in" />;

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRoute() {
  const { isLoading, isAdmin, isDriver, canView } = usePermissions();
  if (isLoading) return null;
  if (!isAdmin && isDriver) return <Redirect to="/my" />;
  if (!isAdmin) {
    const first = (
      [
        ["inventory", "/inventory"],
        ["shipments", "/shipments"],
        ["orders", "/orders"],
        ["deliveries", "/deliveries"],
        ["receipts", "/receipts"],
        ["clients", "/clients"],
        ["sites", "/sites"],
        ["products", "/products"],
      ] as const
    ).find(([section]) => canView(section));
    return first ? <Redirect to={first[1]} /> : <NotFound />;
  }
  return <Dashboard />;
}

// Drivers only get their field screens; direct office URLs redirect back.
function FieldUserGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAdmin, isDriver } = usePermissions();
  const [location] = useLocation();

  if (!isLoading && !isAdmin) {
    const hasSites = (user?.assignedSiteIds?.length ?? 0) > 0;
    if (isDriver) {
      const allowed = [
        "/my",
        ...(hasSites ? ["/my-sites"] : []),
      ];
      if (!allowed.includes(location)) {
        return <Redirect to={allowed[0]} />;
      }
    }
  }

  return <>{children}</>;
}

function SectionOnly({
  section,
  component: Component,
}: {
  section: Section;
  component: React.ComponentType;
}) {
  const { canView, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!canView(section)) return <Redirect to="/" />;
  return <Component />;
}

// Admin-only page guard: non-admins are redirected home instead of hitting a 403.
function AdminOnly({ component: Component }: { component: React.ComponentType }) {
  const { isAdmin, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!isAdmin) return <Redirect to="/" />;
  return <Component />;
}

function DriverOnly({ component: Component }: { component: React.ComponentType }) {
  const { isDriver, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!isDriver) return <Redirect to="/" />;
  return <Component />;
}

function DeliveryEditorOnly({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  const { canEdit, isLoading } = usePermissions();
  if (isLoading) return null;
  if (!canEdit("deliveries")) return <Redirect to="/" />;
  return <Component />;
}

function AuthenticatedApp() {
  return (
    <PermissionsProvider>
      <Layout>
        <FieldUserGuard>
        <Switch>
          <Route path="/" component={HomeRoute} />
          <Route path="/my"><DriverOnly component={MyDeliveries} /></Route>
          <Route path="/my-sites"><DriverOnly component={MySites} /></Route>
          <Route path="/products"><SectionOnly section="products" component={Products} /></Route>
          <Route path="/categories"><SectionOnly section="products" component={Categories} /></Route>
          <Route path="/receipts"><SectionOnly section="receipts" component={GoodsReceipts} /></Route>
          <Route path="/receipts/:id"><SectionOnly section="receipts" component={GoodsReceiptDetail} /></Route>
          <Route path="/sites"><SectionOnly section="sites" component={Sites} /></Route>
          <Route path="/delivery-types"><SectionOnly section="sites" component={DeliveryTypes} /></Route>
          <Route path="/sites/:id"><SectionOnly section="sites" component={SiteDetail} /></Route>
          <Route path="/deliveries"><SectionOnly section="deliveries" component={Deliveries} /></Route>
          <Route path="/deliveries/run">
            <DeliveryEditorOnly component={DeliveryRun} />
          </Route>
          <Route path="/clients"><SectionOnly section="clients" component={Clients} /></Route>
          <Route path="/orders"><SectionOnly section="orders" component={Orders} /></Route>
          <Route path="/orders/:id"><SectionOnly section="orders" component={OrderDetail} /></Route>
          <Route path="/shipments"><SectionOnly section="shipments" component={Shipments} /></Route>
          <Route path="/shipments/:id"><SectionOnly section="shipments" component={ShipmentDetail} /></Route>
          <Route path="/inventory"><SectionOnly section="inventory" component={Inventory} /></Route>
          <Route path="/users">
            <AdminOnly component={Users} />
          </Route>
          <Route path="/audit">
            <AdminOnly component={Audit} />
          </Route>
          <Route component={NotFound} />
        </Switch>
        </FieldUserGuard>
      </Layout>
    </PermissionsProvider>
  );
}

function MainRouter() {
  return (
    <>
      <Show when="signed-in">
        <AuthenticatedApp />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ProtectedPrintRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      localization={{
        ...ruRU,
        signIn: {
          ...ruRU.signIn,
          start: {
            ...ruRU.signIn?.start,
            title: 'ООО ТД "Альянс"',
            subtitle: "Войдите, чтобы продолжить работу",
          },
        },
        signUp: {
          ...ruRU.signUp,
          start: {
            ...ruRU.signUp?.start,
            title: 'ООО ТД "Альянс"',
            subtitle: "Создайте аккаунт сотрудника",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/shipments/:id/print">
            <ProtectedPrintRoute component={ShipmentPrint} />
          </Route>
          <Route path="/orders/:id/print">
            <ProtectedPrintRoute component={OrderPrint} />
          </Route>
          <Route path="/receipts/:id/print">
            <ProtectedPrintRoute component={GoodsReceiptPrint} />
          </Route>
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route>
            <MainRouter />
          </Route>
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
