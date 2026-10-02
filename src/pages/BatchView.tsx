import { useCallback, useEffect, useRef, useState } from "react";
import Header from "../components/Header";
import Thumb from "../components/Thumb";
import {
  analyzeItem, deleteBatch, getItem, getSettings, listBatches, listItems, makeWhite, pollEconomy, priceCheck, queueForEconomy, submitEconomy, updateItem,
} from "../lib/api";
import { itemsToCsv } from "../lib/csv";
import { DEFAULT_PREFS, type Item, type Photo, type Prefs } from "../lib/types";
import { aiStart, ideasOf } from "../../supabase/functions/_shared/ideas";
import { supabase } from "../lib/supabase";

const AI_CONCURRENCY = 3;
const PRICE_CONCURRENCY = 2;
const STALE_MS = 3 * 60_000;

type Filter = "all" | "review" | "ready" | "listed";

const dateName = (d: Date) => d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
/** "Today" / "Yesterday" for the automatic day groups; other (older, named) groups keep their name. */
function groupLabel(name: string): string {
  const now = new Date();
  if (name === dateName(now)) return "Today";
  if (name === dateName(new Date(now.getTime() - 86_400_000))) return "Yesterday";
  return name;
}

function needsAi(i: Item): boolean {
  if (!i.photos.length) return false;
  if (i.ai_status === "pending") return true;
  return i.ai_status === "processing" && Date.now() - new Date(i.ai_updated_at ?? 0).getTime() > STALE_MS;
}

function needsWhite(p: Photo, prefs: Prefs): boolean {
  return p.bg_status === "none" && (prefs.whiteBg === "all" || (prefs.whiteBg === "main" && p.position === 0));
}

function needsPrice(i: Item, prefs: Prefs): boolean {
  return prefs.autoPriceCheck && i.ai_status === "done" && i.status === "draft" && !i.price_checked_at
    && (aiStart(i.price_check) ?? i.start_price ?? 0) >= prefs.priceCheckMin;
}

/**
 * Home screen: all your items (or one photo group, for old "#/b/<id>" links), grouped by the day they were photographed.
 * While open it also runs the background work: AI writing, price checks and white backgrounds.
 */
