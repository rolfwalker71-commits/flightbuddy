const CSS_SIZE = 28;

/** Top-down airliner, nose pointing north (0°) so MapLibre `icon-rotate` is geographic heading. */
export function createNorthPlaneImage(fill: string, stroke: string, pixelRatio = 2) {
  const size = CSS_SIZE * pixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("plane icon: 2d context unavailable");

  ctx.scale(pixelRatio, pixelRatio);
  ctx.translate(CSS_SIZE / 2, CSS_SIZE / 2);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(2.1, -2.2);
  ctx.lineTo(11, 3);
  ctx.lineTo(11, 5.2);
  ctx.lineTo(2, 2.4);
  ctx.lineTo(1.5, 8.2);
  ctx.lineTo(4.4, 10.6);
  ctx.lineTo(4.4, 12);
  ctx.lineTo(0, 10.4);
  ctx.lineTo(-4.4, 12);
  ctx.lineTo(-4.4, 10.6);
  ctx.lineTo(-1.5, 8.2);
  ctx.lineTo(-2, 2.4);
  ctx.lineTo(-11, 5.2);
  ctx.lineTo(-11, 3);
  ctx.lineTo(-2.1, -2.2);
  ctx.closePath();
  // Halo first so the stroke sits outside the fill and separates the icon from the arc.
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, size, size);
  return {
    width: size,
    height: size,
    data: new Uint8Array(imageData.data),
    pixelRatio,
  };
}
