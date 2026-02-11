const fs = require("fs").promises;
const path = require("path");

const ROOT = process.cwd();
const COLLECTION_NAME = process.argv[2];

if (!COLLECTION_NAME) {
  console.error("❌ 사용법: node generate-collection-json.js [컬렉션명]");
  console.error('예: node generate-collection-json.js "통신보안"');
  process.exit(1);
}

const COLLECTION_DIR = path.join(ROOT, "collections", COLLECTION_NAME);
const OUTPUT_FILE = path.join(COLLECTION_DIR, "images.json");

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

async function main() {
  try {
    // 컬렉션 폴더가 없으면 생성
    try {
      await fs.access(COLLECTION_DIR);
    } catch {
      await fs.mkdir(COLLECTION_DIR, { recursive: true });
      console.log(`✅ 컬렉션 폴더 생성: ${COLLECTION_DIR}`);
    }

    const entries = await fs.readdir(COLLECTION_DIR, { withFileTypes: true });

    const files = entries
      .filter((entry) => entry.isFile() && entry.name !== "images.json")
      .map((entry) => entry.name)
      .filter((name) =>
        IMAGE_EXTENSIONS.includes(path.extname(name).toLowerCase())
      )
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

    const data = files.map((file) => ({
      src: `collections/${COLLECTION_NAME}/${file}`,
      alt: path.parse(file).name,
    }));

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2), "utf8");

    console.log(
      `✅ collections/${COLLECTION_NAME}/images.json 생성 완료 (${data.length}개 이미지)\n` +
        ` - 폴더: ${COLLECTION_DIR}\n` +
        ` - 파일: ${OUTPUT_FILE}`
    );
  } catch (error) {
    console.error("❌ images.json 생성 중 오류:", error);
    process.exit(1);
  }
}

main();