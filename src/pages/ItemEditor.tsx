import { useEffect, useState } from "react";
import Header from "../components/Header";
import Thumb from "../components/Thumb";
import CategoryPicker from "../components/CategoryPicker";
import {
  getSettings, analyzeItem, deleteItem, deletePhoto, getItem, listItems, makeWhite, mergeInto, priceCheck, rememberCategory,
  updateItem, updatePhoto,
} from "../lib/api";
import { go } from "../lib/router";
import type { Item, ItemStatus, Photo } from "../lib/types";
import { CONDITIONS, DESCRIPTION_MAX, SHIPPING_SIZES, TITLE_MAX } from "../../supabase/functions/_shared/limits";
import { ideasOf, type PriceIdea } from "../../supabase/functions/_shared/ideas";
import { fixTitleCase } from "../../supabase/functions/_shared/titlecase";
import { tmSummary } from "../lib/trademe";
import { priceSearchLinks } from "../lib/searchLinks";
import type { TmOptions } from "../lib/types";

/** Edit one listing. In review mode, "Approve & next" walks through every draft in the batch. */
export default function ItemEditor({ itemId, review = false }: { itemId: string; review?: boolean }) {
  const [item, setItem] = useState<Item | null>(null);
  const [draft, setDraft] = useState<Item | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(true);
  const [left, setLeft] = useState<number | null>(null);
  const [tm, setTm] = useState<TmOptions | null>(null);
  const [whiteMethod, setWhiteMethod] = useState<"brighten" | "cutout">("brighten");
  useEffect(() => { getSettings().then((x) => { setTm(x.prefs.tm); setWhiteMethod(x.prefs.whiteMethod); }).catch(() => {}); }, []);

  const load = async () => {
    const it = await getItem(itemId);
    setItem(it);
    setDraft(it);
    setSaved(true);
    if (review) {
      const all = await listItems(it.batch_id);
      setLeft(all.filter((i) => i.status === "draft").length);
    }
  };
  useEffect(() => { load().catch((e) => setError(e.message)); }, [itemId]);

  // Desktop shortcut: Ctrl/Cmd + Enter = approve (& next in review mode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (draft && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); approve().catch(() => {}); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!draft || !item) return <main className="page"><p className="muted">{error || "Loading…"}</p></main>;

  const set = <K extends keyof Item>(k: K, v: Item[K]) => { setDraft({ ...draft, [k]: v }); setSaved(false); };

  async function save(extra: Partial<Item> = {}) {
    const d = { ...draft!, ...extra };
    setBusy("Saving…");
    try {
      await updateItem(d.id, {
        title: d.title, subtitle: d.subtitle, description: d.description, category_path: d.category_path,
        condition: d.condition, start_price: d.start_price, buy_now_price: d.buy_now_price,
        shipping_size: d.shipping_size, attributes: d.attributes, status: d.status, hint: d.hint,
        tm_category: d.tm_category,
      });
      if (d.tm_category && d.tm_category !== item!.tm_category) await rememberCategory(d.category_path, d.tm_category);
      setDraft(d);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy("");
    }
  }

  async function nextDraft(): Promise<string | null> {
    const all = await listItems(draft!.batch_id);
    const idx = all.findIndex((i) => i.id === draft!.id);
    const after = [...all.slice(idx + 1), ...all.slice(0, idx)];
    return after.find((i) => i.status === "draft")?.id ?? null;
  }

  async function approve() {
    if (busy) return;
    if (!draft!.title.trim()) return setError("Add a title first.");
    if (!draft!.start_price || draft!.start_price < 0.5) return setError("Type a start price first (at least $0.50) – see the price ideas.");
    if (draft!.buy_now_price !== null && draft!.buy_now_price < draft!.start_price) return setError("Buy Now must be at least the start price.");
    await save({ status: "ready" });
    if (review) {
      const next = await nextDraft();
      go(next ? `#/i/${next}/review` : `#/b/${draft!.batch_id}`);
    }
  }

  async function skip() {
    const next = await nextDraft();
    go(next ? `#/i/${next}/review` : `#/b/${draft!.batch_id}`);
  }

  async function setStatus(status: ItemStatus) {
    await save({ status });
  }

  async function rerun() {
    setBusy("AI is writing…");
    setError("");
    try {
      await save();
      await analyzeItem(draft!);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function checkPrice() {
    setBusy("Checking prices online…");
    setError("");
    try {
      if (!saved) await save();
      const r = await priceCheck(draft!);
      const fresh = await getItem(itemId);
      setItem(fresh);
      void r;
      setDraft({ ...draft!, price_check: fresh.price_check, price_checked_at: fresh.price_checked_at });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function useIdea(idea: PriceIdea) {
    setDraft({ ...draft!, start_price: idea.start, buy_now_price: idea.buy_now });
    setSaved(false);
  }

  async function mergePrev() {
    const items = await listItems(draft!.batch_id);
    const idx = items.findIndex((i) => i.id === draft!.id);
    if (idx <= 0) return setError("This is the first item.");
    if (!confirm("Move these photos onto the previous item and delete this one?")) return;
    await mergeInto(items[idx - 1], items[idx]);
    go(`#/i/${items[idx - 1].id}`);
  }

  async function removeItem() {
    if (!confirm("Delete this item and its photos?")) return;
    await deleteItem(item!);
    go(`#/b/${item!.batch_id}`);
  }

  async function photoAction(p: Photo, action: "rotate" | "crop" | "delete" | "first" | "white" | "makeWhite") {
    if (action === "rotate") await updatePhoto(p.id, { rotation: ((p.rotation + 90) % 360) as Photo["rotation"] });
    if (action === "crop") await updatePhoto(p.id, { crop: null });
    if (action === "white") await updatePhoto(p.id, { use_white: !p.use_white });
    if (action === "makeWhite") {
      setBusy("Whitening background…");
      try {
        const r = await makeWhite(p, whiteMethod);
        if (r !== true) setError(r);
      } finally {
        setBusy("");
      }
    }
    if (action === "first") {
      const others = draft!.photos.filter((x) => x.id !== p.id);
      await Promise.all([p, ...others].map((x, i) => updatePhoto(x.id, { position: i })));
    }
    if (action === "delete") {
      if (!confirm("Delete this photo?")) return;
      await deletePhoto(p);
    }
    const fresh = await getItem(itemId);
    setItem(fresh);
    setDraft({ ...draft!, photos: fresh.photos });
  }

  const isRegion = (name: string) => /^region$/i.test(name.trim());
  const region = draft.attributes.find((a) => isRegion(a.name))?.value ?? "";
  const setRegion = (value: string) => {
    const rest = draft.attributes.filter((a) => !isRegion(a.name));
    set("attributes", value.trim() || value ? [{ name: "Region", value }, ...rest] : rest);
  };
  const ideas = ideasOf(draft.price_check);
  const money = (n: number | null) => (n === null ? "?" : `$${Number(n).toFixed(n % 1 ? 2 : 0)}`);
  return (
    <>
      <Header back={`#/b/${draft.batch_id}`} title={review ? `Review${left !== null ? ` · ${left} left` : ""}` : "Edit item"} right={
        <button className="link" disabled={saved || !!busy} onClick={() => save()}>{saved ? "Saved" : "Save"}</button>
      } />
      <main className="page editor">
        <div className="editor-photos">
          <div className="photos">
            {draft.photos.map((p, i) => (
              <figure key={p.id}>
                <Thumb photo={p} />
                <figcaption className="row wrap small">
                  <button className="link" title="Rotate" onClick={() => photoAction(p, "rotate")}>↻</button>
                  {i > 0 && <button className="link" onClick={() => photoAction(p, "first")}>Main</button>}
                  {p.bg_status === "done"
                    ? <button className="link" onClick={() => photoAction(p, "white")}>{p.use_white ? "Original" : "White bg"}</button>
                    : <button className="link" onClick={() => photoAction(p, "makeWhite")}>{p.bg_status === "failed" ? "Retry white" : "White bg"}</button>}
                  {p.crop && !(p.use_white && p.bg_status === "done") && <button className="link" title="AI suggested a crop; tap to use the full photo" onClick={() => photoAction(p, "crop")}>Uncrop</button>}
                  <button className="link danger" title="Delete photo" onClick={() => photoAction(p, "delete")}>✕</button>
                </figcaption>
              </figure>
            ))}
          </div>

          {draft.needs_check.length > 0 && (
            <div className="card warn-box">
              <b>Please check</b>
              <ul>{draft.needs_check.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
        </div>

        <div className="editor-form stack">
          {draft.ai_error && <p className="error">{draft.ai_error}</p>}
          {draft.ai_provider && <p className="muted small">Written by {draft.ai_provider === "gemini" ? "Gemini" : "Claude"}</p>}
          {error && <p className="error">{error}</p>}
          {busy && <p className="muted">{busy}</p>}

          <div className="card stack">
            <label>Title <span className="muted small">{draft.title.length}/{TITLE_MAX}</span>
              {fixTitleCase(draft.title) !== draft.title && (
                <button className="link small" onClick={(e) => { e.preventDefault(); set("title", fixTitleCase(draft.title)); }}>Fix capitals</button>
              )}
              <input value={draft.title} maxLength={TITLE_MAX} onChange={(e) => set("title", e.target.value)} />
            </label>
            <label>Description
              <textarea rows={7} value={draft.description} maxLength={DESCRIPTION_MAX} onChange={(e) => set("description", e.target.value)} />
            </label>
            <div className="row wrap">
              <label className="grow">Category (AI suggestion)
                <input value={draft.category_path} maxLength={200} onChange={(e) => set("category_path", e.target.value)} />
              </label>
            </div>
            <label>Region <span className="muted small">DVD / Blu-ray / games – e.g. Region 4, Region B, PAL. Leave blank for other items.</span>
              <input value={region} maxLength={40} placeholder="e.g. Region 4" onChange={(e) => setRegion(e.target.value)} />
            </label>
            <div className="stack">
              <span>Trade Me category</span>
              <CategoryPicker item={draft} value={draft.tm_category} onChange={(code) => set("tm_category", code)} />
            </div>
            <div className="row wrap">
              <label className="grow">Condition
                <select value={draft.condition} onChange={(e) => set("condition", e.target.value as Item["condition"])}>
                  {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="grow">Shipping
                <select value={draft.shipping_size} onChange={(e) => set("shipping_size", e.target.value)}>
                  {SHIPPING_SIZES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="row wrap">
              <label className="grow">Start price $
                <input type="number" inputMode="decimal" min={0} step="0.5" value={draft.start_price ?? ""}
                  onChange={(e) => set("start_price", e.target.value === "" ? null : Number(e.target.value))} />
              </label>
              <label className="grow">Buy Now $
                <input type="number" inputMode="decimal" min={0} step="0.5" value={draft.buy_now_price ?? ""}
                  onChange={(e) => set("buy_now_price", e.target.value === "" ? null : Number(e.target.value))} />
              </label>
            </div>
            <div className="card small stack price-box">
              <b>Price ideas</b>
              {priceSearchLinks(draft).length > 0 && (
                <div className="stack">
                  <span className="muted">Look it up (opens in a new tab), then type your price:</span>
                  <div className="row wrap search-links">
                    {priceSearchLinks(draft).map((l) => (
                      <a key={l.label} className="button small" href={l.url} target="_blank" rel="noopener noreferrer nofollow" title={l.hint}>{l.label} ↗</a>
                    ))}
                  </div>
                </div>
              )}
              {ideas.map((idea) => (
                <div key={idea.kind} className="stack">
                  <span>
                    <b>{idea.source}:</b>{" "}
                    {idea.typical || idea.low ? <>typically {money(idea.typical)}{idea.low && idea.high ? ` (range ${money(idea.low)}–${money(idea.high)})` : ""} · </> : null}
                    start {money(idea.start)}{idea.buy_now ? `, Buy Now ${money(idea.buy_now)}` : ""}
                    {" "}<button className="link" onClick={() => useIdea(idea)}>Use</button>
                  </span>
                  {idea.note && <span className="muted">{idea.note}</span>}
                  {idea.links.length > 0 && (
                    <span className="muted">From: {idea.links.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noopener noreferrer nofollow">{l.title || "link"}{i < idea.links.length - 1 ? ", " : ""}</a>
                    ))}</span>
                  )}
                </div>
              ))}
              {!ideas.length && draft.price_reasoning && <span className="muted">AI note: {draft.price_reasoning}</span>}
              {!ideas.length && !draft.price_reasoning && <span className="muted">No price ideas yet.</span>}
              <span className="muted">These are only ideas – type your own price above.</span>
              <button className="button small" disabled={!!busy || !draft.title} onClick={checkPrice}>
                🔎 {ideas.some((i) => i.kind !== "ai") ? "Check prices again" : "Check Trade Me prices"}
              </button>
            </div>

            {tm && (
              <p className="small">Trade Me options: <b>{tmSummary(tm)}</b> <a href="#/settings">Change</a></p>
            )}

            <b>Details</b>
            {draft.attributes.map((a, i) => isRegion(a.name) ? null : (
              <div key={i} className="row">
                <input style={{ flex: "0 0 35%" }} value={a.name} maxLength={40} onChange={(e) => set("attributes", draft.attributes.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className="grow" value={a.value} maxLength={120} onChange={(e) => set("attributes", draft.attributes.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                <button className="link danger" onClick={() => set("attributes", draft.attributes.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="link" onClick={() => set("attributes", [...draft.attributes, { name: "", value: "" }])}>+ Add detail</button>
          </div>

          <div className="card stack">
            <label>Note for the AI (optional, e.g. "works, remote included")
              <input value={draft.hint} maxLength={300} onChange={(e) => set("hint", e.target.value)} />
            </label>
            <button className="button" disabled={!!busy || !draft.photos.length} onClick={rerun}>✨ Re-write with AI</button>
          </div>

          <div className="row wrap sticky-actions">
            {review ? (
              <>
                <button className="button" onClick={skip}>Skip</button>
                <button className="button primary grow" disabled={!!busy} onClick={() => approve().catch(() => {})} title="Ctrl/Cmd + Enter">✓ Approve &amp; next ›</button>
              </>
            ) : (
              <>
                {draft.status !== "ready" && <button className="button primary grow" disabled={!!busy} onClick={() => approve().catch(() => {})} title="Ctrl/Cmd + Enter">✓ Approve</button>}
                {draft.status === "ready" && <button className="button grow" onClick={() => setStatus("draft")}>Back to draft</button>}
                {draft.status !== "listed" && <button className="button" onClick={() => setStatus("listed")}>Listed</button>}
                {draft.status !== "sold" && <button className="button" onClick={() => setStatus("sold")}>Sold</button>}
              </>
            )}
          </div>
          <div className="row wrap">
            <button className="link" onClick={mergePrev}>Merge into previous item</button>
            <button className="link danger" onClick={removeItem}>Delete item</button>
          </div>
        </div>
      </main>
    </>
  );
}
