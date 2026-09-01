const fs = require("fs").promises;
const path = require("path");

const ROOT = path.resolve(__dirname);
// 환경변수로 전달 시 # 등 특수문자가 Windows에서도 안전하게 전달됨
const COLLECTION_NAME = process.env.COLLECTION_ID || process.argv[2];

if (!COLLECTION_NAME) {
  console.error("❌ 사용법: node generate-collection-json.js [컬렉션명] 또는 COLLECTION_ID 환경변수 설정");
  console.error('예: node generate-collection-json.js "통신보안"');
  process.exit(1);
}

const COLLECTION_DIR = path.join(ROOT, "collections", COLLECTION_NAME);
const OUTPUT_FILE = path.join(COLLECTION_DIR, "images.json");

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

function isBackgroundFile(name) {
  const stem = path.parse(name).name.toLowerCase();
  return stem === "background" || stem === "bsckground";
}

function isSceneAssetFile(name) {
  const stem = path.parse(name).name.toLowerCase();
  return stem.startsWith("bg-");
}

function isGalleryExcludedFile(name) {
  return isBackgroundFile(name) || isSceneAssetFile(name);
}

async function photoOrderFor(collectionId) {
  try {
    const raw = await fs.readFile(path.join(ROOT, "collections.json"), "utf8");
    const list = JSON.parse(raw);
    const entry = Array.isArray(list) && list.find((c) => c && c.id === collectionId);
    if (!entry) return "asc";
    return entry.photoOrder === "asc" ? "asc" : "desc";
  } catch {
    return "asc";
  }
}

async function main() {
  try {
    // 컬렉션 폴더가 없으면 생성
    try {
      await fs.access(COLLECTION_DIR);
    } catch {
      await fs.mkdir(COLLECTION_DIR, { recursive: true });
      console.log(`✅ 컬렉션 폴더 생성: ${COLLECTION_DIR}`);
    }

    const photoOrder = await photoOrderFor(COLLECTION_NAME);
    const entries = await fs.readdir(COLLECTION_DIR, { withFileTypes: true });

    const files = entries
      .filter((entry) => entry.isFile() && entry.name !== "images.json")
      .map((entry) => entry.name)
      .filter((name) =>
        IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase())
      )
      .filter((name) => !isGalleryExcludedFile(name));
    files.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    if (photoOrder !== "asc") files.reverse();

    const backgroundFile = entries
      .filter((entry) => entry.isFile() && isBackgroundFile(entry.name))
      .map((entry) => entry.name)[0];

    const images = files.map((file) => ({
      src: `collections/${COLLECTION_NAME}/${file}`,
      alt: path.parse(file).name,
    }));

    const data = {
      background: backgroundFile
        ? `collections/${COLLECTION_NAME}/${backgroundFile}`
        : null,
      images,
    };

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf8");

    console.log(
      `✅ collections/${COLLECTION_NAME}/images.json 생성 완료 (${images.length}개 이미지` +
        (backgroundFile ? `, 배경 ${backgroundFile}` : "") +
        `)\n` +
        ` - 폴더: ${COLLECTION_DIR}\n` +
        ` - 파일: ${OUTPUT_FILE}`
    );
  } catch (error) {
    console.error("❌ images.json 생성 중 오류:", error);
    process.exit(1);
  }
}

main();