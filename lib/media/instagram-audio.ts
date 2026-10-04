import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);
const BUCKET = "openreply-voice-notes";

/** Meta rejects Ogg/OGA headers for Instagram audio. Re-encode only those files
 * in the worker, where ffmpeg is installed, and keep MP3/WAV/M4A untouched. */
export async function getInstagramCompatibleAudioUrl(url: string): Promise<string> {
  const looksLikeOgg = /\.(oga|ogg)(?:$|[?#])/i.test(url);
  if (!looksLikeOgg) return url;

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
  const output = join(dir, "voice.mp3");

  try {
    await writeFile(input, bytes);
    await execFileAsync("ffmpeg", ["-y", "-i", input, "-vn", "-codec:a", "libmp3lame", "-b:a", "128k", output]);
    const mp3 = await readFile(output);
    const path = `converted/${randomUUID()}.mp3`;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const upload = await supabase.storage
      .from(BUCKET)
      .upload(path, mp3, { contentType: "audio/mpeg", upsert: false });
    if (upload.error) throw new Error(`Could not store converted voice note: ${upload.error.message}`);
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
