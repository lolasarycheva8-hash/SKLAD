import { createContext, useContext } from "react";
import { useClerk } from "@clerk/react";
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import type { AppUser, Section } from "@workspace/api-client-react";

function NotInvitedScreen() {
  const { signOut } = useClerk();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-bold">Доступ только по приглашению</h1>
        <p className="text-muted-foreground text-sm">
          Ваша учётная запись создана, но доступ к системе выдаёт администратор.
          Попросите администратора отправить вам приглашение на эту почту, затем
          войдите снова.
        </p>
        <button
          className="underline text-sm"
          onClick={() => signOut()}
          data-testid="button-sign-out-not-invited"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

type PermissionsContextValue = {
  user: AppUser | undefined;
  isLoading: boolean;
  isAdmin: boolean;
  isDriver: boolean;
  canView: (section: Section) => boolean;
  canEdit: (section: Section) => boolean;
  canApproveDeliveryActs: boolean;
};

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function isDriverUser(user: Pick<AppUser, "role" | "isDriver"> | undefined): boolean {
  return !!user && (user.role === "driver" || user.isDriver);
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, error } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });

  // Closed registration: the API refuses users who signed up without an invite.
  const notInvited =
    (error as any)?.status === 403 &&
    (error as any)?.data?.code === "NOT_INVITED";
  if (notInvited) {
    return <NotInvitedScreen />;
  }

  const isAdmin = user?.role === "admin";
  const isDriver = isDriverUser(user);

  function canView(section: Section): boolean {
    if (!user) return false;
    if (user.role === "admin") return true;
    return user.editableSections.includes(section);
  }

  function canEdit(section: Section): boolean {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.role === "logistician") return user.editableSections.includes(section);
    return false;
  }

  const canApproveDeliveryActs =
    !!user &&
    (user.role === "admin" ||
      ((user.role === "logistician" || user.role === "manager") &&
        user.editableSections.includes("deliveries")));

  return (
    <PermissionsContext.Provider
      value={{
        user,
        isLoading,
        isAdmin,
        isDriver,
        canView,
        canEdit,
        canApproveDeliveryActs,
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error("usePermissions must be used within a PermissionsProvider");
  }
  return ctx;
}
