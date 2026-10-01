import { useEffect, useState } from "react";
import {
  categoryById, loadCategories, searchCategories, showPath, suggestCategories, type TmCategory,
} from "../lib/categories";
import type { Item } from "../lib/types";

type ItemLike = Pick<Item, "title" | "category_path" | "attributes">;

/** Trade Me category: picked automatically, change it by searching or from the best matches. */
export default function CategoryPicker({ item, value, onChange }: {
  item: ItemLike; value: string; onChange: (code: string) => void;
}) {
  const [cats, setCats] = useState<TmCategory[] | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => { loadCategories().then(setCats).catch(() => setCats([])); }, []);

  if (!cats) return <span className="muted small">Loading categories…</span>;
  const chosen = value ? categoryById(cats, value) : undefined;
  const auto = chosen ? undefined : suggestCategories(item, cats, 1)[0];
  const shown = chosen ?? auto;
  const options = q.trim() ? searchCategories(q, cats) : suggestCategories(item, cats, 6);

  return (
    <div className="stack cat-picker">
      <span className="small">
        {shown ? <><b>{showPath(shown[1])}</b> <span className="muted">#{shown[0]}{auto ? " · picked automatically" : ""}</span></>
          : value ? <><b>#{value}</b> <span className="muted">(not in Trade Me's list – check it)</span></>
          : <span className="muted">No match yet – search below</span>}
        {" "}<button className="link" onClick={() => setOpen(!open)}>{open ? "Close" : "Change"}</button>
      </span>
      {open && (
        <>
          <input placeholder="Search Trade Me categories, e.g. dvd comedy" value={q} onChange={(e) => setQ(e.target.value)} />
          {options.map((c) => (
            <button key={c[0]} className="link small" style={{ textAlign: "left" }}
              onClick={() => { onChange(String(c[0])); setOpen(false); setQ(""); }}>
              {showPath(c[1])} <span className="muted">#{c[0]}</span>
            </button>
          ))}
          {!options.length && <span className="muted small">No categories match.</span>}
        </>
      )}
    </div>
  );
}
