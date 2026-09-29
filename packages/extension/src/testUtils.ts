import { Window } from "happy-dom";

export function parseHtml(html: string, url = "https://example.com/"): Document {
  const window = new Window({ url });
  window.document.write(html);
  window.document.close();
  return window.document as unknown as Document;
}
