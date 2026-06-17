let products = [];

let cart = JSON.parse(localStorage.getItem("dt-cart") || "[]");
let wishlist = JSON.parse(localStorage.getItem("dt-wishlist") || "[]");
let activeFilter = "Tous";
let visibleCount = 8;

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const formatPrice = value => `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;

function productCard(product){
  const liked = wishlist.includes(product.id);
  const badgeClass = product.badge.includes("%") ? "discount-badge" : "new-badge";
  return `<article class="product-card">
    <div class="product-visual">
      <span class="${badgeClass}">${product.badge}</span>
      <button class="wishlist-toggle ${liked ? "active" : ""}" data-wishlist="${product.id}" aria-label="Ajouter aux favoris">
        <svg><use href="#icon-heart"></use></svg>
      </button>
     <img class="product-image"
     src="${product.image}"
     alt="${product.name}">
    </div>
    <div class="product-info">
      <span class="product-category">${product.category}</span>
      <h3 title="${product.name}">${product.name}</h3>
      <div class="product-rating"><span class="stars">★★★★★</span> ${product.rating} (${product.reviews})</div>
      <div class="product-bottom">
        <span class="price"><strong>${formatPrice(product.price)}</strong>${product.oldPrice ? `<del>${formatPrice(product.oldPrice)}</del>` : ""}</span>
        <button class="add-cart" data-cart="${product.id}" aria-label="Ajouter ${product.name} au panier"><svg><use href="#icon-cart"></use></svg></button>
      </div>
    </div>
  </article>`;
}

function renderProducts(search = ""){
  const query = search.trim().toLowerCase();
  const filtered = products.filter(p => (activeFilter === "Tous" || p.category === activeFilter) && (!query || `${p.name} ${p.category}`.toLowerCase().includes(query)));
  $("#productsGrid").innerHTML = filtered.slice(0, visibleCount).map(productCard).join("");
  $("#emptyState").style.display = filtered.length ? "none" : "block";
  $("#showAllProducts").style.display = filtered.length > visibleCount ? "inline-flex" : "none";
}

function persist(){
  localStorage.setItem("dt-cart", JSON.stringify(cart));
  localStorage.setItem("dt-wishlist", JSON.stringify(wishlist));
  $("#cartCount").textContent = cart.reduce((sum,item) => sum + item.qty, 0);
  $("#wishlistCount").textContent = wishlist.length;
}

function showToast(title = "Produit ajouté", text = "Votre panier a été mis à jour."){
  const toast = $("#toast");
  toast.querySelector("strong").textContent = title;
  toast.querySelector("small").textContent = text;
  toast.classList.add("active");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("active"), 2600);
}

function addToCart(id){
  const item = cart.find(entry => entry.id === id);
  item ? item.qty++ : cart.push({id,qty:1});
  persist();
  renderCart();
  showToast();
}

function toggleWishlist(id){
  wishlist = wishlist.includes(id) ? wishlist.filter(item => item !== id) : [...wishlist,id];
  persist();
  renderProducts($("#searchInput").value);
  renderWishlist();
  showToast(wishlist.includes(id) ? "Ajouté aux favoris" : "Retiré des favoris", wishlist.includes(id) ? "Vous pourrez le retrouver facilement." : "Votre liste de souhaits a été mise à jour.");
}

function renderCart(){
  const container = $("#cartItems");
  if(!cart.length){
    container.innerHTML = `<div class="empty-drawer"><span>🛒</span><h3>Votre panier est vide</h3><p>Découvrez nos produits et trouvez votre prochain coup de cœur tech.</p></div>`;
    $("#cartFooter").style.display = "none";
    return;
  }
  $("#cartFooter").style.display = "block";
  container.innerHTML = cart.map(entry => {
    const p = products.find(product => product.id === entry.id);
    return `<div class="drawer-item"><div class="drawer-item-visual">${p.emoji}</div><div><h4>${p.name}</h4><strong>${formatPrice(p.price)}</strong><div class="quantity"><button data-qty="${p.id}" data-delta="-1">−</button><span>${entry.qty}</span><button data-qty="${p.id}" data-delta="1">+</button></div></div><button class="remove-item" data-remove="${p.id}">×</button></div>`;
  }).join("");
  const total = cart.reduce((sum,entry) => sum + products.find(p => p.id === entry.id).price * entry.qty,0);
  $("#cartTotal").textContent = formatPrice(total);
  $("#checkoutTotal").textContent = formatPrice(total);
}

function renderWishlist(){
  const container = $("#wishlistItems");
  if(!wishlist.length){
    container.innerHTML = `<div class="empty-drawer"><span>♡</span><h3>Aucun favori pour le moment</h3><p>Cliquez sur le cœur d'un produit pour le garder sous la main.</p></div>`;
    return;
  }
  container.innerHTML = wishlist.map(id => {
    const p = products.find(product => product.id === id);
    return `<div class="drawer-item"><div class="drawer-item-visual">${p.emoji}</div><div><h4>${p.name}</h4><strong>${formatPrice(p.price)}</strong><br><button class="wishlist-add" data-cart="${p.id}">Ajouter au panier</button></div><button class="remove-item" data-wishlist="${p.id}">×</button></div>`;
  }).join("");
}

function openDrawer(drawer){
  closeAll();
  drawer.classList.add("active");
  drawer.setAttribute("aria-hidden","false");
  $("#overlay").classList.add("active");
  document.body.classList.add("no-scroll");
}

