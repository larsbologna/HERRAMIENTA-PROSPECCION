import { api } from '../api.js';
import { $, esc, icon, money, toast } from '../ui.js';

export async function render(main) {
  const s = await api.settings();
  const prices = s.prices;
  main.innerHTML = `
    <div class="page-head"><div><h1>Configuración</h1><p class="muted">Tus datos para los mensajes, precios y copia de seguridad.</p></div></div>
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>Tus datos</h2><span class="sub">Se usan en los mensajes de WhatsApp</span></div>
        <form class="stack" id="form" style="gap:14px">
          <label class="field">Tu nombre<input class="input" name="sellerName" maxlength="120" value="${esc(s.settings.sellerName)}" placeholder="Ej.: Martín"></label>
          <label class="field">Ciudad o zona<input class="input" name="sellerCity" maxlength="120" value="${esc(s.settings.sellerCity)}" placeholder="Ej.: Rosario"></label>
          <label class="field">Nombre de tu negocio<input class="input" name="sellerBusiness" maxlength="120" value="${esc(s.settings.sellerBusiness)}"></label>
          <div><button class="btn btn-primary" type="submit">${icon('check')}Guardar</button></div>
        </form>
      </section>

      <section class="card">
        <div class="card-head"><h2>Datos y copia de seguridad</h2></div>
        <div class="kv"><span>Base de datos</span><code>${esc(s.databaseFile)}</code></div>
        <div class="kv"><span>Archivo de precios</span><code>${esc(s.pricesFile)}</code></div>
        <p class="muted" style="font-size:13px">Todo se guarda en tu computadora. Para respaldar, copiá el archivo de la base de datos o descargá una copia completa en JSON.</p>
        <a class="btn" href="/api/export" download>${icon('download')}Descargar copia (JSON)</a>
      </section>

      <section class="card span-2">
        <div class="card-head"><h2>Precios</h2><span class="sub">Moneda: ${esc(prices?.moneda ?? '—')} · ${prices?.mesesContrato ?? 12} meses de contrato${prices?.descuentoPaquete ? ` · ${prices.descuentoPaquete.porcentaje}% de descuento desde ${prices.descuentoPaquete.minimoServicios} servicios` : ''}</span></div>
        ${s.priceError ? `<div class="banner">precios.json tiene un error y se siguen usando los últimos precios válidos: ${esc(s.priceError)}</div>` : ''}
        ${prices ? `<div class="table-wrap" style="border:0;background:transparent"><table class="table" style="min-width:520px">
          <thead><tr><th>Servicio</th><th class="right">Pago inicial</th><th class="right">Mensual</th><th class="right">Total ${prices.mesesContrato ?? 12} meses</th></tr></thead>
          <tbody>${s.services.map((sv) => {
            const p = prices.servicios?.[sv.id];
            const months = prices.mesesContrato ?? 12;
            return `<tr style="cursor:default"><td class="name">${esc(sv.name)}</td>
              <td class="right num">${p ? money(p.pagoInicial) : '<span class="faint">Sin precio</span>'}</td>
              <td class="right num">${p ? money(p.mensual) : '—'}</td>
              <td class="right num">${p ? money(p.pagoInicial + p.mensual * months) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div>` : ''}
        <p class="muted" style="font-size:13px;margin-bottom:0">Para cambiar precios, editá <code>precios.json</code> con cualquier editor de texto. Al guardarlo, el valor potencial y los presupuestos de todos los prospectos se recalculan solos.</p>
      </section>
    </div>`;

  $('#form', main).onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await api.saveSettings(data);
      toast('Datos guardados');
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}
