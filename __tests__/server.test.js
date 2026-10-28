const request = require("supertest");
const server = require("../tools/server");

describe("HTTP 서버 기본 동작", () => {
  it("GET / 요청 시 200과 HTML을 반환한다", async () => {
    const response = await request(server).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("Jung In Hwan");
  });

  it("컬렉션 JSON을 web에서 제공한다", async () => {
    const response = await request(server).get("/collections.json");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(Array.isArray(response.body)).toBe(true);
  });

  it("사진 파일은 collections 폴더에서 제공한다", async () => {
    const response = await request(server).get(
      "/collections/paris%20to%20rome/images.json"
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(Array.isArray(response.body.images)).toBe(true);
    expect(response.body.images.length).toBeGreaterThan(0);
  });

  it("존재하지 않는 경로에 404를 반환한다", async () => {
    const response = await request(server).get("/__not_exists__.html");

    expect(response.status).toBe(404);
    expect(response.text).toContain("404 Not Found");
  });
});
