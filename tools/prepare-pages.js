/**
 * GitHub Pages에 올릴 공개 파일만 _site 로 모읍니다.
 * web 페이지는 사이트 루트로, collections 사진은 /collections 로 둡니다.
 */

const fs = require("fs");
const path = require("path");
const { PROJECT, WEB, COLLECTIONS_DIR } = require("./paths");

const dest = path.join(PROJECT, "_site");

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(WEB, dest, { recursive: true });
if (fs.existsSync(COLLECTIONS_DIR)) {
  fs.cpSync(COLLECTIONS_DIR, path.join(dest, "collections"), { recursive: true });
}

console.log("📦 GitHub Pages 준비:", dest);
