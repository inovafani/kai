import { NextResponse } from "next/server";

export const runtime = "nodejs";

const loaderScript = `
(function () {
  var script = document.currentScript;
  if (!script) return;

  var key = script.getAttribute("data-kai-key");
  if (!key) {
    console.error("[Kai] Missing data-kai-key on loader script.");
    return;
  }

  if (document.querySelector('[data-kai-root=\"true\"]')) {
    return;
  }

  var scriptUrl = new URL(script.src);
  var frameUrl = scriptUrl.origin + "/embed/kai?key=" + encodeURIComponent(key);

  var root = document.createElement("div");
  root.setAttribute("data-kai-root", "true");

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open Kai");
  launcher.textContent = "Kai";
  launcher.style.position = "fixed";
  launcher.style.right = "20px";
  launcher.style.bottom = "20px";
  launcher.style.width = "64px";
  launcher.style.height = "64px";
  launcher.style.border = "0";
  launcher.style.borderRadius = "50%";
  launcher.style.background = "#0f766e";
  launcher.style.color = "#ffffff";
  launcher.style.font = "700 16px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  launcher.style.boxShadow = "0 18px 48px rgba(15, 23, 42, 0.22)";
  launcher.style.cursor = "pointer";
  launcher.style.zIndex = "2147483647";

  var panel = document.createElement("div");
  panel.style.display = "none";
  panel.style.position = "fixed";
  panel.style.right = "20px";
  panel.style.bottom = "20px";
  panel.style.width = "420px";
  panel.style.height = "680px";
  panel.style.maxWidth = "calc(100vw - 32px)";
  panel.style.maxHeight = "calc(100vh - 32px)";
  panel.style.zIndex = "2147483647";

  var closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close Kai");
  closeButton.textContent = "×";
  closeButton.style.position = "absolute";
  closeButton.style.top = "10px";
  closeButton.style.right = "10px";
  closeButton.style.width = "34px";
  closeButton.style.height = "34px";
  closeButton.style.border = "0";
  closeButton.style.borderRadius = "50%";
  closeButton.style.background = "rgba(15, 23, 42, 0.82)";
  closeButton.style.color = "#ffffff";
  closeButton.style.font = "600 22px/1 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  closeButton.style.cursor = "pointer";
  closeButton.style.zIndex = "2";

  function createFrame() {
    var frame = document.createElement("iframe");
    frame.title = "Kai booking assistant";
    frame.setAttribute("data-kai-widget", "true");
    frame.src = frameUrl;
    frame.allow = "clipboard-write";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    frame.style.borderRadius = "8px";
    frame.style.boxShadow = "0 24px 80px rgba(15, 23, 42, 0.22)";
    frame.style.background = "transparent";
    return frame;
  }

  function openKai() {
    if (!panel.querySelector('iframe[data-kai-widget=\"true\"]')) {
      panel.appendChild(createFrame());
    }
    launcher.style.display = "none";
    panel.style.display = "block";
  }

  function closeKai() {
    var frame = panel.querySelector('iframe[data-kai-widget=\"true\"]');
    if (frame) {
      frame.remove();
    }
    panel.style.display = "none";
    launcher.style.display = "block";
  }

  launcher.addEventListener("click", openKai);
  closeButton.addEventListener("click", closeKai);

  panel.appendChild(closeButton);
  root.appendChild(launcher);
  root.appendChild(panel);
  document.body.appendChild(root);
})();
`;

export async function GET() {
  return new NextResponse(loaderScript.trim(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
