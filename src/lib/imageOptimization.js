const DEFAULT_QUALITY_STEPS = [0.8, 0.68, 0.56, 0.46, 0.36];

export async function optimizeImageFile(
  file,
  {
    maxDimension = 1600,
    maxSizeBytes,
    forceWebp = false,
    backgroundColor,
    qualitySteps = DEFAULT_QUALITY_STEPS,
  } = {}
) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot prepare the image. Please use a recent browser.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not optimize image. Please try another photo.");
    if (backgroundColor) {
      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let bestBlob;
    for (const quality of qualitySteps) {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("Could not optimize image. Please try another photo.")),
          "image/webp",
          quality
        );
      });
      if (blob.type !== "image/webp") {
        throw new Error("This browser cannot prepare WebP images. Please use a recent browser.");
      }

      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (maxSizeBytes ? blob.size <= maxSizeBytes : blob.size < file.size) break;
    }

    if (!bestBlob || (!forceWebp && bestBlob.size >= file.size)) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || file.name;
    return new File([bestBlob], `${baseName}.webp`, {
      type: bestBlob.type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
