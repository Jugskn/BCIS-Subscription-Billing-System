import { contextBridge, ipcRenderer } from "electron";

export type DesktopConfig = {
  apiBaseUrl: string;
  appName: string;
};

export type BcisDesktopApi = {
  getConfig: () => Promise<DesktopConfig>;
  lockSession: () => Promise<{ ok: boolean }>;
  logout: () => Promise<{ ok: boolean }>;
};

const api: BcisDesktopApi = {
  getConfig: () => ipcRenderer.invoke("bcis:get-config"),
  lockSession: () => ipcRenderer.invoke("bcis:lock-session"),
  logout: () => ipcRenderer.invoke("bcis:logout"),
};

contextBridge.exposeInMainWorld("bcis", api);
