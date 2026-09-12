import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useUpdateUserRole,
  useCreateUser,
  useClearAllData,
  useCreateUserImpersonationToken,
  getListUsersQueryKey,
  getListDriversQueryKey,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import type { AppUser, UserRole, Section } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Eye,
  EyeOff,
  MoreHorizontal,
  LogIn,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queueSessionSwitch } from "@/lib/session-switch";
import { usePermissions } from "@/hooks/use-permissions";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  driver: "Водитель",
  logistician: "Логист",
  manager: "Руководитель",
};

const SECTION_LABELS: Record<Section, string> = {
  products: "Товары",
  receipts: "Поступление товара",
  sites: "Объекты",
  deliveries: "График доставок",
  inventory: "Инвентарь",
  clients: "Клиенты",
  orders: "Заказы",
  shipments: "Отгрузки",
};

const SECTIONS: Section[] = [
  "products",
  "receipts",
  "sites",
  "deliveries",
  "inventory",
  "clients",
  "orders",
  "shipments",
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function compareUsersByName(a: AppUser, b: AppUser) {
  if (a.name && !b.name) return -1;
  if (!a.name && b.name) return 1;

  const nameComparison = (a.name ?? "").localeCompare(b.name ?? "", "ru", {
    sensitivity: "base",
    numeric: true,
  });
  if (nameComparison !== 0) return nameComparison;

  return a.email.localeCompare(b.email, "ru", {
    sensitivity: "base",
    numeric: true,
  });
}

function UserRow({
  user,
  currentUserId,
}: {
  user: AppUser;
  currentUserId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [role, setRole] = useState<UserRole>(user.role);
  const [editableSections, setEditableSections] = useState<Section[]>(
    user.editableSections,
  );
  const [editingInfo, setEditingInfo] = useState(false);
  const [impersonationOpen, setImpersonationOpen] = useState(false);
  const [nameInput, setNameInput] = useState(user.name ?? "");
  const [phoneInput, setPhoneInput] = useState(user.phone ?? "");
  const [emailInput, setEmailInput] = useState(user.email);

  const isSelf = user.id === currentUserId;

  function syncLocalState(nextUser: AppUser) {
    setRole(nextUser.role);
    setEditableSections(nextUser.editableSections);
    setNameInput(nextUser.name ?? "");
    setPhoneInput(nextUser.phone ?? "");
    setEmailInput(nextUser.email);
  }

  useEffect(() => {
    syncLocalState(user);
  }, [user]);

  const updateUserRole = useUpdateUserRole({
    mutation: {
      onSuccess: (updatedUser) => {
        syncLocalState(updatedUser);
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        toast({ title: "Пользователь обновлён" });
      },
      onError: (error: any) => {
        syncLocalState(user);
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({
          title: "Ошибка",
          description:
            error?.data?.error ?? error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  const createImpersonationToken = useCreateUserImpersonationToken();

  async function startImpersonation() {
    try {
      const { token } = await createImpersonationToken.mutateAsync({
        id: user.id,
      });
      setImpersonationOpen(false);
      queueSessionSwitch(token);
    } catch (error) {
      toast({
        title: "Не удалось войти как пользователь",
        description:
          error instanceof Error ? error.message : "Повторите попытку",
        variant: "destructive",
      });
    }
  }

  function save(nextRole: UserRole, nextSections: Section[]) {
    updateUserRole.mutate({
      id: user.id,
      data: {
        role: nextRole,
        editableSections:
          nextRole === "logistician" || nextRole === "manager"
            ? nextSections
            : [],
      },
    });
  }

  function handleRoleChange(value: string) {
    const nextRole = value as UserRole;
    setRole(nextRole);
    save(nextRole, editableSections);
  }

  function toggleSection(section: Section, checked: boolean) {
    const next = checked
      ? [...editableSections, section]
      : editableSections.filter((s) => s !== section);
    setEditableSections(next);
    save(role, next);
  }

  function saveInfo() {
    const email = emailInput.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      toast({
        title: "Проверьте email",
        description: "Введите корректный адрес электронной почты",
        variant: "destructive",
      });
      return;
    }

    updateUserRole.mutate(
      {
        id: user.id,
        data: {
          email,
          name: nameInput.trim() || null,
          phone: phoneInput.trim() || null,
          role,
          editableSections:
            role === "logistician" || role === "manager"
              ? editableSections
              : [],
        },
      },
      { onSuccess: () => setEditingInfo(false) },
    );
  }

  function cancelInfo() {
    setNameInput(user.name ?? "");
    setPhoneInput(user.phone ?? "");
    setEmailInput(user.email);
    setEditingInfo(false);
  }

  function openEditor() {
    setNameInput(user.name ?? "");
    setPhoneInput(user.phone ?? "");
    setEmailInput(user.email);
    setEditingInfo(true);
  }

  return (
    <>
      <TableRow data-testid={`row-user-${user.id}`}>
      <TableCell className="py-2">
        <span data-testid={`text-name-${user.id}`}>{user.name || "—"}</span>
      </TableCell>
      <TableCell className="py-2">
        <div className="font-medium">{user.email}</div>
      </TableCell>
      <TableCell className="py-2">
        <span data-testid={`text-phone-${user.id}`}>{user.phone || "—"}</span>
      </TableCell>
      <TableCell className="py-2">
        <Select
          value={role}
          onValueChange={handleRoleChange}
          disabled={isSelf || updateUserRole.isPending}
        >
          <SelectTrigger
            className="w-40"
            data-testid={`select-role-${user.id}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSelf && (
          <div className="text-xs text-muted-foreground mt-1">
            Нельзя менять себе
          </div>
        )}
      </TableCell>
      <TableCell className="py-2">
        {role === "logistician" || role === "manager" ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 max-w-md">
            {SECTIONS.map((section) => (
              <label
                key={section}
                className="flex items-center gap-1.5 text-sm"
              >
                <Checkbox
                  checked={editableSections.includes(section)}
                  disabled={isSelf || updateUserRole.isPending}
                  onCheckedChange={(checked) =>
                    toggleSection(section, checked === true)
                  }
                  data-testid={`checkbox-section-${user.id}-${section}`}
                />
                {SECTION_LABELS[section]}
              </label>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">
            {role === "admin"
              ? "Полный доступ"
              : "Полевой доступ: свои доставки и инвентарь"}
          </span>
        )}
      </TableCell>
      <TableCell className="w-16 py-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Действия для ${user.name || user.email}`}
              data-testid={`button-user-actions-${user.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onSelect={openEditor}
              data-testid={`action-edit-user-${user.id}`}
            >
              <Pencil />
              Редактировать
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setImpersonationOpen(true)}
              disabled={isSelf}
              data-testid={`action-impersonate-user-${user.id}`}
            >
              <LogIn />
              Войти как пользователь
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
      </TableRow>

      <Dialog
        open={editingInfo}
        onOpenChange={(open) => {
          if (open) openEditor();
          else cancelInfo();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать пользователя</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`edit-name-${user.id}`}>ФИО</Label>
              <Input
                id={`edit-name-${user.id}`}
                placeholder="Иванов Иван"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                data-testid={`input-name-${user.id}`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-phone-${user.id}`}>Телефон</Label>
              <Input
                id={`edit-phone-${user.id}`}
                type="tel"
                placeholder="+7 999 000-00-00"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                data-testid={`input-phone-${user.id}`}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-email-${user.id}`}>Email</Label>
              <Input
                id={`edit-email-${user.id}`}
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                data-testid={`input-email-${user.id}`}
              />
              <p className="text-xs text-muted-foreground">
                Email используется для входа. После сохранения пользователь
                будет входить по новому адресу.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelInfo}>
              Отмена
            </Button>
            <Button
              onClick={saveInfo}
              disabled={updateUserRole.isPending}
              data-testid={`button-save-info-${user.id}`}
            >
              {updateUserRole.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={impersonationOpen} onOpenChange={setImpersonationOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Войти как пользователь?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Вы временно войдёте в учётную запись{" "}
            <span className="font-medium text-foreground">
              {user.name || user.email}
            </span>{" "}
            и увидите приложение с её правами доступа. Пароль пользователя не
            требуется.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImpersonationOpen(false)}
            >
              Отмена
            </Button>
            <Button
              onClick={startImpersonation}
              disabled={createImpersonationToken.isPending}
              data-testid={`button-confirm-impersonate-${user.id}`}
            >
              {createImpersonationToken.isPending
                ? "Выполняется вход..."
                : "Войти"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Users() {
  const { data: users, isLoading } = useListUsers();
  const { user: currentUser } = usePermissions();

  const sortedUsers = [...(users ?? [])].sort(compareUsersByName);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteRole, setInviteRole] = useState<UserRole>("manager");
  const [inviteSections, setInviteSections] = useState<Section[]>([]);

  function resetInviteForm() {
    setInviteEmail("");
    setInviteName("");
    setInvitePassword("");
    setShowPassword(false);
    setInviteRole("manager");
    setInviteSections([]);
  }

  const createUser = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setInviteDialogOpen(false);
        resetInviteForm();
        toast({ title: "Пользователь создан" });
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description:
            error?.data?.error ?? error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || invitePassword.length < 8) return;
    createUser.mutate({
      data: {
        email: inviteEmail.trim(),
        password: invitePassword,
        name: inviteName.trim() || null,
        role: inviteRole,
        editableSections:
          inviteRole === "logistician" || inviteRole === "manager"
            ? inviteSections
            : [],
      },
    });
  }

  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");

  const clearAllData = useClearAllData({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries();
        setClearDialogOpen(false);
        setClearConfirmText("");
        toast({ title: "Все данные удалены" });
      },
      onError: (error: any) => {
        toast({
          title: "Ошибка",
          description: error?.response?.data?.error ?? error.message,
          variant: "destructive",
        });
      },
    },
  });

  return (
    <div className="flex h-[calc(100vh-2rem)] min-h-0 flex-col gap-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Пользователи
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Управление ролями и доступными разделами сотрудников
          </p>
        </div>
        <Button
          onClick={() => setInviteDialogOpen(true)}
          data-testid="button-invite-user"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Создать пользователя
        </Button>
      </div>

      <div className="min-h-0 flex-1 border rounded-md overflow-hidden">
        <Table
          className="text-xs"
          containerClassName="h-full"
        >
          <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <TableHead>ФИО</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Доступные разделы</TableHead>
              <TableHead className="w-16 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : sortedUsers.length > 0 ? (
              sortedUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  currentUserId={currentUser?.id}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  Пользователи не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="border border-destructive/40 rounded-md p-4 space-y-2">
        <p className="font-medium text-sm text-destructive">Опасная зона</p>
        <p className="text-muted-foreground text-sm">
          Полное удаление всех данных: товары, категории, движения, объекты,
          график доставок, клиенты, заказы, отгрузки, поступления. Пользователи
          и их роли сохраняются. Действие необратимо.
        </p>
        <Button
          variant="destructive"
          onClick={() => setClearDialogOpen(true)}
          data-testid="button-clear-all-data"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Очистить все данные
        </Button>
      </div>

      <Dialog
        open={clearDialogOpen}
        onOpenChange={(open) => {
          setClearDialogOpen(open);
          if (!open) setClearConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить все данные?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Будут безвозвратно удалены все товары, категории, движения,
              объекты, график доставок, клиенты, заказы, отгрузки и
              поступления. Пользователи и их роли сохранятся.
            </p>
            <div className="space-y-2">
              <Label htmlFor="clearConfirm">
                Для подтверждения введите слово <b>УДАЛИТЬ</b>
              </Label>
              <Input
                id="clearConfirm"
                value={clearConfirmText}
                onChange={(e) => setClearConfirmText(e.target.value)}
                placeholder="УДАЛИТЬ"
                data-testid="input-clear-confirm"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setClearDialogOpen(false)}
              >
                Отмена
              </Button>
              <Button
                variant="destructive"
                disabled={
                  clearConfirmText.trim().toUpperCase() !== "УДАЛИТЬ" ||
                  clearAllData.isPending
                }
                onClick={() => clearAllData.mutate()}
                data-testid="button-confirm-clear"
              >
                {clearAllData.isPending ? "Удаление..." : "Удалить все данные"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={inviteDialogOpen}
        onOpenChange={(open) => {
          setInviteDialogOpen(open);
          if (!open) resetInviteForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Создать пользователя</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inviteEmail">Email (логин для входа)</Label>
              <Input
                id="inviteEmail"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inviteName">ФИО (необязательно)</Label>
              <Input
                id="inviteName"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Иванов Иван"
                data-testid="input-invite-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invitePassword">Пароль</Label>
              <div className="relative">
                <Input
                  id="invitePassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Минимум 8 символов"
                  className="pr-10"
                  data-testid="input-invite-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Передайте сотруднику email и пароль — он сможет войти сразу.
                Слишком простые пароли не принимаются.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as UserRole)}
              >
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(inviteRole === "logistician" || inviteRole === "manager") && (
              <div className="space-y-2">
                <Label>Доступные разделы</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SECTIONS.map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={inviteSections.includes(s)}
                        onCheckedChange={(checked) =>
                          setInviteSections((prev) =>
                            checked
                              ? [...prev, s]
                              : prev.filter((x) => x !== s),
                          )
                        }
                        data-testid={`checkbox-invite-section-${s}`}
                      />
                      {SECTION_LABELS[s]}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={createUser.isPending}
                data-testid="button-create-user"
              >
                {createUser.isPending ? "Создание..." : "Создать пользователя"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
