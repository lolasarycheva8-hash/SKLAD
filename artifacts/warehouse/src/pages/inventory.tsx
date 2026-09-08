import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInventoryRequests,
  useCreateInventoryRequest,
  useApproveInventoryRequest,
  useRejectInventoryRequest,
  useMarkInventoryRequestDone,
  useListInventoryItems,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useListInventorySiteLookup,
  getListInventoryRequestsQueryKey,
  getListInventoryItemsQueryKey,
} from "@workspace/api-client-react";
import type {
  InventoryRequest,
  InventoryItem,
  InventoryRequestStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Trash2,
  Pencil,
  CheckCircle2,
  XCircle,
  Search,
  Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const STATUS_LABEL: Record<InventoryRequestStatus, string> = {
  new: "Новая",
  approved: "Одобрена",
  rejected: "Отклонена",
  done: "Выдана",
};

const STATUS_VARIANT: Record<
  InventoryRequestStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  new: "outline",
  approved: "default",
  rejected: "destructive",
  done: "secondary",
};

export default function Inventory() {
  const { canEdit, user } = usePermissions();
  const canEditInventory = canEdit("inventory");

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Инвентарь
      </h1>

      <Tabs defaultValue="requests">
        <TabsList className="mb-4">
          <TabsTrigger value="requests">Заявки</TabsTrigger>
          {canEditInventory && (
            <TabsTrigger value="dictionary">Справочник</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="requests" className="space-y-4">
          <InventoryRequestsTab canEditInventory={canEditInventory} />
        </TabsContent>

        {canEditInventory && (
          <TabsContent value="dictionary" className="space-y-4">
            <InventoryDictionaryTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function InventoryRequestsTab({
  canEditInventory,
}: {
  canEditInventory: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<
    InventoryRequestStatus | "all"
  >("all");
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: requests, isLoading } = useListInventoryRequests({
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getListInventoryRequestsQueryKey(),
    });
  };

  const [decisionDialog, setDecisionDialog] = useState<{
    open: boolean;
    request: InventoryRequest | null;
    action: "approve" | "reject";
  }>({ open: false, request: null, action: "approve" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select
            value={statusFilter}
            onValueChange={(val) => setStatusFilter(val as any)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(STATUS_LABEL).map(([val, label]) => (
                <SelectItem key={val} value={val}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canEditInventory && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Новая заявка
          </Button>
        )}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Номер / Дата</TableHead>
              <TableHead>Объект</TableHead>
              <TableHead>Позиции</TableHead>
              <TableHead>Комментарий</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-8 text-muted-foreground"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : requests?.length ? (
              requests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-medium text-xs text-muted-foreground mb-1">
                      {new Date(req.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    {req.createdBy}
                  </TableCell>
                  <TableCell>{req.siteName || "—"}</TableCell>
                  <TableCell>
                    <ul className="list-disc pl-4 text-sm">
                      {req.items.map((item) => (
                        <li key={item.id}>
                          {item.name} — {item.qty} {item.unit}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate"
                    title={req.note || ""}
                  >
                    {req.note || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <Badge variant={STATUS_VARIANT[req.status]}>
                        {STATUS_LABEL[req.status]}
                      </Badge>
                      {req.decisionNote && (
                        <span
                          className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded max-w-[150px] truncate"
                          title={req.decisionNote}
                        >
                          {req.decisionNote}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {canEditInventory && req.status === "new" && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-600"
                          onClick={() =>
                            setDecisionDialog({
                              open: true,
                              request: req,
                              action: "approve",
                            })
                          }
                          title="Одобрить"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() =>
                            setDecisionDialog({
                              open: true,
                              request: req,
                              action: "reject",
                            })
                          }
                          title="Отклонить"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {canEditInventory && req.status === "approved" && (
                      <MarkDoneButton request={req} onDone={invalidate} />
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-8 text-muted-foreground"
                >
                  Заявок не найдено
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <CreateInventoryRequestDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={invalidate}
      />

      {decisionDialog.request && (
        <DecisionDialog
          request={decisionDialog.request}
          action={decisionDialog.action}
          open={decisionDialog.open}
          onOpenChange={(open) =>
            setDecisionDialog((prev) => ({ ...prev, open }))
          }
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}

function MarkDoneButton({
  request,
  onDone,
}: {
  request: InventoryRequest;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const markDone = useMarkInventoryRequestDone({
    mutation: {
      onSuccess: () => {
        toast({ title: "Заявка выдана" });
        onDone();
      },
      onError: (err) =>
        toast({
          title: "Ошибка",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      className="text-xs"
      onClick={() => markDone.mutate({ id: request.id })}
      disabled={markDone.isPending}
    >
      {markDone.isPending ? "..." : "Выдать"}
    </Button>
  );
}

function DecisionDialog({
  request,
  action,
  open,
  onOpenChange,
  onSuccess,
}: {
  request: InventoryRequest;
  action: "approve" | "reject";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState("");

  const approve = useApproveInventoryRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Заявка одобрена" });
        onSuccess();
        onOpenChange(false);
      },
      onError: (err) =>
        toast({
          title: "Ошибка",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const reject = useRejectInventoryRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Заявка отклонена" });
        onSuccess();
        onOpenChange(false);
      },
      onError: (err) =>
        toast({
          title: "Ошибка",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const isPending = approve.isPending || reject.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (action === "approve") {
      approve.mutate({ id: request.id, data: { note: note || null } });
    } else {
      reject.mutate({ id: request.id, data: { note: note || null } });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === "approve" ? "Одобрить заявку" : "Отклонить заявку"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Комментарий (опционально)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Причина или пояснение..."
            />
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={isPending}
              variant={action === "approve" ? "default" : "destructive"}
            >
              {action === "approve" ? "Одобрить" : "Отклонить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateInventoryRequestDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: sites } = useListInventorySiteLookup();
  const { data: items } = useListInventoryItems();

  const [siteId, setSiteId] = useState<string>("none");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([
    { itemId: "", qty: "1" },
  ]);

  const activeItems = (items ?? []).filter((i) => i.active);

  const create = useCreateInventoryRequest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Заявка создана" });
        onSuccess();
        onOpenChange(false);
        setSiteId("none");
        setNote("");
        setLines([{ itemId: "", qty: "1" }]);
      },
      onError: (err) =>
        toast({
          title: "Ошибка",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validLines = lines.filter((l) => l.itemId && Number(l.qty) > 0);
    if (validLines.length === 0) {
      toast({
        title: "Заполните хотя бы одну позицию",
        variant: "destructive",
      });
      return;
    }

    create.mutate({
      data: {
        siteId: siteId === "none" ? null : siteId,
        note: note || null,
        items: validLines.map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty),
        })),
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая заявка на инвентарь</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Объект (если для объекта)</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  Без объекта (внутренние нужды)
                </SelectItem>
                {sites?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 border rounded-md p-4 bg-muted/20">
            <Label>Позиции</Label>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Select
                  value={line.itemId}
                  onValueChange={(val) => {
                    const newLines = [...lines];
                    newLines[i].itemId = val;
                    setLines(newLines);
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Выберите инвентарь..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} ({item.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="w-24"
                  value={line.qty}
                  onChange={(e) => {
                    const newLines = [...lines];
                    newLines[i].qty = e.target.value;
                    setLines(newLines);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive w-10 shrink-0"
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  disabled={lines.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setLines([...lines, { itemId: "", qty: "1" }])}
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить позицию
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Комментарий</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Дополнительная информация..."
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Отправить заявку
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InventoryDictionaryTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: items, isLoading } = useListInventoryItems();
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getListInventoryItemsQueryKey(),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Добавить позицию
        </Button>
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Категория</TableHead>
              <TableHead>Ед. изм.</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-muted-foreground"
                >
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : items?.length ? (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className={item.active ? "" : "opacity-50"}
                >
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.category || "—"}</TableCell>
                  <TableCell>{item.unit}</TableCell>
                  <TableCell>
                    {item.active ? (
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700"
                      >
                        Активен
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Архив</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditItem(item)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-muted-foreground"
                >
                  Справочник пуст
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <InventoryItemDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={invalidate}
      />
      {editItem && (
        <InventoryItemDialog
          item={editItem}
          open={!!editItem}
          onOpenChange={(open) => !open && setEditItem(null)}
          onSuccess={invalidate}
        />
      )}
    </div>
  );
}

function InventoryItemDialog({
  item,
  open,
  onOpenChange,
  onSuccess,
}: {
  item?: InventoryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(item?.name || "");
  const [unit, setUnit] = useState(item?.unit || "шт");
  const [category, setCategory] = useState(item?.category || "");
  const [active, setActive] = useState(item ? item.active : true);

  // Update state when item changes
  useEffect(() => {
    if (open) {
      setName(item?.name || "");
      setUnit(item?.unit || "шт");
      setCategory(item?.category || "");
      setActive(item ? item.active : true);
    }
  }, [open, item]);

  const create = useCreateInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Позиция создана" });
        onSuccess();
        onOpenChange(false);
      },
      onError: (err) =>
        toast({
          title: "Ошибка",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  const update = useUpdateInventoryItem({
    mutation: {
      onSuccess: () => {
        toast({ title: "Позиция обновлена" });
        onSuccess();
        onOpenChange(false);
      },
      onError: (err) =>
        toast({
          title: "Ошибка",
          description: err.message,
          variant: "destructive",
        }),
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (item) {
      update.mutate({
        id: item.id,
        data: { name, unit, category: category || null, active },
      });
    } else {
      create.mutate({
        data: { name, unit, category: category || null },
      });
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {item ? "Редактировать позицию" : "Новая позиция"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Название</Label>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Единица измерения</Label>
              <Input
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Категория</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
          {item && (
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="active"
                checked={active}
                onCheckedChange={(c) => setActive(!!c)}
              />
              <Label htmlFor="active">Активная (доступна для заказа)</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
