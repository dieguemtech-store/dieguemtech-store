const MARKUP_PERCENT = 25;
const PRICE_MULTIPLIER = 1 + (MARKUP_PERCENT / 100);
const SOURCE_CHECKED_AT = "2026-07-22";

const offers = [
  {
    id: 160,
    brand: "Samsung",
    name: "Samsung Galaxy A16 4G 4Go RAM 128Go Noir",
    sourcePrice: 81000,
    sourceUrl: "https://www.jumia.sn/samsung-galaxy-a16-4g-ram-4go-rom-128go-noir-12742163.html",
    stock: 5,
    image: "/assets/products/phones/samsung-galaxy-a16.jpg",
    badge: "Bon plan",
    description: "Samsung Galaxy A16 4G avec écran Super AMOLED 6,7 pouces à 90 Hz, 4 Go de RAM, 128 Go de stockage extensible, triple appareil photo avec capteur principal 50 MP et batterie 5000 mAh. Android 14, protection IP54 et lecteur d'empreinte latéral. Chargeur secteur non inclus selon l'offre source."
  },
  {
    id: 161,
    brand: "Xiaomi",
    name: "Xiaomi Redmi A7 4G 3Go RAM 64Go Bleu",
    sourcePrice: 57900,
    sourceUrl: "https://www.jumia.sn/xiaomi-redmi-a7-6.88-4g-2-sim-3gb-ram-64gb-rom-8mpx5mpx-5200-mah-bleu-garantie-12-mois-12886924.html",
    stock: 10,
    image: "/assets/products/phones/xiaomi-redmi-a7.jpg",
    badge: "Bon plan",
    description: "Xiaomi Redmi A7 double SIM 4G avec grand écran 6,88 pouces, 3 Go de RAM, 64 Go de stockage, appareil photo arrière 8 MP, caméra avant 5 MP et batterie haute capacité de 5200 mAh. Une configuration accessible pour les appels, la messagerie, la vidéo et les réseaux sociaux."
  },
  {
    id: 162,
    brand: "POCO",
    name: "POCO C55 LTE 3Go RAM 32Go Forest Green",
    sourcePrice: 39900,
    sourceUrl: "https://www.jumia.sn/xiaomi-poco-c55-6.71-lte-2-sim-3gb-ram-32gb-rom-50mpx5mpx-5000-mah-forest-green-garantie-24-mois-12845064.html",
    stock: 10,
    image: "/assets/products/phones/poco-c55.jpg",
    badge: "Prix doux",
    description: "POCO C55 LTE double SIM avec écran 6,71 pouces, 3 Go de RAM, 32 Go de stockage, capteur photo principal 50 MP, caméra avant 5 MP et batterie 5000 mAh. Son coloris Forest Green et son grand écran conviennent à un usage mobile quotidien à petit budget."
  },
  {
    id: 163,
    brand: "Tecno",
    name: "Tecno POP 20 4G 8Go RAM 128Go Noir",
    sourcePrice: 82900,
    sourceUrl: "https://www.jumia.sn/tecno-pop-20-675-128go-rom-44go-ram-4g-2-sim-13mp-5000mah-noir-12890493.html",
    stock: 8,
    image: "/assets/products/phones/tecno-pop-20.jpg",
    badge: "Nouveau",
    description: "Tecno POP 20 4G double SIM avec écran 6,75 pouces, 128 Go de stockage et 8 Go de mémoire annoncée sous la forme 4 Go + 4 Go étendus. Il dispose d'un appareil photo 13 MP, d'une batterie 5000 mAh et d'un port USB Type-C pour les usages du quotidien."
  },
  {
    id: 164,
    brand: "Honor",
    name: "Honor X5C 4Go RAM 64Go Bleu",
    sourcePrice: 59900,
    sourceUrl: "https://www.jumia.sn/honor-x5c-4go-ram-64go-rom-5260-mah-camera-50-mp-bleu-12899385.html",
    stock: 8,
    image: "/assets/products/phones/honor-x5c.jpg",
    badge: "Bon plan",
    description: "Honor X5C avec 4 Go de RAM, 64 Go de stockage, appareil photo principal 50 MP et batterie longue durée de 5260 mAh. Son grand écran et sa configuration équilibrée sont adaptés à la communication, aux contenus multimédias et aux applications courantes."
  },
  {
    id: 165,
    brand: "Oppo",
    name: "Oppo A3s Reconditionné 6Go RAM 128Go Bleu",
    sourcePrice: 33900,
    sourceUrl: "https://www.jumia.sn/oppo-a3secran-6.26-pouces-ips-rom-128gb-ram-6gb-1613mp-batterie-4230mah-bleu-12751947.html",
    stock: 5,
    image: "/assets/products/phones/oppo-a3s.jpg",
    badge: "Reconditionné",
    description: "Oppo A3s reconditionné en coloris bleu avec écran IPS 6,26 pouces, 6 Go de RAM et 128 Go de stockage selon la fiche de l'offre. Batterie 4230 mAh et double appareil photo pour les appels, la navigation et les applications essentielles. Le visuel source identifie clairement l'appareil comme renouvelé."
  },
  {
    id: 166,
    brand: "ZTE",
    name: "ZTE A76 5G 6Go RAM 128Go Noir",
    sourcePrice: 59900,
    sourceUrl: "https://www.jumia.sn/zte-a76-5g-rom-128-go-ram-6-go-5000-mah-gift-carte-sim-offerte-12771162.html",
    stock: 8,
    image: "/assets/products/phones/zte-a76.jpg",
    badge: "5G",
    description: "ZTE A76 compatible 5G avec 6 Go de RAM, 128 Go de stockage et batterie 5000 mAh. Ce smartphone offre l'espace nécessaire pour les applications, photos et vidéos, avec une connectivité mobile rapide et une autonomie pensée pour une journée d'utilisation."
  },
  {
    id: 167,
    brand: "redbeat",
    name: "redbeat E3 Android 14 12Go RAM 256Go Bleu",
    sourcePrice: 59900,
    sourceUrl: "https://www.jumia.sn/redbeat-e3-6.6-pouces-12-go-ram256-go-rom-android-14-bleu-12280609.html",
    stock: 8,
    image: "/assets/products/phones/redbeat-e3.jpg",
    badge: "Grande capacité",
    description: "redbeat E3 sous Android 14 avec écran 6,6 pouces, 256 Go de stockage et 12 Go de mémoire annoncée sous la forme 6 Go + 6 Go étendus. Une grande capacité pour conserver applications, photos et vidéos, avec double SIM et un design bleu moderne."
  },
  {
    id: 168,
    brand: "Ruioo",
    name: "Ruioo S25 Ultra 8Go RAM 128Go Or",
    sourcePrice: 52500,
    sourceUrl: "https://www.jumia.sn/ruioo-smartphone-android-ruioo-s25-ultra-8-go-128-go-ecran-de-68-pouces-12837883.html",
    stock: 8,
    image: "/assets/products/phones/ruioo-s25-ultra.jpg",
    badge: "Grand écran",
    description: "Ruioo S25 Ultra sous Android 13 avec écran 6,8 pouces, 128 Go de stockage et 8 Go de mémoire annoncée sous la forme 4 Go + 4 Go étendus. Processeur MediaTek, batterie 5000 mAh, appareil photo arrière 13 MP, caméra avant 8 MP et recharge USB Type-C."
  },
  {
    id: 169,
    brand: "Apple",
    name: "Apple iPhone 6 Reconditionné 1Go RAM 64Go Gris Sidéral",
    sourcePrice: 34900,
    sourceUrl: "https://www.jumia.sn/renewed-iphone-6-4.7-1gb-ram64gb-rom-8mpx-4g-reconditionne-99.99new-space-grey-12552832.html",
    stock: 3,
    image: "/assets/products/phones/apple-iphone-6-renewed.jpg",
    badge: "Reconditionné",
    description: "Apple iPhone 6 reconditionné en Gris Sidéral avec écran 4,7 pouces, 1 Go de RAM, 64 Go de stockage, appareil photo 8 MP et connectivité 4G. Format compact adapté aux appels et aux usages iOS compatibles. État reconditionné clairement indiqué sur la fiche et le visuel source."
  },
  {
    id: 170,
    brand: "Huawei",
    name: "Huawei Y9 Reconditionné 6Go RAM 128Go Noir",
    sourcePrice: 39900,
    sourceUrl: "https://www.jumia.sn/renewed-huawei-y9-6gb-ram-128gb-rom-ecran-de-65-pouces-batterie-4000mah-hisilicon-kirin-710-deverrouillage-facial-empreinte-digitale-smartphone-noir-12113406.html",
    stock: 6,
    image: "/assets/products/phones/huawei-y9-renewed.jpg",
    badge: "Reconditionné",
    description: "Huawei Y9 reconditionné avec écran 6,5 pouces, 6 Go de RAM, 128 Go de stockage, processeur HiSilicon Kirin 710 et batterie 4000 mAh. Déverrouillage facial et lecteur d'empreinte digitale complètent cette configuration destinée aux usages Android quotidiens."
  },
  {
    id: 171,
    brand: "Vivo",
    name: "Vivo Y17 Reconditionné 6Go RAM 128Go Rose",
    sourcePrice: 42900,
    sourceUrl: "https://www.jumia.sn/renewed-vivo-y17-635-5000mah-6-go-ram-128-go-rom-double-sim-13mp-reconnaissance-faciale-reinitialisation-empreinte-digitale-smartphone-rose-12655362.html",
    stock: 6,
    image: "/assets/products/phones/vivo-y17-renewed.jpg",
    badge: "Reconditionné",
    description: "Vivo Y17 reconditionné double SIM avec écran HD+ 6,35 pouces, 6 Go de RAM, 128 Go de stockage et batterie 5000 mAh. Appareil photo 13 MP, reconnaissance faciale et lecteur d'empreinte digitale dans un coloris rose."
  },
  {
    id: 172,
    brand: "Landvo",
    name: "Landvo i17 Pro Max Android 15 4Go RAM 64Go Noir",
    sourcePrice: 86800,
    sourceUrl: "https://www.jumia.sn/landvo-i17-pro-max-73-zoll-android-15-smartphone-464gb-4g-netzwerk-all-in-one-phone-dual-sim-standby-12847193.html",
    stock: 2,
    image: "/assets/products/phones/landvo-i17-pro-max.jpg",
    badge: "Android 15",
    description: "Landvo i17 Pro Max avec grand écran 7,3 pouces, Android 15, 4 Go de RAM et 64 Go de stockage. Compatible 4G, double SIM et double veille, ce modèle vise les utilisateurs recherchant un très grand affichage pour les contenus et les applications courantes."
  },
  {
    id: 173,
    brand: "Infinix",
    name: "Infinix Smart 10 4G 4Go RAM 128Go Noir",
    sourcePrice: 85000,
    sourceUrl: "https://www.jumia.sn/smart-10-4g-667-hd-rom-128go-ram-4go-5000mah-noir-infinix-mpg55059.html",
    stock: 3,
    image: "/assets/products/phones/infinix-smart-10.jpg",
    badge: "Nouveau",
    description: "Infinix Smart 10 4G en coloris noir avec écran HD 6,67 pouces, 4 Go de RAM, 128 Go de stockage et batterie 5000 mAh. Une configuration équilibrée pour la messagerie, les réseaux sociaux, la vidéo et les tâches mobiles du quotidien."
  },
  {
    id: 174,
    brand: "General Mobile",
    name: "General Mobile / Tecno POP 20 4G 8Go RAM 64Go Gris",
    sourcePrice: 85000,
    sourceUrl: "https://www.jumia.sn/general-mobile-tecno-pop-20-667-64go-rom-44go-ram-4g-2-sim-8mp13mp-5000mah-gris-12890523.html",
    stock: 8,
    image: "/assets/products/phones/general-mobile-pop-20.jpg",
    badge: "Nouveau",
    description: "Référence proposée sur Jumia sous la marque General Mobile et le modèle Tecno POP 20. Écran 6,67 pouces, 64 Go de stockage, mémoire annoncée 4 Go + 4 Go étendus, double SIM 4G, appareils photo 8 MP et 13 MP, batterie 5000 mAh et Android 14 Go."
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
  SOURCE_CHECKED_AT,
  offers,
  catalogProducts
};
