const BLUR_THRESHOLD = 100;
const MAX_ANALYSIS_WIDTH = 640;
const MIN_IMAGE_WIDTH = 600;
const MIN_IMAGE_HEIGHT = 400;
const MIN_MEAN_BRIGHTNESS = 50;
const MAX_MEAN_BRIGHTNESS = 220;

export async function checkImageQuality(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return { ok: false, reason: "invalid-image", blurScore: 0 };
  }

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    image.src = imageUrl;
    await image.decode();

    const scale = Math.min(1, MAX_ANALYSIS_WIDTH / image.naturalWidth);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Could not analyze the photo. Please try again.");
    }

    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const grayscale = new Float32Array(width * height);
    let brightnessTotal = 0;

    for (let pixel = 0; pixel < grayscale.length; pixel += 1) {
      const offset = pixel * 4;
      const brightness =
        data[offset] * 0.299 +
        data[offset + 1] * 0.587 +
        data[offset + 2] * 0.114;
      grayscale[pixel] = brightness;
      brightnessTotal += brightness;
    }

    let laplacianTotal = 0;
    let laplacianSquaredTotal = 0;
    let laplacianCount = 0;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const center = y * width + x;
        const response =
          grayscale[center - width] +
          grayscale[center - 1] -
          4 * grayscale[center] +
          grayscale[center + 1] +
          grayscale[center + width];
        laplacianTotal += response;
        laplacianSquaredTotal += response * response;
        laplacianCount += 1;
      }
    }

    const laplacianMean = laplacianTotal / laplacianCount;
    const blurScore = Math.max(
      0,
      laplacianSquaredTotal / laplacianCount - laplacianMean * laplacianMean
    );
    const meanBrightness = brightnessTotal / grayscale.length;

    if (image.naturalWidth < MIN_IMAGE_WIDTH || image.naturalHeight < MIN_IMAGE_HEIGHT) {
      return { ok: false, reason: "too-small", blurScore };
    }
    if (meanBrightness < MIN_MEAN_BRIGHTNESS) {
      return { ok: false, reason: "too-dark", blurScore };
    }
    if (meanBrightness > MAX_MEAN_BRIGHTNESS) {
      return { ok: false, reason: "too-bright", blurScore };
    }
    if (blurScore < BLUR_THRESHOLD) {
      return { ok: false, reason: "blurry", blurScore };
    }

    return { ok: true, reason: null, blurScore };
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}
