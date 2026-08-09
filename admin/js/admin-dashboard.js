import { auth, db } from "../../assets/js/firebase-init.js";
import { firebaseConfig } from "../../assets/js/firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  onAuthStateChanged, signOut,
  getAuth as getSecondaryAuth, createUserWithEmailAndPassword, signOut as signOutSecondary
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, getDocs, getDoc, doc, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, writeBatch, serverTimestamp, onSnapshot
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
let team = [];
let dashboardInitialized = false;
let currentAdmin = null; // { uid, email, role, permissions }

onAuthStateChanged(auth, async user => {
  if (!user) { location.href = 'login.html'; return; }
  let snap;
  try {
    snap = await getDoc(doc(db, 'admins', user.uid));
  } catch (err) {
    console.error(err);
    document.querySelector('.admin-content').innerHTML = `<div class="empty" style="margin:20px">تعذر التحقق من صلاحياتچ (${err.code || err.message}).<br>غالباً قواعد أمان Firestore (Rules) فيها خطأ إملائي — راجعيها من Firebase Console.</div>`;
    return;
  }
  if (!snap.exists()) {
    await signOut(auth);
    location.href = 'login.html?err=noaccess';
    return;
  }
  let data = snap.data();
  currentAdmin = { uid: user.uid, email: user.email, role: String(data.role || '').trim().toLowerCase(), permissions: data.permissions || {} };
  document.getElementById('admin-user-email').textContent = user.email + (currentAdmin.role === 'owner' ? ' (مالكة)' : '');
  initDashboard();
});
document.getElementById('admin-logout').addEventListener('click', () => signOut(auth));

function canSee(section){
  return currentAdmin.role === 'owner' || currentAdmin.permissions[section] === true;
}

function applyPermissions(){
  document.getElementById('team-tab-btn').hidden = currentAdmin.role !== 'owner';
  ['products', 'categories', 'orders'].forEach(section => {
    let btn = document.querySelector(`.admin-tab[data-tab="${section}"]`);
    btn.hidden = !canSee(section);
  });
  let firstVisible = [...document.querySelectorAll('.admin-tab')].find(b => !b.hidden);
  if (firstVisible) {
    activateTab(firstVisible);
    return true;
  }
  document.querySelector('.admin-content').innerHTML = `<div class="empty" style="margin:20px">هذا الحساب مسجل دخول بس ماله أي صلاحيات معروضة.<br>تأكدي إن مستند حسابچ بمجموعة <b>admins</b> فيه الحقل <b>role</b> = <code>owner</code> بالضبط (القيمة اللي انلقاتلچ حالياً: "${currentAdmin.role || '(فاضي)'}"), أو إن عندچ صلاحية وحدة على الأقل مفعّلة.</div>`;
  return false;
}

function activateTab(btn){
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p => p.hidden = true);
  document.getElementById('panel-' + btn.dataset.tab).hidden = false;
  if (btn.dataset.tab === 'orders') { newOrdersCount = 0; updateOrdersBadge(); }
}

document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn));
});

