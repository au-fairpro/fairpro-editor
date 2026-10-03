// A stand-in for FairPro in the end-to-end tests: a page on another origin
// that frames the editor and drives it through postMessage.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Host</title></head>
<body>
<iframe id="editor" title="Editor" src="http://localhost:5180/" style="width:1200px;height:900px"></iframe>
<script>
  window.received = [];
  window.addEventListener('message', (event) => {
    if (event.origin !== 'http://localhost:5180') return;
    window.received.push(event.data);
  });
  window.sendToEditor = (message, transfer) =>
    document.getElementById('editor').contentWindow.postMessage(
      { source: 'fairpro', v: 1, ...message }, 'http://localhost:5180', transfer ?? []);
</script>
</body>
</html>`;

const fixture = readFileSync(
  new URL("./fixtures/sample.docx", import.meta.url),
);

createServer((req, res) => {
  if (req.url === "/sample.docx") {
    res.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.end(fixture);
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(page);
}).listen(5181);
