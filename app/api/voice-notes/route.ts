import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentWorkspaceId } from "@/lib/auth";

export const runtime = "nodejs";

const BUCKET = "openreply-voice-notes";
const ALLOWED = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a"]);

export async function POST(request: Request) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Voice-note storage is not configured yet." }, { status: 503 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an MP3 or WAV file." }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Only MP3, WAV, M4A, or MP4 audio files are supported." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Voice notes must be 10 MB or smaller." }, { status: 400 });
  const ext = file.name.toLowerCase().split(".").pop() || "mp3";
  const path = `${workspaceId}/${crypto.randomUUID()}.${ext}`;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const upload = await supabase.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 502 });
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ url: publicUrl, name: file.name, size: file.size, type: file.type });
}
