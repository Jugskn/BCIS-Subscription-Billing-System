import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

/** Keep in sync with renderer DEFAULT_API_BASE_URL — always 127.0.0.1, not localhost. */
const API_BASE_URL = process.env.BCIS_API_BASE_URL ?? "http://127.0.0.1:3001";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: "#FAFAF9",
    title: "BCIS Subscription Billing",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("bcis:get-config", () => ({
    apiBaseUrl: API_BASE_URL,
    appName: "BCIS Subscription Billing",
  }));

  ipcMain.handle("bcis:lock-session", () => ({ ok: true }));
  ipcMain.handle("bcis:logout", () => ({ ok: true }));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
