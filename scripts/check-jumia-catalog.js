const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const allProducts = require("../data/products");
const {
  MARKUP_PERCENT,
  PRICE_MULTIPLIER,
  SOURCE_CHECKED_AT,
  offers,
  catalogProducts
} = require("../data/jumia-phone-offers");

const root = path.resolve(__dirname, "..");
const catalogById = new Map(catalogProducts.map(product => [product.id, product]));

assert.equal(MARKUP_PERCENT, 25, "La marge doit rester fixée à 25 %.");
assert.equal(PRICE_MULTIPLIER, 1.25, "Le multiplicateur de prix doit être 1,25.");
assert.match(SOURCE_CHECKED_AT, /^\d{4}-\d{2}-\d{2}$/, "La date de vérification des offres est invalide.");
assert.equal(offers.length, 15, "Le catalogue doit contenir exactement 15 offres importées.");
assert.equal(catalogProducts.length, 15, "Les 15 offres doivent produire 15 fiches catalogue.");
assert.equal(new Set(offers.map(offer => offer.brand.toLowerCase())).size, 15, "Les 15 marques doivent être différentes.");
assert.equal(new Set(allProducts.map(product => product.id)).size, allProducts.length, "Tous les identifiants produit doivent être uniques.");

for (const offer of offers) {
  const product = catalogById.get(offer.id);
  assert.ok(product, `Fiche catalogue absente pour ${offer.name}.`);
  assert.ok(offer.sourcePrice > 0 && offer.sourcePrice < 100000, `${offer.name} dépasse le plafond d'achat de 100 000 FCFA.`);
  assert.equal(product.price, Math.round(offer.sourcePrice * 1.25), `La marge de ${offer.name} n'est pas exactement de 25 %.`);
  assert.equal(product.category, "Smartphones", `${offer.name} doit être classé dans Smartphones.`);
  assert.equal(product.subcategory, offer.brand, `La marque de ${offer.name} doit rester recherchable.`);
  assert.ok(product.description.length >= 120, `La description de ${offer.name} est trop courte.`);
  assert.ok(offer.sourceUrl.startsWith("https://www.jumia.sn/"), `La source Jumia de ${offer.name} est invalide.`);
  assert.ok(product.image.startsWith("/assets/products/phones/"), `L'image locale de ${offer.name} est invalide.`);
  assert.ok(fs.existsSync(path.join(root, product.image.slice(1))), `Le fichier image de ${offer.name} est absent.`);
  assert.deepEqual(product.images, [product.image], `La galerie de ${offer.name} doit contenir son image principale.`);
  assert.equal(product.featured, true, `${offer.name} doit être visible parmi les nouveautés.`);
}

console.log(`Catalogue Jumia valide : 15 téléphones, 15 marques, marge ${MARKUP_PERCENT} %, offres vérifiées le ${SOURCE_CHECKED_AT}.`);
