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
- Responsive
- RTL عربي

## إعداد Firebase (خطوات لمرة واحدة)
المشروع مربوط بمشروع Firebase باسم `mirna-e73c4` (الإعدادات موجودة بالفعل في `assets/js/firebase-config.js`). لازم تكملين هذي الخطوات يدوياً من [Firebase Console](https://console.firebase.google.com):

1. فعّلي **Firestore Database** (Native mode).
2. فعّلي **Authentication → Email/Password**، وأنشئي مستخدم إداري واحد (Authentication → Users → Add user) — هذا هو حساب دخولك للوحة التحكم (`admin/login.html`).
3. أول ما تدخلين للوحة التحكم، أضيفي الأقسام الأربعة والمنتجات الثمانية الأصلية يدوياً من تبويبي "الأقسام" و"المنتجات" (تعمل كاختبار أولي للوحة أيضاً).
4. بعد التأكد إن كل شي يشتغل، الصقي قواعد الأمان التالية في Firestore Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /products/{id}    { allow read: if true; allow write: if request.auth != null; }
    match /categories/{id}  { allow read: if true; allow write: if request.auth != null; }
    match /orders/{id}      { allow create: if true; allow read, update, delete: if request.auth != null; }
  }
}
```

**Storage غير مستخدم** — صور المنتجات تترفع عبر [imgbb](https://imgbb.com) API (المفتاح موجود بـ `admin/js/imgbb-config.js`)، ماكو حاجة تفعلين Firebase Storage.

## الخطوة التالية
دفع إلكتروني، حسابات إدارية متعددة، وتوسيع تقارير الطلبات.
