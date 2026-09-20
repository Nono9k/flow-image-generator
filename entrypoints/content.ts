import { defineContentScript } from "wxt/utils/define-content-script";
import { mountBatchPanel, unmountBatchPanel } from "../src/ui/panel";

export default defineContentScript({
  // Flow can enter a project with client-side navigation, so inject on the
  // host and gate project-only behavior in the page.
  matches: ["https://flow.google.com/*"],
  runAt: "document_idle",
  main(ctx) {
    document.documentElement.setAttribute(
      "data-flow-batch-extension",
      "loaded",
    );
    console.info("[Flow Batch] content script loaded");

    let activeProject = "";
    const reconcile = () => {
      const projectMatch = window.location.pathname.match(/^\/project\/([^/]+)(?:\/|$)/);
      if (projectMatch) {
        if (activeProject !== projectMatch[1]) {
          unmountBatchPanel();
          activeProject = projectMatch[1];
        }
        mountBatchPanel();
      } else {
        activeProject = "";
        unmountBatchPanel();
      }
    };
    reconcile();
    ctx.setInterval(reconcile, 1000);
    ctx.addEventListener(window, "wxt:locationchange", () => {
      if (window.location.hostname === "flow.google.com") {
        document.documentElement.setAttribute(
          "data-flow-batch-extension",
          "loaded",
        );
      }
      reconcile();
    });
    ctx.onInvalidated(unmountBatchPanel);

  },
});
