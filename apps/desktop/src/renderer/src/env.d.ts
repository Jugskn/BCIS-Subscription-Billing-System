import type { BcisDesktopApi } from "../../preload/index";

declare global {
  interface Window {
    bcis: BcisDesktopApi;
  }
}

export {};
