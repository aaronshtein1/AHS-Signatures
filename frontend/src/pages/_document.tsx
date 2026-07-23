import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        {/* Global error handler - runs before React hydration to catch chunk load errors */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__APP_ERRORS = [];
              window.onerror = function(msg, src, line, col, err) {
                window.__APP_ERRORS.push({msg: msg, src: src, line: line, err: err && err.stack});
                var d = document.getElementById('__pre_react_error');
                if (!d) {
                  d = document.createElement('div');
                  d.id = '__pre_react_error';
                  d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#fef2f2;border-bottom:2px solid #dc2626;padding:12px 16px;font-family:monospace;font-size:13px;white-space:pre-wrap;max-height:200px;overflow:auto;';
                  document.body.prepend(d);
                }
                d.textContent = 'Error: ' + msg + '\\nSource: ' + src + ':' + line + ':' + col + (err && err.stack ? '\\n' + err.stack : '');
              };
              window.addEventListener('unhandledrejection', function(e) {
                var r = e.reason;
                var msg = r && r.message ? r.message : String(r);
                window.__APP_ERRORS.push({msg: msg, reason: r && r.stack});
                var d = document.getElementById('__pre_react_error');
                if (!d) {
                  d = document.createElement('div');
                  d.id = '__pre_react_error';
                  d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#fef2f2;border-bottom:2px solid #dc2626;padding:12px 16px;font-family:monospace;font-size:13px;white-space:pre-wrap;max-height:200px;overflow:auto;';
                  document.body.prepend(d);
                }
                d.textContent = 'Unhandled rejection: ' + msg + (r && r.stack ? '\\n' + r.stack : '');
              });
            `,
          }}
        />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
