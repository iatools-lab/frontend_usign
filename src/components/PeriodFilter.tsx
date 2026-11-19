import { useId, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EMPTY_PERIOD, type Period } from "@/lib/period";

export function PeriodFilter({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  const { i18n } = useTranslation();
  const fr = i18n.language.startsWith("fr");
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState(false);
  const active = Boolean(value.from || value.to);
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${date}T00:00:00`));
  const summary =
    value.from && value.to
      ? `${formatDate(value.from)} – ${formatDate(value.to)}`
      : value.from
        ? `${fr ? "Depuis le" : "From"} ${formatDate(value.from)}`
        : value.to
          ? `${fr ? "Jusqu’au" : "Until"} ${formatDate(value.to)}`
          : fr
            ? "Période"
            : "Period";
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(value);
          setMonth("");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-w-full gap-2"
          aria-label={`${fr ? "Filtrer par période" : "Filter by period"} : ${summary}`}
        >
          <CalendarDays className="h-4 w-4 shrink-0" />
          <span className="max-w-[230px] truncate">{summary}</span>
          {active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-action" />}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalid) {
              onChange(draft);
              setOpen(false);
            }
          }}
        >
          <div className="col-span-2 text-xs text-muted-foreground">
            {fr
              ? "Période de dernière modification · dates incluses, heure locale"
              : "Last modified period · inclusive dates, local time"}
          </div>
          <label htmlFor={`${id}-month`} className="col-span-2 space-y-1 text-xs">
            <span>{fr ? "Mois" : "Month"}</span>
            <Input
              id={`${id}-month`}
              type="month"
              value={month}
              onChange={(event) => {
                const selected = event.target.value;
                setMonth(selected);
                if (!selected) return;
                const [year, number] = selected.split("-").map(Number);
                const last = new Date(year, number, 0).getDate();
                setDraft({ from: `${selected}-01`, to: `${selected}-${last}` });
              }}
            />
          </label>
          <label htmlFor={`${id}-from`} className="space-y-1 text-xs">
            <span>{fr ? "Du" : "From"}</span>
            <Input
              id={`${id}-from`}
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) => {
                setMonth("");
                setDraft({ ...draft, from: event.target.value });
              }}
            />
          </label>
          <label htmlFor={`${id}-to`} className="space-y-1 text-xs">
            <span>{fr ? "Au" : "To"}</span>
            <Input
              id={`${id}-to`}
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) => {
                setMonth("");
                setDraft({ ...draft, to: event.target.value });
              }}
            />
          </label>
          <Button type="submit" size="sm" disabled={invalid}>
            {fr ? "Appliquer" : "Apply"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(EMPTY_PERIOD);
              setMonth("");
              onChange(EMPTY_PERIOD);
              setOpen(false);
            }}
          >
            {fr ? "Réinitialiser" : "Reset"}
          </Button>
          {invalid && (
            <p role="alert" className="col-span-2 text-xs text-destructive">
              {fr
                ? "La date de fin doit suivre la date de début."
                : "The end date must follow the start date."}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}
