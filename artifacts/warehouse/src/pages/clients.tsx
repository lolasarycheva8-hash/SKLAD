import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  getListClientsQueryKey,
  getListDeliveriesQueryKey,
  getListSitesQueryKey,
  extractApiError,
} from "@workspace/api-client-react";
import type { Client } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { ClientDeleteDialog } from "@/components/client-delete-dialog";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function getClientNameConflictMessage(error: unknown): string | null {
  const details = extractApiError(error);
  if (details?.status !== 409) return null;

  return details.data === null
    ? "Клиент с таким названием уже существует"
    : details.message;
}

type BlockingSites = {
  count: number;
  preview: Array<{ id: string; name: string }>;
};

function getDeleteClientError(error: unknown): {
  message: string;
  blockingSites: BlockingSites | null;
} {
  const fallback = error instanceof Error ? error.message : "Не удалось удалить клиента";
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return { message: fallback, blockingSites: null };
  }
  const data = error.data;
  if (typeof data !== "object" || data === null) {
    return { message: fallback, blockingSites: null };
  }
  const message =
    "error" in data && typeof data.error === "string" ? data.error : fallback;
  const raw = "blockingSites" in data ? data.blockingSites : null;
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("count" in raw) ||
    typeof raw.count !== "number" ||
    !("preview" in raw) ||
    !Array.isArray(raw.preview)
  ) {
    return { message, blockingSites: null };
  }
  const preview = raw.preview.filter(
    (site): site is { id: string; name: string } =>
      typeof site === "object" &&
      site !== null &&
      "id" in site &&
      typeof site.id === "string" &&
      "name" in site &&
      typeof site.name === "string",
  );
  return { message, blockingSites: { count: raw.count, preview } };
}

export default function Clients() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [blockingSites, setBlockingSites] = useState<BlockingSites | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditClients = canEdit("clients");
  const [, navigate] = useLocation();

  const { data: clients, isLoading } = useListClients({
    search: search || undefined,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
  };

  const invalidateClientDependents = () => {
    queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDeliveriesQueryKey() });
  };

  const createClient = useCreateClient({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDialogOpen(false);
        setName("");
        setContact("");
        setNameError(null);
        toast({ title: "Клиент добавлен" });
      },
      onError: (error) => {
        const conflictMessage = getClientNameConflictMessage(error);
        if (conflictMessage) {
          setNameError(conflictMessage);
          return;
        }
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  const deleteClient = useDeleteClient({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteTarget(null);
        setDeleteError(null);
        setBlockingSites(null);
        toast({ title: "Клиент удалён" });
      },
      onError: (error) => {
        const details = getDeleteClientError(error);
        toast({
          title: "Ошибка",
          description: details.message,
          variant: "destructive",
        });
        setDeleteError(details.message);
        setBlockingSites(details.blockingSites);
      },
    },
  });

  const updateClient = useUpdateClient({
    mutation: {
      onSuccess: () => {
        invalidate();
        invalidateClientDependents();
        setDialogOpen(false);
        setEditTarget(null);
        setName("");
        setContact("");
        setNameError(null);
        toast({ title: "Изменения сохранены" });
      },
      onError: (error) => {
        const conflictMessage = getClientNameConflictMessage(error);
        if (conflictMessage) {
          setNameError(conflictMessage);
          return;
        }
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editTarget) {
      updateClient.mutate({
        id: editTarget.id,
        data: { name, contact: contact || null },
      });
    } else {
      createClient.mutate({ data: { name, contact: contact || undefined } });
    }
  }

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Клиенты
      </h1>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm mt-1">
            Справочник клиентов для заказов
          </p>
        </div>
        {canEditClients && (
          <Button
            onClick={() => {
              setName("");
              setContact("");
              setEditTarget(null);
              setNameError(null);
              setDialogOpen(true);
            }}
            data-testid="button-add-client"
          >
            <Plus className="h-4 w-4 mr-2" />
            Добавить клиента
          </Button>
        )}
      </div>

      <div className="relative w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по названию..."
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-search-clients"
        />
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Контакт</TableHead>
              <TableHead className="w-28 text-right">Объекты</TableHead>
              <TableHead>Добавлен</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : (clients ?? []).length > 0 ? (
              (clients ?? []).map((client) => (
                <TableRow
                  key={client.id}
                  data-testid={`row-client-${client.id}`}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/orders?clientId=${client.id}`)}
                >
                  <TableCell className="font-medium py-1.5">
                    {client.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground py-1.5">
                    {client.contact || "—"}
                  </TableCell>
                  <TableCell
                    className="py-1.5 text-right tabular-nums"
                    data-testid={`text-client-site-count-${client.id}`}
                  >
                    {client.siteCount.toLocaleString("ru-RU")}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap py-1.5">
                    {dateFormatter.format(new Date(client.createdAt))}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {canEditClients && (
                      <div className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditTarget(client);
                            setName(client.name);
                            setContact(client.contact ?? "");
                            setNameError(null);
                            setDialogOpen(true);
                          }}
                          data-testid={`button-edit-client-${client.id}`}
                          aria-label={`Редактировать клиента ${client.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteError(null);
                            setBlockingSites(null);
                            setDeleteTarget(client);
                          }}
                          data-testid={`button-delete-client-${client.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-8"
                >
                  Клиенты не найдены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditTarget(null);
            setNameError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editTarget ? "Редактировать клиента" : "Новый клиент"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название</Label>
              <Input
                id="name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "client-name-error" : undefined}
                data-testid="input-client-name"
              />
              {nameError && (
                <p
                  id="client-name-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {nameError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact">Контакт</Label>
              <Input
                id="contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                data-testid="input-client-contact"
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={createClient.isPending || updateClient.isPending}
                data-testid="button-save-client"
              >
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ClientDeleteDialog
        clientName={deleteTarget?.name ?? null}
        error={deleteError}
        blockingSites={blockingSites}
        isPending={deleteClient.isPending}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
          setBlockingSites(null);
        }}
        onConfirm={() =>
          deleteTarget && deleteClient.mutate({ id: deleteTarget.id })
        }
        onViewSites={() => {
          if (!deleteTarget) return;
          navigate(
            `/sites?clientId=${encodeURIComponent(deleteTarget.id)}&clientName=${encodeURIComponent(deleteTarget.name)}`,
          );
          setDeleteTarget(null);
          setDeleteError(null);
          setBlockingSites(null);
        }}
      />
    </div>
  );
}
