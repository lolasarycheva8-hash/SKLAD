import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInventoryRecords,
  useCreateInventoryRecord,
  useUpdateInventoryRecord,
  useDeleteInventoryRecord,
  useBulkCreateInventoryRecords,
  getListInventoryRecordsQueryKey,
  useListSites,
} from "@workspace/api-client-react";
import type { InventoryRecord } from "@workspace/api-client-react";
import { Download, FileUp, Pencil, Plus, Search, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { downloadTemplate, parseExcelFile, readSheetHeaders } from "@/lib/excel-import";
import {
  CONDITIONS, DEFAULT_UNIT, STATUSES, STOCK_KINDS, kindMeta, serverBulkErrors, templateHeaders, validateStockRows,
  type StockImportError, type StockImportRow, type StockKind, type StockRecordInput,
} from "@/lib/stock-import";

const ALL = "__all";
const NONE = "__none";

function apiError(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string };
  return e?.data?.error ?? e?.message ?? "Ошибка запроса";
}

export default function Stock() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<StockKind>("equipment");
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState(ALL);
  const [editing, setEditing] = useState<InventoryRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<InventoryRecord | null>(null);
  const [templated, setTemplated] = useState<Record<StockKind, boolean>>({ equipment: false, consumables: false, spare_parts: false });
  const [preview, setPreview] = useState<{ file: string; rows: StockImportRow[]; errors: StockImportError[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useListInventoryRecords({ kind, ...(siteFilter !== ALL && siteFilter !== NONE ? { siteId: siteFilter } : {}) });
  const [reading, setReading] = useState(false);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const submittingRef = useRef(false);
  const sitesQ = useListSites();
  const activeSites = useMemo(
    () => (sitesQ.data ?? []).filter((s) => !s.closedFrom).map((s) => ({ id: s.id, name: s.name })),
    [sitesQ.data],
  );
  const siteName = useMemo(() => new Map((sitesQ.data ?? []).map((s) => [s.id, s.name])), [sitesQ.data]);

  const records = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((r) => {
      if (siteFilter === NONE && r.siteId) return false;
      if (!q) return true;
      return [r.name, r.type, r.model, r.inventoryNumber, r.sku, r.notes, r.siteId ? siteName.get(r.siteId) : ""]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [list.data, search, siteFilter, siteName]);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListInventoryRecordsQueryKey().slice(0, 1) });
  const del = useDeleteInventoryRecord();
  const bulk = useBulkCreateInventoryRecords();
  const meta = kindMeta(kind);
  const busy = reading || bulk.isPending;

  async function handleTemplate() {
    const target = kind;
    const fresh = await sitesQ.refetch();
    if (fresh.isError || !fresh.data) {
      toast({ title: "Шаблон не сформирован", description: "Не удалось загрузить список объектов. Повторите попытку.", variant: "destructive" });
      return;
    }
    const activeSites = fresh.data.filter((s) => !s.closedFrom).map((s) => ({ id: s.id, name: s.name }));
    const meta = kindMeta(target);
    try {
      const headers = templateHeaders(target);
      downloadTemplate(headers, meta.file, [
        { name: "Объекты", headers: ["Объект"], rows: activeSites.map((s) => ({ Объект: s.name })), dropdownForHeader: "Объект", dropdownError: "Выберите объект из списка.", hidden: true },
        { name: "Состояния", headers: ["Состояние"], rows: CONDITIONS.map((c) => ({ Состояние: c })), dropdownForHeader: "Состояние", hidden: true },
        { name: "Статусы", headers: ["Статус"], rows: STATUSES.map((c) => ({ Статус: c })), dropdownForHeader: "Статус", hidden: true },
      ]);
      setTemplated((t) => ({ ...t, [target]: true }));
    } catch (e) {
      toast({ title: "Не удалось сформировать шаблон", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function handleFile(file: File) {
    const k = kind;
    if (!templated[k] || busy) return;
    setReading(true);
    try {
      const [headers, rows] = await Promise.all([readSheetHeaders(file), parseExcelFile(file)]);
      if (kindRef.current !== k) return;
      const existing = (list.data ?? []).map((r) => (kind === "equipment" ? r.inventoryNumber : r.sku) ?? "").filter(Boolean);
      const result = validateStockRows(k, rows, headers, activeSites, siteFilter === ALL ? existing : []);
      setPreview({ file: file.name, ...result });
    } catch (e) {
      if (kindRef.current === k) setPreview({ file: file.name, rows: [], errors: [{ rowNumber: null, message: `Файл не читается: ${(e as Error).message}` }] });
    } finally {
      setReading(false);
    }
  }

  function confirmImport() {
    if (!preview?.rows.length || submittingRef.current || bulk.isPending) return;
    submittingRef.current = true;
    const rows = preview.rows.map(({ rowNumber: _r, ...rest }) => rest);
    bulk.mutate({ data: { rows } }, {
      onSettled: () => { submittingRef.current = false; },
      onSuccess: (res) => {
        toast({ title: "Импорт выполнен", description: `Добавлено записей: ${res.created}` });
        setPreview(null);
        invalidate();
      },
      onError: (err) => setPreview((p) => (p ? { ...p, rows: [], errors: serverBulkErrors(err) } : p)),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Склад</h1>
          <p className="text-sm text-muted-foreground">Техника, расходные материалы и запчасти по объектам.</p>
        </div>
        <Button onClick={() => setEditing("new")} data-testid="button-add-stock"><Plus className="mr-1 h-4 w-4" />Добавить</Button>
      </div>

      <Tabs value={kind} onValueChange={(v) => { if (busy) return; setKind(v as StockKind); setPreview(null); }}>
        <TabsList className="h-auto flex-wrap">
          {STOCK_KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind} disabled={busy && k.kind !== kind} data-testid={`tab-stock-${k.kind}`}>{k.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-2 rounded border border-l-4 border-l-primary bg-card p-3 md:flex-row md:items-center">
        <ol className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <li><span className="font-mono font-semibold text-primary">1</span> Скачайте шаблон «{meta.label}»</li>
          <li><span className="font-mono font-semibold text-primary">2</span> Заполните первый лист</li>
          <li><span className="font-mono font-semibold text-primary">3</span> Загрузите и проверьте</li>
        </ol>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleTemplate()} disabled={busy || sitesQ.isFetching} data-testid="button-download-template">
            <Download className="mr-1 h-4 w-4" />Шаблон
          </Button>
          <Button size="sm" disabled={!templated[kind] || busy} onClick={() => fileRef.current?.click()} data-testid="button-upload-xlsx"
            title={templated[kind] ? "" : "Сначала скачайте шаблон этой вкладки"}>
            <FileUp className="mr-1 h-4 w-4" />{reading ? "Чтение…" : "Загрузить"}
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" data-testid="input-xlsx"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleFile(f); }} />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, модели, номеру…" className="pl-8" data-testid="input-stock-search" />
        </div>
        <Select value={siteFilter} onValueChange={setSiteFilter}>
          <SelectTrigger className="sm:w-64" data-testid="select-stock-site"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все места хранения</SelectItem>
            <SelectItem value={NONE}>Склад (без объекта)</SelectItem>
            {activeSites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto rounded border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Наименование</TableHead>
              <TableHead>Тип / модель</TableHead>
              <TableHead>{meta.keyLabel}</TableHead>
              <TableHead className="text-right">Кол-во</TableHead>
              <TableHead>Состояние</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Место</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={8}><Skeleton className="h-5 w-full" /></TableCell></TableRow>
            ))}
            {list.isError && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center">
                <p className="mb-2 text-destructive">{apiError(list.error)}</p>
                <Button variant="outline" size="sm" onClick={() => list.refetch()}>Повторить</Button>
              </TableCell></TableRow>
            )}
            {!list.isLoading && !list.isError && records.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground" data-testid="text-stock-empty">
                {(list.data ?? []).length ? "Ничего не найдено по фильтру." : `В разделе «${meta.label}» пока нет записей. Добавьте вручную или загрузите шаблон.`}
              </TableCell></TableRow>
            )}
            {records.map((r) => (
              <TableRow key={r.id} data-testid={`row-stock-${r.id}`}>
                <TableCell className="font-medium">{r.name}{r.notes && <div className="text-xs text-muted-foreground line-clamp-1">{r.notes}</div>}</TableCell>
                <TableCell className="text-sm">{[r.type, r.model].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{(kind === "equipment" ? r.inventoryNumber : r.sku) ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{r.quantity} <span className="text-muted-foreground">{r.unit}</span></TableCell>
                <TableCell><Badge variant="outline">{r.condition}</Badge></TableCell>
                <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                <TableCell className="text-sm">{r.siteId ? siteName.get(r.siteId) ?? "—" : "Склад"}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)} data-testid={`button-edit-stock-${r.id}`}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(r)} data-testid={`button-delete-stock-${r.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <RecordDialog kind={kind} record={editing === "new" ? null : editing} sites={activeSites}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); invalidate(); }} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>«{deleting?.name}» будет удалена без возможности восстановления.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" data-testid="button-confirm-delete"
              onClick={() => deleting && del.mutate({ id: deleting.id }, {
                onSuccess: () => { toast({ title: "Запись удалена" }); setDeleting(null); invalidate(); },
                onError: (e) => toast({ title: "Не удалось удалить", description: apiError(e), variant: "destructive" }),
              })}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && !bulk.isPending && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Импорт: {meta.label}</DialogTitle>
            <DialogDescription>{preview?.file}</DialogDescription>
          </DialogHeader>
          {preview && preview.errors.length > 0 ? (
            <div className="max-h-80 space-y-1 overflow-y-auto rounded border border-destructive/30 bg-destructive/5 p-3" data-testid="list-import-errors">
              <p className="mb-2 flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" />Файл не принят — ничего не сохранено. Исправьте ошибки:</p>
              {preview.errors.map((e, i) => (
                <p key={i} className="text-sm"><span className="font-mono font-semibold">{e.rowNumber ? `Строка ${e.rowNumber}` : "Файл"}:</span> {e.message}</p>
              ))}
            </div>
          ) : preview && (
            <div className="max-h-80 overflow-auto rounded border">
              <p className="flex items-center gap-2 border-b bg-muted p-2 text-sm"><CheckCircle2 className="h-4 w-4 text-primary" />Проверено строк: {preview.rows.length}. Будут добавлены все или ни одной.</p>
              <Table>
                <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Наименование</TableHead><TableHead>{meta.keyLabel}</TableHead><TableHead>Кол-во</TableHead><TableHead>Состояние</TableHead><TableHead>Статус</TableHead><TableHead>Место</TableHead></TableRow></TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.rowNumber}>
                      <TableCell className="font-mono text-xs">{r.rowNumber}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.inventoryNumber ?? r.sku}</TableCell>
                      <TableCell>{r.quantity} {r.unit}</TableCell>
                      <TableCell>{r.condition}</TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell>{r.siteId ? siteName.get(r.siteId) : "Склад"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={bulk.isPending}>Закрыть</Button>
            {preview && preview.errors.length === 0 && (
              <Button onClick={confirmImport} disabled={bulk.isPending} data-testid="button-confirm-import">
                {bulk.isPending ? "Импорт…" : `Добавить ${preview.rows.length}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecordDialog({ kind, record, sites, onClose, onSaved }: {
  kind: StockKind; record: InventoryRecord | null; sites: { id: string; name: string }[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateInventoryRecord();
  const update = useUpdateInventoryRecord();
  const k = (record?.kind as StockKind) ?? kind;
  const isEq = k === "equipment";
  const [f, setF] = useState({
    name: record?.name ?? "", type: record?.type ?? "", model: record?.model ?? "",
    key: (isEq ? record?.inventoryNumber : record?.sku) ?? "",
    quantity: String(record?.quantity ?? 1), unit: record?.unit ?? DEFAULT_UNIT[k],
    condition: record?.condition ?? CONDITIONS[0], status: record?.status ?? STATUSES[0],
    siteId: record?.siteId ?? NONE, notes: record?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [key]: v }));

  function submit() {
    const qty = Number(f.quantity.replace(",", "."));
    if (!f.name.trim()) return setError("Укажите наименование");
    if (!f.key.trim()) return setError(`Укажите ${kindMeta(k).keyLabel.toLowerCase()}`);
    if (!Number.isFinite(qty) || qty < 0) return setError("Количество должно быть числом ≥ 0");
    if (isEq && qty !== 1) return setError("Для техники количество всегда 1");
    if (!f.unit.trim()) return setError("Укажите единицу измерения");
    const body: StockRecordInput = {
      kind: k, name: f.name.trim(), type: f.type.trim() || null, model: f.model.trim() || null,
      inventoryNumber: isEq ? f.key.trim() : null, sku: isEq ? null : f.key.trim(),
      quantity: qty, unit: f.unit.trim(), condition: f.condition, status: f.status,
      siteId: f.siteId === NONE ? null : f.siteId, notes: f.notes.trim() || null,
    };
    const opts = {
      onSuccess: () => { toast({ title: record ? "Запись обновлена" : "Запись добавлена" }); onSaved(); },
      onError: (e: unknown) => setError(apiError(e)),
    };
    if (record) {
      const { kind: _k, ...patch } = body;
      update.mutate({ id: record.id, data: patch }, opts);
    } else create.mutate({ data: body }, opts);
  }
  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{record ? "Редактировать" : "Добавить"}: {kindMeta(k).label}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Наименование *</Label><Input value={f.name} onChange={(e) => set("name")(e.target.value)} data-testid="input-stock-name" /></div>
          <div><Label>Тип</Label><Input value={f.type} onChange={(e) => set("type")(e.target.value)} data-testid="input-stock-type" /></div>
          <div><Label>Модель</Label><Input value={f.model} onChange={(e) => set("model")(e.target.value)} data-testid="input-stock-model" /></div>
          <div><Label>{kindMeta(k).keyLabel} *</Label><Input className="font-mono" value={f.key} onChange={(e) => set("key")(e.target.value)} data-testid="input-stock-key" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Кол-во *</Label><Input inputMode="decimal" value={f.quantity} disabled={isEq} onChange={(e) => set("quantity")(e.target.value)} data-testid="input-stock-quantity" /></div>
            <div><Label>Ед. *</Label><Input value={f.unit} onChange={(e) => set("unit")(e.target.value)} data-testid="input-stock-unit" /></div>
          </div>
          <div><Label>Состояние</Label>
            <Select value={f.condition} onValueChange={set("condition")}><SelectTrigger data-testid="select-stock-condition"><SelectValue /></SelectTrigger>
              <SelectContent>{[...new Set([...CONDITIONS, f.condition])].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
          </div>
          <div><Label>Статус</Label>
            <Select value={f.status} onValueChange={set("status")}><SelectTrigger data-testid="select-stock-status"><SelectValue /></SelectTrigger>
              <SelectContent>{[...new Set([...STATUSES, f.status])].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="sm:col-span-2"><Label>Место хранения</Label>
            <Select value={f.siteId} onValueChange={set("siteId")}><SelectTrigger data-testid="select-stock-record-site"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Склад (без объекта)</SelectItem>{sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="sm:col-span-2"><Label>Примечание</Label><Textarea rows={2} value={f.notes} onChange={(e) => set("notes")(e.target.value)} data-testid="input-stock-notes" /></div>
        </div>
        {error && <p className="text-sm text-destructive" data-testid="text-stock-form-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Отмена</Button>
          <Button onClick={submit} disabled={pending} data-testid="button-save-stock">{pending ? "Сохранение…" : "Сохранить"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
