import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
  getListClientsQueryKey,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default function Clients() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

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

  const createClient = useCreateClient({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDialogOpen(false);
        setName("");
        setContact("");
        toast({ title: "Клиент добавлен" });
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

  const deleteClient = useDeleteClient({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDeleteTarget(null);
        toast({ title: "Клиент удалён" });
      },
      onError: (error) => {
        toast({
          title: "Ошибка",
          description: error.message,
          variant: "destructive",
        });
        setDeleteTarget(null);
      },
    },
  });

  const updateClient = useUpdateClient({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDialogOpen(false);
        setEditTarget(null);
        setName("");
        setContact("");
        toast({ title: "Изменения сохранены" });
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
              <TableHead>Добавлен</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={4}
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
                  colSpan={4}
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
          if (!open) setEditTarget(null);
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
                onChange={(e) => setName(e.target.value)}
                data-testid="input-client-name"
              />
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить клиента?</AlertDialogTitle>
            <AlertDialogDescription>
              Клиент «{deleteTarget?.name}» будет удалён без возможности
              восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-client">
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteClient.mutate({ id: deleteTarget.id })
              }
              data-testid="button-confirm-delete-client"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
