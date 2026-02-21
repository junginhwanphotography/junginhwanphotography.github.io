/**
 * WALL / collections 변경 감지 → images.json 생성/갱신 → git commit & push
 * 프로젝트 루트에서 실행: node sync-and-push.js
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

async function main() {
  console.log("📷 WALL / collections 동기화 후 푸시\n");

  let changed = false;

  // ----- WALL -----
  const wallFiles = await getWallImageList();
  const wallJson = await getCurrentWallJsonList();
  if (!arraysEqual(wallFiles, wallJson)) {
    console.log("🖼 WALL 이미지 변경 감지 → images.json 재생성");
    run("node generate-images-json.js");
    changed = true;
  } else {
    console.log("🖼 WALL 변경 없음");
  }

  // ----- collections -----
  const collectionDirs = await getCollectionDirs();
  let collections = await loadCollectionsJson();
  const byId = new Map(collections.map((c) => [c.id, c]));

  // 폴더 없어진 항목 제거
  const kept = collections.filter((c) => c.id === "wall" || collectionDirs.includes(c.id));
  if (kept.length !== collections.length) {
    collections = kept;
    await saveCollectionsJson(collections);
    byId.clear();
    collections.forEach((c) => byId.set(c.id, c));
    changed = true;
    console.log("📁 삭제된 컬렉션 폴더 반영 (collections.json 정리)");
  }

  // 새 폴더 → collections.json에 추가
  for (const id of collectionDirs) {
    if (id === "wall" || byId.has(id)) continue;
    const name = id;
    collections.push({
      id,
      name,
      path: `collection.html?collection=${id}`,
    });
    byId.set(id, collections[collections.length - 1]);
    changed = true;
    console.log(`📁 새 컬렉션 추가: ${id}`);
  }

  if (collections.length !== (await loadCollectionsJson()).length || collectionDirs.some((id) => !byId.has(id))) {
    await saveCollectionsJson(collections);
  }

  // 컬렉션별 images.json 필요 시 재생성 (새 컬렉션 + 기존 폴더 내 이미지 변경)
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

  // ----- Git -----
  try {
    const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim();
    if (!status) {
      console.log("\n📤 커밋할 변경 없음. 푸시 생략.");
      return;
    }
    console.log("\n📤 Git 커밋 및 푸시...");
    run("git add -A");
    run('git commit -m "chore: WALL/collections 동기화"');
    run("git push");
    console.log("\n✅ 동기화 및 푸시 완료.");
  } catch (e) {
    if (e.status === 128 || (e.message && e.message.includes("not a git repository"))) {
      console.log("\n⚠ 이 폴더는 Git 저장소가 아니거나 원격이 없어 푸시를 건너뜁니다.");
    } else {
      throw e;
    }
  }
}

main().catch((err) => {
  console.error("❌ 오류:", err.message);
  process.exit(1);
});
