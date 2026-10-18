export type CropTransform = {
    zoom: number;
    x: number;
    y: number;
};
export function cropGeometry(width: number, height: number, diameter: number, transform: CropTransform) {
    const zoom = Math.max(1, Math.min(transform.zoom, Math.min(5, Math.min(width, height) / 128)));
    const scale = Math.max(diameter / width, diameter / height) * zoom;
    const x = Math.max(-(width * scale - diameter) / 2, Math.min(transform.x, (width * scale - diameter) / 2));
    const y = Math.max(-(height * scale - diameter) / 2, Math.min(transform.y, (height * scale - diameter) / 2));
    const side = diameter / scale;
    return { zoom, x, y, scale, side, sourceX: Math.max(0, width / 2 - (diameter / 2 + x) / scale), sourceY: Math.max(0, height / 2 - (diameter / 2 + y) / scale) };
}
export async function loadAvatar(file: File) {
    if (file.size > 20 * 1024 * 1024)
        throw new Error("请选择小于 20MB 的图片");
    const decoded = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => { throw new Error("无法读取图片，请选择 JPG、PNG 或 WebP 静态图片"); });
    try {
        if (decoded.width * decoded.height > 40000000 || Math.min(decoded.width, decoded.height) < 128)
            throw new Error("请选择至少 128 像素且不超过 4000 万像素的图片");
        const ratio = Math.min(1, 4096 / Math.max(decoded.width, decoded.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(decoded.width * ratio);
        canvas.height = Math.round(decoded.height * ratio);
        if (Math.min(canvas.width, canvas.height) < 128)
            throw new Error("图片过于狭长，请选择更接近方形的图片");
        const ctx = canvas.getContext("2d");
        if (!ctx)
            throw new Error("无法处理图片");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);
        return canvas;
    }
    finally {
        decoded.close();
    }
}
export async function exportAvatar(image: HTMLCanvasElement, diameter: number, transform: CropTransform) {
    const g = cropGeometry(image.width, image.height, diameter, transform), side = Math.min(512, Math.floor(g.side));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("无法生成头像");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(image, g.sourceX, g.sourceY, g.side, g.side, 0, 0, side, side);
    for (const quality of [.85, .7, .55]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= 512 * 1024)
            return blob;
    }
    throw new Error("头像过大，请重新选择图片");
}
