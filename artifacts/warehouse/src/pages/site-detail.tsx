import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSite,
  useUpdateSite,
  useUpdateSiteFeatures,
  getListSitesQueryKey,
  getGetSiteQueryKey,
  getListDeliverySiteLookupQueryKey,
  useListSiteBranchLookup,
  getListSiteBranchLookupQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Lock, Unlock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { CloseSiteDialog } from "@/components/close-site-dialog";
import {
  useReopenSite,
  useListTradeNames,
  useListDrivers,
  useListOrderClientLookup,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { SiteServiceModeSelect, siteServiceMode, type ServiceMode } from "@/components/site-service-mode";

type FormState = {
  name: string;
  address: string;
  branch: string;
  customer: string;
  client: string;
  clientId: string;
  manager: string;
  managerContact: string;
  director: string;
  project: string;
  driverUserId: string;
  serviceMode: ServiceMode;
  features: string;
};

export default function SiteDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit, isAdmin } = usePermissions();
  const canEditSites = canEdit("sites");
  const { data: tradeNames } = useListTradeNames();
  const { data: drivers = [] } = useListDrivers();
  const { data: clients = [] } = useListOrderClientLookup();
  const {
    data: branches = [],
    isLoading: branchesLoading,
    isError: branchesError,
    refetch: refetchBranches,
  } = useListSiteBranchLookup();

  const { data: site, isLoading } = useGetSite(params.id);
  const [form, setForm] = useState<FormState | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  useEffect(() => {
    if (site) {
      setForm({
        name: site.name,
        address: site.address,
        branch: site.branch,
        customer: site.customer,
        client: site.client,
        clientId: site.clientId ?? "",
        manager: site.manager,
        managerContact: site.managerContact,
        director: site.director,
        project: site.project,
        driverUserId: site.driverUserId ?? "",
        serviceMode: siteServiceMode(site),
        features: site.features,
      });
    }
  }, [site?.id]);

  const updateSite = useUpdateSite({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(params.id) });
        queryClient.invalidateQueries({ queryKey: getListDeliverySiteLookupQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSiteBranchLookupQueryKey() });
        toast({ title: "Объект обновлён" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  const updateFeatures = useUpdateSiteFeatures({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(params.id) });
        toast({ title: "Особенности сохранены" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  const reopenSite = useReopenSite({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(params.id) });
        queryClient.invalidateQueries({ queryKey: getListDeliverySiteLookupQueryKey() });
        toast({ title: "Объект возвращён на обслуживание" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !site || !canEditSites || updateSite.isPending || updateFeatures.isPending) return;

    const values = {
      name: form.name,
      address: form.address,
      branch: form.branch,
      customer: form.customer,
      clientId: form.clientId,
      manager: form.manager,
      managerContact: form.managerContact,
      director: form.director,
      project: form.project,
      driverUserId: form.driverUserId || null,
      serviceMode: form.serviceMode,
    };
    updateSite.mutate({ id: params.id, data: { ...values, features: form.features } });
  }

  if (isLoading || !site || !form) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation("/sites")} data-testid="button-back-sites">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Назад к объектам
        </Button>
        <p className="text-muted-foreground text-sm">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div>
        <Button variant="ghost" onClick={() => setLocation("/sites")} data-testid="button-back-sites">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Назад к объектам
        </Button>
        <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between mt-2">
          <div className="min-w-0 max-w-full">
            <h1 className="max-w-full text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 inline-flex flex-wrap items-center gap-2" data-testid="text-page-title">
              <span className="min-w-0 max-w-full break-words">{site.name}</span>
              {site.isClosed && (
                <Badge variant="destructive" className="ml-2">В архиве</Badge>
              )}
              {site.pendingClosureRequest && (
                <Badge
                  variant="outline"
                  className="max-w-full whitespace-normal break-words border-amber-400 text-amber-700"
                  data-testid="status-pending-site-removal"
                >
                  Снятие с обслуживания ожидает подтверждения администратора
                </Badge>
              )}
            </h1>
            <p className="break-words text-muted-foreground text-sm mt-1">{site.address}</p>
            {site.isClosed && (
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                {site.closedFrom && (
                  <p>
                    Снято с обслуживания:{" "}
                    {new Intl.DateTimeFormat("ru-RU").format(
                      new Date(site.closedFrom),
                    )}
                  </p>
                )}
                {site.closureReason && <p>Причина: {site.closureReason}</p>}
              </div>
            )}
          </div>
          {(isAdmin || canEditSites) && (
            <div className="shrink-0 max-w-full [&>button]:min-h-11">
              {isAdmin && !site.isClosed && !site.pendingClosureRequest ? (
                <Button
                  variant="outline"
                  onClick={() => setCloseDialogOpen(true)}
                  data-testid="button-remove-site-from-service"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Снять с обслуживания
                </Button>
              ) : isAdmin && site.isClosed ? (
                <Button 
                  variant="outline" 
                  className="text-green-600 border-green-200 hover:bg-green-50"
                  onClick={() => reopenSite.mutate({ id: site.id })}
                  disabled={reopenSite.isPending}
                  data-testid="button-return-site-to-service"
                >
                  <Unlock className="h-4 w-4 mr-2" />
                  Вернуть на обслуживание
                </Button>
              ) : canEditSites && !site.isClosed && !site.pendingClosureRequest ? (
                <Button
                  variant="outline"
                  onClick={() => setCloseDialogOpen(true)}
                  data-testid="button-request-site-removal"
                >
                  <Lock className="h-4 w-4 mr-2" />
                  Запросить снятие с обслуживания
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-base">Данные объекта</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
              <div className="space-y-2">
                <Label htmlFor="name">Название</Label>
                 <Input id="name" required value={form.name} disabled={!canEditSites} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-site-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Адрес</Label>
                 <Input id="address" required value={form.address} disabled={!canEditSites} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-site-address" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
              <div className="space-y-2">
                <Label htmlFor="branch">Куст</Label>
                <select
                  id="branch"
                  required
                  disabled={!canEditSites || branchesLoading || branchesError}
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-describedby={branchesLoading || branchesError ? "branch-status" : undefined}
                  data-testid="select-site-branch"
                >
                  <option value="" disabled>Выберите куст</option>
                  {Array.from(new Set([
                    ...branches.map((branch) => branch.name),
                    form.branch,
                  ])).filter((name) => name.trim()).sort((a, b) => a.localeCompare(b, "ru")).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {branchesLoading && (
                  <p id="branch-status" role="status" className="text-sm text-muted-foreground">
                    Загружаем список кустов…
                  </p>
                )}
                {branchesError && (
                  <div id="branch-status" role="alert" className="text-sm text-destructive">
                    Не удалось загрузить список кустов.{" "}
                    <button type="button" className="underline" onClick={() => void refetchBranches()}>
                      Повторить
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="client">Клиент</Label>
                <Select
                  disabled={!canEditSites}
                  value={form.clientId || undefined}
                  onValueChange={(clientId) => {
                    const client = clients.find((item) => item.id === clientId);
                    setForm({
                      ...form,
                      clientId,
                      client: client?.name ?? "",
                    });
                  }}
                >
                  <SelectTrigger id="client" data-testid="select-site-client">
                    <SelectValue placeholder={form.client || "Выберите клиента"} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
              <div className="space-y-2">
                <Label>Торговое название объекта (необязательно)</Label>
                <Select
                  value={form.customer || undefined}
                  onValueChange={(v) => setForm({ ...form, customer: v })}
                  disabled={!canEditSites}
                >
                  <SelectTrigger data-testid="select-site-customer">
                    <SelectValue placeholder="Можно не указывать" />
                  </SelectTrigger>
                  <SelectContent>
                    {form.customer &&
                      !(tradeNames ?? []).some((t) => t.name === form.customer) && (
                        <SelectItem value={form.customer}>
                          {form.customer} (нет в справочнике)
                        </SelectItem>
                      )}
                    {(tradeNames ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="manager">Закреплённый менеджер</Label>
                <Input
                  id="manager"
                  disabled={!canEditSites}
                  value={form.manager}
                  onChange={(e) => setForm({ ...form, manager: e.target.value })}
                  data-testid="input-site-manager"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
              <div className="space-y-2">
                <Label htmlFor="director">Закреплённый руководитель</Label>
                <Input
                  id="director"
                  required
                  disabled={!canEditSites}
                  value={form.director}
                  onChange={(e) => setForm({ ...form, director: e.target.value })}
                  data-testid="input-site-director"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project">Закреплённый проект</Label>
                <Input
                  id="project"
                  required
                  disabled={!canEditSites}
                  value={form.project}
                  onChange={(e) => setForm({ ...form, project: e.target.value })}
                  data-testid="input-site-project"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
              <div className="space-y-2">
                <Label htmlFor="driver">Закреплённый водитель</Label>
                <Select
                  disabled={!canEditSites}
                  value={form.driverUserId || "__none__"}
                  onValueChange={(value) => setForm({
                    ...form,
                    driverUserId: value === "__none__" ? "" : value,
                  })}
                >
                  <SelectTrigger id="driver" data-testid="select-site-driver">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Не назначен</SelectItem>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name || driver.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="managerContact">Контакт менеджера</Label>
                <Input
                  id="managerContact"
                  disabled={!canEditSites}
                  value={form.managerContact}
                  onChange={(e) =>
                    setForm({ ...form, managerContact: e.target.value })
                  }
                  data-testid="input-site-manager-contact"
                />
              </div>
              <div className="space-y-2">
                <Label>Формат обслуживания</Label>
                <SiteServiceModeSelect value={form.serviceMode} onChange={serviceMode => setForm({ ...form, serviceMode })} disabled={!canEditSites} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="features">Особенности</Label>
              <Textarea
                id="features"
                disabled={!canEditSites}
                value={form.features}
                onChange={(e) => setForm({ ...form, features: e.target.value })}
                placeholder="Особенности работы магазина или подъезда большой машины"
                data-testid="textarea-site-features"
              />
              {canEditSites && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={updateSite.isPending || updateFeatures.isPending || form.features === site.features}
                  onClick={() =>
                    updateFeatures.mutate({
                      id: params.id,
                      data: { features: form.features },
                    })
                  }
                  data-testid="button-save-site-features"
                >
                  Сохранить особенности сразу
                </Button>
              )}
            </div>
            {canEditSites && (
              <Button type="submit" disabled={updateSite.isPending || updateFeatures.isPending} data-testid="button-submit-site">
                {updateSite.isPending ? "Сохранение..." : "Сохранить"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
      
      <CloseSiteDialog
        site={site}
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
      />
    </div>
  );
}
