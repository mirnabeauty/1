import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "../../assets/js/firebase-init.js";

function toast(m){
  let t = document.querySelector('.toast');
  t.textContent = m; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

const form = document.getElementById('admin-login-form');
const errEl = document.getElementById('admin-login-error');

if (new URLSearchParams(location.search).get('err') === 'noaccess') {
  errEl.textContent = 'هذا الحساب غير مصرح له بدخول لوحة التحكم';
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  errEl.textContent = '';
  const btn = form.querySelector('.btn-primary');
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
    location.href = 'dashboard.html';
  } catch (err) {
    errEl.textContent = 'بيانات الدخول غير صحيحة';
    btn.disabled = false;
  }
});

document.getElementById('forgot-password-link').addEventListener('click', async e => {
  e.preventDefault();
  let email = form.email.value.trim();
  if (!email) { errEl.textContent = 'اكتبي بريدج الإلكتروني أولاً'; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast('تم إرسال رابط إعادة تعيين كلمة المرور لبريدج');
  } catch (err) {
    errEl.textContent = 'تعذر إرسال رابط إعادة التعيين';
  }
});
