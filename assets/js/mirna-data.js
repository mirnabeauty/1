import { db } from "./firebase-init.js";
import {
  collection, getDocs, getDoc, doc, query, orderBy, addDoc, serverTimestamp
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

function applySettingsToDOM(s) {
  if (s.whatsapp) {
    let digits = String(s.whatsapp).replace(/[^0-9]/g, "");
    if (digits) document.querySelectorAll('[data-social="whatsapp"]').forEach(a => a.href = `https://wa.me/${digits}`);
  }
  if (s.instagram) document.querySelectorAll('[data-social="instagram"]').forEach(a => a.href = s.instagram);
  if (s.facebook) document.querySelectorAll('[data-social="facebook"]').forEach(a => a.href = s.facebook);
  if (s.contactEmail) document.querySelectorAll('[data-contact-email]').forEach(el => el.textContent = s.contactEmail);
  if (s.contactPhone) document.querySelectorAll('[data-contact-phone]').forEach(el => el.textContent = s.contactPhone);
}

async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "general"));
    if (snap.exists()) {
      window.MIRNA_SETTINGS = snap.data();
      applySettingsToDOM(snap.data());
    }
  } catch (err) {
    console.warn("تعذر تحميل إعدادات المتجر من Firebase:", err);
  }
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
  await Promise.all([loadProducts(), loadCategories(), loadSettings()]);
  window.dispatchEvent(new CustomEvent("mirna:data-ready"));
})();

window.MirnaData = { loadProducts, loadCategories, loadSettings, submitOrder, ready };
