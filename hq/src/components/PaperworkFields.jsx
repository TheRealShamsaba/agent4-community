import React from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { pick } from "../paperwork-templates.js";

/* The form half of the paperwork editor: one field kind per control, and the
   template's own hint always on screen under the label.

   The hints in paperwork-templates.js are the most valuable writing in that
   file — "content is what makes launches late, every time" — and a hint behind
   a tooltip is a hint nobody reads at the moment they are typing. They cost a
   line each and they are worth it. */

const WORDS = {
  en: { required: "required", choose: "Choose", add: "Add a row", up: "Move up", down: "Move down", drop: "Remove this row", empty: "No rows yet." },
  fa: { required: "الزامی", choose: "انتخاب کنید", add: "افزودن ردیف", up: "بالا", down: "پایین", drop: "حذف این ردیف", empty: "هنوز ردیفی نیست." }
};

/* A saved list is an array of arrays — one array per row, one string per
   column — because that is the shape render() reads. Anything else in the
   store (an older answer, a hand-edited row) is normalised rather than thrown
   away, so a bad row can be fixed on screen instead of losing the document. */
function rowsOf(value, width) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    return Array.from({ length: width }, (_, index) => String(cells[index] ?? ""));
  });
}

function ListField({ field, lang, value, onChange }) {
  const words = WORDS[lang];
  const columns = field.columns || [];
  const rows = rowsOf(value, columns.length);
  const label = pick(field.label, lang);

  const write = (next) => onChange(field.id, next);

  function setCell(rowIndex, cellIndex, text) {
    write(rows.map((row, index) => (index === rowIndex ? row.map((cell, position) => (position === cellIndex ? text : cell)) : row)));
  }

  function move(from, to) {
    if (to < 0 || to >= rows.length) return;
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    write(next);
  }

  return (
    <div className="pw-list">
      <div className="pw-list-head" aria-hidden="true">
        {columns.map((column, index) => <span key={index}>{pick(column, lang)}</span>)}
        <span className="pw-list-head-tools" />
      </div>
      {rows.map((row, rowIndex) => (
        <div className="pw-list-row" key={rowIndex}>
          {columns.map((column, cellIndex) => column.options ? (
            <select
              key={cellIndex}
              value={row[cellIndex]}
              aria-label={`${label} — ${pick(column, lang)} — ${rowIndex + 1}`}
              onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
            >
              <option value="">{words.choose}</option>
              {column.options.map((option) => <option key={option.value} value={option.value}>{pick(option.label, lang)}</option>)}
            </select>
          ) : (
            <input
              key={cellIndex}
              type="text"
              /* Plain text, not a date control, even in a column headed "By":
                 a milestone is as often "before the clinic reopens" as it is a
                 calendar day, and the templates already print a real date where
                 they are given one and the words where they are not. */
              value={row[cellIndex]}
              aria-label={`${label} — ${pick(column, lang)} — ${rowIndex + 1}`}
              onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
            />
          ))}
          <span className="pw-row-tools">
            <button type="button" title={words.up} aria-label={`${words.up} — ${rowIndex + 1}`} disabled={rowIndex === 0} onClick={() => move(rowIndex, rowIndex - 1)}><ChevronUp size={13} /></button>
            <button type="button" title={words.down} aria-label={`${words.down} — ${rowIndex + 1}`} disabled={rowIndex === rows.length - 1} onClick={() => move(rowIndex, rowIndex + 1)}><ChevronDown size={13} /></button>
            <button type="button" className="is-danger" title={words.drop} aria-label={`${words.drop} — ${rowIndex + 1}`} onClick={() => write(rows.filter((_, index) => index !== rowIndex))}><X size={13} /></button>
          </span>
        </div>
      ))}
      {!rows.length ? <p className="pw-list-empty">{words.empty}</p> : null}
      <button type="button" className="pw-list-add" onClick={() => write([...rows, columns.map(() => "")])}>
        <Plus size={13} /> {words.add}
      </button>
    </div>
  );
}

/**
 * One answer. The control follows the field kind; everything else — the label,
 * the required mark, the hint — is the same for all of them, so a template can
 * add a question without anyone deciding again what a question looks like.
 */
export function PaperworkField({ field, lang, value, missing = false, onChange }) {
  const words = WORDS[lang];
  const id = `pw-field-${field.id}`;
  const hint = pick(field.hint, lang);
  const label = pick(field.label, lang);
  const common = {
    id,
    value: value === undefined || value === null ? "" : String(value),
    onChange: (event) => onChange(field.id, event.target.value)
  };

  return (
    <div className={`pw-field pw-field--${field.kind}${missing ? " is-missing" : ""}`}>
      {/* A repeating list is a group of inputs, not one control, so it gets a
          heading rather than a label pointing at nothing — every cell carries
          its own accessible name instead. */}
      {field.kind === "list" ? (
        <span className="pw-field-label">
          <span dir="auto">{label}</span>
          {field.required ? <i>{words.required}</i> : null}
        </span>
      ) : (
        <label htmlFor={id} className="pw-field-label">
          <span dir="auto">{label}</span>
          {field.required ? <i>{words.required}</i> : null}
        </label>
      )}
      {hint ? <em className="pw-field-hint" dir="auto">{hint}</em> : null}
      {field.kind === "long" ? <textarea {...common} rows={5} dir="auto" /> : null}
      {field.kind === "text" ? <input {...common} type="text" dir="auto" /> : null}
      {field.kind === "date" ? <input {...common} type="date" dir="ltr" /> : null}
      {field.kind === "money" ? <input {...common} type="text" inputMode="decimal" dir="ltr" /> : null}
      {field.kind === "choice" ? (
        <select {...common}>
          <option value="">{words.choose}</option>
          {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : null}
      {field.kind === "list" ? <ListField field={field} lang={lang} value={value} onChange={onChange} /> : null}
    </div>
  );
}

/** Whether a field counts as answered, for the "still blank" count in the editor. */
export function isAnswered(field, value) {
  if (field.kind === "list") return rowsOf(value, (field.columns || []).length).some((row) => row.some((cell) => cell.trim()));
  return Boolean(String(value ?? "").trim());
}
