import { useEffect, useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjacentCalendarMonth, isCanonicalMonth } from "@/lib/moscow-date";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export function DeliveryMonthSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (month: string) => void;
}) {
  const [year, month] = value.split("-");
  const [yearDraft, setYearDraft] = useState(year);
  const [yearError, setYearError] = useState(false);
  const errorId = useId();
  const previous = adjacentCalendarMonth(value, -1);
  const next = adjacentCalendarMonth(value, 1);

  useEffect(() => {
    setYearDraft(year);
    setYearError(false);
  }, [value, year]);

  function selectMonth(selected: string) {
    if (!isCanonicalMonth(selected)) return;
    setYearDraft(selected.slice(0, 4));
    setYearError(false);
    onChange(selected);
  }

  function validateYear() {
    const selected = `${yearDraft}-${month}`;
    if (isCanonicalMonth(selected)) {
      selectMonth(selected);
    } else {
      setYearError(true);
    }
  }

  return (
    <div className="relative" role="group" aria-label="Месяц графика доставок">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Предыдущий месяц"
          title="Предыдущий месяц"
          disabled={previous === null}
          onClick={() => previous && selectMonth(previous)}
          data-testid="button-previous-delivery-month"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        {/* Ordinary visible controls work in Safari without a native month picker. */}
        <select
          value={month}
          onChange={(event) => selectMonth(`${year}-${event.target.value}`)}
          aria-label="Выбрать месяц"
          className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="input-month-selector"
        >
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={String(index + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </select>
        <Input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={yearDraft}
          onChange={(event) => {
            const draft = event.target.value;
            setYearDraft(draft);
            setYearError(false);
            const selected = `${draft}-${month}`;
            if (isCanonicalMonth(selected)) onChange(selected);
          }}
          onBlur={validateYear}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              validateYear();
            } else if (event.key === "Escape") {
              setYearDraft(year);
              setYearError(false);
            }
          }}
          aria-label="Выбрать год"
          aria-invalid={yearError}
          aria-describedby={yearError ? errorId : undefined}
          className="h-9 w-[4.5rem] px-2 text-center"
          data-testid="input-year-selector"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Следующий месяц"
          title="Следующий месяц"
          disabled={next === null}
          onClick={() => next && selectMonth(next)}
          data-testid="button-next-delivery-month"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <span
        className="sr-only"
        aria-live="polite"
        data-testid="text-selected-delivery-month"
      >
        {MONTH_NAMES[Number(month) - 1]} {year}
      </span>
      {yearError && (
        <span
          id={errorId}
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 rounded border border-destructive/30 bg-background px-2 py-1 text-xs text-destructive shadow"
          data-testid="month-selector-error"
        >
          Введите год из 4 цифр (1000–9999).
        </span>
      )}
    </div>
  );
}