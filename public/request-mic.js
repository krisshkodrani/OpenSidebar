const btn = document.getElementById('allow-btn');
const status = document.getElementById('status');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  status.textContent = 'Requesting permission\u2026';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    status.textContent = 'Permission granted! Closing\u2026';
    status.className = 'status granted';
    setTimeout(() => window.close(), 800);
  } catch (err) {
    status.textContent = 'Permission denied. You can grant it later in Chrome site settings.';
    status.className = 'status denied';
    btn.disabled = false;
    btn.textContent = 'Try Again';
  }
});
