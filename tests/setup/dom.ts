import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });

Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
  value: { unregisterListener: () => {} },
  configurable: true,
});

Object.defineProperty(globalThis, "localStorage", {
  value: globalThis.localStorage,
  writable: true,
  configurable: true,
});
