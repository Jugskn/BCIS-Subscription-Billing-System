import type { BcisDesktopApi } from "./index";

declare global {
  interface Window {
    bcis: BcisDesktopApi;
  }
}

export {};
