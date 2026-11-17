/**
 * 원본 해상도는 유지하고, 눈에 띄는 화질 손실 없이 파일만 줄인다.
 * 동기화·푸시 때 실행되며, 이미 줄어든 파일은 다시 건드리지 않는다.
 * TIFF·GIF·애니메이션·투명 PNG는 변환하지 않는다.
 */

const fs = require("fs").promises;
const path = require("path");

const { PROJECT } = require("./paths");
const CACHE_FILE = path.join(PROJECT, "photo-opt-cache.json");

const JPEG_QUALITY = 90;
const MIN_SAVE_RATIO = 0.05;
const MIN_SAVE_BYTES = 4096;
const SKIP_EXT = new Set([".gif", ".svg", ".tif", ".tiff"]);
const JPEG_EXT = new Set([".jpg", ".jpeg"]);
const PNG_EXT = new Set([".png"]);

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    return null;
  }
}

function cacheKey(filePath) {
  return path.relative(PROJECT, filePath).split(path.sep).join("/");
}

async function loadOptCache() {
  try {
    const data = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function saveOptCache(cache) {
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

function isCached(cache, filePath, stat) {
  const hit = cache[cacheKey(filePath)];
  return !!(hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs);
}

function remember(cache, filePath, stat) {
  cache[cacheKey(filePath)] = { size: stat.size, mtimeMs: stat.mtimeMs };
}

function forget(cache, filePath) {
  delete cache[cacheKey(filePath)];
}

function keepOriginalFormat(name) {
  const stem = path.parse(name).name.toLowerCase();
  return stem.startsWith("bg-") || stem === "background" || stem === "bsckground";
}

function tmpPath(filePath, ext) {
  return `${filePath}.opt-tmp${ext}`;
}

async function replaceWith(tmp, dest) {
  try {
    await fs.rename(tmp, dest);
  } catch {
    await fs.copyFile(tmp, dest);
    await fs.unlink(tmp).catch(() => {});
  }
}

async function hasVisibleAlpha(sharp, srcPath, meta) {
  if (!meta.hasAlpha) return false;
  const { data } = await sharp(srcPath)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] < 255) return true;
  }
  return false;
}

async function writeOptimized(sharp, srcPath, destPath, meta, asJpeg) {
  let image = sharp(srcPath, { failOn: "none" }).rotate();
  if (meta.icc) {
    image = image.keepIccProfile();
  }
  image = image.withMetadata({ orientation: 1 });
  if (asJpeg) {
    image = image.jpeg({
      quality: JPEG_QUALITY,
      progressive: true,
      mozjpeg: true,
      chromaSubsampling: "4:4:4",
    });
  } else {
    image = image.png({
      compressionLevel: 9,
      effort: 10,
      adaptiveFiltering: true,
    });
  }
  await image.toFile(destPath);
}

function worthReplacing(fromSize, toSize) {
  const saved = fromSize - toSize;
  return saved >= MIN_SAVE_BYTES && saved / fromSize >= MIN_SAVE_RATIO;
}

async function optimizeOne(sharp, srcPath) {
  const ext = path.extname(srcPath).toLowerCase();
  if (SKIP_EXT.has(ext) || (!JPEG_EXT.has(ext) && !PNG_EXT.has(ext) && ext !== ".webp")) {
    return { skipped: true };
  }

  const orig = await fs.stat(srcPath);
  const meta = await sharp(srcPath, { animated: true, failOn: "none" }).metadata();
  if ((meta.pages || 1) > 1) return { skipped: true, reason: "animated" };

  const parsed = path.parse(srcPath);
  const opaquePng =
    PNG_EXT.has(ext) &&
    !keepOriginalFormat(parsed.base) &&
    !(await hasVisibleAlpha(sharp, srcPath, meta));
  const asJpeg = JPEG_EXT.has(ext) || ext === ".webp" || opaquePng;
  const destPath = opaquePng ? path.join(parsed.dir, `${parsed.name}.jpg`) : srcPath;
  if (opaquePng) {
    try {
      await fs.access(destPath);
      if (path.resolve(destPath) !== path.resolve(srcPath)) {
        return { skipped: true, reason: "jpg-exists" };
      }
    } catch {
      // no colliding jpg
    }
  }

  const tmp = tmpPath(srcPath, asJpeg ? ".jpg" : ".png");
  await fs.unlink(tmp).catch(() => {});
  try {
    await writeOptimized(sharp, srcPath, tmp, meta, asJpeg);
    const next = await fs.stat(tmp);
    if (!worthReplacing(orig.size, next.size)) {
      await fs.unlink(tmp).catch(() => {});
      return { skipped: true, reason: "no-gain" };
    }
    await replaceWith(tmp, destPath);
    if (opaquePng && path.resolve(destPath) !== path.resolve(srcPath)) {
      await fs.unlink(srcPath).catch(() => {});
    }
    return {
      changed: true,
      from: orig.size,
      to: next.size,
      saved: orig.size - next.size,
      renamed: opaquePng ? path.basename(destPath) : null,
    };
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    return { skipped: true, reason: err.message };
  }
}

async function optimizeCollectionPhotos(dir, cache) {
  const sharp = loadSharp();
  const summary = { changed: 0, saved: 0, from: 0, to: 0, skipped: 0 };
  if (!sharp) {
    console.warn("⚠️ sharp가 없어 사진 압축을 건너뜁니다. 프로젝트 폴더에서 npm install 을 실행하세요.");
    return summary;
  }

  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return summary;
  }

  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "images.json" || entry.name.startsWith(".")) continue;
    const srcPath = path.join(dir, entry.name);
    try {
      const orig = await fs.stat(srcPath);
      if (cache && isCached(cache, srcPath, orig)) {
        summary.skipped += 1;
        continue;
      }
      const result = await optimizeOne(sharp, srcPath);
      if (result && result.changed) {
        summary.changed += 1;
        summary.saved += result.saved;
        summary.from += result.from;
        summary.to += result.to;
        const destPath = result.renamed
          ? path.join(dir, result.renamed)
          : srcPath;
        if (result.renamed) forget(cache, srcPath);
        remember(cache, destPath, await fs.stat(destPath));
      } else {
        summary.skipped += 1;
        if (cache) remember(cache, srcPath, orig);
      }
    } catch (err) {
      summary.skipped += 1;
      console.error(`⚠️ 압축 실패 "${entry.name}":`, err.message);
    }
  }
  return summary;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function summarize(label, summary) {
  if (!summary.changed) return;
  console.log(
    `📦 "${label}" 사진 압축 ${summary.changed}장 (${formatMb(summary.from)} → ${formatMb(summary.to)})`
  );
}

module.exports = {
  optimizeCollectionPhotos,
  summarize,
  loadOptCache,
  saveOptCache,
};
