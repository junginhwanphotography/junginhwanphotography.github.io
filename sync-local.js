/**
 * WALL / collections 변경 감지 → images.json·collections.json 갱신만 (Git/서버 없음)
 * sync-and-push.js, sync-and-serve.js에서 사용
 */

const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname);
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

function isImage(name) {
  return IMAGE_EXT.includes(path.extname(name).toLowerCase());
}

async function getWallImageList() {
  const dir = path.join(ROOT, "WALL");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isImage(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  } catch {
    return [];
  }
}

async function getCurrentWallJsonList() {
  try {
    const raw = await fs.readFile(path.join(ROOT, "images.json"), "utf8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.images || []);
    return (list || [])
      .filter((item) => item && item.src)
      .map((item) => path.basename(item.src))
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
  } catch {
    return null;
  }
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

async function runSync() {
  console.log("📷 WALL / collections 동기화\n");

  let changed = false;

  const wallFiles = await getWallImageList();
  const wallJson = await getCurrentWallJsonList();
  if (!arraysEqual(wallFiles, wallJson)) {
    console.log("🖼 WALL 이미지 변경 감지 → images.json 재생성");
    run("node generate-images-json.js");
    changed = true;
  } else {
    console.log("🖼 WALL 변경 없음");
  }

  const collectionDirs = await getCollectionDirs();
  const collectionDirsByCreation = await getCollectionDirsByCreationOrder();
  let collections = await loadCollectionsJson();
  const byId = new Map(collections.map((c) => [c.id, c]));

  const kept = collections.filter((c) => c.id === "wall" || collectionDirs.includes(c.id));
  if (kept.length !== collections.length) {
    collections = kept;
    byId.clear();
    collections.forEach((c) => byId.set(c.id, c));
    changed = true;
    console.log("📁 삭제된 컬렉션 폴더 반영 (collections.json 정리)");
  }

  for (const id of collectionDirs) {
    if (id === "wall" || byId.has(id)) continue;
    byId.set(id, { id, name: id, path: `collection.html?collection=${id}` });
    changed = true;
    console.log(`📁 새 컬렉션 추가: ${id}`);
  }

  const ordered = [];
  if (byId.has("wall")) ordered.push(byId.get("wall"));
  for (const id of collectionDirsByCreation) {
    if (byId.has(id)) ordered.push(byId.get(id));
  }
  await saveCollectionsJson(ordered);

  for (const id of collectionDirs) {
    const currentFiles = await getCollectionImageList(id);
    const jsonFiles = await getCollectionJsonList(id);
    if (!arraysEqual(currentFiles, jsonFiles)) {
      console.log(`🖼 컬렉션 "${id}" 이미지 변경 감지 → images.json 재생성`);
      run(`node generate-collection-json.js "${id}"`);
      changed = true;
    }
  }

  if (!changed) {
    console.log("\n✅ 적용할 변경 없음.");
  }

  return changed;
}

module.exports = { runSync };
