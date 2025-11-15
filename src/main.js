// @ts-check
import { createGame } from "./game.js";

let activeGame = null;

/**
 * @param {Document} [doc]
 * @returns {{ dispose: () => void, updateFlightInfo: (info: { speed?: number; altitude?: number }) => void }}
 */
export function bootGame(doc = document) {
  const win = doc.defaultView ?? window;
  globalThis.document = doc;
  globalThis.window = win;
  if (typeof win.ResizeObserver !== "undefined") {
    globalThis.ResizeObserver = win.ResizeObserver;
  }
  const root = ensureRoot(doc);
  root.innerHTML = "";

  const canvas = doc.createElement("canvas");
  canvas.id = "flight-canvas";
  canvas.className = "w-100 h-100 d-block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const hud = doc.createElement("div");

  root.append(canvas, hud);

  if (activeGame) {
    activeGame.dispose();
  }
  activeGame = createGame(canvas, hud, win);
  root.dataset.flightInitialized = "true";
  return activeGame;
}

function ensureRoot(doc) {
  doc.body.style.margin = "0";
  doc.body.classList.add("bg-body-tertiary");
  let root = doc.getElementById("game-root");
  if (!root) {
    root = doc.createElement("div");
    root.id = "game-root";
    doc.body.append(root);
  }
  root.className = "position-relative vw-100 vh-100 overflow-hidden";
  return root;
}
