import { useEffect, useRef, useState } from "react";
import Header from "../components/Header";
import { addPhoto, createItem, listItems } from "../lib/api";
import { previewUrl, processPhoto, type Processed } from "../lib/image";
import type { Item } from "../lib/types";

/**
 * Fast capture: shoot 1-3 photos of an item, tap "New listing", repeat.
 * Uses the live camera inside the page; if that isn't possible, the phone's own camera (one photo at a time).
 * Photos are tidied and uploaded in the background so you never wait.
 */
export default function Capture({ batchId, userId }: { batchId: string; userId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [pending, setPending] = useState(0);
  const [itemCount, setItemCount] = useState(0);
  const [shots, setShots] = useState<string[]>([]); // local previews for the current item
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const [groupFiles, setGroupFiles] = useState<File[] | null>(null);
  const [dragging, setDragging] = useState(false);

  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<{ item: Item; photos: number } | null>(null);
  const nextPos = useRef(0);

  useEffect(() => {
    listItems(batchId).then((items) => {
      nextPos.current = items.reduce((m, i) => Math.max(m, i.position + 1), 0);
      setItemCount(items.length);
    }).catch((e) => setError(e.message));
  }, [batchId]);

  // camera
  const stream = useRef<MediaStream | null>(null);
  async function startCamera() {
    setCameraError("");
    setCameraOk(null);
    stream.current?.getTracks().forEach((t) => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOk(false);
      setCameraError("This browser can't use the camera. If you opened KlickList from an email link, it's probably inside the email app – open the site in Safari or Chrome, or use the home-screen app.");
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream.current;
        await videoRef.current.play();
      }
      setCameraOk(true);
    } catch (e) {
      const name = (e as Error).name;
      setCameraOk(false);
      setCameraError(
        name === "NotAllowedError" ? "Camera access is blocked for this site. iPhone: Settings → Safari → Camera → Allow (or tap aA in the address bar → Website Settings → Camera). Android Chrome: tap the icon left of the address → Permissions → Camera → Allow. Then tap Try again."
          : name === "NotFoundError" ? "No camera found on this device."
          : name === "NotReadableError" ? "The camera is busy in another app. Close that app, then tap Try again."
          : "The camera didn't start. Tap Try again.",
      );
    }
  }
  useEffect(() => {
    startCamera();
    return () => stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending > 0) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  /** Queue work so items/photos are created in the order they were shot. */
  function enqueue(task: () => Promise<void>) {
    setPending((n) => n + 1);
    chain.current = chain.current
      .then(task)
      .catch((e) => setError(`Upload problem: ${(e as Error).message}. Photo skipped.`))
      .finally(() => setPending((n) => n - 1));
  }

  /** `processing` has already started (in the background), so saving only waits for the upload. */
  async function addToCurrent(processing: Promise<Processed>) {
    if (!current.current) {
      const item = await createItem(batchId, nextPos.current++);
      current.current = { item, photos: 0 };
      setItemCount((n) => n + 1);
    }
    const cur = current.current;
    await addPhoto(userId, cur.item, await processing, cur.photos++);
  }

  async function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    // Grab the frame straight from the camera (no JPEG round-trip), then tidy it in a background worker.
    const frame = await createImageBitmap(v);
    const url = await previewUrl(frame);
    setShots((s) => [...s, url]);
    const processing = processPhoto(frame);
    processing.catch(() => {}); // reported when the queue reaches it
    enqueue(() => addToCurrent(processing));
  }

  function nextItem() {
    shots.forEach(URL.revokeObjectURL);
    setShots([]);
    chain.current = chain.current.then(() => { current.current = null; });
  }

  // Desktop shortcuts: Space = take photo, N or Enter = new listing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (groupFiles || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); shoot(); }
      if (e.key === "n" || e.key === "N" || e.key === "Enter") { e.preventDefault(); nextItem(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Photos from the phone's own camera (backup mode): added to the current listing, no questions. */
  function addFiles(files: FileList | null | undefined) {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    for (const f of list) {
      setShots((s) => [...s, URL.createObjectURL(f)]);
      enqueue(() => addToCurrent(processPhoto(f)));
    }
  }

  function onFiles(files: FileList | null | undefined) {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type.startsWith("image/")).sort((a, b) => a.lastModified - b.lastModified);
    if (list.length === 1) return addFiles(files);
    setGroupFiles(list);
  }

  function importGrouped(perItem: number) {
    const files = groupFiles ?? [];
    setGroupFiles(null);
    nextItem();
    const size = perItem === 0 ? files.length : perItem;
    for (let i = 0; i < files.length; i += size) {
      const group = files.slice(i, i + size);
      group.forEach((f) => enqueue(() => addToCurrent(processPhoto(f))));
      chain.current = chain.current.then(() => { current.current = null; });
    }
  }

  return (
    <>
      <Header back={`#/b/${batchId}`} title={`${itemCount} item${itemCount === 1 ? "" : "s"}`} right={pending > 0 ? <span className="badge">⬆ {pending}</span> : <span className="badge ok">✓ saved</span>} />
      <main
        className={`capture ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer?.files); }}
      >
        {cameraOk !== false ? (
          <div className={`viewfinder ${flash ? "flash" : ""}`}>
            <video ref={videoRef} playsInline muted />
          </div>
        ) : (
          <div className="card stack center">
            <p className="small">{cameraError || "No camera here."}</p>
            <button className="button" onClick={startCamera}>Try again</button>
            <p className="muted small">Or use your phone's camera below – each photo goes into this listing until you tap New listing. On a computer you can drag &amp; drop photos here.</p>
          </div>
        )}

        <div className="strip">
          {shots.map((u, i) => <img key={u} src={u} alt={`photo ${i + 1}`} />)}
          {shots.length === 0 && <span className="muted small">Listing {itemCount + 1}: photo 1 = front, photo 2 = back/label.</span>}
        </div>

        <div className="controls">
          <label className="button">
            Gallery
            <input hidden type="file" accept="image/*" multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {cameraOk !== false
            ? <button className="shutter" onClick={shoot} disabled={!cameraOk} aria-label="Take photo" />
            : (
              <label className="shutter" aria-label="Take photo">
                <input hidden type="file" accept="image/*" capture="environment" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          <button className="button primary new-listing" onClick={nextItem} disabled={shots.length === 0} title="Shortcut: N">
            New listing ›
          </button>
        </div>
        {pending > 0
          ? <button className="button wide" disabled>Saving {pending} photo{pending > 1 ? "s" : ""}…</button>
          : <a className="button wide" href={`#/b/${batchId}`}>Done – write my listings</a>}
        {error && <p className="error">{error}</p>}
      </main>

      {groupFiles && (
        <div className="modal" role="dialog">
          <div className="card stack">
            <b>{groupFiles.length} photos – how are they grouped?</b>
            <p className="muted small">Sorted by the time taken. You can merge items later.</p>
            <button className="button primary" onClick={() => { const f = groupFiles; setGroupFiles(null); f.forEach((x) => enqueue(() => addToCurrent(processPhoto(x)))); setShots((s) => [...s, ...f.map((x) => URL.createObjectURL(x))]); }}>
              Add all to this listing</button>
            <button className="button" onClick={() => importGrouped(1)}>1 photo per item</button>
            <button className="button" onClick={() => importGrouped(2)}>2 photos per item (front + back)</button>
            <button className="button" onClick={() => importGrouped(3)}>3 photos per item</button>
            <button className="button" onClick={() => importGrouped(0)}>All one item</button>
            <button className="link" onClick={() => setGroupFiles(null)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
