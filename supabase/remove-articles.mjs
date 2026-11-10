import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this cleanup.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE_SIZE = 100;
const BATCH_SIZE = 50;
const articleRecords = [];

for (let offset = 0; ; offset += PAGE_SIZE) {
  const { data, error } = await supabase.from("awareness_content")
    .select("id,thumbnail_path,full_image_path")
    .ilike("type", "article")
    .order("id")
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) throw error;

  articleRecords.push(...(data || []));
  if (!data || data.length < PAGE_SIZE) break;
}

for (let offset = 0; offset < articleRecords.length; offset += BATCH_SIZE) {
  const batch = articleRecords.slice(offset, offset + BATCH_SIZE);
  const paths = [...new Set(batch.flatMap((item) => [
    item.thumbnail_path,
    item.full_image_path,
  ]).filter(Boolean))];

  for (let pathOffset = 0; pathOffset < paths.length; pathOffset += BATCH_SIZE) {
    const { error } = await supabase.storage.from("awareness-media")
      .remove(paths.slice(pathOffset, pathOffset + BATCH_SIZE));
    if (error) throw error;
  }

  const { error } = await supabase.from("awareness_content")
    .delete()
    .in("id", batch.map((item) => item.id));
  if (error) throw error;
}

console.log(`Removed ${articleRecords.length} article record(s) and their stored media.`);
