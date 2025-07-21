// import { createSignal } from "solid-js";
// import { invoke } from "@tauri-apps/api/core";
import Titlebar from "@/components/Titlebar";
import { Router } from "@solidjs/router";
import { lazy } from "solid-js";

const routes = [
  {
    path: "/",
    component: lazy(() => import("@/routes/Home.tsx")),
  },
  {
    path: "/preview",
    component: lazy(() => import("@/routes/Preview.tsx")),
  },
  {
    path: "/settings",
    component: lazy(() => import("@/routes/Settings.tsx")),
  },
  {
    path: "/about",
    component: lazy(() => import("@/routes/About.tsx")),
  }
]

import "./App.css";

function App() {

  return (
    <main class="h-screen w-screen flex flex-col">
      <Titlebar />
      <Router>{routes}</Router>
    </main>
  );
}

export default App;
