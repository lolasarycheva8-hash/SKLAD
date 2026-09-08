import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeliveryTypes,
  useCreateDeliveryType,
  useDeleteDeliveryType,
  getListDeliveryTypesQueryKey,
} from "@workspace/api-client-react";
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
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default function DeliveryTypes() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { canEdit } = usePermissions();
  const canEditSites = canEdit("sites");

  const { data: types, isLoading } = useListDeliveryTypes();
  const [newName, setNewName] = useState("");

  const showError = (error: any) =>
    toast({
      title: "Ошибка",
      description:
        error?.data?.error ?? error?.response?.data?.error ?? error.message,
      variant: "destructive",
    });

  const createType = useCreateDeliveryType({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListDeliveryTypesQueryKey(),
        });
        setNewName("");
      },
      onError: showError,
    },
  });

  const deleteType = useDeleteDeliveryType({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListDeliveryTypesQueryKey(),
        });
        toast({ title: "Тип поставки удалён" });
      },
      onError: showError,
    },
  });

  return (
    <div className="space-y-6">
      <h1
        className="text-2xl font-bold text-blue-900 bg-[#f5ecd9] rounded-md px-4 py-2 block w-full"
        data-testid="text-page-title"
      >
        Типы поставки
      </h1>
      <p className="text-muted-foreground text-sm">
        Справочник типов поставки. Поле «Тип поставки» у объекта можно указывать
        только из этого списка — и в форме, и при загрузке из Excel.
      </p>

      {canEditSites && (
        <form
          className="flex gap-2 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (name) createType.mutate({ data: { name } });
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Новый тип поставки"
            data-testid="input-new-delivery-type"
          />
          <Button
            type="submit"
            disabled={createType.isPending || !newName.trim()}
            data-testid="button-add-delivery-type"
          >
            Добавить
          </Button>
        </form>
      )}

      <div className="rounded-md border max-w-2xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Добавлен</TableHead>
              {canEditSites && <TableHead className="w-16" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : (types ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  Справочник пуст. Добавьте первый тип поставки.
                </TableCell>
              </TableRow>
            ) : (
              (types ?? []).map((t) => (
                <TableRow key={t.id} data-testid={`row-delivery-type-${t.name}`}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {dateFormatter.format(new Date(t.createdAt))}
                  </TableCell>
                  {canEditSites && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteType.mutate({ id: t.id })}
                        disabled={deleteType.isPending}
                        data-testid={`button-delete-delivery-type-${t.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
