import { useEffect, useState } from "react";

// No id = all items (the normal case). Old "#/b/<id>" links still open that one photo group.
export type Route =
  | { name: "home" }
  | { name: "batch"; id: string }
  | { name: "capture"; id?: string }
  | { name: "quicklist"; id?: string }
  | { name: "export"; id?: string }
  | { name: "item"; id: string; review: boolean }
  | { name: "settings" };

const UUID = "[0-9a-f-]{36}";

export function parseRoute(hash: string): Route {
  let m: RegExpMatchArray | null;
  if ((m = hash.match(new RegExp(`^#/b/(${UUID})$`)))) return { name: "batch", id: m[1] };
  if ((m = hash.match(new RegExp(`^#/b/(${UUID})/capture$`)))) return { name: "capture", id: m[1] };
  if ((m = hash.match(new RegExp(`^#/b/(${UUID})/list$`)))) return { name: "quicklist", id: m[1] };
  if ((m = hash.match(new RegExp(`^#/b/(${UUID})/export$`)))) return { name: "export", id: m[1] };
  if ((m = hash.match(new RegExp(`^#/i/(${UUID})(/review)?$`)))) return { name: "item", id: m[1], review: !!m[2] };
  if (hash === "#/capture") return { name: "capture" };
  if (hash === "#/list") return { name: "quicklist" };
  if (hash === "#/export") return { name: "export" };
  if (hash === "#/settings") return { name: "settings" };
  return { name: "home" };
}

export function go(hash: string): void {
  window.location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
