import { auth, db } from "../../assets/js/firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, doc, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { IMGBB_API_KEY } from "./imgbb-config.js";

async function uploadToImgbb(file){
  let formData = new FormData();
  formData.append('image', file);
  let res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: formData });
  let json = await res.json();
  if (!json.success) throw new Error('فشل رفع الصورة');
  return json.data.url;
}

function toast(m){
  let t = document.querySelector('.toast');
  t.textContent = m; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

let categories = [];
let products = [];
let dashboardInitialized = false;

onAuthStateChanged(auth, user => {
  if (!user) { location.href = 'login.html'; return; }
  document.getElementById('admin-user-email').textContent = user.email;
  initDashboard();
});
document.getElementById('admin-logout').addEventListener('click', () => signOut(auth));

document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.admin-panel').forEach(p => p.hidden = true);
    document.getElementById('panel-' + btn.dataset.tab).hidden = false;
  });
});

async function initDashboard(){
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  wireCategoryForm();
  wireProductForm();
  await loadCategories();
  await loadProducts();
  await loadOrders();
}

// ---- generic drag-reorder ----
function wireDragList(container, onDrop){
  let dragEl = null;
  container.querySelectorAll('.admin-drag-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragEl = row; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === row) return;
      let rect = row.getBoundingClientRect();
      let before = (e.clientY - rect.top) < rect.height / 2;
      row.parentNode.insertBefore(dragEl, before ? row : row.nextSibling);
    });
  });
  container.addEventListener('drop', async e => {
    e.preventDefault();
    if (!dragEl) return;
    dragEl = null;
    let ids = [...container.querySelectorAll('.admin-drag-row')].map(r => r.dataset.id);
    await onDrop(ids);
  });
}

// ---- categories ----
async function loadCategories(){
  let snap = await getDocs(query(collection(db, 'categories'), orderBy('sortOrder')));
  categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCategoryList();
  fillCategorySelect();
}

function fillCategorySelect(){
  let sel = document.getElementById('p-category');
  let cur = sel.value;
  sel.innerHTML = categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  if (cur) sel.value = cur;
}

function renderCategoryList(){
  let el = document.getElementById('category-list');
  el.innerHTML = categories.length ? categories.map(c => `
    <div class="admin-drag-row" draggable="true" data-id="${c.id}">
      <span class="drag-handle">⠿</span>
      <span class="admin-row-title">${c.name}</span>
      <span class="admin-row-sub">${c.desc || ''}</span>
      <div class="admin-row-actions">
        <button class="btn btn-soft" data-edit-cat="${c.id}">تعديل</button>
        <button class="btn btn-outline" data-del-cat="${c.id}">حذف</button>
      </div>
    </div>`).join('') : '<div class="empty">لا يوجد أقسام بعد.</div>';
  wireDragList(el, saveCategoryOrder);
  el.querySelectorAll('[data-edit-cat]').forEach(b => b.addEventListener('click', () => editCategory(b.dataset.editCat)));
  el.querySelectorAll('[data-del-cat]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.delCat)));
}

async function saveCategoryOrder(ids){
  let batch = writeBatch(db);
  ids.forEach((id, i) => batch.update(doc(db, 'categories', id), { sortOrder: i }));
  await batch.commit();
  await loadCategories();
  toast('تم تحديث الترتيب');
}

function wireCategoryForm(){
  let form = document.getElementById('category-form');
  document.getElementById('category-cancel-btn').addEventListener('click', resetCategoryForm);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('category-form-msg');
    msg.textContent = '';
    try {
      let id = document.getElementById('category-id').value;
      let data = {
        name: document.getElementById('c-name').value.trim(),
        desc: document.getElementById('c-desc').value.trim()
      };
      if (id) {
        await updateDoc(doc(db, 'categories', id), data);
      } else {
        data.sortOrder = categories.length;
        await addDoc(collection(db, 'categories'), data);
      }
      resetCategoryForm();
      await loadCategories();
      toast('تم الحفظ');
    } catch (err) {
      console.error(err);
      msg.textContent = 'حدث خطأ، حاولي مرة أخرى';
    }
  });
}

function resetCategoryForm(){
  document.getElementById('category-form').reset();
  document.getElementById('category-id').value = '';
  document.getElementById('category-form-title').textContent = 'إضافة قسم جديد';
  document.getElementById('category-cancel-btn').style.display = 'none';
  document.getElementById('category-form-msg').textContent = '';
}

function editCategory(id){
  let c = categories.find(x => x.id === id);
  if (!c) return;
  document.getElementById('category-id').value = c.id;
  document.getElementById('c-name').value = c.name || '';
  document.getElementById('c-desc').value = c.desc || '';
  document.getElementById('category-form-title').textContent = 'تعديل القسم';
  document.getElementById('category-cancel-btn').style.display = 'inline-flex';
}

async function deleteCategory(id){
  if (!confirm('حذف هذا القسم؟')) return;
  await deleteDoc(doc(db, 'categories', id));
  await loadCategories();
  toast('تم الحذف');
}

// ---- products ----
async function loadProducts(){
  let snap = await getDocs(query(collection(db, 'products'), orderBy('sortOrder')));
  products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderProductList();
}

