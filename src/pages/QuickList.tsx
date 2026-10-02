import { useEffect, useState } from "react";
import Header from "../components/Header";
import Thumb from "../components/Thumb";
import { listItems, renderPhoto, updateItem } from "../lib/api";
import { fullDescription } from "../lib/csv";
import type { Item } from "../lib/types";

const SELL_URL = "https://www.trademe.co.nz/a/sell";

/** One item at a time: copy each field, grab the photos, list on Trade Me, mark done, next. */
export default function QuickList({ batchId }: { batchId?: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { listItems(batchId).then(setItems).catch((e) => setMsg(e.message)); }, [batchId]);

  const queue = (items ?? []).filter((i) => i.status === "ready" || (includeDrafts && i.status === "draft"));
  const item = queue[Math.min(idx, queue.length - 1)];

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setMsg("Copy blocked by the browser - long-press the text instead.");
    }
  }

  async function photos() {
    if (!item) return;
    setMsg("Preparing photos…");
    try {
      const files = await Promise.all(item.photos.map(async (p, i) => {
        const blob = await renderPhoto(p);
        return new File([blob], `${item.title.slice(0, 40).replace(/[^\w-]+/g, "_") || "item"}_${i + 1}.jpg`, { type: "image/jpeg" });
      }));
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files }); // phone: "Save images" or share straight to the Trade Me app
      } else {
        for (const f of files) {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(f);
          a.download = f.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }
      }
      setMsg("");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg((e as Error).message);
      else setMsg("");
    }
  }

  async function markListed() {
    if (!item) return;
    await updateItem(item.id, { status: "listed" });
    setItems((list) => list!.map((i) => (i.id === item.id ? { ...i, status: "listed" } : i)));
  }

  const Copy = ({ label, text }: { label: string; text: string }) => (
    <div className="copy">
      <div className="row"><b className="grow">{label}</b>
        <button className="button small" onClick={() => copy(label, text)} disabled={!text}>{copied === label ? "Copied ✓" : "Copy"}</button>
      </div>
      <p className="copy-text">{text || <span className="muted">—</span>}</p>
    </div>
  );

  return (
    <>
      <Header back={batchId ? `#/b/${batchId}` : "#/"} title="Copy-paste mode" right={queue.length ? <span className="badge">{Math.min(idx, queue.length - 1) + 1}/{queue.length}</span> : null} />
      <main className="page">
        <label className="row small">
          <input type="checkbox" checked={includeDrafts} onChange={(e) => { setIncludeDrafts(e.target.checked); setIdx(0); }} />
          Include drafts (not only items marked Ready)
        </label>
        {msg && <p className="muted">{msg}</p>}
        {items === null ? <p className="muted">Loading…</p> : !item ? (
          <p className="muted center">Nothing to list. Mark items as “Ready to list” first{includeDrafts ? "" : ", or include drafts"}.</p>
        ) : (
          <div className="stack">
            <div className="photos">{item.photos.map((p) => <Thumb key={p.id} photo={p} />)}</div>
            <div className="row wrap">
              <button className="button grow" onClick={photos}>📷 Save / share photos</button>
              <a className="button primary grow" href={SELL_URL} target="_blank" rel="noopener noreferrer">Open Trade Me ↗</a>
            </div>
            <div className="card stack">
              <Copy label="Title" text={item.title} />
              {item.subtitle && <Copy label="Subtitle" text={item.subtitle} />}
              <Copy label="Description" text={fullDescription(item)} />
              <Copy label="Category" text={item.category_path} />
              <div className="row wrap">
                <Copy label="Start $" text={item.start_price != null ? String(item.start_price) : ""} />
                <Copy label="Buy Now $" text={item.buy_now_price != null ? String(item.buy_now_price) : ""} />
              </div>
              <p className="muted small">Condition: {item.condition} · {item.shipping_size}{item.weight_kg ? ` · ~${item.weight_kg} kg` : ""}</p>
            </div>
            <div className="row wrap sticky-actions">
              <button className="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>‹ Prev</button>
              <button className="button primary grow" onClick={async () => { await markListed(); setIdx(Math.min(idx, queue.length - 2)); }}>
                Mark listed &amp; next ›
              </button>
              <button className="button" disabled={idx >= queue.length - 1} onClick={() => setIdx(idx + 1)}>Skip ›</button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