export default function BatchView({ batchId, userId }: { batchId?: string; userId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [whiteBusy, setWhiteBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [groups, setGroups] = useState<Map<string, string>>(new Map()); // photo group id -> name
  const itemsRef = useRef<Item[]>([]);
  const inFlight = useRef(new Set<string>());
  const priceFlight = useRef(new Set<string>());
  const whiteFlight = useRef(false);
  const failed = useRef(new Set<string>()); // item/photo ids that failed this session: don't loop on them
  const econOff = useRef(false); // server said economy isn't possible right now -> write instantly
  const lastSubmit = useRef(0);
  const [notice, setNotice] = useState("");

  const setAll = (list: Item[]) => { itemsRef.current = list; setItems(list); };
  const refresh = async (id: string) => {
    try {
      const it = await getItem(id);
      setAll(itemsRef.current.map((x) => (x.id === it.id ? it : x)));
    } catch { /* ignore */ }
  };

  const loadAll = async () => {
    const [list, batches] = await Promise.all([listItems(batchId), listBatches()]);
    setGroups(new Map(batches.map((b) => [b.id, b.name])));
    setAll(list);
  };
  useEffect(() => {
    loadAll().catch((e) => setError(e.message));
    getSettings().then((s) => setPrefs(s.prefs)).catch(() => {});
  }, [batchId]);

  async function removeGroup(id: string, label: string) {
    const count = itemsRef.current.filter((x) => x.batch_id === id).length;
    if (!confirm(`Delete "${label}" – ${count} item${count === 1 ? "" : "s"} and their photos? This can't be undone.`)) return;
    try {
      await deleteBatch(id);
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const pump = useCallback(() => {
    if (paused) return;
    const list = itemsRef.current;

    // 1. AI writes listings - economy (half-price batch) or instant
    const economy = prefs.economy && prefs.aiProvider === "claude" && !econOff.current;
    const queue = list.filter((i) => needsAi(i) && !inFlight.current.has(i.id) && !failed.current.has(i.id));
    while (inFlight.current.size < AI_CONCURRENCY && queue.length) {
      const item = queue.shift()!;
      inFlight.current.add(item.id);
      setRunning(new Set(inFlight.current));
      (economy ? queueForEconomy(userId, item) : analyzeItem(item))
        .catch((e: Error) => {
          failed.current.add(item.id);
          if (/limit/i.test(e.message)) { setPaused(true); setError(e.message); }
        })
        .finally(async () => {
          inFlight.current.delete(item.id);
          setRunning(new Set(inFlight.current));
          await refresh(item.id);
        });
    }

    // Once every item is prepared, send all queued items as one batch (at most once a minute).
    if (inFlight.current.size === 0 && list.some((i) => i.ai_status === "queued") && Date.now() - lastSubmit.current > 60_000) {
      lastSubmit.current = Date.now();
      submitEconomy()
        .then((r) => {
          if (r.instant) {
            econOff.current = true;
            lastSubmit.current = 0;
            setNotice(`Economy mode unavailable (${r.reason}) - writing instantly instead.`);
          }
        })
        .catch((e: Error) => setError(e.message))
        .finally(async () => { try { await loadAll(); } catch { /* ignore */ } });
    }

    // 2. Online price checks (cheap, only for items worth it)
    const pq = list.filter((i) => needsPrice(i, prefs) && !priceFlight.current.has(i.id) && !failed.current.has(`p${i.id}`));
    while (priceFlight.current.size < PRICE_CONCURRENCY && pq.length) {
      const item = pq.shift()!;
      priceFlight.current.add(item.id);
      priceCheck(item)
        .catch((e: Error) => {
          failed.current.add(`p${item.id}`);
          if (/limit/i.test(e.message)) { setPaused(true); setError(e.message); }
        })
        .finally(async () => { priceFlight.current.delete(item.id); await refresh(item.id); });
    }

    // 3. White backgrounds, one photo at a time on this device
    if (!whiteFlight.current && prefs.whiteBg !== "off") {
      for (const item of list) {
        const photo = item.photos.find((p) => needsWhite(p, prefs) && !failed.current.has(p.id));
        if (!photo) continue;
        whiteFlight.current = true;
        setWhiteBusy(true);
        makeWhite(photo, prefs.whiteMethod)
          .catch(() => failed.current.add(photo.id))
          .finally(async () => { whiteFlight.current = false; setWhiteBusy(false); await refresh(item.id); });
        break;
      }
    }
  }, [paused, prefs]);

  useEffect(() => { pump(); }, [items, pump]);

  // Economy results: check every 45 s while this page is open (they're also collected next time you open it).
  const waitingOnBatch = (items ?? []).some((i) => i.ai_status === "batched");
  useEffect(() => {
    if (!waitingOnBatch) return;
    const poll = () => pollEconomy()
      .then(async (r) => { if (r.saved > 0) await loadAll(); })
      .catch(() => {});
    poll();
    const t = setInterval(poll, 45_000);
    return () => clearInterval(t);
  }, [waitingOnBatch, batchId]);

  async function retry(item: Item) {
    failed.current.delete(item.id);
    await updateItem(item.id, { ai_status: "pending" });
    setAll(itemsRef.current.map((x) => (x.id === item.id ? { ...x, ai_status: "pending", ai_error: null } : x)));
  }

  function exportCsv() {
    const blob = new Blob(["﻿" + itemsToCsv(items ?? [])], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "klicklist.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const list = items ?? [];
  const done = list.filter((i) => i.ai_status === "done").length;
  const waiting = list.filter((i) => needsAi(i)).length;
  const inBatch = list.filter((i) => i.ai_status === "queued" || i.ai_status === "batched").length;
  const whiteLeft = prefs.whiteBg === "off" ? 0
    : list.reduce((n, i) => n + i.photos.filter((p) => needsWhite(p, prefs) && !failed.current.has(p.id)).length, 0);
  const priceLeft = list.filter((i) => needsPrice(i, prefs) && !failed.current.has(`p${i.id}`)).length;
  const drafts = list.filter((i) => i.status === "draft" && i.ai_status === "done");
  const approved = list.filter((i) => i.status === "ready").length;
  const shown = list.filter((i) =>
    filter === "all" ? true
      : filter === "review" ? i.status === "draft"
      : filter === "ready" ? i.status === "ready"
      : i.status === "listed" || i.status === "sold");
  // Day groups, newest first (items arrive newest first); items in the order they were photographed.
  const grouped: { id: string; items: Item[] }[] = [];
  for (const i of shown) {
    const g = grouped.find((x) => x.id === i.batch_id);
    if (g) g.items.push(i); else grouped.push({ id: i.batch_id, items: [i] });
  }
  for (const g of grouped) g.items.sort((a, b) => a.position - b.position);
  const base = batchId ? `#/b/${batchId}` : "#";
  const busyAnything = waiting > 0 || whiteLeft > 0 || priceLeft > 0;

  return (
    <>
      <Header back={batchId ? "#/" : undefined} title={batchId ? groupLabel(groups.get(batchId) ?? "Items") : "Your items"} right={
        batchId ? null : <><a className="link" href="#/settings">Settings</a><button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button></>
      } />
      <main className="page">
        <a className="button primary wide" href={`${base}/capture`}>📷 New listing</a>
        <div className="card stack">
          <div className="row wrap">
            <span className="grow">
              AI: <b>{done}</b>/{list.length} written
              {waiting > 0 && !paused && <span className="muted"> · {running.size} working, {waiting} waiting</span>}
            </span>
            {busyAnything && (
              <button className="link" onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
            )}
          </div>
          {list.length > 0 && <progress max={list.length} value={done} />}
          {inBatch > 0 && (
            <span className="muted small">
              💰 Economy: {inBatch} item{inBatch > 1 ? "s" : ""} being written at half price – usually ready within minutes
              (up to an hour or so). You can close the app; results are collected next time.
            </span>
          )}
          {notice && <span className="muted small">{notice}</span>}
          {(whiteLeft > 0 || priceLeft > 0) && !paused && (
            <span className="muted small">
              {whiteLeft > 0 && <>⬜ White backgrounds: {whiteLeft} to go{whiteBusy ? "…" : ""} (keep this page open) </>}
              {priceLeft > 0 && <>· 🔎 Price checks: {priceLeft} to go</>}
            </span>
          )}
          <div className="row wrap">
            <button className="button primary grow" disabled={!drafts.length} onClick={() => { location.hash = `#/i/${drafts[0].id}/review`; }}>
              ✓ Review &amp; approve ({drafts.length})
            </button>
            <a className={`button grow ${approved ? "primary" : ""}`} href={`${base}/export`}>⬆ Upload to Trade Me ({approved})</a>
          </div>
          <div className="row wrap small">
            <a className="link" href={`${base}/list`}>Copy-paste mode</a>
            <button className="link" onClick={exportCsv} disabled={!list.length}>Summary list (not for Trade Me)</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}

        <div className="tabs">
          {(["all", "review", "ready", "listed"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {{ all: "All", review: "To review", ready: "Ready to upload", listed: "Listed" }[f]}
            </button>
          ))}
        </div>

        {items === null ? <p className="muted">Loading…</p> : shown.length === 0 ? (
          <p className="muted center">{list.length ? "Nothing here." : "No items yet – tap 📷 New listing to start."}</p>
        ) : grouped.map((g) => (
          <section key={g.id} className="stack">
            {!batchId && (
              <div className="row group-head">
                <b className="grow">{groupLabel(groups.get(g.id) ?? "Earlier")} <span className="muted small">· {g.items.length}</span></b>
                <button className="link danger small" onClick={() => removeGroup(g.id, groupLabel(groups.get(g.id) ?? "Earlier"))}>Delete day</button>
              </div>
            )}
          <ul className="grid">
            {g.items.map((i) => (
              <li key={i.id} className="card tile">
                <a href={`#/i/${i.id}`}>
                  <Thumb photo={i.photos[0]} />
                  <div className="tile-body">
                    <b className="clamp">{i.title || (running.has(i.id) ? "Preparing…" : i.ai_status === "batched" || i.ai_status === "queued" ? "💰 In economy batch" : i.photos.length ? "Waiting for AI" : "No photos")}</b>
                    <span className="row small wrap">
                      {i.start_price != null ? <span>${Number(i.start_price).toFixed(0)}</span>
                        : i.ai_status === "done" && <span className="muted">price?</span>}
                      <span className={`pill ${i.status}`}>{i.status === "ready" ? "approved" : i.status}</span>
                      {i.needs_check.length > 0 && i.status === "draft" && <span className="pill warn">check</span>}
                      {ideasOf(i.price_check).some((x) => x.kind !== "ai") && <span className="pill" title="Price checked">🔎</span>}
                    </span>
                  </div>
                </a>
                {i.ai_status === "failed" && (
                  <div className="tile-err">
                    <span className="small">{i.ai_error}</span>
                    <button className="link" onClick={() => retry(i)}>Retry</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          </section>
        ))}
      </main>
    </>
  );
}