function closeAll(){
  $$(".drawer,.modal").forEach(el => {el.classList.remove("active");el.setAttribute("aria-hidden","true")});
  $("#overlay").classList.remove("active");
  document.body.classList.remove("no-scroll");
}

document.addEventListener("click", e => {
  const cartButton = e.target.closest("[data-cart]");
  const wishButton = e.target.closest("[data-wishlist]");
  const qtyButton = e.target.closest("[data-qty]");
  const removeButton = e.target.closest("[data-remove]");
  const filterButton = e.target.closest("[data-filter]");
  if(cartButton) addToCart(Number(cartButton.dataset.cart));
  if(wishButton) toggleWishlist(Number(wishButton.dataset.wishlist));
  if(qtyButton){
    const entry = cart.find(item => item.id === Number(qtyButton.dataset.qty));
    entry.qty += Number(qtyButton.dataset.delta);
    if(entry.qty <= 0) cart = cart.filter(item => item.id !== entry.id);
    persist(); renderCart();
  }
  if(removeButton){cart = cart.filter(item => item.id !== Number(removeButton.dataset.remove));persist();renderCart();}
  if(filterButton){
    activeFilter = filterButton.dataset.filter;
    visibleCount = 12;
    $$("#productTabs button").forEach(btn => btn.classList.toggle("active", btn.dataset.filter === activeFilter));
    renderProducts();
    if(filterButton.closest(".category-card") || filterButton.closest(".nav-inner")) setTimeout(() => $("#boutique").scrollIntoView(), 50);
    $("#mainNav").classList.remove("open");
  }
});

$("#searchForm").addEventListener("submit", e => {e.preventDefault();activeFilter="Tous";visibleCount=12;renderProducts($("#searchInput").value);$("#boutique").scrollIntoView();});
$("#searchInput").addEventListener("input", e => {if(e.target.value.length > 1 || !e.target.value){activeFilter="Tous";renderProducts(e.target.value);}});
$("#resetSearch").addEventListener("click", () => {$("#searchInput").value="";activeFilter="Tous";visibleCount=8;renderProducts();});
$("#showAllProducts").addEventListener("click", () => {visibleCount=products.length;renderProducts($("#searchInput").value);});
$("#cartButton").addEventListener("click", () => {renderCart();openDrawer($("#cartDrawer"));});
$("#wishlistButton").addEventListener("click", () => {renderWishlist();openDrawer($("#wishlistDrawer"));});
$("#overlay").addEventListener("click", closeAll);
$$(".close-drawer,.modal-close").forEach(btn => btn.addEventListener("click", closeAll));
$("#menuToggle").addEventListener("click", () => $("#mainNav").classList.toggle("open"));

$("#checkoutButton").addEventListener("click", () => {$("#cartDrawer").classList.remove("active");$("#checkoutModal").classList.add("active");$("#checkoutModal").setAttribute("aria-hidden","false");});
$$(".payment-options button").forEach(btn => btn.addEventListener("click", () => {$$(".payment-options button").forEach(b => b.classList.remove("selected"));btn.classList.add("selected");}));
$("#payButton").addEventListener("click", async () => {
  const fields = $$("#checkoutModal input");
  if([...fields].some(field => !field.value.trim())){showToast("Informations manquantes","Veuillez renseigner vos coordonnées de livraison.");return;}
  const provider = $(".payment-options button.selected").dataset.payment;
  const payButton = $("#payButton");
  payButton.disabled = true;
  payButton.textContent = "Création de la commande...";
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        customer: {
          name: fields[0].value,
          phone: fields[1].value,
          address: fields[2].value
        },
        items: cart.map(item => ({id: item.id, quantity: item.qty})),
        paymentProvider: provider
      })
    });
    const result = await response.json();

if (!response.ok) {
  throw new Error(result.error || "The order could not be created.");
}

// Si PayTech retourne une URL de paiement
if (provider === "PayTech" && result.redirect_url) {
  window.location.href = result.redirect_url;
  return;
}

cart = [];
persist();
renderCart();
closeAll();
fields.forEach(f => f.value = "");

showToast(
  `Commande ${result.orderId}`,
  `Commande créée. Paiement ${provider} en attente.`
);
  } catch (error) {
    showToast("Commande impossible",error.message);
  } finally {
    payButton.disabled = false;
    payButton.textContent = "Payer maintenant";
  }
});

$("#newsletterForm").addEventListener("submit", e => {e.preventDefault();e.target.reset();showToast("Inscription réussie","Bienvenue dans la communauté DieguemTech !");});

const deadline = Date.now() + (2*24*60*60*1000) + (14*60*60*1000);
setInterval(() => {
  const diff = Math.max(0,deadline-Date.now());
  $("#days").textContent=String(Math.floor(diff/86400000)).padStart(2,"0");
  $("#hours").textContent=String(Math.floor(diff%86400000/3600000)).padStart(2,"0");
  $("#minutes").textContent=String(Math.floor(diff%3600000/60000)).padStart(2,"0");
},1000);

async function initializeStore(){
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Catalogue indisponible.");
    products = await response.json();
    cart = cart.filter(item => products.some(product => product.id === item.id));
    wishlist = wishlist.filter(id => products.some(product => product.id === id));
    renderProducts();
    renderCart();
    renderWishlist();
    persist();
  } catch (error) {
    $("#productsGrid").innerHTML = "";
    $("#emptyState").style.display = "block";
    $("#emptyState h3").textContent = "Le catalogue est temporairement indisponible";
    $("#emptyState p").textContent = "Veuillez actualiser la page dans quelques instants.";
    console.error(error);
  }
}

initializeStore();
