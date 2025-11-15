// @ts-check
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Browser } from "happy-dom";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

let browser;

let modulePromise;

const loadGameModule = async () => {
  if (!modulePromise) {
    const moduleUrl = pathToFileURL(path.join(rootDir, "src", "main.js")).href;
    modulePromise = import(moduleUrl);
  }
  return modulePromise;
};

const boot = async () => {
  const page = browser.newPage();
  page.content =
    '<!doctype html><html><body><div id="game-root"></div></body></html>';
  const { document: doc, window: win } = page.mainFrame;
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.performance = win.performance;
  globalThis.ResizeObserver = win.ResizeObserver;
  const module = await loadGameModule();
  const game = module.bootGame(doc);
  return { page, game };
};

beforeAll(() => {
  browser = new Browser({ console });
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
  browser?.close();
});

describe("HUD", () => {
  it("shows initial speed and altitude", async () => {
    const { page } = await boot();
    const doc = page.mainFrame.document;
    const speed = doc.querySelector("#speed-value")?.textContent;
    const altitude = doc.querySelector("#altitude-value")?.textContent;
    expect(speed).toBe("0");
    expect(altitude).toBe("0");
  });

  it("updates speed and altitude when flight info changes", async () => {
    const { page, game } = await boot();
    const doc = page.mainFrame.document;
    game.updateFlightInfo({ speed: 480, altitude: 1234 });
    const speed = doc.querySelector("#speed-value")?.textContent;
    const altitude = doc.querySelector("#altitude-value")?.textContent;
    expect(speed).toBe("480");
    expect(altitude).toBe("1234");
  });
});

describe("audio", () => {
  it("creates a looping engine track", async () => {
    const { page } = await boot();
    const audio = /** @type {HTMLAudioElement|null} */ (
      page.mainFrame.document.querySelector('audio[data-role="engine"]')
    );
    expect(audio).not.toBeNull();
    expect(audio?.loop).toBe(true);
  });
});
