import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const BUCKET = "openreply-voice-notes";

/** Meta accepts a narrow set of audio encodings. Re-encode every upload in the\n * worker so the URL handed to Instagram is always a Instagram-compatible M4A. */
export async function getInstagramCompatibleAudioUrl(url: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Cannot convert OGA audio: Supabase storage is not configured.");
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the OGA voice note for conversion.");
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "openreply-audio-"));
  const input = join(dir, "voice.oga");
  const output = join(dir, "voice.m4a");

  try {
    await writeFile(input, bytes);
    await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-codec:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output]);
    const m4a = await readFile(output);
    const path = `converted/${randomUUID()}.m4a`;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const upload = await supabase.storage
      .from(BUCKET)
      .upload(path, m4a, { contentType: "audio/mp4", upsert: false });
    if (upload.error) throw new Error(`Could not store converted voice note: ${upload.error.message}`);
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
