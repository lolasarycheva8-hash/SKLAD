import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import type { OrderFormSite } from "@/components/order-form-fields";

export function OrderSitePicker({ sites, value, onChange, loading, error }: {
  sites: OrderFormSite[];
  value?: string;
  onChange: (value: string) => void;
  loading: boolean;
  error: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = sites.find((site) => site.id === value);
  const select = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Магазин и адрес"
          aria-expanded={open}
          disabled={loading || error}
          className="h-auto min-h-10 w-full justify-between text-left font-normal whitespace-normal"
          data-testid="select-order-site"
        >
          {loading ? "Загрузка магазинов…" : selected
            ? `${selected.name} — ${selected.address}`
            : value === "__none__" ? "Без привязки к магазину" : "Найти магазин по названию или адресу"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Название магазина или адрес…" aria-label="Поиск магазина" />
          <CommandList>
            <CommandEmpty>Магазины не найдены</CommandEmpty>
            <CommandItem value="__none__" keywords={["Без привязки к магазину"]} onSelect={() => select("__none__")}>
              Без привязки к магазину
            </CommandItem>
            {sites.map((site) => (
              <CommandItem key={site.id} value={site.id} keywords={[site.name, site.address]} onSelect={() => select(site.id)}>
                <span className="flex flex-col">
                  <span>{site.name}</span>
                  <span className="text-xs text-muted-foreground">{site.address}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}