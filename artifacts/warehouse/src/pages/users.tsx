import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useUpdateUserRole,
  useCreateUser,
  useClearAllData,
  useListSites,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Building2,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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
  sites,
}: {
  user: AppUser;
  currentUserId: string | undefined;
  sites: { id: string; name: string }[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [role, setRole] = useState<UserRole>(user.role);
  const [editableSections, setEditableSections] = useState<Section[]>(
    user.editableSections,
  );
  const [editingInfo, setEditingInfo] = useState(false);
  const [assignedSitesOpen, setAssignedSitesOpen] = useState(false);
  const [nameInput, setNameInput] = useState(user.name ?? "");
  const [phoneInput, setPhoneInput] = useState(user.phone ?? "");

  const isSelf = user.id === currentUserId;

  const updateUserRole = useUpdateUserRole({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDriversQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
        toast({ title: "Права обновлены" });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

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

  function toggleAssignedSite(siteId: string, checked: boolean) {
    const current = user.assignedSiteIds ?? [];
    const next = checked
      ? [...current, siteId]
      : current.filter((id) => id !== siteId);
    updateUserRole.mutate({
      id: user.id,
      data: {
        role,
        editableSections:
          role === "logistician" || role === "manager"
            ? editableSections
            : [],
        assignedSiteIds: next,
      },
    });
  }

  function saveInfo() {
    updateUserRole.mutate(
      {
        id: user.id,
        data: {
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
    setEditingInfo(false);
  }

  function openEditor() {
    setNameInput(user.name ?? "");
    setPhoneInput(user.phone ?? "");
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
        <Select value={role} onValueChange={handleRoleChange} disabled={isSelf}>
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
                  disabled={isSelf}
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
      <TableCell className="py-2">
        <Popover open={assignedSitesOpen} onOpenChange={setAssignedSitesOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              data-testid={`button-assigned-sites-${user.id}`}
            >
              {(user.assignedSiteIds?.length ?? 0) > 0
                ? `Объектов: ${user.assignedSiteIds!.length}`
                : "Не закреплены"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 max-h-80 overflow-y-auto" align="start">
            {sites.length === 0 ? (
              <p className="text-sm text-muted-foreground">Объектов пока нет</p>
            ) : (
              <div className="space-y-1.5">
                {sites.map((site) => (
                  <label
                    key={site.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={(user.assignedSiteIds ?? []).includes(site.id)}
                      onCheckedChange={(checked) =>
                        toggleAssignedSite(site.id, checked === true)
                      }
                      data-testid={`checkbox-site-${user.id}-${site.id}`}
                    />
                    {site.name}
                  </label>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
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
              onSelect={() => setAssignedSitesOpen(true)}
              data-testid={`action-assign-sites-${user.id}`}
            >
              <Building2 />
              Назначить объекты
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
              <Label>Email</Label>
              <Input value={user.email} disabled />
              <p className="text-xs text-muted-foreground">
                Email используется для входа и в этом окне не изменяется.
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
    </>
  );
}

export default function Users() {
  const { data: users, isLoading } = useListUsers();
  const { user: currentUser } = usePermissions();
  const { data: allSites } = useListSites();

  const siteOptions = (allSites ?? [])
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
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
    <div className="space-y-6">
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

      <div className="border rounded-md overflow-hidden">
        <Table
          className="text-xs"
          containerClassName="max-h-[calc(100vh-18rem)]"
        >
          <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
            <TableRow>
              <TableHead>ФИО</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Доступные разделы</TableHead>
              <TableHead>Объекты</TableHead>
              <TableHead className="w-16 text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
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
                  sites={siteOptions}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={7}
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
