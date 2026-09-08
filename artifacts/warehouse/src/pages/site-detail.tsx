import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSite,
  useUpdateSite,
  getListSitesQueryKey,
  getGetSiteQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  useListDeliveryTypes,
  useListDrivers,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormState = {
  branch: string;
  customer: string;
  client: string;
  manager: string;
  managerContact: string;
  director: string;
  project: string;
  driverUserId: string;
  deliveryType: string;
};

export default function SiteDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditSites = canEdit("sites");
  const { data: tradeNames } = useListTradeNames();
  const { data: deliveryTypes } = useListDeliveryTypes();
  const { data: drivers = [] } = useListDrivers();

  const { data: site, isLoading } = useGetSite(params.id);
  const [form, setForm] = useState<FormState | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  useEffect(() => {
    if (site) {
      setForm({
        branch: site.branch,
        customer: site.customer,
        client: site.client,
        manager: site.manager,
        managerContact: site.managerContact,
        director: site.director,
        project: site.project,
        driverUserId: site.driverUserId ?? "",
        deliveryType: site.deliveryType,
      });
    }
  }, [site]);

  const updateSite = useUpdateSite({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSiteQueryKey(params.id) });
        toast({ title: "Объект обновлён" });
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
        toast({ title: "Объект открыт" });
      },
      onError: (error) => {
        toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    updateSite.mutate({
      id: params.id,
      data: {
        branch: form.branch,
        customer: form.customer,
        client: form.client,
        manager: form.manager,
        managerContact: form.managerContact,
        director: form.director,
        project: form.project,
        driverUserId: form.driverUserId || null,
        deliveryType: form.deliveryType,
      },
    });
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
    <div className="space-y-6">
      <div>
        <Button variant="ghost" onClick={() => setLocation("/sites")} data-testid="button-back-sites">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Назад к объектам
        </Button>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 inline-flex items-center gap-2" data-testid="text-page-title">
              {site.name}
              {site.isClosed && (
                <Badge variant="destructive" className="ml-2">Закрыт</Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{site.address}</p>
          </div>
          {canEditSites && (
            <div>
              {!site.isClosed ? (
                <Button variant="outline" onClick={() => setCloseDialogOpen(true)}>
                  <Lock className="h-4 w-4 mr-2" />
                  Закрыть объект
                </Button>
              ) : (
                <Button 
                  variant="outline" 
                  className="text-green-600 border-green-200 hover:bg-green-50"
                  onClick={() => reopenSite.mutate({ id: site.id })}
                  disabled={reopenSite.isPending}
                >
                  <Unlock className="h-4 w-4 mr-2" />
                  Открыть объект
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Данные объекта</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Название</Label>
                <Input id="name" value={site.name} disabled data-testid="input-site-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Адрес</Label>
                <Input id="address" value={site.address} disabled data-testid="input-site-address" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="branch">Куст</Label>
                <Input
                  id="branch"
                  required
                  disabled={!canEditSites}
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  data-testid="input-site-branch"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client">Клиент</Label>
                <Input
                  id="client"
                  required
                  disabled={!canEditSites}
                  value={form.client}
                  onChange={(e) => setForm({ ...form, client: e.target.value })}
                  data-testid="input-site-client"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
                  required
                  disabled={!canEditSites}
                  value={form.manager}
                  onChange={(e) => setForm({ ...form, manager: e.target.value })}
                  data-testid="input-site-manager"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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
                <Label>Тип поставки</Label>
                <Select
                  value={form.deliveryType || "__none__"}
                  onValueChange={(v) =>
                    setForm({ ...form, deliveryType: v === "__none__" ? "" : v })
                  }
                  disabled={!canEditSites}
                >
                  <SelectTrigger data-testid="select-site-delivery-type">
                    <SelectValue placeholder="Выберите из справочника" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Не указан</SelectItem>
                    {form.deliveryType &&
                      !(deliveryTypes ?? []).some(
                        (t) => t.name === form.deliveryType,
                      ) && (
                        <SelectItem value={form.deliveryType}>
                          {form.deliveryType} (нет в справочнике)
                        </SelectItem>
                      )}
                    {(deliveryTypes ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {canEditSites && (
              <Button type="submit" disabled={updateSite.isPending} data-testid="button-submit-site">
                Сохранить
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
