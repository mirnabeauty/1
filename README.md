# Mirna Beauty Store

مشروع متجر Front-end كامل ومنظم باسم ميرنا بيوتي.

## الملفات
- index.html
- pages/shop.html
- pages/product.html
- pages/cart.html
- pages/checkout.html
- pages/wishlist.html
- pages/about.html
- pages/contact.html
- pages/success.html
- assets/css/style.css
- assets/css/animations.css
- assets/js/products.js
- assets/js/cart.js
- assets/js/app.js
- assets/js/validation.js
- assets/images/
- data/products.json

## التشغيل
يمكن فتح index.html مباشرة، والأفضل استخدام Live Server داخل VS Code.

## الوظائف
- عرض المنتجات (من Firestore، مع بيانات محلية احتياطية إذا تعذر الاتصال)
- البحث والتصفية والترتيب، وأقسام ديناميكية قابلة للتعديل من لوحة التحكم
- تفاصيل المنتج
- سلة مشتريات LocalStorage
- مفضلة LocalStorage
- Checkout حقيقي يخزن الطلب بـ Firestore، مع خارطة اختيارية (Leaflet/OpenStreetMap) لتحديد موقع التوصيل
- لوحة تحكم (`admin/`) لإضافة/تعديل/حذف وترتيب المنتجات والأقسام (برفع صور عبر imgbb)، وإدارة حالة الطلبات
- حسابات فريق متعددة بصلاحيات مخصصة لكل عضو (منتجات/أقسام/طلبات)، تدارى من تبويب "الفريق" (يظهر بس لصاحبة الحساب الرئيسي)
- Responsive
- RTL عربي

## إعداد Firebase (خطوات لمرة واحدة)
المشروع مربوط بمشروع Firebase باسم `mirna-e73c4` (الإعدادات موجودة بالفعل في `assets/js/firebase-config.js`). لازم تكملين هذي الخطوات يدوياً من [Firebase Console](https://console.firebase.google.com):

1. فعّلي **Firestore Database** (Native mode).
2. فعّلي **Authentication → Email/Password**، وأنشئي مستخدم إداري واحد (Authentication → Users → Add user) — هذا هو حساب دخولك للوحة التحكم (`admin/login.html`).
3. أول ما تدخلين للوحة التحكم، أضيفي الأقسام الأربعة والمنتجات الثمانية الأصلية يدوياً من تبويبي "الأقسام" و"المنتجات" (تعمل كاختبار أولي للوحة أيضاً).
4. **إنشاء حسابج كـ "مالكة" (خطوة لمرة وحدة، ضرورية عشان تبويب "الفريق" يشتغل ويگدر يضيف أعضاء):**
   - بـ Firestore Database، أنشئي مجموعة (Collection) اسمها `admins`
   - أنشئي مستند (Document) جوه، وحطي **معرّف المستند (Document ID) هو نفس الـ UID مالتج** (اللي عندج، مثلاً `Ppe07A2d2RZOAJ1ZUwibfb054FB2`)
   - أضيفي هذي الحقول للمستند:
     - `email` (نوع string) = إيميلج اللي تدخلين بيه للداشبورد
     - `role` (نوع string) = `owner`
     - `permissions` (نوع map) = `{ products: true, categories: true, orders: true }`
   - احفظي. بعدها سجلي دخول للداشبورد وتأكدي إن تبويب "الفريق" ظاهر وتگدرين تضيفين منه عضو جديد بصلاحيات مخصصة
5. بعد التأكد إن كل شي يشتغل (تسجيل الدخول، إضافة/تعديل، وتبويب الفريق)، الصقي قواعد الأمان التالية في Firestore Rules (تستبدل القواعد القديمة بالكامل):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function adminDoc() { return get(/databases/$(database)/documents/admins/$(request.auth.uid)).data; }
    function isOwner() { return signedIn() && adminDoc().role == 'owner'; }
    function canManage(section) { return signedIn() && (isOwner() || adminDoc().permissions[section] == true); }

    match /admins/{uid}     { allow read: if signedIn(); allow write: if isOwner(); }
    match /products/{id}    { allow read: if true; allow write: if canManage('products'); }
    match /categories/{id}  { allow read: if true; allow write: if canManage('categories'); }
    match /orders/{id}      { allow create: if true; allow read, update, delete: if canManage('orders'); }
  }
}
```

**Storage غير مستخدم** — صور المنتجات تترفع عبر [imgbb](https://imgbb.com) API (المفتاح موجود بـ `admin/js/imgbb-config.js`)، ماكو حاجة تفعلين Firebase Storage.

## الفريق والصلاحيات
- تبويب "الفريق" يظهر بس للمالكة (`role: owner`). منه تضيفين عضو جديد بإيميل وكلمة مرور مؤقتة، وتحددين شنو يقدر يدير (منتجات/أقسام/طلبات).
- إزالة عضو من التبويب توقف وصوله للوحة التحكم فوراً، بس ما تحذف حساب الدخول تاعه من Firebase — إذا تريدين تحذفينه نهائياً روحي لـ Authentication → Users بالـ Firebase Console واحذفيه من گاع.
- في رابط "نسيت كلمة المرور؟" بصفحة الدخول لأي عضو يريد يعيد تعيين كلمة مروره بنفسه.

## الخطوة التالية
دفع إلكتروني، وتوسيع تقارير الطلبات.
