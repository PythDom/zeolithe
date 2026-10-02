// Turn the single-file build into page content for a hosted preview page,
// which supplies its own <!doctype>/<html>/<head>/<body> skeleton.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist-single/index.html", "utf8");
// The inlined JavaScript contains "<head>"/"<body>" strings, so cut at the
// last real tags rather than the first match.
const head = html.slice(html.indexOf("<head>") + 6, html.lastIndexOf("</head>"));
const body = html.slice(html.lastIndexOf("<body>") + 6, html.lastIndexOf("</body>"));
const keep = head
  .replace(/<meta charset[^>]*>/i, "")
  .replace(/<meta name="viewport"[^>]*>/i, "")
  .replace(/<link rel="icon"[^>]*>/i, "");
const title = /<title>[\s\S]*?<\/title>/.exec(keep)[0];
// Libraries embed a literal U+FFFD inside JS string literals; the host rejects
// that character, so write it as the equivalent escape sequence.
const page = `${title}\n${keep.replace(title, "")}\n${body}\n`.replaceAll("\uFFFD", "\\uFFFD");
writeFileSync("dist-single/zeolithe.html", page);
console.log("wrote dist-single/zeolithe.html");
