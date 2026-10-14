type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

export type BarcodeDetectorConstructor = {
  new(options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

const MAX_FRAME_EDGE = 640;

/** Read camera frames locally. The software decoder is loaded only when the
 * browser's native reader is unavailable, cannot read QR, or fails. */
export async function createQrFrameReader(
  video: HTMLVideoElement,
  BarcodeDetector?: BarcodeDetectorConstructor
): Promise<() => Promise<string | null>> {
  let nativeReader: BarcodeDetectorInstance | null = null;
  if (BarcodeDetector) {
    try {
      const formats = await BarcodeDetector.getSupportedFormats?.();
      if (!formats || formats.includes("qr_code")) {
        nativeReader = new BarcodeDetector({ formats: ["qr_code"] });
      }
    } catch {
      // Some browsers expose the constructor without supporting QR detection.
    }
  }

  let canvas: HTMLCanvasElement | null = null;
  let decoder: Promise<typeof import("jsqr")["default"]> | null = null;

  return async () => {
    if (nativeReader) {
      try {
        const codes = await nativeReader.detect(video);
        return codes.find((code) => typeof code.rawValue === "string" && code.rawValue.length > 0)?.rawValue ?? null;
      } catch {
        nativeReader = null;
      }
    }

    if (!video.videoWidth || !video.videoHeight) return null;
    decoder ??= import("jsqr").then((module) => module.default);
    const decode = await decoder;
    canvas ??= document.createElement("canvas");
    const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Camera frames cannot be read in this browser.");
    context.drawImage(video, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    return decode(frame.data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  };
}
