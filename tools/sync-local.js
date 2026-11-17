/**
 * collections 변경 감지 → images.json·collections.json 갱신만 (Git/서버 없음)
 * 폴더 이름이 _ 로 시작하면 "맨 위 + 간격" 컬렉션으로 표시됩니다.
 */

const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");
const { generateSitemap } = require("./generate-sitemap.js");

const { PROJECT: ROOT, WEB, COLLECTIONS_DIR, COLLECTIONS_URL } = require("./paths");
const {
  optimizeCollectionPhotos,
  summarize,
  loadOptCache,
  saveOptCache,
} = require("./optimize-photos");
const { buildAllWall } = require("./build-all-wall");
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
/** 맨 위에 간격을 두는 컬렉션: 폴더 이름이 이 문자로 시작 */
const TOP_COLLECTION_PREFIX = "_";

function isImage(name) {
  return IMAGE_EXT.includes(path.extname(name).toLowerCase());
}

/** 파일명 stem이 background(오타 bsckground 포함)면 페이지 배경용 */
function isBackgroundFile(name) {
  const stem = path.parse(name).name.toLowerCase();
  return stem === "background" || stem === "bsckground";
}

/** bg- 접두사 씬 에셋(기차·랜드 등)은 갤러리에서 제외 */
function isSceneAssetFile(name) {
  const stem = path.parse(name).name.toLowerCase();
  return stem.startsWith("bg-");
}

function isGalleryExcludedFile(name) {
  return isBackgroundFile(name) || isSceneAssetFile(name);
}

/** bsckground.* → background.* 로 통일 (확장자 유지) */
async function normalizeBackgroundFilename(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const bgLike = entries.filter(
      (e) => e.isFile() && isImage(e.name) && isBackgroundFile(e.name)
    );
    if (!bgLike.length) return null;
    const canonical = bgLike.find(
      (e) => path.parse(e.name).name.toLowerCase() === "background"
    );
    const typo = bgLike.find(
      (e) => path.parse(e.name).name.toLowerCase() === "bsckground"
    );
    if (typo && !canonical) {
      const ext = path.extname(typo.name);
      const dest = path.join(dir, `background${ext}`);
      await fs.rename(path.join(dir, typo.name), dest);
      return `background${ext}`;
    }
    return canonical ? canonical.name : bgLike[0].name;
  } catch {
    return null;
  }
}

async function getCollectionDirs() {
  const dir = COLLECTIONS_DIR;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function createdMsFromStat(stat) {
  const birth = (stat.birthtimeMs || (stat.birthtime && stat.birthtime.getTime()) || 0);
  const mtime = (stat.mtimeMs || (stat.mtime && stat.mtime.getTime()) || 0);
  if (birth > 0) return birth;
  return mtime;
}

function createdMsFromIso(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

async function getCollectionCreatedMs() {
  const dir = COLLECTIONS_DIR;
  const map = new Map();
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const stat = await fs.stat(path.join(dir, e.name));
          map.set(e.name, createdMsFromStat(stat));
        })
    );
  } catch {
    // collections 폴더가 없으면 빈 맵
  }
  return map;
}

function detectRenames(oldIds, newIds) {
  const removed = oldIds.filter((id) => !newIds.includes(id));
  const added = newIds.filter((id) => !oldIds.includes(id));
  const map = new Map();
  if (removed.length === 1 && added.length === 1) {
    map.set(added[0], removed[0]);
  }
  return map;
}

