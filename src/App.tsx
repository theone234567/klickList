import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "./lib/supabase";
import { useRoute } from "./lib/router";
import Login from "./pages/Login";
import BatchView from "./pages/BatchView";
import Capture from "./pages/Capture";
import ItemEditor from "./pages/ItemEditor";
import QuickList from "./pages/QuickList";
import ExportPage from "./pages/Export";
import SettingsPage from "./pages/Settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const route = useRoute();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return (
      <main className="page narrow">
        <h1 className="logo">Klick<span>List</span></h1>
        <p>Not configured yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see docs/SETUP.md).</p>
      </main>
    );
  }
  if (!ready) return <main className="page narrow"><p className="muted">Loading…</p></main>;
  if (!session) return <Login />;

  const userId = session.user.id;
  switch (route.name) {
    case "batch": return <BatchView key={route.id} batchId={route.id} userId={userId} />;
    case "capture": return <Capture key={route.id ?? "today"} batchId={route.id} userId={userId} />;
    case "quicklist": return <QuickList key={route.id ?? "all"} batchId={route.id} />;
    case "item": return <ItemEditor key={route.id} itemId={route.id} review={route.review} />;
    case "export": return <ExportPage key={route.id ?? "all"} batchId={route.id} userId={userId} />;
    case "settings": return <SettingsPage />;
    default: return <BatchView key="all" userId={userId} />;
  }
}
