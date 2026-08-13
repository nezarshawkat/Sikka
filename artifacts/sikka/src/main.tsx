import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import App from "./App.tsx";
import "./index.css";

// MapLibre GL (like Mapbox GL) does not shape/join complex scripts such as
// Arabic on its own -- without this plugin, Arabic street/station labels on
// the map render as disconnected, isolated letterforms in the wrong visual
// order (e.g. "الجمعة" shows up as separated, reversed glyphs). Registering
// the RTL text plugin makes MapLibre run the Arabic text through proper
// shaping before drawing it. The plugin is bundled locally (public/vendor)
// so this also works offline in the Android WebView, not just when online.
try {
  if (maplibregl.getRTLTextPluginStatus() === "unavailable") {
    maplibregl.setRTLTextPlugin(
      `${import.meta.env.BASE_URL}vendor/mapbox-gl-rtl-text.js`,
      true, // lazy: only fetch/parse it once Arabic (or other RTL) text is actually drawn
    );
  }
} catch (err) {
  console.warn("[maplibre] failed to register RTL text plugin", err);
}

createRoot(document.getElementById("root")!).render(<App />);
