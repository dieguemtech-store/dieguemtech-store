const MARKUP_PERCENT = 25;
const PRICE_MULTIPLIER = 1 + (MARKUP_PERCENT / 100);
const SOURCE_PRICE_LIMIT = 150000;
const SOURCE_CHECKED_AT = "2026-07-22";

const offers = [
  {
    id: 175,
    brand: "Tecno",
    name: "Tecno Spark 50 4G 4Go RAM 128Go Bleu",
    sourcePrice: 120000,
    sourceUrl: "https://www.jumia.sn/tecno-spark-50-4g-6.78-rom-128go-ram-4go-appareil-photo-50mp-6700mah-double-sim-bleu-12863743.html",
    stock: 6,
    image: "/assets/products/phones/tecno-spark-50.jpg",
    badge: "Nouveau",
    description: "Tecno Spark 50 4G double SIM en coloris bleu avec écran 6,78 pouces, 4 Go de RAM et 128 Go de stockage. Son appareil photo principal 50 MP et sa grande batterie annoncée à 6700 mAh sur l'offre Jumia accompagnent les appels, la vidéo, les réseaux sociaux et les usages quotidiens."
  },
  {
    id: 176,
    brand: "Tecno",
    name: "Tecno Spark 40 4G 4Go RAM 128Go Noir",
    sourcePrice: 91900,
    sourceUrl: "https://www.jumia.sn/tecno-tecno-spark-40-km5-1284-6.67-rom-128go-ram-4go-photo-50mp-5200mah-dual-sim-black-12840348.html",
    stock: 7,
    image: "/assets/products/phones/tecno-spark-40.jpg",
    badge: "Bon plan",
    description: "Tecno Spark 40 4G double SIM noir avec écran fluide 6,67 pouces, 4 Go de RAM, 128 Go de stockage et appareil photo principal 50 MP. La batterie 5200 mAh offre une autonomie adaptée à une journée connectée, tandis que le format fin facilite la prise en main."
  },
  {
    id: 177,
    brand: "Tecno",
    name: "Tecno Spark 40 5G 8Go RAM 256Go Noir",
    sourcePrice: 145000,
    sourceUrl: "https://www.jumia.sn/tecno-spark-40-5g-6.75-rom-256go-ram-8go-appareil-photo-50mp-6000mah-double-sim-noir-12765528.html",
    stock: 5,
    image: "/assets/products/phones/tecno-spark-40-5g.jpg",
    badge: "5G",
    description: "Tecno Spark 40 compatible 5G avec écran 6,75 pouces, 8 Go de RAM et 256 Go de stockage pour conserver davantage d'applications, photos et vidéos. Il associe un appareil photo 50 MP, une batterie 6000 mAh et la gestion double SIM dans un coloris noir discret."
  },
  {
    id: 178,
    brand: "Tecno",
    name: "Tecno Spark 40 Pro+ 4G 8Go RAM 128Go Blanc",
    sourcePrice: 135000,
    sourceUrl: "https://www.jumia.sn/tecno-spark-40-pro-6.78-rom-128go-ram-8go-photo-50mp-5200mah-dual-sim-blanc-12717465.html",
    stock: 9,
    image: "/assets/products/phones/tecno-spark-40-pro-plus.jpg",
    badge: "Pro+",
    description: "Tecno Spark 40 Pro+ 4G en Aurora White avec grand écran 6,78 pouces, 8 Go de RAM et 128 Go de stockage. Son appareil photo principal 50 MP, sa batterie 5200 mAh et sa compatibilité double SIM en font une configuration polyvalente pour la photo, le divertissement et le multitâche."
  },
  {
    id: 179,
    brand: "Tecno",
    name: "Tecno Spark 30 4G 8Go RAM 128Go Stellar Shadow",
    sourcePrice: 109250,
    sourceUrl: "https://www.jumia.sn/tecno-tecno-spark-30-s.78-128gb-8gb-ram50mp5000mah-stellar-shadow-12840326.html",
    stock: 9,
    image: "/assets/products/phones/tecno-spark-30.jpg",
    badge: "Photo 50 MP",
    description: "Tecno Spark 30 4G en finition Stellar Shadow avec écran 6,78 pouces, 8 Go de RAM et 128 Go de stockage. Il intègre un appareil photo principal 50 MP et une batterie 5000 mAh, une combinaison équilibrée pour la messagerie, les contenus multimédias et les applications du quotidien."
  },
  {
    id: 180,
    brand: "Tecno",
    name: "Tecno Spark 10 Pro 4G 8Go RAM 128Go Blanc",
    sourcePrice: 105000,
    sourceUrl: "https://www.jumia.sn/tecno-spark-10-pro-6.8-rom-128go-ram-8go-photo-50mp-5000mah-blanc-11995433.html",
    stock: 9,
    image: "/assets/products/phones/tecno-spark-10-pro.jpg",
    badge: "Écran 90 Hz",
    description: "Tecno Spark 10 Pro 4G blanc avec écran FHD+ 6,8 pouces à 90 Hz, processeur Helio G88, 8 Go de RAM et 128 Go de stockage. Il propose un appareil photo arrière 50 MP, une caméra selfie 32 MP, une batterie 5000 mAh et une charge rapide 18 W."
  },
  {
    id: 181,
    brand: "Tecno",
    name: "Tecno POP 10C 4G 2Go RAM 64Go Gris",
    sourcePrice: 72000,
    sourceUrl: "https://www.jumia.sn/tecno-pop-10c-4g-ecran-6.6-rom-64go-ram-2go-battrie-5000mah-grey-12904692.html",
    stock: 4,
    image: "/assets/products/phones/tecno-pop-10c.jpg",
    badge: "Prix doux",
    description: "Tecno POP 10C 4G en coloris gris avec écran 6,6 pouces, 2 Go de RAM et 64 Go de stockage. Son appareil photo principal 13 MP, sa caméra avant 8 MP, sa batterie 5000 mAh et la gestion double SIM couvrent les appels, WhatsApp et les besoins mobiles essentiels."
  },
  {
    id: 182,
    brand: "Tecno",
    name: "Tecno POP 9 4G 3Go RAM 64Go Noir",
    sourcePrice: 75000,
    sourceUrl: "https://www.jumia.sn/tecno-pop-9-4g-ecran-6.67-rom-64go-ram-3go-black-12286685.html",
    stock: 8,
    image: "/assets/products/phones/tecno-pop-9.jpg",
    badge: "Accessible",
    description: "Tecno POP 9 4G noir avec écran 6,67 pouces, 3 Go de RAM et 64 Go de stockage extensible. La batterie 5000 mAh, le double emplacement SIM et la configuration pensée pour les applications légères en font un smartphone accessible pour communiquer et se divertir."
  },
  {
    id: 183,
    brand: "Tecno",
    name: "Tecno POP 8 4G 4Go RAM 128Go Vert",
    sourcePrice: 108900,
    sourceUrl: "https://www.jumia.sn/tecno-pop-8-6.6-hd-128gb-rom-4gb-ram-5000mah-tecno-12257869.html",
    stock: 6,
    image: "/assets/products/phones/tecno-pop-8.jpg",
    badge: "Grande capacité",
    description: "Tecno POP 8 4G double SIM avec écran HD 6,6 pouces, 4 Go de RAM et 128 Go de stockage. Sa batterie 5000 mAh, le lecteur d'empreintes, la reconnaissance faciale et le stockage généreux conviennent à la navigation, aux vidéos et aux réseaux sociaux."
  },
  {
    id: 184,
    brand: "Tecno",
    name: "Tecno Camon 18 Premier 4G 8Go RAM 256Go Vaste Sky",
    sourcePrice: 127950,
    sourceUrl: "https://www.jumia.sn/tecno-camon-18-premier-ecran-6.7-rom-256go-ram-8go-camera-arriere-64-triple-rear-camera-32mp-4750mah-vaste-sky-9732524.html",
    stock: 3,
    image: "/assets/products/phones/tecno-camon-18-premier.jpg",
    badge: "AMOLED 120 Hz",
    description: "Tecno Camon 18 Premier 4G Vaste Sky avec écran AMOLED FHD+ 6,7 pouces à 120 Hz, 8 Go de RAM et 256 Go de stockage. Son système photo principal 64 MP avec stabilisation, sa caméra selfie 32 MP et sa batterie 4750 mAh avec charge 33 W visent la création de contenus et le multimédia."
  }
];

const catalogProducts = offers.map(({ brand, sourcePrice, sourceUrl, ...offer }) => ({
  ...offer,
  category: "Smartphones",
  subcategory: brand,
  price: Math.round(sourcePrice * PRICE_MULTIPLIER),
  oldPrice: null,
  emoji: "DT",
  rating: 0,
  reviews: 0,
  images: [offer.image],
  featured: true
}));

module.exports = {
  MARKUP_PERCENT,
  PRICE_MULTIPLIER,
  SOURCE_PRICE_LIMIT,
  SOURCE_CHECKED_AT,
  offers,
  catalogProducts
};
