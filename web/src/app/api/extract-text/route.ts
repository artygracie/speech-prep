// POST /api/extract-text
//
// Pulls plain text out of an uploaded document so the new-speech form can
// fill the script body. Handles .txt, .docx, and .pdf. Caps at 10MB to
// keep memory bounded — speeches are short, so anything bigger is almost
// certainly the wrong file.
//
// Auth: requires a logged-in user. We don't persist the upload anywhere;
// the file lives in memory for the duration of the request.

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

type Ext = "txt" | "docx" | "pdf";

function detectExt(name: string, type: string): Ext | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".txt") || type === "text/plain") return "txt";
  if (lower.endsWith(".docx") || type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (lower.endsWith(".pdf") || type === "application/pdf") return "pdf";
  return null;
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value ?? "";
}

async function extractPdf(buf: Buffer): Promise<string> {
  // pdfjs-dist legacy build is the one designed to run in Node without a
  // DOM. The non-legacy build assumes a browser and breaks in server
  // contexts.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: unknown) => {
        if (typeof item === "object" && item !== null && "str" in item) {
          return String((item as { str: string }).str);
        }
        return "";
      })
      .join(" ");
    parts.push(pageText);
  }
  await doc.destroy();
  return parts.join("\n\n");
}

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "no file" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "File is over 10MB. Try pasting the text instead." },
      { status: 413 },
    );
  }

  const ext = detectExt(file.name, file.type);
  if (!ext) {
    return Response.json(
      { error: "Unsupported file type. Try .txt, .docx, or .pdf." },
      { status: 415 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  let text = "";
  try {
    if (ext === "txt") text = buf.toString("utf-8");
    else if (ext === "docx") text = await extractDocx(buf);
    else if (ext === "pdf") text = await extractPdf(buf);
  } catch (err) {
    console.error("[extract-text] parse failed", err);
    return Response.json(
      { error: "Couldn't read that file. Try pasting the text instead." },
      { status: 422 },
    );
  }

  // PDFs often emit whitespace between every glyph because of how text is
  // positioned in the page stream. Collapse runs of spaces here so the
  // user doesn't have to clean it up by hand.
  if (ext === "pdf") {
    text = text.replace(/[ \t]{2,}/g, " ");
  }

  text = text
    .replace(/\r\n/g, "\n")
    .replace(//g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    return Response.json(
      { error: "No readable text in that file. If it's a scanned PDF, try pasting instead." },
      { status: 422 },
    );
  }

  return Response.json({ text });
}
