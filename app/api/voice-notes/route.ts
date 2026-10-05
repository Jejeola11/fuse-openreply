import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
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

async function normalizeUpload(file: File, ext: string) {
  const original = Buffer.from(await file.arrayBuffer());
  if (ext !== "oga" && ext !== "ogg") {
    return { bytes: original, extension: ext, contentType: file.type || "audio/mpeg", name: file.name };
  }
  if (!ffmpegPath) throw new Error("Audio conversion is unavailable. Please try again.");

  const dir = await mkdtemp(join(tmpdir(), "openreply-upload-"));
  const input = join(dir, "voice.oga");
  const output = join(dir, "voice.mp3");
  try {
    await writeFile(input, original);
    await execFileAsync(ffmpegPath, ["-y", "-i", input, "-vn", "-codec:a", "libmp3lame", "-b:a", "128k", output]);
    return {
      bytes: await readFile(output),
      extension: "mp3",
      contentType: "audio/mpeg",
      name: file.name.replace(/\.(oga|ogg)$/i, ".mp3"),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

  try {
    const normalized = await normalizeUpload(file, ext);
    const path = `${workspaceId}/${crypto.randomUUID()}.${normalized.extension}`;
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const upload = await supabase.storage.from(BUCKET).upload(path, normalized.bytes, { contentType: normalized.contentType, upsert: false });
    if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 502 });
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return NextResponse.json({ url: publicUrl, name: normalized.name, size: normalized.bytes.length, type: normalized.contentType });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not convert this voice note." }, { status: 422 });
  }
}
