/**
 * collections 변경 감지 → images.json·collections.json 갱신만 (Git/서버 없음)
 * 폴더 이름이 _ 로 시작하면 "맨 위 + 간격" 컬렉션으로 표시됩니다.
 */

const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname);
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
/** 맨 위에 간격을 두는 컬렉션: 폴더 이름이 이 문자로 시작 */
const TOP_COLLECTION_PREFIX = "_";

function isImage(name) {
  return IMAGE_EXT.includes(path.extname(name).toLowerCase());
}

async function getCollectionDirs() {
  const dir = path.join(ROOT, "collections");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function getCollectionDirsByCreationOrder() {
  const dir = path.join(ROOT, "collections");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const withBirth = await Promise.all(
      dirs.map(async (e) => {
        const stat = await fs.stat(path.join(dir, e.name));
        const t = (stat.birthtime && stat.birthtime.getTime) ? stat.birthtime.getTime() : (stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : 0);
        return { id: e.name, birthtime: t };
      })
    );
    withBirth.sort((a, b) => a.birthtime - b.birthtime);
    return withBirth.map((d) => d.id);
  } catch {
    return [];
  }
}

async function getCollectionImageList(collectionId) {
  const dir = path.join(ROOT, "collections", collectionId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name !== "images.json" && isImage(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
}

async function getCollectionJsonList(collectionId) {
  const file = path.join(ROOT, "collections", collectionId, "images.json");
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
  const file = path.join(ROOT, "collections", collectionId, "images.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.images || []);
    const srcList = (list || []).filter((item) => item && item.src).map((item) => item.src);
    if (srcList.length === 0) return true;
    const prefix = `collections/${collectionId}/`;
    return srcList.every((src) => src.startsWith(prefix));
  } catch {
    return false;
  }
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

async function loadCollectionsJson() {
  const file = path.join(ROOT, "collections.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveCollectionsJson(list) {
  const file = path.join(ROOT, "collections.json");
  await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
}

function run(cmd, cwd = ROOT) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

/** 컬렉션 폴더의 사진 목록을 읽어 images.json 생성/갱신 (프로세스 분리 없이 직접 실행) */
async function generateCollectionImagesJson(collectionId) {
  const dir = path.join(ROOT, "collections", collectionId);
  const outFile = path.join(dir, "images.json");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {}
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name !== "images.json" && isImage(e.name))
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  const data = files.map((file) => ({
    src: `collections/${collectionId}/${file}`,
    alt: path.parse(file).name,
  }));
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");
  return data.length;
}

async function runSync() {
  process.chdir(ROOT);
  console.log("📷 collections 동기화\n");
  console.log("   작업 폴더:", ROOT, "\n");

  let changed = false;

  const collectionDirs = await getCollectionDirs();
  const collectionDirsByCreation = await getCollectionDirsByCreationOrder();
  let collections = await loadCollectionsJson();
  const byId = new Map(collections.map((c) => [c.id, c]));

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
    newIds.add(id);
    byId.set(id, {
      id,
      name: id,
      path: `collection.html?collection=${encodeURIComponent(id)}`,
    });
    changed = true;
    console.log(`📁 새 컬렉션 추가: ${id}`);
  }

  const creationOrdered = collectionDirsByCreation.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const prefixFirst = creationOrdered.filter((c) => c.id.startsWith(TOP_COLLECTION_PREFIX));
  const rest = creationOrdered.filter((c) => !c.id.startsWith(TOP_COLLECTION_PREFIX));
  const ordered = [...prefixFirst, ...rest].map((c) => ({
    ...c,
    path: `collection.html?collection=${encodeURIComponent(c.id)}`,
  }));
  await saveCollectionsJson(ordered);

  // 모든 컬렉션의 images.json을 매번 재생성 (사진 추가/삭제/변경 반영)
  for (const id of collectionDirs) {
    try {
      const count = await generateCollectionImagesJson(id);
      console.log(`🖼 컬렉션 "${id}" → images.json 갱신 (${count}개 이미지)`);
      changed = true;
    } catch (err) {
      console.error(`❌ 컬렉션 "${id}" images.json 생성 실패:`, err.message);
    }
  }

  if (!changed) {
    console.log("\n✅ 적용할 변경 없음 (컬렉션 폴더 없음).");
  } else {
    console.log("\n✅ 모든 컬렉션 갱신 완료.");
  }

  return changed;
}

module.exports = { runSync };
