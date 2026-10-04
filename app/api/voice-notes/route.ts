import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentWorkspaceId } from "@/lib/auth";

export const runtime = "nodejs";

const BUCKET = "openreply-voice-notes";
const ALLOWED = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "application/ogg",
]);
const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "m4a", "mp4", "oga", "ogg"]);

export async function POST(request: Request) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Voice-note storage is not configured yet." }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an audio file." }, { status: 400 });
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (!ALLOWED.has(file.type) && !ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "Only MP3, WAV, M4A, MP4, OGA, or OGG audio files are supported." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Voice notes must be 10 MB or smaller." }, { status: 400 });
  const contentType =
    ext === "oga" || ext === "ogg"
      ? "audio/ogg"
      : file.type || "application/octet-stream";
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const upload = await supabase.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType, upsert: false });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 502 });
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ url: publicUrl, name: file.name, size: file.size, type: contentType });
}
