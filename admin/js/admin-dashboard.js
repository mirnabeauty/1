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
  document.getElementById('settings-tab-btn').hidden = currentAdmin.role !== 'owner';
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
  wireCameraCapture();
  wireTeamForm();
  wireTelegramForm();
  wireGeneralSettingsForm();
  wireEmailForm();
  wireSocialForm();
  await loadCategories(); // categories are public-read and feed the product form's select regardless of the "categories" tab permission
  if (canSee('products')) await loadProducts();
  if (canSee('orders')) {
    loadOrders();
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
  if (currentAdmin.role === 'owner') {
    await loadTeam();
    await loadTelegramSettings();
    await loadGeneralSettings();
    await loadEmailSettings();
    await loadSocialSettings();
  }
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

// ---- one-time import of the starter catalog (used when Firestore is still empty) ----
const SEED_CATEGORIES = [
  { name: 'مكياج', desc: 'ألوان ولمسات لكل إطلالة' },
  { name: 'العناية بالبشرة', desc: 'روتين يومي لبشرة متألقة' },
  { name: 'عطور', desc: 'روائح تبقى في الذاكرة' },
  { name: 'العناية بالشعر', desc: 'تغذية ولمعان ونعومة' }
];
const SEED_PRODUCTS = [
  { name: 'أحمر شفاه Velvet Rose', category: 'مكياج', price: 18500, oldPrice: 22000, badge: 'الأكثر مبيعاً', rating: 4.9, desc: 'لون مخملي غني وثبات طويل بتركيبة ناعمة لا تسبب الجفاف.', image: 'assets/images/products/photos/lipstick.jpg' },
  { name: 'سيروم Glow Vitamin C', category: 'العناية بالبشرة', price: 32000, oldPrice: 36000, badge: 'جديد', rating: 4.8, desc: 'سيروم إشراقة يومي بفيتامين C يساعد على توحيد مظهر البشرة.', image: 'assets/images/products/photos/serum.jpg' },
  { name: 'عطر Mirna Bloom 50ml', category: 'عطور', price: 45000, oldPrice: 52000, badge: 'حصري', rating: 4.9, desc: 'رائحة أنثوية ناعمة بمزيج زهري دافئ يناسب الاستخدام اليومي.', image: 'assets/images/products/photos/perfume.jpg' },
  { name: 'ماسكارا Lash Lift', category: 'مكياج', price: 16000, oldPrice: 19000, badge: '-15%', rating: 4.7, desc: 'تكثيف وتطويل للرموش مع فرشاة دقيقة ونتيجة طبيعية واضحة.', image: 'assets/images/products/photos/mascara.jpg' },
  { name: 'كريم ترطيب Hydra Silk', category: 'العناية بالبشرة', price: 27500, oldPrice: 0, badge: '', rating: 4.6, desc: 'مرطب خفيف للاستخدام اليومي يمنح ملمساً ناعماً ومريحاً.', image: 'assets/images/products/photos/cream.jpg' },
  { name: 'زيت شعر Argan Repair', category: 'العناية بالشعر', price: 24000, oldPrice: 28000, badge: 'مختار لك', rating: 4.8, desc: 'زيت أرغان خفيف للمساعدة على تنعيم الشعر وتقليل مظهر التقصف.', image: 'assets/images/products/photos/hair-oil.jpg' },
  { name: 'باليت Nude Elegance', category: 'مكياج', price: 38000, oldPrice: 43000, badge: 'مميز', rating: 4.9, desc: 'درجات يومية متعددة بلمسات مطفية ولامعة تناسب مختلف الإطلالات.', image: 'assets/images/products/photos/palette.jpg' },
  { name: 'غسول Pure Balance', category: 'العناية بالبشرة', price: 21000, oldPrice: 0, badge: '', rating: 4.7, desc: 'غسول لطيف ينظف البشرة ويتركها بإحساس منعش دون شد.', image: 'assets/images/products/photos/cleanser.jpg' },
  { name: 'كونسيلر Perfect Cover', category: 'مكياج', price: 17500, oldPrice: 20000, badge: 'مطلوب', rating: 4.6, desc: 'تغطية كاملة لعيوب البشرة والهالات مع ملمس خفيف لا يشعر بالثقل.', image: 'assets/images/products/photos/concealer.jpg' },
  { name: 'أيلاينر Precision Liner', category: 'مكياج', price: 14000, oldPrice: 0, badge: '', rating: 4.7, desc: 'رأس دقيق يرسم خط عين حاد وثابت طوال اليوم دون تلطخ.', image: 'assets/images/products/photos/eyeliner.jpg' },
  { name: 'هايلايتر Golden Glow', category: 'مكياج', price: 23000, oldPrice: 27000, badge: 'جديد', rating: 4.8, desc: 'بودرة مضغوطة تمنح إشراقة ذهبية طبيعية على عظمة الخد والأنف.', image: 'assets/images/products/photos/highlighter.jpg' },
  { name: 'واقي شمس Sun Shield SPF50', category: 'العناية بالبشرة', price: 26000, oldPrice: 0, badge: 'أساسي يومي', rating: 4.9, desc: 'حماية عالية من أشعة الشمس بتركيبة خفيفة تناسب طقس العراق الحار.', image: 'assets/images/products/photos/sunscreen.jpg' },
  { name: 'تونر Rose Water', category: 'العناية بالبشرة', price: 19000, oldPrice: 22000, badge: '', rating: 4.7, desc: 'ماء ورد نقي ينعش البشرة ويهيئها لامتصاص أفضل لبقية روتين العناية.', image: 'assets/images/products/photos/toner.jpg' },
  { name: 'ماسك طيني Deep Clean', category: 'العناية بالبشرة', price: 22500, oldPrice: 0, badge: 'مختار لك', rating: 4.6, desc: 'ماسك طين طبيعي يسحب الشوائب ويقلل لمعان البشرة الدهنية.', image: 'assets/images/products/photos/clay-mask.jpg' },
  { name: 'عطر Oud Al Layl', category: 'عطور', price: 48000, oldPrice: 55000, badge: 'حصري', rating: 4.9, desc: 'مزيج عود شرقي دافئ بثبات طويل يناسب السهرات والمناسبات.', image: 'assets/images/products/photos/oud-perfume.jpg' },
  { name: 'بادي مست Vanilla Musk', category: 'عطور', price: 21000, oldPrice: 0, badge: 'جديد', rating: 4.7, desc: 'رذاذ جسم يومي برائحة فانيليا ناعمة تدوم طوال اليوم.', image: 'assets/images/products/photos/body-mist.jpg' },
  { name: 'شامبو Keratin Smooth', category: 'العناية بالشعر', price: 20000, oldPrice: 23000, badge: '-15%', rating: 4.6, desc: 'ينظف فروة الرأس ويقلل التجعد مع تركيبة غنية بالكيراتين.', image: 'assets/images/products/photos/shampoo.jpg' },
  { name: 'سيروم شعر Anti Frizz', category: 'العناية بالشعر', price: 18500, oldPrice: 0, badge: '', rating: 4.5, desc: 'سيروم خفيف يروّض الشعر المجعد ويمنحه لمعاناً فورياً دون دهنية.', image: 'assets/images/products/photos/hair-serum.jpg' }
];

async function seedLocalCatalog(){
  if (!confirm(`رح نضيف ${SEED_CATEGORIES.length} أقسام و${SEED_PRODUCTS.length} منتج جاهزين كبداية لمتجرچ. تريدين المتابعة؟`)) return;
  document.querySelectorAll('.seed-catalog-btn').forEach(b => b.disabled = true);
  try {
    let batch = writeBatch(db);
    SEED_CATEGORIES.forEach((c, i) => batch.set(doc(collection(db, 'categories')), { name: c.name, desc: c.desc, sortOrder: i }));
    SEED_PRODUCTS.forEach((p, i) => batch.set(doc(collection(db, 'products')), {
      name: p.name, category: p.category, price: p.price, oldPrice: p.oldPrice || 0,
      badge: p.badge || '', rating: p.rating || 4.8, desc: p.desc || '', featured: false,
      sortOrder: i, imageURL: p.image
    }));
    await batch.commit();
    await loadCategories();
    if (canSee('products')) await loadProducts();
    toast('تم استيراد الكتالوج بنجاح');
  } catch (err) {
    console.error(err);
    toast('صار خطأ أثناء الاستيراد، حاولي مرة أخرى');
  } finally {
    document.querySelectorAll('.seed-catalog-btn').forEach(b => b.disabled = false);
  }
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
    </div>`).join('') : `<div class="empty">لا يوجد أقسام بعد.<br><button type="button" class="btn btn-primary seed-catalog-btn" style="margin-top:14px">استيراد كتالوج جاهز (4 أقسام + 18 منتج)</button></div>`;
  wireDragList(el, saveCategoryOrder);
  el.querySelectorAll('[data-edit-cat]').forEach(b => b.addEventListener('click', () => editCategory(b.dataset.editCat)));
  el.querySelectorAll('[data-del-cat]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.delCat)));
  el.querySelector('.seed-catalog-btn')?.addEventListener('click', seedLocalCatalog);
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

function adminImgSrc(url){
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : '../' + url;
}

function renderProductList(){
  let el = document.getElementById('product-list');
  el.innerHTML = products.length ? products.map(p => `
    <div class="admin-drag-row" draggable="true" data-id="${p.id}">
      <span class="drag-handle">⠿</span>
      <img class="admin-row-thumb" src="${adminImgSrc(p.imageURL)}" alt="">
      <span class="admin-row-title">${p.name}</span>
      <span class="admin-row-sub">${p.category || ''} · ${Number(p.price || 0).toLocaleString('ar-IQ')} د.ع${p.featured ? ' · مميز' : ''}</span>
      <div class="admin-row-actions">
        <button class="btn btn-soft" data-edit-p="${p.id}">تعديل</button>
        <button class="btn btn-outline" data-del-p="${p.id}">حذف</button>
      </div>
    </div>`).join('') : `<div class="empty">لا يوجد منتجات بعد.<br><button type="button" class="btn btn-primary seed-catalog-btn" style="margin-top:14px">استيراد كتالوج جاهز (4 أقسام + 18 منتج)</button></div>`;
  wireDragList(el, saveProductOrder);
  el.querySelectorAll('[data-edit-p]').forEach(b => b.addEventListener('click', () => editProduct(b.dataset.editP)));
  el.querySelectorAll('[data-del-p]').forEach(b => b.addEventListener('click', () => deleteProduct(b.dataset.delP)));
  el.querySelector('.seed-catalog-btn')?.addEventListener('click', seedLocalCatalog);
}

async function saveProductOrder(ids){
  let batch = writeBatch(db);
  ids.forEach((id, i) => batch.update(doc(db, 'products', id), { sortOrder: i }));
  await batch.commit();
  await loadProducts();
  toast('تم تحديث الترتيب');
}

// ---- product photo capture (device/webcam camera) ----
let cameraStream = null;

function stopCamera(){
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  document.getElementById('camera-panel').hidden = true;
}

async function openCamera(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('الكاميرا غير مدعومة بهذا المتصفح');
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (err) {
    console.error(err);
    toast('تعذر فتح الكاميرا، تأكدي من السماح للموقع بالوصول لها');
    return;
  }
  document.getElementById('camera-video').srcObject = cameraStream;
  document.getElementById('camera-panel').hidden = false;
}

function captureFromCamera(){
  let video = document.getElementById('camera-video');
  if (!video.videoWidth) { toast('الكاميرا لسه ما جاهزة، حاولي بعد ثانية'); return; }
  let canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(blob => {
    if (!blob) { toast('تعذر التقاط الصورة'); return; }
    let file = new File([blob], 'product-' + Date.now() + '.jpg', { type: 'image/jpeg' });
    let dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('p-image').files = dt.files;
    showImagePreview(URL.createObjectURL(file));
    stopCamera();
    toast('تم التقاط الصورة، اضغطي حفظ المنتج لرفعها');
  }, 'image/jpeg', 0.92);
}

function showImagePreview(src){
  let img = document.getElementById('p-image-preview');
  if (!src) { img.hidden = true; img.removeAttribute('src'); return; }
  img.src = src;
  img.hidden = false;
}

function wireCameraCapture(){
  document.getElementById('p-camera-btn').addEventListener('click', openCamera);
  document.getElementById('camera-capture-btn').addEventListener('click', captureFromCamera);
  document.getElementById('camera-close-btn').addEventListener('click', stopCamera);
  document.getElementById('p-image').addEventListener('change', e => {
    let f = e.target.files[0];
    showImagePreview(f ? URL.createObjectURL(f) : '');
  });
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
      let isNew = !docId;
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
      if (isNew && data.imageURL) postProductToSocial(data);
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
  stopCamera();
  showImagePreview('');
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
  showImagePreview(p.imageURL ? adminImgSrc(p.imageURL) : '');
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
  if (telegramSettings.enabled && telegramSettings.token && telegramSettings.chatId) {
    let itemsText = (order.items || []).map(i => `- ${i.name} ×${i.qty}`).join('\n');
    let text = `🛍 طلب جديد!\nالرقم: ${order.code || ''}\nالزبونة: ${order.customerName || ''}\nالهاتف: ${order.phone || ''}\nالمحافظة: ${order.province || ''} - ${order.district || ''}\nالمجموع: ${Number(order.total || 0).toLocaleString('ar-IQ')} د.ع\n\nالمنتجات:\n${itemsText}`;
    sendTelegramMessage(telegramSettings.token, telegramSettings.chatId, text);
  }
  sendEmailNotification(order);
}

// ---- settings: telegram notifications (owner only) ----
let telegramSettings = { enabled: false, token: '', chatId: '' };

async function sendTelegramMessage(token, chatId, text){
  try {
    let res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    let json = await res.json();
    return !!json.ok;
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function loadTelegramSettings(){
  try {
    let snap = await getDoc(doc(db, 'settings', 'telegram'));
    if (snap.exists()) {
      let d = snap.data();
      telegramSettings = { enabled: !!d.enabled, token: d.token || '', chatId: d.chatId || '' };
      let tokenEl = document.getElementById('tg-token'), chatEl = document.getElementById('tg-chatid'), enEl = document.getElementById('tg-enabled');
      if (tokenEl) { tokenEl.value = telegramSettings.token; chatEl.value = telegramSettings.chatId; enEl.checked = telegramSettings.enabled; }
    }
  } catch (err) {
    console.error(err);
  }
}

function wireTelegramForm(){
  let form = document.getElementById('telegram-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('telegram-form-msg');
    msg.textContent = '';
    try {
      telegramSettings = {
        token: document.getElementById('tg-token').value.trim(),
        chatId: document.getElementById('tg-chatid').value.trim(),
        enabled: document.getElementById('tg-enabled').checked
      };
      await setDoc(doc(db, 'settings', 'telegram'), telegramSettings);
      toast('تم حفظ إعدادات تلجرام');
    } catch (err) {
      console.error(err);
      msg.textContent = 'حدث خطأ أثناء الحفظ، حاولي مرة أخرى';
    }
  });
  document.getElementById('telegram-test-btn').addEventListener('click', async () => {
    let btn = document.getElementById('telegram-test-btn');
    let token = document.getElementById('tg-token').value.trim();
    let chatId = document.getElementById('tg-chatid').value.trim();
    if (!token || !chatId) { toast('أدخلي التوكن و Chat ID أولاً'); return; }
    btn.disabled = true;
    let ok = await sendTelegramMessage(token, chatId, '✅ رسالة تجريبية من لوحة تحكم ميرنا بيوتي — الإعداد شغّال تمام!');
    btn.disabled = false;
    toast(ok ? 'وصلت الرسالة التجريبية بنجاح' : 'تعذر الإرسال، تأكدي من التوكن و Chat ID');
  });
}

// ---- settings: store & contact info (public-read, feeds the storefront footer/contact page) ----
async function loadGeneralSettings(){
  try {
    let snap = await getDoc(doc(db, 'settings', 'general'));
    if (!snap.exists()) return;
    let d = snap.data();
    let map = { 'gs-whatsapp': 'whatsapp', 'gs-phone': 'contactPhone', 'gs-instagram': 'instagram', 'gs-facebook': 'facebook', 'gs-email': 'contactEmail' };
    Object.entries(map).forEach(([elId, key]) => { let el = document.getElementById(elId); if (el) el.value = d[key] || ''; });
  } catch (err) {
    console.error(err);
  }
}

function wireGeneralSettingsForm(){
  let form = document.getElementById('general-settings-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('general-settings-msg');
    msg.textContent = '';
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        whatsapp: document.getElementById('gs-whatsapp').value.trim(),
        contactPhone: document.getElementById('gs-phone').value.trim(),
        instagram: document.getElementById('gs-instagram').value.trim(),
        facebook: document.getElementById('gs-facebook').value.trim(),
        contactEmail: document.getElementById('gs-email').value.trim()
      });
      toast('تم حفظ المعلومات');
    } catch (err) {
      console.error(err);
      msg.textContent = 'حدث خطأ أثناء الحفظ، حاولي مرة أخرى (تأكدي إن قواعد Firestore تسمح بالكتابة على settings/general)';
    }
  });
}

// ---- settings: email notifications via EmailJS (owner only) ----
let emailSettings = { enabled: false, to: '', serviceId: '', templateId: '', publicKey: '' };

async function sendEmailNotification(order){
  if (!emailSettings.enabled || !emailSettings.serviceId || !emailSettings.templateId || !emailSettings.publicKey) return false;
  try {
    let itemsText = (order.items || []).map(i => `${i.name} ×${i.qty}`).join('، ');
    let res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: emailSettings.serviceId,
        template_id: emailSettings.templateId,
        user_id: emailSettings.publicKey,
        template_params: {
          to_email: emailSettings.to,
          order_code: order.code || '',
          customer_name: order.customerName || '',
          phone: order.phone || '',
          total: Number(order.total || 0).toLocaleString('ar-IQ') + ' د.ع',
          items: itemsText,
          province: order.province || '',
          address: order.address || ''
        }
      })
    });
    return res.ok;
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function loadEmailSettings(){
  try {
    let snap = await getDoc(doc(db, 'settings', 'email'));
    if (!snap.exists()) return;
    let d = snap.data();
    emailSettings = { enabled: !!d.enabled, to: d.to || '', serviceId: d.serviceId || '', templateId: d.templateId || '', publicKey: d.publicKey || '' };
    let ids = { 'em-to': 'to', 'em-service': 'serviceId', 'em-template': 'templateId', 'em-publickey': 'publicKey' };
    Object.entries(ids).forEach(([elId, key]) => { let el = document.getElementById(elId); if (el) el.value = emailSettings[key]; });
    let enEl = document.getElementById('em-enabled'); if (enEl) enEl.checked = emailSettings.enabled;
  } catch (err) {
    console.error(err);
  }
}

function wireEmailForm(){
  let form = document.getElementById('email-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('email-form-msg');
    msg.textContent = '';
    try {
      emailSettings = {
        to: document.getElementById('em-to').value.trim(),
        serviceId: document.getElementById('em-service').value.trim(),
        templateId: document.getElementById('em-template').value.trim(),
        publicKey: document.getElementById('em-publickey').value.trim(),
        enabled: document.getElementById('em-enabled').checked
      };
      await setDoc(doc(db, 'settings', 'email'), emailSettings);
      toast('تم حفظ إعدادات البريد');
    } catch (err) {
      console.error(err);
      msg.textContent = 'حدث خطأ أثناء الحفظ، حاولي مرة أخرى';
    }
  });
  document.getElementById('email-test-btn').addEventListener('click', async () => {
    let btn = document.getElementById('email-test-btn');
    let to = document.getElementById('em-to').value.trim();
    let serviceId = document.getElementById('em-service').value.trim();
    let templateId = document.getElementById('em-template').value.trim();
    let publicKey = document.getElementById('em-publickey').value.trim();
    if (!to || !serviceId || !templateId || !publicKey) { toast('عبّي كل الحقول أولاً'); return; }
    btn.disabled = true;
    let prev = emailSettings;
    emailSettings = { enabled: true, to, serviceId, templateId, publicKey };
    let ok = await sendEmailNotification({ code: 'TEST-0001', customerName: 'زبونة تجريبية', phone: '07xxxxxxxxx', total: 1000, items: [{ name: 'منتج تجريبي', qty: 1 }], province: 'بغداد', address: 'عنوان تجريبي' });
    emailSettings = prev;
    btn.disabled = false;
    toast(ok ? 'تم إرسال الإيميل التجريبي بنجاح' : 'تعذر الإرسال، تأكدي من البيانات');
  });
}

// ---- settings: auto-post new products to Facebook/Instagram (owner only) ----
let socialSettings = { fbEnabled: false, igEnabled: false, token: '', pageId: '', igId: '' };

async function postProductToSocial(product){
  if (!socialSettings.token || !product.imageURL) return;
  let caption = `${product.name}\n${Number(product.price || 0).toLocaleString('ar-IQ')} د.ع\n${product.desc || ''}\n\n#ميرنا_بيوتي #MirnaBeauty`;
  if (socialSettings.fbEnabled && socialSettings.pageId) {
    try {
      await fetch(`https://graph.facebook.com/v20.0/${socialSettings.pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: product.imageURL, caption, access_token: socialSettings.token })
      });
    } catch (err) {
      console.error('فشل النشر على فيسبوك', err);
    }
  }
  if (socialSettings.igEnabled && socialSettings.igId) {
    try {
      let createRes = await fetch(`https://graph.facebook.com/v20.0/${socialSettings.igId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: product.imageURL, caption, access_token: socialSettings.token })
      });
      let createJson = await createRes.json();
      if (createJson.id) {
        await fetch(`https://graph.facebook.com/v20.0/${socialSettings.igId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: createJson.id, access_token: socialSettings.token })
        });
      }
    } catch (err) {
      console.error('فشل النشر على إنستغرام', err);
    }
  }
}

async function loadSocialSettings(){
  try {
    let snap = await getDoc(doc(db, 'settings', 'social'));
    if (!snap.exists()) return;
    let d = snap.data();
    socialSettings = { fbEnabled: !!d.fbEnabled, igEnabled: !!d.igEnabled, token: d.token || '', pageId: d.pageId || '', igId: d.igId || '' };
    let tokenEl = document.getElementById('sc-token'), pageEl = document.getElementById('sc-pageid'), igEl = document.getElementById('sc-igid'), fbEl = document.getElementById('sc-fb'), igCheckEl = document.getElementById('sc-ig');
    if (tokenEl) { tokenEl.value = socialSettings.token; pageEl.value = socialSettings.pageId; igEl.value = socialSettings.igId; fbEl.checked = socialSettings.fbEnabled; igCheckEl.checked = socialSettings.igEnabled; }
  } catch (err) {
    console.error(err);
  }
}

function wireSocialForm(){
  let form = document.getElementById('social-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    let msg = document.getElementById('social-form-msg');
    msg.textContent = '';
    try {
      socialSettings = {
        token: document.getElementById('sc-token').value.trim(),
        pageId: document.getElementById('sc-pageid').value.trim(),
        igId: document.getElementById('sc-igid').value.trim(),
        fbEnabled: document.getElementById('sc-fb').checked,
        igEnabled: document.getElementById('sc-ig').checked
      };
      await setDoc(doc(db, 'settings', 'social'), socialSettings);
      toast('تم حفظ إعدادات النشر التلقائي');
    } catch (err) {
      console.error(err);
      msg.textContent = 'حدث خطأ أثناء الحفظ، حاولي مرة أخرى';
    }
  });
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
