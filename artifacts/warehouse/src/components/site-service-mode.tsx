import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ServiceMode = "monthly" | "additional_only";
export const SERVICE_MODES: Record<ServiceMode, string> = {
  monthly: "Ежемесячная поставка",
  additional_only: "Доставка доп.заказов",
};

export function siteServiceMode(site: { serviceMode?: string | null; deliveryType?: string }): ServiceMode {
  return site.serviceMode === "additional_only" ||
    (!site.serviceMode && /^доп[.\s]*заказ/i.test(site.deliveryType?.trim() ?? ""))
    ? "additional_only" : "monthly";
}

export function parseServiceMode(value: string): ServiceMode | undefined {
  if (!value.trim()) return undefined;
  const match = Object.entries(SERVICE_MODES).find(([, label]) => label.toLowerCase() === value.trim().toLowerCase());
  if (!match) throw new Error(`Неизвестный формат обслуживания: ${value}`);
  return match[0] as ServiceMode;
}

export function SiteServiceModeSelect({ value, onChange, disabled }: {
  value: ServiceMode; onChange: (value: ServiceMode) => void; disabled?: boolean;
}) {
  return <Select value={value} onValueChange={v => onChange(v as ServiceMode)} disabled={disabled}>
    <SelectTrigger aria-label="Формат обслуживания" data-testid="select-site-service-mode"><SelectValue /></SelectTrigger>
    <SelectContent>{Object.entries(SERVICE_MODES).map(([key, label]) =>
      <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
  </Select>;
}