async function initDashboard(){
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  if (!applyPermissions()) return;
  wireCategoryForm();
  wireProductForm();
  wireTeamForm();
  await loadCategories(); // categories are public-read and feed the product form's select regardless of the "categories" tab permission
  if (canSee('products')) await loadProducts();
  if (canSee('orders')) {
    loadOrders();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
  if (currentAdmin.role === 'owner') await loadTeam();
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
let ordersUnsub = null;
let newOrdersCount = 0;
let ordersFirstSnapshot = true;

function loadOrders(){
  if (ordersUnsub) return; // already listening
  ordersUnsub = onSnapshot(query(collection(db, 'orders'), orderBy('createdAt', 'desc')), snap => {
    let orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderOrders(orders);
    if (!ordersFirstSnapshot) {
      snap.docChanges().forEach(change => {
        if (change.type === 'added') notifyNewOrder({ id: change.doc.id, ...change.doc.data() });
      });
    }
    ordersFirstSnapshot = false;
  }, err => console.error(err));
}

function updateOrdersBadge(){
  let btn = document.querySelector('.admin-tab[data-tab="orders"]');
  if (!btn) return;
  let badge = btn.querySelector('.tab-badge');
  if (!badge) { badge = document.createElement('span'); badge.className = 'tab-badge'; btn.appendChild(badge); }
  badge.textContent = newOrdersCount;
  badge.style.display = newOrdersCount > 0 ? 'grid' : 'none';
}

function playNotifySound(){
  try {
    let ctx = new (window.AudioContext || window.webkitAudioContext)();
    let o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch (e) {}
}

function notifyNewOrder(order){
  newOrdersCount++;
  updateOrdersBadge();
  playNotifySound();
  toast(`🛍 طلب جديد — ${order.customerName || ''} (${order.code || ''})`);
  if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
    new Notification('طلب جديد بمتجر ميرنا بيوتي', {
      body: `${order.code || ''} — ${order.customerName || ''} — ${Number(order.total || 0).toLocaleString('ar-IQ')} د.ع`
    });
  }
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

// ---- team (owner only) ----
const PERMISSION_LABELS = { products: 'المنتجات', categories: 'الأقسام', orders: 'الطلبات' };

async function loadTeam(){
  let snap = await getDocs(collection(db, 'admins')); // no orderBy: the manually-created owner doc may lack createdAt
  team = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  team.sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1) || (a.email || '').localeCompare(b.email || ''));
  renderTeamList();
}

function renderTeamList(){
  let el = document.getElementById('team-list');
  el.innerHTML = team.length ? team.map(m => {
    let isOwner = m.role === 'owner';
    let perms = m.permissions || {};
    return `
    <div class="admin-drag-row" data-id="${m.id}">
      <span class="admin-row-title">${m.email || ''}${isOwner ? ' <small>(مالكة)</small>' : ''}</span>
      <span class="admin-row-sub">
        ${Object.keys(PERMISSION_LABELS).map(k => `<label style="margin-inline-end:10px"><input type="checkbox" data-team-perm="${m.id}:${k}" ${isOwner || perms[k] ? 'checked' : ''} ${isOwner ? 'disabled' : ''}> ${PERMISSION_LABELS[k]}</label>`).join('')}
      </span>
      <div class="admin-row-actions">
        ${isOwner ? '' : `<button class="btn btn-outline" data-remove-team="${m.id}">إزالة</button>`}
      </div>
    </div>`;
  }).join('') : '<div class="empty">لا يوجد أعضاء بعد.</div>';
  el.querySelectorAll('[data-team-perm]').forEach(cb => {
    cb.addEventListener('change', async () => {
      let [uid, key] = cb.dataset.teamPerm.split(':');
      await updateDoc(doc(db, 'admins', uid), { ['permissions.' + key]: cb.checked });
      toast('تم تحديث صلاحيات العضو');
      await loadTeam();
    });
  });
  el.querySelectorAll('[data-remove-team]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('إزالة هذا العضو من الفريق؟ (يفقد الوصول للوحة التحكم فوراً، حسابه بالدخول يبقى موجود بـ Firebase)')) return;
      await deleteDoc(doc(db, 'admins', b.dataset.removeTeam));
      await loadTeam();
      toast('تمت الإزالة');
    });
  });
}

async function createTeamMember(email, password, permissions){
  let secondaryApp = initializeApp(firebaseConfig, 'secondary-' + Date.now());
  let secondaryAuth = getSecondaryAuth(secondaryApp);
  try {
    let cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    let uid = cred.user.uid;
    await signOutSecondary(secondaryAuth);
    await setDoc(doc(db, 'admins', uid), { email, role: 'staff', permissions, createdAt: serverTimestamp() });
  } finally {
    await deleteApp(secondaryApp);
  }
}

function wireTeamForm(){
  let form = document.getElementById('team-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('team-form-msg');
    let saveBtn = document.getElementById('team-save-btn');
    msg.textContent = '';
    saveBtn.disabled = true;
    try {
      let email = document.getElementById('team-email').value.trim();
      let password = document.getElementById('team-password').value;
      let permissions = {
        products: document.getElementById('team-perm-products').checked,
        categories: document.getElementById('team-perm-categories').checked,
        orders: document.getElementById('team-perm-orders').checked
      };
      await createTeamMember(email, password, permissions);
      form.reset();
      await loadTeam();
      toast('تمت إضافة العضو');
    } catch (err) {
      console.error(err);
      msg.textContent = err.code === 'auth/email-already-in-use' ? 'هذا البريد مستخدم مسبقاً' : 'حدث خطأ أثناء إضافة العضو';
    } finally {
      saveBtn.disabled = false;
    }
  });
}
