const server = require("./server.js");
const { exec } = require("child_process");

const PORT = process.env.PORT || 3000;
const HOST = "127.0.0.1";

server.on("error", (err) => {
  console.error("❌ 서버 오류:", err.message);
  if (err.code === "EADDRINUSE") {
    console.error(`   포트 ${PORT}이(가) 이미 사용 중입니다. 다른 포트를 쓰거나 해당 프로그램을 종료하세요.`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`✅ 서버 실행 중: http://127.0.0.1:${PORT}`);
  console.log(`   브라우저에서 위 주소로 접속하세요. (이 창은 닫지 마세요)`);
  
  // Windows에서 브라우저 자동 열기
  const url = `http://${HOST}:${PORT}`;
  const command = process.platform === "win32" 
    ? `start ${url}` 
    : process.platform === "darwin" 
    ? `open ${url}` 
    : `xdg-open ${url}`;
  
  exec(command, (error) => {
    if (error) {
      console.log(`   브라우저를 자동으로 열 수 없습니다. 수동으로 ${url} 을 열어주세요.`);
    }
  });
});



