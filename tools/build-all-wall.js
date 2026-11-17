/**
 * 전체 사진 화면용 모자이크 한 장을 만든다.
 * 사진 목록이 그대로면 wall.jpg를 다시 쓰지 않는다.
 */

const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");

const { WEB, COLLECTIONS_DIR } = require("./paths");

const OUT_DIR = path.join(WEB, "all-photos");
const WALL_FILE = path.join(OUT_DIR, "wall.jpg");
const ORDER_FILE = path.join(OUT_DIR, "order.json");
const TILE = 180;
const GAP = 1;

function chooseCols(count) {
  if (count <= 1) return 1;
  let best = 12;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let cols = 8; cols <= 14; cols += 1) {
    const rem = count % cols;
    const empty = rem === 0 ? 0 : cols - rem;
    const score = empty * 10 + Math.abs(cols - 12);
    if (score < bestScore) {
      bestScore = score;
      best = cols;
    }
  }
  return best;
}

function loadSharp() {
  try {
    return require("sharp");
  } catch {
    return null;
  }
}

function isHiddenCollection(id) {
  const n = String(id || "")
    .replace(/^_/, "")
    .toUpperCase();
  return n === "WALL";
}

function isGalleryExcludedFile(name) {
  const stem = path.parse(name).name.toLowerCase();
  return stem === "background" || stem === "bsckground" || stem.startsWith("bg-");
}

async function listPublicPhotos(collections) {
  const photos = [];
  for (const collection of collections) {
    if (!collection || !collection.id || isHiddenCollection(collection.id)) continue;
    const jsonPath = path.join(COLLECTIONS_DIR, collection.id, "images.json");
    let data;
    try {
      data = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    } catch {
      continue;
    }
    const images = Array.isArray(data) ? data : data && data.images;
    if (!Array.isArray(images)) continue;
    for (const item of images) {
      const file = item && item.src ? path.basename(item.src) : "";
      if (!file || isGalleryExcludedFile(file)) continue;
      const abs = path.join(COLLECTIONS_DIR, collection.id, file);
      try {
        const stat = await fs.stat(abs);
        photos.push({
          collectionId: collection.id,
          file,
          src: `collections/${collection.id}/${file}`,
          abs,
          mtimeMs: Number(stat.mtimeMs) || 0,
          size: Number(stat.size) || 0,
        });
      } catch {
        // missing file
      }
    }
  }
  return photos;
}

function layoutHash(photos, cols) {
  const hash = crypto.createHash("sha1");
  hash.update(`cols=${cols};tile=${TILE};gap=${GAP}\n`);
  for (const photo of photos) {
    hash.update(
      `${photo.collectionId}\0${photo.file}\0${photo.mtimeMs}\0${photo.size}\n`
    );
  }
  return hash.digest("hex");
}

async function readExistingHash() {
  try {
    const data = JSON.parse(await fs.readFile(ORDER_FILE, "utf8"));
    return data && data.hash ? String(data.hash) : "";
  } catch {
    return "";
  }
}

async function writeWall(sharp, photos, cols) {
  const count = photos.length;
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = cols * TILE + Math.max(0, cols - 1) * GAP;
  const height = rows * TILE + Math.max(0, rows - 1) * GAP;
  const composites = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const buf = await sharp(photos[i].abs, { failOn: "none", animated: true })
      .rotate()
      .resize(TILE, TILE, { fit: "cover", position: "centre" })
      .jpeg({ quality: 82 })
      .toBuffer();
    composites.push({
      input: buf,
      left: col * (TILE + GAP),
      top: row * (TILE + GAP),
    });
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  const tmp = WALL_FILE + ".tmp";
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite(composites)
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toFile(tmp);
  await fs.rename(tmp, WALL_FILE).catch(async () => {
    await fs.copyFile(tmp, WALL_FILE);
    await fs.unlink(tmp).catch(() => {});
  });
  return { cols, rows, width, height };
}

async function buildAllWall(collections) {
  const sharp = loadSharp();
  if (!sharp) {
    console.warn("⚠️ sharp가 없어 전체 사진 벽을 건너뜁니다.");
    return { changed: false };
  }
  const photos = await listPublicPhotos(collections);
  const cols = chooseCols(photos.length);
  const hash = layoutHash(photos, cols);
  const existing = await readExistingHash();
  try {
    const wallStat = await fs.stat(WALL_FILE);
    if (existing === hash && wallStat.size > 0) {
      return { changed: false, count: photos.length };
    }
  } catch {
    // rebuild
  }
  const layout = await writeWall(sharp, photos, cols);
  const order = {
    cols: layout.cols,
    rows: layout.rows,
    tile: TILE,
    gap: GAP,
    hash,
    images: photos.map((photo) => ({
      collectionId: photo.collectionId,
      file: photo.file,
      src: photo.src,
    })),
  };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(ORDER_FILE, JSON.stringify(order, null, 2), "utf8");
  console.log(
    `🧱 전체 사진 벽 ${photos.length}장 → all-photos/wall.jpg (${layout.cols}×${layout.rows})`
  );
  return { changed: true, count: photos.length };
}

module.exports = { buildAllWall };
