const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const allProducts = require("../data/products");
const { offers: existingJumiaOffers } = require("../data/jumia-phone-offers");
const {
  MARKUP_PERCENT,
  PRICE_MULTIPLIER,
  SOURCE_PRICE_LIMIT,
  SOURCE_CHECKED_AT,
  offers,
  catalogProducts
} = require("../data/jumia-tecno-offers");

const root = path.resolve(__dirname, "..");
const catalogById = new Map(catalogProducts.map(product => [product.id, product]));
const existingNames = new Set(existingJumiaOffers.map(offer => offer.name.toLowerCase()));

assert.equal(MARKUP_PERCENT, 25, "La marge Tecno doit rester fixée à 25 %.");
assert.equal(PRICE_MULTIPLIER, 1.25, "Le multiplicateur Tecno doit être 1,25.");
assert.equal(SOURCE_PRICE_LIMIT, 150000, "Le plafond d'achat Tecno doit être 150 000 FCFA.");
assert.match(SOURCE_CHECKED_AT, /^\d{4}-\d{2}-\d{2}$/, "La date de vérification Tecno est invalide.");
assert.equal(offers.length, 10, "Le catalogue Tecno doit contenir exactement 10 offres.");
assert.equal(catalogProducts.length, 10, "Les 10 offres Tecno doivent produire 10 fiches catalogue.");
assert.equal(new Set(offers.map(offer => offer.name.toLowerCase())).size, 10, "Les 10 modèles Tecno doivent être distincts.");
assert.equal(new Set(allProducts.map(product => product.id)).size, allProducts.length, "Tous les identifiants produit doivent être uniques.");

for (const offer of offers) {
  const product = catalogById.get(offer.id);
  assert.ok(product, `Fiche catalogue absente pour ${offer.name}.`);
  assert.equal(offer.brand, "Tecno", `${offer.name} doit appartenir à la marque Tecno.`);
  assert.ok(offer.sourcePrice > 0 && offer.sourcePrice < SOURCE_PRICE_LIMIT, `${offer.name} dépasse le plafond d'achat de 150 000 FCFA.`);
  assert.equal(product.price, Math.round(offer.sourcePrice * PRICE_MULTIPLIER), `La marge de ${offer.name} n'est pas exactement de 25 %.`);
  assert.equal(product.category, "Smartphones", `${offer.name} doit être classé dans Smartphones.`);
  assert.equal(product.subcategory, "Tecno", `${offer.name} doit être classé dans la sous-catégorie Tecno.`);
  assert.ok(product.description.length >= 120, `La description de ${offer.name} est trop courte.`);
  assert.ok(offer.sourceUrl.startsWith("https://www.jumia.sn/"), `La source Jumia de ${offer.name} est invalide.`);
  assert.ok(product.image.startsWith("/assets/products/phones/tecno-"), `L'image locale de ${offer.name} est invalide.`);
  assert.ok(fs.existsSync(path.join(root, product.image.slice(1))), `Le fichier image de ${offer.name} est absent.`);
  assert.deepEqual(product.images, [product.image], `La galerie de ${offer.name} doit contenir son image principale.`);
  assert.equal(product.featured, true, `${offer.name} doit être visible parmi les nouveautés.`);
  assert.equal(existingNames.has(offer.name.toLowerCase()), false, `${offer.name} existe déjà dans le catalogue Jumia.`);
}

console.log(`Catalogue Tecno valide : 10 modèles, prix source sous ${SOURCE_PRICE_LIMIT.toLocaleString("fr-FR")} FCFA, marge ${MARKUP_PERCENT} %, offres vérifiées le ${SOURCE_CHECKED_AT}.`);