function renderProductList(){
  let el = document.getElementById('product-list');
  el.innerHTML = products.length ? products.map(p => `
    <div class="admin-drag-row" draggable="true" data-id="${p.id}">
      <span class="drag-handle">⠿</span>
      <img class="admin-row-thumb" src="${p.imageURL || ''}" alt="">
      <span class="admin-row-title">${p.name}</span>
      <span class="admin-row-sub">${p.category || ''} · ${Number(p.price || 0).toLocaleString('ar-IQ')} د.ع${p.featured ? ' · مميز' : ''}</span>
      <div class="admin-row-actions">
        <button class="btn btn-soft" data-edit-p="${p.id}">تعديل</button>
        <button class="btn btn-outline" data-del-p="${p.id}">حذف</button>
      </div>
    </div>`).join('') : '<div class="empty">لا يوجد منتجات بعد.</div>';
  wireDragList(el, saveProductOrder);
  el.querySelectorAll('[data-edit-p]').forEach(b => b.addEventListener('click', () => editProduct(b.dataset.editP)));
  el.querySelectorAll('[data-del-p]').forEach(b => b.addEventListener('click', () => deleteProduct(b.dataset.delP)));
}

async function saveProductOrder(ids){
  let batch = writeBatch(db);
  ids.forEach((id, i) => batch.update(doc(db, 'products', id), { sortOrder: i }));
  await batch.commit();
  await loadProducts();
  toast('تم تحديث الترتيب');
}

function wireProductForm(){
  let form = document.getElementById('product-form');
  document.getElementById('product-cancel-btn').addEventListener('click', resetProductForm);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('product-form-msg');
    let saveBtn = document.getElementById('product-save-btn');
    msg.textContent = '';
    saveBtn.disabled = true;
    try {
      let id = document.getElementById('product-id').value;
      let data = {
        name: document.getElementById('p-name').value.trim(),
        category: document.getElementById('p-category').value,
        price: Number(document.getElementById('p-price').value) || 0,
        oldPrice: Number(document.getElementById('p-oldprice').value) || 0,
        badge: document.getElementById('p-badge').value.trim(),
        rating: Number(document.getElementById('p-rating').value) || 0,
        desc: document.getElementById('p-desc').value.trim(),
        featured: document.getElementById('p-featured').checked
      };
      let file = document.getElementById('p-image').files[0];
      let docId = id;
      if (!docId) {
        let newDoc = await addDoc(collection(db, 'products'), { ...data, sortOrder: products.length, imageURL: '' });
        docId = newDoc.id;
      }
      if (file) {
        data.imageURL = await uploadToImgbb(file);
      }
      await setDoc(doc(db, 'products', docId), data, { merge: true });
      resetProductForm();
      await loadProducts();
      toast('تم حفظ المنتج');
    } catch (err) {
      console.error(err);
      msg.textContent = 'حدث خطأ أثناء الحفظ، حاولي مرة أخرى';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function resetProductForm(){
  document.getElementById('product-form').reset();
  document.getElementById('product-id').value = '';
  document.getElementById('product-form-title').textContent = 'إضافة منتج جديد';
  document.getElementById('product-cancel-btn').style.display = 'none';
  document.getElementById('product-form-msg').textContent = '';
}

function editProduct(id){
  let p = products.find(x => x.id === id);
  if (!p) return;
  document.getElementById('product-id').value = p.id;
  document.getElementById('p-name').value = p.name || '';
  document.getElementById('p-category').value = p.category || '';
  document.getElementById('p-price').value = p.price || 0;
  document.getElementById('p-oldprice').value = p.oldPrice || 0;
  document.getElementById('p-badge').value = p.badge || '';
  document.getElementById('p-rating').value = p.rating || 4.8;
  document.getElementById('p-desc').value = p.desc || '';
  document.getElementById('p-featured').checked = !!p.featured;
  document.getElementById('product-form-title').textContent = 'تعديل المنتج';
  document.getElementById('product-cancel-btn').style.display = 'inline-flex';
}

async function deleteProduct(id){
  if (!confirm('حذف هذا المنتج نهائياً؟')) return;
  await deleteDoc(doc(db, 'products', id));
  await loadProducts();
  toast('تم الحذف');
}

// ---- orders ----
const STATUS_LABELS = { pending: 'قيد الانتظار', confirmed: 'مؤكد', shipped: 'قيد التوصيل', delivered: 'تم التسليم', cancelled: 'ملغي' };

async function loadOrders(){
  let snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
  let orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders(orders);
}

function renderOrders(orders){
  let el = document.getElementById('orders-list');
  el.innerHTML = orders.length ? orders.map(o => `
    <div class="admin-order-card">
      <div class="admin-order-head">
        <b>${o.code || o.id}</b>
        <select class="select" data-status="${o.id}">
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div>${o.customerName || ''} · ${o.phone || ''}</div>
      <div>${o.province || ''} - ${o.district || ''} - ${o.address || ''}</div>
      <div class="admin-order-items">${(o.items || []).map(i => `${i.name} ×${i.qty}`).join('، ')}</div>
      <div><b>${Number(o.total || 0).toLocaleString('ar-IQ')} د.ع</b></div>
      ${o.location ? `<a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${o.location.lat}&mlon=${o.location.lng}#map=15/${o.location.lat}/${o.location.lng}">عرض الموقع على الخارطة</a>` : ''}
    </div>`).join('') : '<div class="empty">لا يوجد طلبات بعد.</div>';
  el.querySelectorAll('[data-status]').forEach(sel => {
    sel.addEventListener('change', async () => {
      await updateDoc(doc(db, 'orders', sel.dataset.status), { status: sel.value });
      toast('تم تحديث حالة الطلب');
    });
  });
}