async function getCollectionImageList(collectionId) {
  const dir = path.join(COLLECTIONS_DIR, collectionId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name !== "images.json" && isImage(e.name) && !isGalleryExcludedFile(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
}

async function getCollectionJsonList(collectionId) {
  const file = path.join(COLLECTIONS_DIR, collectionId, "images.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.images || []);
    return (list || [])
      .filter((item) => item && item.src)
      .map((item) => path.basename(item.src))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return null;
  }
}

/** images.json 안의 src가 모두 현재 폴더명(id)과 일치하는지 검사. 이름 변경 시 false */
async function imagesJsonPathsMatchId(collectionId) {
  const file = path.join(COLLECTIONS_DIR, collectionId, "images.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.images || []);
    const srcList = (list || []).filter((item) => item && item.src).map((item) => item.src);
    if (srcList.length === 0) return true;
    const prefix = `${COLLECTIONS_URL}/${collectionId}/`;
    return srcList.every((src) => src.startsWith(prefix));
  } catch {
    return false;
  }
}

function photoOrderForCollection(entry, isNew) {
  if (isNew) return "asc";
  return entry && entry.photoOrder === "asc" ? "asc" : "desc";
}

function sortPhotoNames(names, order) {
  const copy = [...names];
  copy.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  if (order !== "asc") copy.reverse();
  return copy;
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

async function loadCollectionsJson() {
  const file = path.join(WEB, "collections.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveCollectionsJson(list) {
  const file = path.join(WEB, "collections.json");
  await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
}

function run(cmd, cwd = ROOT) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

/** 컬렉션 폴더의 사진 목록을 읽어 images.json 생성/갱신 (프로세스 분리 없이 직접 실행) */
async function generateCollectionImagesJson(collectionId, photoOrder = "desc") {
  const dir = path.join(COLLECTIONS_DIR, collectionId);
  const outFile = path.join(dir, "images.json");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {}
  const backgroundFile = await normalizeBackgroundFilename(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = sortPhotoNames(
    entries
      .filter((e) => e.isFile() && e.name !== "images.json" && isImage(e.name) && !isGalleryExcludedFile(e.name))
      .map((e) => e.name),
    photoOrder
  );
  const images = files.map((file) => ({
    src: `${COLLECTIONS_URL}/${collectionId}/${file}`,
    alt: path.parse(file).name,
  }));
  const data = {
    background: backgroundFile
      ? `${COLLECTIONS_URL}/${collectionId}/${backgroundFile}`
      : null,
    images,
  };
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");
  return { count: images.length, background: backgroundFile };
}

async function runSync() {
  process.chdir(ROOT);
  console.log("📷 collections 동기화\n");
  console.log("   작업 폴더:", ROOT, "\n");

  let changed = false;

  const collectionDirs = await getCollectionDirs();
  const createdMsById = await getCollectionCreatedMs();
  let collections = await loadCollectionsJson();
  const byId = new Map(collections.map((c) => [c.id, c]));
  const renameFrom = detectRenames(
    collections.map((c) => c.id),
    collectionDirs
  );

  const kept = collections.filter((c) => collectionDirs.includes(c.id));
  if (kept.length !== collections.length) {
    collections = kept;
    byId.clear();
    collections.forEach((c) => byId.set(c.id, c));
    changed = true;
    console.log("📁 삭제된 컬렉션 폴더 반영 (collections.json 정리)");
  }

  const newIds = new Set();
  for (const id of collectionDirs) {
    if (byId.has(id)) continue;
    const oldId = renameFrom.get(id);
    const oldEntry = oldId ? byId.get(oldId) : null;
    newIds.add(id);
    byId.set(id, {
      id,
      name: id,
      path: `collection.html?collection=${encodeURIComponent(id)}`,
      photoOrder: oldEntry && oldEntry.photoOrder === "desc" ? "desc" : "asc",
      createdAt: oldEntry && oldEntry.createdAt,
    });
    changed = true;
    if (oldId) {
      console.log(`📁 컬렉션 이름 변경: ${oldId} → ${id}`);
    } else {
      console.log(`📁 새 컬렉션 추가: ${id}`);
    }
  }

  // 메뉴 순서는 폴더 생성일 최신이 위. 한 번 기록한 createdAt은 이름 변경·CI checkout에도 유지한다.
  const ordered = collectionDirs
    .map((id) => {
      const c = byId.get(id);
      const inherited = c && c.createdAt;
      const createdAt =
        inherited || new Date(createdMsById.get(id) || Date.now()).toISOString();
      return {
        ...c,
        id,
        name: id,
        path: `collection.html?collection=${encodeURIComponent(id)}`,
        photoOrder: photoOrderForCollection(c, newIds.has(id) && !renameFrom.has(id)),
        createdAt,
      };
    })
    .sort((a, b) => {
      const aPrefix = a.id.startsWith(TOP_COLLECTION_PREFIX);
      const bPrefix = b.id.startsWith(TOP_COLLECTION_PREFIX);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return createdMsFromIso(b.createdAt) - createdMsFromIso(a.createdAt);
    });
  await saveCollectionsJson(ordered);

  // 모든 컬렉션의 images.json을 매번 재생성 (사진 추가/삭제/변경 반영)
  const optCache = await loadOptCache();
  for (const id of collectionDirs) {
    try {
      const entry = byId.get(id);
      const photoOrder = photoOrderForCollection(entry, newIds.has(id));
      const compressed = await optimizeCollectionPhotos(
        path.join(COLLECTIONS_DIR, id),
        optCache
      );
      summarize(id, compressed);
      if (compressed.changed) changed = true;
      const { count, background } = await generateCollectionImagesJson(id, photoOrder);
      const bgNote = background ? `, 배경 ${background}` : "";
      console.log(`🖼 컬렉션 "${id}" → images.json 갱신 (${count}개 이미지${bgNote})`);
      changed = true;
    } catch (err) {
      console.error(`❌ 컬렉션 "${id}" images.json 생성 실패:`, err.message);
    }
  }
  await saveOptCache(optCache);

  try {
    const wall = await buildAllWall(ordered);
    if (wall && wall.changed) changed = true;
  } catch (err) {
    console.error("❌ 전체 사진 벽 생성 실패:", err.message);
  }

  if (!changed) {
    console.log("\n✅ 적용할 변경 없음 (컬렉션 폴더 없음).");
  } else {
    console.log("\n✅ 모든 컬렉션 갱신 완료.");
  }

  await generateSitemap({ bumpLastmod: changed });

  return changed;
}

module.exports = { runSync };
