import { useId, useState } from "react";
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
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid) onChange(draft);
      }}
    >
      <div className="w-full text-xs text-muted-foreground">
        {fr
          ? "Période de dernière modification · dates incluses, heure locale"
          : "Last modified period · inclusive dates, local time"}
      </div>
      <label htmlFor={`${id}-month`} className="space-y-1 text-xs">
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
        }}
      >
        {fr ? "Réinitialiser" : "Reset"}
      </Button>
      {invalid && (
        <p role="alert" className="w-full text-xs text-destructive">
          {fr
            ? "La date de fin doit suivre la date de début."
            : "The end date must follow the start date."}
        </p>
      )}
    </form>
  );
}
