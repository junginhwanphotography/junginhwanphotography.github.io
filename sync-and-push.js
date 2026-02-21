/**
 * WALL / collections 변경 감지 → images.json 생성/갱신 → git commit & push
 * 프로젝트 루트에서 실행: node sync-and-push.js
 */

const path = require("path");
const { execSync } = require("child_process");
const { runSync } = require("./sync-local.js");

const ROOT = path.resolve(__dirname);

function run(cmd, cwd = ROOT) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

runSync()
  .then(() => {
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
  })
  .catch((err) => {
    console.error("❌ 오류:", err.message);
    process.exit(1);
  });
