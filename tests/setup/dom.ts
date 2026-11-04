import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });

Object.defineProperty(globalThis, "localStorage", {
  value: globalThis.localStorage,
  writable: true,
  configurable: true,
});
