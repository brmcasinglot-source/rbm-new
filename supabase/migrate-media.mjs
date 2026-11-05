import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this migration.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function decodeDataUrl(value) {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value || "");
  if (!match) return null;
  return { contentType: match[1].toLowerCase(), bytes: Buffer.from(match[2], "base64") };
}

async function upload(bucket, path, value) {
  const decoded = decodeDataUrl(value);
  if (!decoded || !decoded.bytes.length) throw new Error(`Invalid embedded media for ${path}.`);
  await uploadBytes(bucket, path, decoded.bytes, decoded.contentType);
}

async function uploadBytes(bucket, path, bytes, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
}

async function migrateReportEvidence() {
  let offset = 0;
  let migrated = 0;
  while (true) {
    const { data: reports, error } = await supabase.from("reports")
      .select("id,evidence").order("id").range(offset, offset + 4);
    if (error) throw error;
    if (!reports?.length) break;

    for (const report of reports) {
      const evidence = report.evidence || [];
      const uploaded = [];
      let changed = false;
      try {
        const migratedEvidence = [];
        for (const file of evidence) {
          if (!file?.data?.startsWith("data:")) {
            migratedEvidence.push(file);
            continue;
          }
          const path = `legacy/${report.id}/${randomUUID()}`;
          await upload("report-evidence", path, file.data);
          uploaded.push(path);
          migratedEvidence.push({ name: file.name || "Evidence file", type: file.type, path });
          changed = true;
        }
        if (changed) {
          const { error: updateError } = await supabase.from("reports")
            .update({ evidence: migratedEvidence }).eq("id", report.id);
          if (updateError) throw updateError;
          migrated += uploaded.length;
        }
      } catch (error) {
        if (uploaded.length) {
          const { error: cleanupError } = await supabase.storage.from("report-evidence").remove(uploaded);
          if (cleanupError) console.error("Could not clean up incomplete report evidence migration:", cleanupError.message);
        }
        throw error;
      }
    }

    offset += reports.length;
    if (reports.length < 5) break;
  }
  console.log(`Migrated ${migrated} embedded report evidence file(s).`);
}

async function migrateAwarenessImages() {
  let offset = 0;
  let migrated = 0;
  while (true) {
    const { data: items, error } = await supabase.from("awareness_content")
      .select("id,thumbnail,full_image_path").order("id").range(offset, offset + 24);
    if (error) throw error;
    if (!items?.length) break;

    for (const item of items) {
      if (item.full_image_path || !item.thumbnail?.startsWith("data:")) continue;
      const decoded = decodeDataUrl(item.thumbnail);
      if (!decoded || !decoded.bytes.length) throw new Error(`Invalid awareness image for item ${item.id}.`);
      const path = `legacy/${item.id}/${randomUUID()}`;
      const uploaded = [path];
      let thumbnailPath = path;
      try {
        await uploadBytes("awareness-media", path, decoded.bytes, decoded.contentType);
        if (decoded.contentType.startsWith("image/")) {
          const thumbnailBytes = await sharp(decoded.bytes)
            .rotate()
            .resize(400, 400, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 72 })
            .toBuffer();
          if (thumbnailBytes.length < decoded.bytes.length) {
            thumbnailPath = `legacy/${item.id}/${randomUUID()}-thumb.webp`;
            await uploadBytes("awareness-media", thumbnailPath, thumbnailBytes, "image/webp");
            uploaded.push(thumbnailPath);
          }
        }
      } catch (error) {
        const { error: cleanupError } = await supabase.storage.from("awareness-media").remove(uploaded);
        if (cleanupError) console.error("Could not clean up incomplete awareness image migration:", cleanupError.message);
        throw error;
      }
      const { error: updateError } = await supabase.from("awareness_content")
        .update({ full_image_path: path, thumbnail_path: thumbnailPath, thumbnail: null }).eq("id", item.id);
      if (updateError) {
        const { error: cleanupError } = await supabase.storage.from("awareness-media").remove(uploaded);
        if (cleanupError) console.error("Could not clean up incomplete awareness image migration:", cleanupError.message);
        throw updateError;
      }
      migrated += 1;
    }

    offset += items.length;
    if (items.length < 25) break;
  }
  console.log(`Migrated ${migrated} embedded awareness image(s) and generated optimized thumbnails where possible.`);
}

await migrateReportEvidence();
await migrateAwarenessImages();
