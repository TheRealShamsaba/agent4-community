/* The snippet a site you build pastes in to be counted. It sends a page view
   when a page opens (and on each single-page-app navigation) and the first few
   uncaught errors on a page. It sets no cookie, stores nothing in the browser,
   reads no personal data and does nothing at all for visitors who have asked
   not to be tracked. */
export const MONITOR_SCRIPT = `(function () {
  var script = document.currentScript;
  if (!script) return;
  var site = script.getAttribute("data-site");
  if (!site) return;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  var endpoint = new URL(script.src).origin + "/m/collect";
  function send(event) {
    event.k = site;
    try {
      var body = JSON.stringify(event);
      if (navigator.sendBeacon) navigator.sendBeacon(endpoint, body);
      else fetch(endpoint, { method: "POST", body: body, keepalive: true, mode: "cors", headers: { "content-type": "text/plain" } });
    } catch (ignore) {}
  }
  var lastPath;
  function view() {
    var path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    send({ t: "pv", p: path });
  }
  view();
  var push = history.pushState;
  history.pushState = function () { var result = push.apply(this, arguments); setTimeout(view, 0); return result; };
  addEventListener("popstate", view);
  var errors = 0;
  addEventListener("error", function (event) {
    if (errors++ >= 5) return;
    send({ t: "err", m: event.message, s: event.filename, l: event.lineno, p: location.pathname });
  });
  addEventListener("unhandledrejection", function (event) {
    if (errors++ >= 5) return;
    var reason = event.reason;
    send({ t: "err", m: "Unhandled promise rejection: " + ((reason && reason.message) || reason), s: "", l: 0, p: location.pathname });
  });
})();
`;
