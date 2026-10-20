import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * The script a customer's site loads to get Kai. It draws the pill that opens the chat and the frame the
 * chat sits in, in the BluePass design system (the same dark glass and motion as the Kai panel on
 * bluepass.co). The chat itself is the iframe at /embed/kai, styled by kai-widget.css; the iframe's close
 * button asks this script to close through postMessage.
 *
 * It runs on someone else's page, so every class is prefixed `kai-embed-` and its colours are written out
 * rather than taken from that page's variables.
 */
const loaderScript = `
(function () {
  var script = document.currentScript;
  if (!script) return;

  var key = script.getAttribute("data-kai-key");
  if (!key) {
    console.error("[Kai] Missing data-kai-key on loader script.");
    return;
  }

  if (document.querySelector('[data-kai-root="true"]')) {
    return;
  }

  var scriptUrl = new URL(script.src);
  var frameOrigin = scriptUrl.origin;
  var frameUrl = frameOrigin + "/embed/kai?key=" + encodeURIComponent(key);

  var style = document.createElement("style");
  style.textContent = [
    ".kai-embed-root{--kai-ease:cubic-bezier(.16,1,.3,1);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    ".kai-embed-pill{position:fixed;right:20px;bottom:20px;z-index:2147483646;display:flex;align-items:center;gap:10px;padding:8px 16px 8px 8px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:#1d1d1b;color:#f5f5f3;box-shadow:0 12px 36px rgba(0,0,0,.35);cursor:pointer;text-align:left;font:inherit;opacity:0;animation:kai-embed-pill-in .8s var(--kai-ease) .6s forwards;transition:transform .4s var(--kai-ease),opacity .3s ease}",
    ".kai-embed-pill:hover{transform:scale(1.04)}",
    ".kai-embed-pill:focus-visible{outline:2px solid #fff;outline-offset:3px}",
    ".kai-embed-pill.is-hidden{opacity:0!important;pointer-events:none;transform:scale(.9);animation:none}",
    ".kai-embed-avatar{position:relative;display:flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border-radius:50%;background:#fff;color:#0a0a09;font-size:14px;font-weight:700;transition:transform .5s var(--kai-ease)}",
    ".kai-embed-pill:hover .kai-embed-avatar{transform:rotate(-8deg)}",
    ".kai-embed-dot{position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;border-radius:50%;background:#22c55e;border:2px solid #1d1d1b;animation:kai-embed-pulse 2.4s ease-out 1.4s infinite}",
    ".kai-embed-text{display:flex;flex-direction:column;line-height:1.2}",
    ".kai-embed-title{font-size:14px;font-weight:600;color:#f5f5f3}",
    ".kai-embed-sub{font-size:12px;color:rgba(255,255,255,.6)}",
    ".kai-embed-panel{position:fixed;right:20px;bottom:20px;z-index:2147483647;width:408px;height:640px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:#0e0e0d;box-shadow:0 30px 80px rgba(0,0,0,.5);transform-origin:bottom right;animation:kai-embed-open .55s var(--kai-ease) both}",
    ".kai-embed-panel.is-closing{animation:kai-embed-close .22s ease-in both}",
    ".kai-embed-panel iframe{display:block;width:100%;height:100%;border:0;background:#0e0e0d}",
    "@keyframes kai-embed-pill-in{from{opacity:0;transform:translateY(40px) scale(.85)}to{opacity:1;transform:none}}",
    "@keyframes kai-embed-open{from{opacity:0;transform:translateY(24px) scale(.94)}to{opacity:1;transform:none}}",
    "@keyframes kai-embed-close{to{opacity:0;transform:translateY(16px) scale(.96)}}",
    "@keyframes kai-embed-pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%,100%{box-shadow:0 0 0 7px rgba(34,197,94,0)}}",
    "@media (max-width:620px){.kai-embed-panel{inset:0;width:100%;height:100%;max-width:none;max-height:none;border:0;border-radius:0}.kai-embed-pill{right:16px;bottom:16px}}",
    "@media (prefers-reduced-motion:reduce){.kai-embed-pill,.kai-embed-panel,.kai-embed-dot{animation:none!important;opacity:1}.kai-embed-pill.is-hidden{opacity:0!important}}"
  ].join("");
  document.head.appendChild(style);

  var root = document.createElement("div");
  root.className = "kai-embed-root";
  root.setAttribute("data-kai-root", "true");

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.className = "kai-embed-pill";
  launcher.setAttribute("aria-label", "Open Kai");
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.innerHTML =
    '<span class="kai-embed-avatar" aria-hidden="true">K<span class="kai-embed-dot"></span></span>' +
    '<span class="kai-embed-text"><span class="kai-embed-title">Kai</span><span class="kai-embed-sub">Ask me anything</span></span>';

  var panel = null;
  var closing = false;

  function openKai() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "kai-embed-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Kai booking assistant");

    var frame = document.createElement("iframe");
    frame.title = "Kai booking assistant";
    frame.setAttribute("data-kai-widget", "true");
    frame.src = frameUrl;
    frame.allow = "clipboard-write";
    panel.appendChild(frame);

    root.appendChild(panel);
    launcher.classList.add("is-hidden");
  }

  function closeKai() {
    if (!panel || closing) return;
    closing = true;
    var closingPanel = panel;
    closingPanel.classList.add("is-closing");
    setTimeout(function () {
      closingPanel.remove();
      panel = null;
      closing = false;
      launcher.classList.remove("is-hidden");
      launcher.focus({ preventScroll: true });
    }, 220);
  }

  launcher.addEventListener("click", openKai);

  window.addEventListener("message", function (event) {
    if (event.origin !== frameOrigin) return;
    var data = event.data;
    if (data && data.source === "kai-widget" && data.type === "close") closeKai();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeKai();
  });

  root.appendChild(launcher);
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
