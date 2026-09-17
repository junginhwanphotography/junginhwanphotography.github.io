/**
 * collections.json 기준으로 sitemap.xml을 만들고,
 * index.html noscript 컬렉션 링크를 동기화합니다.
 */

const fs = require("fs").promises;
const path = require("path");

const ROOT = path.resolve(__dirname);
const DEFAULT_SITE_URL = "https://junginhwanphotography.github.io";

function isHiddenCollection(id) {
  const n = String(id || "")
    .replace(/^_/, "")
    .toUpperCase();
  return n === "WALL";
}

function displayName(id) {
  return id && String(id).startsWith("_") ? String(id).slice(1) : String(id || "");
}

async function siteUrl() {
  try {
    const raw = await fs.readFile(
      path.join(ROOT, ".photo-site-manager", "layout.json"),
      "utf8"
    );
    const layout = JSON.parse(raw);
    const url = layout && layout.preview && layout.preview.mainPageUrl;
    if (url) return String(url).replace(/\/+$/, "");
  } catch {
    // layout.json이 없으면 기본 도메인 사용
  }
  return DEFAULT_SITE_URL;
}

async function publicCollections() {
  const raw = await fs.readFile(path.join(ROOT, "collections.json"), "utf8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) return [];
  return list.filter((c) => c && c.id && !isHiddenCollection(c.id));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeSitemap(origin, collections, lastmod) {
  const urls = [
    { loc: origin + "/", priority: "1.0" },
    ...collections.map((c) => ({
      loc: origin + "/collection.html?collection=" + encodeURIComponent(c.id),
      priority: "0.8",
    })),
  ];

  const body = urls
    .map(
      (u) => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  await fs.writeFile(path.join(ROOT, "sitemap.xml"), xml, "utf8");
}

async function writeRobots(origin) {
  const text = `User-agent: *
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
  await fs.writeFile(path.join(ROOT, "robots.txt"), text, "utf8");
}

async function updateIndexNoscript(collections) {
  const indexPath = path.join(ROOT, "index.html");
  let html = await fs.readFile(indexPath, "utf8");
  const start = "<!-- SEO_COLLECTION_LINKS -->";
  const end = "<!-- /SEO_COLLECTION_LINKS -->";
  const startAt = html.indexOf(start);
  const endAt = html.indexOf(end);
  if (startAt === -1 || endAt === -1 || endAt < startAt) return;

  const links = collections
    .map((c) => {
      const href = "collection.html?collection=" + encodeURIComponent(c.id);
      const name = displayName(c.id);
      return `        <a href="${href}">${xmlEscape(name)}</a>`;
    })
    .join("\n");

  html =
    html.slice(0, startAt + start.length) +
    "\n" +
    links +
    "\n        " +
    html.slice(endAt);
  await fs.writeFile(indexPath, html, "utf8");
}

async function generateSitemap() {
  const origin = await siteUrl();
  const collections = await publicCollections();
  const lastmod = new Date().toISOString().slice(0, 10);
  await writeSitemap(origin, collections, lastmod);
  await writeRobots(origin);
  await updateIndexNoscript(collections);
  console.log(`🗺 sitemap.xml 갱신 (${collections.length + 1}개 URL)`);
}

if (require.main === module) {
  generateSitemap().catch((err) => {
    console.error("❌ sitemap 생성 실패:", err.message);
    process.exit(1);
  });
}

module.exports = { generateSitemap };
