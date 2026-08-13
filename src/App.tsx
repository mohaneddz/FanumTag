import { Router } from "@solidjs/router";
import { lazy } from "solid-js";

import Titlebar from "@/components/Titlebar";

const routes = [
  { path: "/", component: lazy(() => import("@/routes/Preview")) },
  { path: "/settings", component: lazy(() => import("@/routes/Settings")) },
  { path: "/debug", component: lazy(() => import("@/routes/Debug")) },
  { path: "/about", component: lazy(() => import("@/routes/About")) },
];

import "./App.css";

export default function App() {
  return (
    <main class="h-screen w-screen flex flex-col overflow-hidden">
      <Router
        root={(props) => (
          <>
            <Titlebar />
            <div class="flex-1 min-h-0 overflow-hidden">{props.children}</div>
          </>
        )}
      >
        {routes}
      </Router>
    </main>
  );
}
