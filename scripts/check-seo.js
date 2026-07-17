"use strict";

const assert = require("node:assert/strict");
const app = require("../server");

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(match => JSON.parse(match[1]));
}

async function run() {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const request = (path, options) => fetch(`${baseUrl}${path}`, options);

    const homeResponse = await request("/");
    const home = await homeResponse.text();
    assert.equal(homeResponse.status, 200);
    assert.match(home, /<link rel="canonical" href="https:\/\/dieguemtechstore\.com\/">/);
    assert.match(home, /<meta name="description" content="[^"]+">/);
    assert.doesNotMatch(home, /<meta name="keywords"/);
    assert.match(home, /"alternateName": "DieguemTech"/);

    const redirectResponse = await request("/index.html", { redirect: "manual" });
    assert.equal(redirectResponse.status, 301);
    assert.equal(redirectResponse.headers.get("location"), "/");

    const robots = await (await request("/robots.txt")).text();
    assert.match(robots, /Disallow: \/api\//);
    assert.match(robots, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);

    const sitemapResponse = await request("/sitemap.xml");
    const sitemap = await sitemapResponse.text();
    assert.equal(sitemapResponse.status, 200);
    assert.match(sitemapResponse.headers.get("content-type"), /application\/xml/);
    assert.doesNotMatch(sitemap, /<changefreq>|<priority>/);
    assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.ok(sitemapUrls.length > 20, "Le sitemap doit contenir les pages catalogue.");
    const productUrl = sitemapUrls.find(url => url.includes("/produit/"));
    assert.ok(productUrl, "Le sitemap doit contenir au moins une page produit.");

    const productResponse = await fetch(productUrl);
    const productHtml = await productResponse.text();
    assert.equal(productResponse.status, 200);
    assert.match(productHtml, /<meta property="og:type" content="product">/);
    assert.match(productHtml, /<link rel="canonical" href="[^"]+\/produit\/[^"]+">/);
    const productGraph = jsonLdBlocks(productHtml)[0]["@graph"];
    const product = productGraph.find(entry => entry["@type"] === "Product");
    assert.ok(product, "La page produit doit exposer Product en JSON-LD.");
    assert.equal(product.offers.priceCurrency, "XOF");
    assert.notEqual(product.brand?.name, "DieguemTech Store");

    const returnsHtml = await (await request("/livraison-retours")).text();
    const returnsGraph = jsonLdBlocks(returnsHtml)[0]["@graph"];
    const store = returnsGraph.find(entry => entry["@id"]?.endsWith("/#store"));
    assert.equal(store.hasMerchantReturnPolicy.merchantReturnLink, `${baseUrl}/livraison-retours`);
    assert.equal(store.hasMerchantReturnPolicy.applicableCountry, "SN");

    const paymentHtml = await (await request("/payment-cancel")).text();
    assert.match(paymentHtml, /<meta name="robots" content="noindex,nofollow,noarchive">/);

    console.log(`SEO OK: ${sitemapUrls.length} URL(s) verifiee(s) dans le sitemap.`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
