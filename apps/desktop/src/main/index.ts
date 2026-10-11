import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:3001";

type AppFileConfig = {
  apiBaseUrl?: string;
};

function readJsonConfig(filePath: string): AppFileConfig | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as AppFileConfig;
  } catch {
    return null;
  }
}

/** Editable config: beside exe → userData → packaged resources → env → default. */
function resolveApiBaseUrl(): string {
  const candidates: string[] = [];

  if (app.isPackaged) {
    candidates.push(join(dirname(app.getPath("exe")), "bcis-config.json"));
  }

  const userDir = join(app.getPath("userData"));
  const userConfig = join(userDir, "bcis-config.json");
  candidates.push(userConfig);

  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, "bcis-config.json"));
  } else {
    candidates.push(join(app.getAppPath(), "resources", "bcis-config.json"));
  }

  for (const path of candidates) {
    const cfg = readJsonConfig(path);
    if (cfg?.apiBaseUrl && typeof cfg.apiBaseUrl === "string") {
      return cfg.apiBaseUrl.trim() || DEFAULT_API_BASE_URL;
    }
  }

  // Seed userData config so operators can edit without hunting packaged files.
  try {
    if (!existsSync(userConfig)) {
      mkdirSync(userDir, { recursive: true });
      writeFileSync(
        userConfig,
        JSON.stringify({ apiBaseUrl: DEFAULT_API_BASE_URL }, null, 2),
        "utf8",
      );
    }
  } catch {
    // ignore seed failures
  }

  return process.env.BCIS_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

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
  const apiBaseUrl = resolveApiBaseUrl();

  ipcMain.handle("bcis:get-config", () => ({
    apiBaseUrl,
    appName: "BCIS Subscription Billing",
  }));

  ipcMain.handle("bcis:lock-session", () => ({ ok: true }));
  ipcMain.handle("bcis:logout", () => ({ ok: true }));
  ipcMain.handle("bcis:open-path", async (_event, targetPath: string) => {
    if (typeof targetPath !== "string" || targetPath.length === 0) {
      return { ok: false as const, error: "Invalid path" };
    }
    const result = await shell.openPath(targetPath);
    return result
      ? { ok: false as const, error: result }
      : { ok: true as const };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
