/** Página pública de valoración (la que abre el QR). Autocontenida, pensada para móvil. */
export function renderQrPage(opts: { reportId: string; businessName: string }): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const name = esc(opts.businessName);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Valora tu experiencia · ${name}</title>
<style>
:root{--brand:#5b5bf6;--ink:#14161f;--muted:#5d6475}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(160deg,#eef0ff,#fff 60%);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);padding:16px}
.card{width:100%;max-width:420px;background:#fff;border-radius:22px;box-shadow:0 20px 60px rgba(40,40,120,.12);padding:28px 22px;text-align:center}
h1{font-size:22px;margin:0 0 6px}p{color:var(--muted);margin:0 0 18px}
.stars{display:flex;justify-content:center;gap:6px;margin:10px 0 18px}
.stars button{font-size:42px;line-height:1;background:none;border:0;cursor:pointer;color:#d6d8e3;transition:transform .1s,color .1s;padding:2px}
.stars button.on{color:#f5b301}.stars button:active{transform:scale(.9)}
textarea,input{width:100%;border:1px solid #e1e3ec;border-radius:12px;padding:12px;font:inherit;margin-bottom:10px}
textarea{min-height:110px;resize:vertical}
.btn{width:100%;border:0;border-radius:12px;padding:14px;font:inherit;font-weight:700;background:var(--brand);color:#fff;cursor:pointer}
.hidden{display:none}.ok{font-size:44px}
</style></head><body>
<main class="card">
  <section id="rate">
    <h1>¿Cómo fue tu experiencia en ${name}?</h1>
    <p>Tu opinión nos ayuda a mejorar.</p>
    <div class="stars" role="radiogroup" aria-label="Valoración">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" aria-label="${n} estrella${n > 1 ? 's' : ''}">★</button>`).join('')}
    </div>
  </section>
  <section id="feedback" class="hidden">
    <h1>Gracias por contarnos</h1>
    <p>¿Qué podríamos mejorar? Tu comentario llega directamente al equipo.</p>
    <textarea id="comment" placeholder="Cuéntanos qué pasó…"></textarea>
    <input id="contact" placeholder="Email o teléfono (opcional, para responderte)">
    <button class="btn" id="send">Enviar comentario</button>
  </section>
  <section id="thanks" class="hidden"><div class="ok">💜</div><h1>¡Muchas gracias!</h1><p id="thanks-text">Hemos recibido tu comentario.</p></section>
</main>
<script>
const id = ${JSON.stringify(opts.reportId)};
let rating = 0;
const stars = [...document.querySelectorAll('.stars button')];
const show = (s) => ['rate','feedback','thanks'].forEach((x) => document.getElementById(x).classList.toggle('hidden', x !== s));
const post = (body) => fetch('/api/r/' + id + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
stars.forEach((b) => {
  b.addEventListener('mouseenter', () => stars.forEach((s) => s.classList.toggle('on', +s.dataset.v <= +b.dataset.v)));
  b.addEventListener('click', async () => {
    rating = +b.dataset.v;
    stars.forEach((s) => s.classList.toggle('on', +s.dataset.v <= rating));
    if (rating === 5) {
      const res = await post({ rating });
      document.getElementById('thanks-text').textContent = 'Te llevamos a Google para que compartas tu opinión…';
      show('thanks');
      if (res.redirect) setTimeout(() => { location.href = res.redirect; }, 900);
    } else {
      show('feedback');
    }
  });
});
document.getElementById('send').addEventListener('click', async () => {
  await post({ rating, comment: document.getElementById('comment').value, contact: document.getElementById('contact').value });
  show('thanks');
});
</script></body></html>`;
}
