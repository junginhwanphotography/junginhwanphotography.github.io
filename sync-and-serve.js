/**
 * 로컬 변경 감지 → 적용 후 로컬 서버 실행 (푸시 없음)
 * 프로젝트 루트에서 실행: node sync-and-serve.js
 */

const { runSync } = require("./sync-local.js");

runSync()
  .then(() => {
    console.log("\n🌐 로컬 서버 실행 중...\n");
    require("./start-server.js");
  })
  .catch((err) => {
    console.error("❌ 오류:", err.message);
    process.exit(1);
  });
