import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseFragment } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import type { DomainResult } from "./project.js";
import { failure, success } from "./project.js";

export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const parser = unified().use(remarkParse).use(remarkGfm);
const mediaPattern = /^fanto-media:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const allowedTags = new Set("html head body title meta style div span p h1 h2 h3 h4 h5 h6 section article header footer main aside figure figcaption img a br hr strong em b i u s blockquote pre code ul ol li table thead tbody tfoot tr th td caption colgroup col dl dt dd small time sup sub details summary".split(" "));
const allowedAttrs = new Set("class id style title alt width height src href lang dir role colspan rowspan scope datetime open name content charset".split(" "));
/** Inspect syntax trees. Code examples and ordinary HTML fences remain literal text. */
export function inspectProjectContent(content: string): DomainResult<string[]> {
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) return failure("CONTENT_TOO_LARGE");
  const ids = new Set<string>();
  const media = (url: string) => {
    const match = mediaPattern.exec(url);
    if (!match) throw new Error("Image must reference fanto media");
    ids.add(match[1]!);
  };
  const link = (url: string) => { if (!/^https?:\/\//i.test(url) && !url.startsWith("#")) throw new Error("Unsupported link"); };
  const css = (source: string) => {
    const root = postcss.parse(source);
    root.walkAtRules(rule => { if (!["media", "supports", "keyframes", "-webkit-keyframes"].includes(rule.name.toLowerCase())) throw new Error("Unsupported CSS rule"); });
    root.walkDecls(decl => {
      if (/behavior|binding/i.test(decl.prop)) throw new Error("Unsupported CSS property");
      valueParser(decl.value).walk(node => {
        if (node.type === "function" && (node.value.includes("\\") || ["image-set", "-webkit-image-set", "image", "src", "paint"].includes(node.value.toLowerCase()))) throw new Error("Unsupported CSS resource function");
        if (node.type === "function" && node.value.toLowerCase() === "url") {
          if (node.nodes.length !== 1 || !["word", "string"].includes(node.nodes[0]!.type)) throw new Error("Invalid CSS URL");
          media(node.nodes[0]!.value);
        }
        if (node.type === "function" && /expression/i.test(node.value)) throw new Error("Unsupported CSS expression");
      });
    });
  };
  const html = (source: string) => {
    const walk = (node: any) => {
      if (node.tagName) {
        if (!allowedTags.has(node.tagName)) throw new Error("Unsupported HTML element");
        for (const attr of node.attrs ?? []) {
          if (attr.namespace || (!allowedAttrs.has(attr.name) && !attr.name.startsWith("aria-") && !attr.name.startsWith("data-"))) throw new Error("Unsupported HTML attribute");
          if (attr.name === "src") { if (node.tagName !== "img") throw new Error("Unsupported resource"); media(attr.value); }
          if (attr.name === "href") { if (node.tagName !== "a") throw new Error("Unsupported resource"); link(attr.value); }
          if (attr.name === "style") css(`a { ${attr.value} }`);
          if (node.tagName === "meta" && attr.name === "name") throw new Error("HTML metadata is not supported");
        }
        if (node.tagName === "meta") throw new Error("HTML metadata is not supported");
        if (node.tagName === "style") css((node.childNodes ?? []).map((child: any) => child.value ?? "").join(""));
      }
      for (const child of node.childNodes ?? []) walk(child);
    };
    walk(parseFragment(source));
  };
  try {
    const root: any = parser.parse(content);
    const definitions = new Map<string, any>();
    const collect = (node: any) => { if (node.type === "definition") definitions.set(node.identifier, node); for (const child of node.children ?? []) collect(child); };
    collect(root);
    const walk = (node: any) => {
      if (node.type === "image") media(node.url);
      if (node.type === "imageReference") { const d = definitions.get(node.identifier); if (!d) throw new Error("Missing image definition"); media(d.url); }
      if (node.type === "link") link(node.url);
      if (node.type === "linkReference") { const d = definitions.get(node.identifier); if (d) link(d.url); }
      if (node.type === "code" && node.lang === "html-preview") html(node.value);
      for (const child of node.children ?? []) walk(child);
    };
    walk(root);
    return success([...ids]);
  } catch { return failure("INVALID_INPUT"); }
}
