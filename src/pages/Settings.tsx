import { useEffect, useState } from "react";
import Header from "../components/Header";
import { getSettings, saveSettings, usageToday } from "../lib/api";
import { fieldFor, templateFromCsv, tmSummary } from "../lib/trademe";
import type { Prefs, Settings, TmOptions } from "../lib/types";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof usageToday>>>(null);

  useEffect(() => {
    getSettings().then(setS).catch((e) => setMsg(e.message));
    usageToday().then(setUsage).catch(() => {});
  }, []);
  if (!s) return <main className="page"><p className="muted">{msg || "Loading…"}</p></main>;

  async function setPrefs(p: Partial<Prefs>) {
    const prefs = { ...s!.prefs, ...p };
    setS({ ...s!, prefs });
    await saveSettings({ prefs }).catch((e) => setMsg(e.message));
  }

  /** Listing options; text boxes save when you leave them (save = false while typing). */
  async function setTm(p: Partial<TmOptions>, save = true) {
    const prefs = { ...s!.prefs, tm: { ...s!.prefs.tm, ...p } };
    setS({ ...s!, prefs });
    if (save) await saveSettings({ prefs }).catch((e) => setMsg(e.message));
  }

  async function loadTemplate(file: File | undefined) {
    if (!file) return;
    setMsg("");
    try {
      if (file.size > 5_000_000) throw new Error("File too large");
      const tm_template = templateFromCsv(await file.text());
      await saveSettings({ tm_template });
      setS({ ...s!, tm_template });
      setMsg(`Template loaded: ${tm_template.headers.length} columns.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function forgetCategory(path: string) {
    const category_map = { ...s!.category_map };
    delete category_map[path];
    setS({ ...s!, category_map });
    await saveSettings({ category_map });
  }

  const t = s.tm_template;
  return (
    <>
      <Header back="#/" title="Settings" />
      <main className="page">
        <section className="card stack">
          <b>Which AI writes your listings</b>
          <div className="tabs">
            <button className={s.prefs.aiProvider === "claude" ? "on" : ""} onClick={() => setPrefs({ aiProvider: "claude" })}>Claude</button>
            <button className={s.prefs.aiProvider === "gemini" ? "on" : ""} onClick={() => setPrefs({ aiProvider: "gemini" })}>Gemini (free)</button>
          </div>
          <p className="muted small">
            {s.prefs.aiProvider === "claude"
              ? "Claude Haiku: best listings, about 0.2c per item in economy mode (0.4c instant)."
              : "Gemini Flash-Lite free tier: $0 within Google's daily free limit (roughly 500-1,000 items a day). On the free tier Google may use your photos and text to improve its products."}
          </p>
          <label className="row"><input type="checkbox" checked={s.prefs.aiBackup} onChange={(e) => setPrefs({ aiBackup: e.target.checked })} />
            Use the other AI as a backup if this one is busy, out of credit or over its free limit</label>
          <label className="row"><input type="checkbox" checked={s.prefs.economy} disabled={s.prefs.aiProvider !== "claude"} onChange={(e) => setPrefs({ economy: e.target.checked })} />
            Economy mode (Claude only): half price, listings arrive within minutes to an hour instead of seconds</label>
        </section>

        <section className="card stack">
          <b>White backgrounds</b>
          <p className="muted small">Done free on your device (desktop is fastest). The first time downloads a 44 MB model.</p>
          <select value={s.prefs.whiteBg} onChange={(e) => setPrefs({ whiteBg: e.target.value as Prefs["whiteBg"] })}>
            <option value="all">All photos</option>
            <option value="main">Main photo only</option>
            <option value="off">Off</option>
          </select>
        </section>

        <section className="card stack">
          <b>Online price checks</b>
          <p className="muted small">Compares with similar listings on Trade Me, which is free once the Trade Me API is set up (see the setup guide). Only items the AI values at or above the amount below are checked automatically, and you can check any item by hand.</p>
          <label className="row"><input type="checkbox" checked={s.prefs.autoPriceCheck} onChange={(e) => setPrefs({ autoPriceCheck: e.target.checked })} /> Check automatically</label>
          <label>Only for items worth at least $
            <input type="number" min={0} step={1} value={s.prefs.priceCheckMin} onChange={(e) => setPrefs({ priceCheckMin: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </section>

        <section className="card stack">
          <b>Trade Me listing options</b>
          <p className="muted small">Used for every item in the Trade Me upload file. Now: {tmSummary(s.prefs.tm)}</p>
          <label>Shipping
            <select value={s.prefs.tm.shipping} onChange={(e) => setTm({ shipping: e.target.value as TmOptions["shipping"] })}>
              <option value="free">Free shipping</option>
              <option value="custom">My own shipping prices</option>
            </select>
          </label>
          {s.prefs.tm.shipping === "custom" && (
            <label>Shipping prices <span className="muted small">price=description, separated by ; (up to 10), or the name of one of your Trade Me shipping templates</span>
              <input value={s.prefs.tm.shippingText} maxLength={500} placeholder="4.00=Tracked Post;7.25=Courier;8.50=Rural Courier"
                onChange={(e) => setTm({ shippingText: e.target.value }, false)} onBlur={() => setTm({})} />
            </label>
          )}
          <label>Pickup
            <select value={s.prefs.tm.pickup} onChange={(e) => setTm({ pickup: e.target.value as TmOptions["pickup"] })}>
              <option value="no">No pickups</option>
              <option value="allowed">Buyer can pick up</option>
              <option value="must">Buyer must pick up</option>
            </select>
          </label>
          <label>Auction length
            <select value={s.prefs.tm.days} onChange={(e) => setTm({ days: Number(e.target.value) })}>
              {[2, 3, 4, 5, 6, 7, 10, 14].map((d) => <option key={d} value={d}>{d} days{d === 10 ? " (Trade Me charges a fee)" : d === 14 ? " (some categories only)" : ""}</option>)}
            </select>
          </label>
          <span className="small muted">If a category doesn't allow this length, the nearest allowed one is used.</span>
          <b className="small">Payment methods</b>
          <label className="row"><input type="checkbox" checked={s.prefs.tm.bank} onChange={(e) => setTm({ bank: e.target.checked })} /> Bank deposit</label>
          <label className="row"><input type="checkbox" checked={s.prefs.tm.card} onChange={(e) => setTm({ card: e.target.checked })} /> Pay Now / credit card</label>
          <label className="row"><input type="checkbox" checked={s.prefs.tm.cash} onChange={(e) => setTm({ cash: e.target.checked })} /> Cash (on pickup)</label>
        </section>

        <section className="card stack">
          <b>Trade Me import template</b>
          <p className="muted small">
            One-time setup, best done on a computer: on Trade Me go to <b>My Products</b>, create one product by hand with your usual
            duration, pickup, shipping and payment options, then export your products to CSV and load that file here. KlickList
            copies its exact columns and other options (e.g. listing footer). Shipping, pickup, auction length and payment
            come from the listing options above. Optional: without a template KlickList uses Trade Me's standard columns.
          </p>
          <label className="button">
            {t ? "Replace template CSV" : "Load template CSV"}
            <input hidden type="file" accept=".csv,text/csv" onChange={(e) => { loadTemplate(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {t ? (
            <details>
              <summary className="small">{t.headers.length} columns loaded {new Date(t.loadedAt).toLocaleDateString("en-NZ")}</summary>
              <ul className="small">
                {t.headers.map((h, i) => (
                  <li key={i}><code>{h}</code> → {fieldFor(h) ? <b>filled by KlickList ({fieldFor(h)})</b> : t.defaults[i] ? <>default “{t.defaults[i].slice(0, 40)}”</> : <span className="muted">blank</span>}</li>
                ))}
              </ul>
            </details>
          ) : <p className="small muted">No template loaded – using Trade Me's standard columns.</p>}
        </section>

        {Object.keys(s.category_map).length > 0 && (
          <section className="card stack">
            <b>Remembered Trade Me categories</b>
            <ul className="list small">
              {Object.entries(s.category_map).map(([path, code]) => (
                <li key={path} className="row"><span className="grow">{path} → <code>{code}</code></span>
                  <button className="link danger" onClick={() => forgetCategory(path)}>Forget</button></li>
              ))}
            </ul>
          </section>
        )}

        {usage && (
          <p className="muted small center">
            AI today: {usage.calls} calls{usage.gemini_calls ? ` (${usage.gemini_calls} Gemini)` : ""} · {(usage.input_tokens + usage.output_tokens).toLocaleString()} tokens
            · about US${(usage.est_cost_micro_usd / 1e6).toFixed(3)}
          </p>
        )}
        {msg && <p className="muted">{msg}</p>}
      </main>
    </>
  );
}
