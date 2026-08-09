import { db } from "./firebase-init.js";
import {
  collection, getDocs, query, orderBy, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function normalizeProduct(id, v) {
  return {
    id,
    name: v.name || "",
    category: v.category || "",
    price: Number(v.price) || 0,
    oldPrice: Number(v.oldPrice) || 0,
    image: v.imageURL || "",
    badge: v.badge || "",
    rating: Number(v.rating) || 0,
    desc: v.desc || "",
    sortOrder: Number(v.sortOrder) || 0,
    featured: !!v.featured
  };
}

async function loadProducts() {
  try {
    const snap = await getDocs(query(collection(db, "products"), orderBy("sortOrder")));
    if (!snap.empty) {
      const docs = snap.docs.map(d => normalizeProduct(d.id, d.data()));
      window.PRODUCTS.length = 0;
      window.PRODUCTS.push(...docs);
    }
  } catch (err) {
    console.warn("تعذر تحميل المنتجات من Firebase، سيتم عرض البيانات المحلية:", err);
  }
  return window.PRODUCTS;
}

async function loadCategories() {
  try {
    const snap = await getDocs(query(collection(db, "categories"), orderBy("sortOrder")));
    if (!snap.empty) {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      window.CATEGORIES.length = 0;
      window.CATEGORIES.push(...docs);
    }
  } catch (err) {
    console.warn("تعذر تحميل الأقسام من Firebase، سيتم عرض البيانات المحلية:", err);
  }
  return window.CATEGORIES;
}

async function submitOrder(order) {
  const code = "MB-" + Date.now().toString().slice(-6);
  const docRef = await addDoc(collection(db, "orders"), {
    ...order,
    code,
    status: "pending",
    createdAt: serverTimestamp()
  });
  return { id: docRef.id, code };
}

const ready = (async () => {
  await Promise.all([loadProducts(), loadCategories()]);
  window.dispatchEvent(new CustomEvent("mirna:data-ready"));
})();

window.MirnaData = { loadProducts, loadCategories, submitOrder, ready };
