const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const CTGMoviesProvider = require("../provider.js");
const manifest = require("../manifest.json");

const BASE_URL = "https://ctgmovies.com";
const provider = new CTGMoviesProvider();

const toId = (url) => "ctg:" + Buffer.from(url).toString("base64url");
const fromId = (id) => Buffer.from(id.replace("ctg:", ""), "base64url").toString();
const stType = (t) => (t === "tvseries" ? "series" : t);

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, extra }) => {
  try {
    const url = extra && extra.search
      ? `${BASE_URL}/search?q=${encodeURIComponent(extra.search)}`
      : BASE_URL;
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const seen = new Set();
    const metas = [];
    $('a[href*="/movies/"], a[href*="/series/"], a[href*="/tv/"]').each((i, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      if (href.startsWith("/")) href = BASE_URL + href;
      if (seen.has(href)) return;
      seen.add(href);
      const img = $(el).find("img").first();
      const name = (img.attr("alt") || $(el).text()).trim();
      if (!name) return;
      let poster = img.attr("src") || img.attr("data-src");
      if (poster && poster.includes("/_next/image?url=")) {
        poster = decodeURIComponent(poster.split("/_next/image?url=")[1].split("&")[0]);
      } else if (poster && poster.startsWith("/")) {
        poster = BASE_URL + poster;
      }
      metas.push({ id: toId(href), type, name, poster });
    });
    return { metas: metas.slice(0, 100) };
  } catch (e) {
    console.error("Catalog error:", e.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  const m = await provider.getMeta({ id: fromId(id), type: type === "series" ? "tv" : "movie" });
  if (!m) return { meta: null };
  return { meta: { ...m, id, type: stType(m.type), imdbId: undefined } };
});

builder.defineStreamHandler(async ({ type, id }) => {
  const list = await provider.getStream({ id: fromId(id) });
  const subtitles = list
    .filter((s) => s.quality === "subtitle")
    .map((s, i) => ({ id: String(i), url: s.url, lang: s.name.includes("Hindi") ? "hin" : "eng" }));
  const streams = list
    .filter((s) => s.quality !== "subtitle")
    .map((s) => ({ name: "CTGMovies", title: s.name, url: s.url, subtitles }));
  return { streams };
});

const router = getRouter(builder.getInterface());

module.exports = (req, res) => {
  router(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
};
