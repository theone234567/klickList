import { useEffect, useState } from "react";
import { zipSync } from "fflate";
import Header from "../components/Header";
import { exportPhotoLinks, getSettings, listItems, markExported, rememberCategory, renderPhoto, updateItem } from "../lib/api";
import { buildTradeMeCsv, skuFor, TM_TITLE_MAX } from "../lib/trademe";
import { loadCategories, type TmCategory } from "../lib/categories";
import CategoryPicker from "../components/CategoryPicker";
import type { Item, Settings } from "../lib/types";

type PhotoMode = "links" | "zip";

function download(data: BlobPart, name: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function ExportPage({ batchId, userId }: { batchId: string; userId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<PhotoMode>("links");
  const [progress, setProgress] = useState("");
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [cats, setCats] = useState<TmCategory[]>([]);
  const [showCats, setShowCats] = useState(false);

  useEffect(() => { loadCategories().then(setCats).catch(() => {}); }, []);
  useEffect(() => {
    Promise.all([listItems(batchId), getSettings()])
      .then(([i, s]) => { setItems(i); setSettings(s); })
      .catch((e) => setError(e.message));
  }, [batchId]);

  if (!items || !settings) return <main className="page"><p className="muted">{error || "Loading…"}</p></main>;

  const approved = items.filter((i) => i.status === "ready");
  const noPrice = approved.filter((i) => !i.start_price);
  const longTitles = approved.filter((i) => i.title.length > TM_TITLE_MAX);

  async function setCategory(item: Item, code: string) {
    const clean = code.replace(/[^\w\-./ ]/g, "").slice(0, 60);
    await updateItem(item.id, { tm_category: clean });
    await rememberCategory(item.category_path, clean);
    setItems((list) => list!.map((x) => (x.id === item.id ? { ...x, tm_category: clean } : x)));
    setSettings((s) => s && ({ ...s, category_map: { ...s.category_map, [item.category_path]: clean } }));
  }

  async function run() {
    setError("");
    setDone(null);
    try {
      const photoLists = new Map<string, string[]>();
      const files: Record<string, Uint8Array> = {};
      for (const [n, item] of approved.entries()) {
        setProgress(`Preparing photos ${n + 1}/${approved.length}…`);
        if (mode === "links") {
          photoLists.set(item.id, await exportPhotoLinks(userId, item));
        } else {
          const names: string[] = [];
          for (const [k, p] of item.photos.slice(0, 20).entries()) {
            const name = `${skuFor(item)}-${k + 1}.jpg`;
            files[`photos/${name}`] = new Uint8Array(await (await renderPhoto(p)).arrayBuffer());
            names.push(name);
          }
          photoLists.set(item.id, names);
        }
      }
      const csv = "﻿" + buildTradeMeCsv(approved, settings!.tm_template, photoLists, settings!.category_map, cats.length ? cats : await loadCategories());
      const stamp = new Date().toISOString().slice(0, 10);
      if (mode === "links") {
        download(csv, `klicklist-trademe-${stamp}.csv`, "text/csv");
      } else {
        files["trademe-products.csv"] = new TextEncoder().encode(csv);
        download(zipSync(files, { level: 0 }) as BlobPart, `klicklist-trademe-${stamp}.zip`, "application/zip");
      }
      await markExported(approved.map((i) => i.id), false);
      setDone(approved.map((i) => i.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress("");
    }
  }

  async function markListed() {
    await markExported(done ?? [], true);
    location.hash = `#/b/${batchId}`;
  }

  return (
    <>
      <Header back={`#/b/${batchId}`} title="Upload to Trade Me" />
      <main className="page narrow-wide">
        <div className="card stack">
          <b>{approved.length} approved item{approved.length === 1 ? "" : "s"} ready to export</b>
          {approved.length === 0 && <p className="muted">Approve items first (Review → “Approve & next”).</p>}
          {!settings.tm_template && (
            <p className="small warn-box card">
              Tip: load your Trade Me template once in <a href="#/settings">Settings</a> so the file matches Trade Me's columns exactly.
            </p>
          )}
        </div>

        {longTitles.length > 0 && (
          <div className="card stack">
            <b>Titles too long for Trade Me</b>
            <p className="muted small">Trade Me's import allows {TM_TITLE_MAX} characters. Shorten these, or Trade Me will reject them:</p>
            {longTitles.map((i) => (
              <a key={i.id} className="small" href={`#/i/${i.id}`}>{i.title} ({i.title.length})</a>
            ))}
          </div>
        )}

        {noPrice.length > 0 && (
          <div className="card stack">
            <b>No price yet</b>
            <p className="muted small">Trade Me needs a start price. Add one to these:</p>
            {noPrice.map((i) => <a key={i.id} className="small" href={`#/i/${i.id}`}>{i.title || "Untitled"}</a>)}
          </div>
        )}

        {approved.length > 0 && (
          <div className="card stack">
            <b>Trade Me categories</b>
            <p className="muted small">
              Picked automatically from Trade Me's category list. KlickList remembers any you change for similar items.
              {" "}<button className="link" onClick={() => setShowCats(!showCats)}>{showCats ? "Hide" : "Check them"}</button>
            </p>
            {showCats && approved.map((i) => (
              <div key={i.id} className="stack">
                <b className="small">{i.title}</b>
                <CategoryPicker item={i} value={i.tm_category || settings.category_map[i.category_path] || ""} onChange={(code) => setCategory(i, code)} />
              </div>
            ))}
          </div>
        )}

        <div className="card stack">
          <b>Photos</b>
          <label className="row"><input type="radio" checked={mode === "links"} onChange={() => setMode("links")} />
            <span><b>Photo links</b> (easiest) – Trade Me downloads the photos itself. Links expire after 14 days.</span></label>
          <label className="row"><input type="radio" checked={mode === "zip"} onChange={() => setMode("zip")} />
            <span><b>ZIP with photo files</b> – you upload the photos to Trade Me yourself, then the CSV.</span></label>
          <button className="button primary" disabled={!approved.length || noPrice.length > 0 || !!progress} onClick={run}>
            {progress || `Create Trade Me file (${approved.length})`}
          </button>
          {error && <p className="error">{error}</p>}
        </div>

        {done && (
          <div className="card stack">
            <b>✓ File downloaded. Now on Trade Me (computer):</b>
            <ol className="small">
              <li>Open <a href="https://sell.trademe.co.nz/" target="_blank" rel="noopener noreferrer">My Products ↗</a> → <b>Import photos &amp; products</b>.</li>
              {mode === "zip" && <li><b>Step 1 – Import photos</b>: unzip the file and upload everything in the <code>photos</code> folder.</li>}
              <li><b>Step 2 – Import CSV file</b>: choose the {mode === "zip" ? "trademe-products.csv from the ZIP" : "downloaded .csv"}.</li>
              <li>The import only adds them to <b>My Products</b>. Tick the new products and choose <b>List</b> to put them on Trade Me.</li>
            </ol>
            <p className="muted small">Each item keeps the same SKU (KL…), so if you fix something here and export again, Trade Me updates that product instead of adding a duplicate.</p>
            <button className="button" onClick={markListed}>Mark these {done.length} as listed</button>
          </div>
        )}
      </main>
    </>
  );
}
