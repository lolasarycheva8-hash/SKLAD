import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onCreate?: (name: string) => Promise<string>;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function CreatableSiteLookup({
  id, label, value, options, onChange, onCreate, isLoading, isError, onRetry,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const choices = [...new Set([...options, ...(value ? [value] : [])])].sort((a, b) => a.localeCompare(b, "ru"));

  async function add() {
    const name = draft.trim();
    if (!name || pending) return;
    setPending(true);
    setError("");
    try {
      const existing = choices.find((choice) => choice.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"));
      const resolved = existing ?? (onCreate ? await onCreate(name) : name);
      if (!mounted.current) return;
      onChange(resolved);
      setCreating(false);
      setDraft("");
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Не удалось создать название. Повторите попытку.");
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`select-${id}`}>{label} *</Label>
      <Select
        value={creating ? "__create__" : value ? `value:${value}` : ""}
        disabled={pending || isLoading || isError}
        onValueChange={(selected) => {
          // Radix's hidden native select can emit an empty value while a newly
          // created option is being mounted. It is not a user reset action.
          if (selected !== "__create__" && !selected.startsWith("value:")) return;
          setError("");
          if (selected === "__create__") {
            setCreating(true);
            setDraft("");
            onChange("");
          } else {
            setCreating(false);
            onChange(selected.slice("value:".length));
          }
        }}
      >
        <SelectTrigger id={`select-${id}`} data-testid={`select-${id}`} aria-required="true">
          <SelectValue placeholder={isLoading ? "Загрузка…" : "Выберите из списка"} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((name) => <SelectItem key={name} value={`value:${name}`}>{name}</SelectItem>)}
          <SelectItem value="__create__">Создать новый</SelectItem>
        </SelectContent>
      </Select>
      {isError && (
        <div className="text-sm text-destructive" role="alert">
          Не удалось загрузить список.
          <Button type="button" size="sm" variant="ghost" onClick={onRetry}>Повторить</Button>
        </div>
      )}
      {creating && (
        <div className="space-y-2">
          <Input
            aria-label={`Новое название: ${label}`}
            data-testid={`input-new-${id}`}
            placeholder="Введите новое название"
            value={draft}
            disabled={pending}
            onChange={(event) => { setDraft(event.target.value); setError(""); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); void add(); }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !draft.trim()}
            data-testid={`button-create-${id}`}
            onClick={() => void add()}
          >
            {pending ? "Добавление…" : "Добавить и выбрать"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {onCreate ? "Название будет сохранено в справочнике." : "Новый куст появится в списке после сохранения объекта."}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}