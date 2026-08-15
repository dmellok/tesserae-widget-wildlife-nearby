/* wildlife_nearby — a field-guide plate for wherever the panel is.

   Two modes off the same list shape: what was spotted most recently, or what
   turns up most often. The right-hand column carries whichever metric the mode
   produced, so the layout does not change between them.

   Group icons are inlined Phosphor paths rather than the icon font: the font
   loads nondeterministically inside a shadow root and a miss is a silent blank
   box, which on a species list would read as a missing animal. */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/* Only groups with an icon that actually depicts them. Everything else — fungi,
   reptiles, amphibians, and iNaturalist's Animalia/Protozoa/Chromista/unknown —
   resolves server-side to `other`, the binoculars: a sighting, unspecified. */
const TAXA = {
  "Aves": "<path d=\"M176,72a16,16,0,1,1-16-16A16,16,0,0,1,176,72Zm68,8a12,12,0,0,1-5.34,10L220,102.42V120A108.12,108.12,0,0,1,112,228H24A20,20,0,0,1,8.41,195.5l.15-.18L92,95.18V76.89C92,41.28,120.57,12.17,155.69,12H156a63.94,63.94,0,0,1,60.58,43.29L238.66,70A12,12,0,0,1,244,80Zm-33.63,0-10.69-7.13a12,12,0,0,1-5-7A40,40,0,0,0,156,36h-.19c-21.95.11-39.8,18.45-39.8,40.89V99.52a12,12,0,0,1-2.79,7.69L32.57,204H53.05l69.74-83.68a12,12,0,1,1,18.43,15.36L84.29,204H112a84.09,84.09,0,0,0,84-84V96a12,12,0,0,1,5.35-10Z\"/>",
  "Mammalia": "<path d=\"M236,108a24,24,0,1,1-24-24A24,24,0,0,1,236,108ZM68,108a24,24,0,1,0-24,24A24,24,0,0,0,68,108ZM92,84A24,24,0,1,0,68,60,24,24,0,0,0,92,84Zm72,0a24,24,0,1,0-24-24A24,24,0,0,0,164,84Zm48,100a44,44,0,0,1-61.1,40.55,60.15,60.15,0,0,0-45.8,0A44,44,0,0,1,67,145.34,31.33,31.33,0,0,0,81.91,126.6a48,48,0,0,1,92.18,0A31.34,31.34,0,0,0,189,145.34,44,44,0,0,1,212,184Zm-24,0a20,20,0,0,0-10.49-17.6l-.1-.06a55.22,55.22,0,0,1-26.37-33,24,24,0,0,0-46.08,0,55.21,55.21,0,0,1-26.37,33.05l-.1.06A20,20,0,0,0,88,204a19.77,19.77,0,0,0,7.8-1.58l.13,0a84,84,0,0,1,64.14,0l.13,0A19.77,19.77,0,0,0,168,204,20,20,0,0,0,188,184Z\"/>",
  "Insecta": "<path d=\"M235.79,48c-4.27-5.48-12.4-12-26.88-12-17.86,0-40.5,11.7-60.57,31.3-3,2.89-5.74,5.85-8.34,8.84V56a12,12,0,0,0-24,0V76.14c-2.6-3-5.38-6-8.34-8.84C87.59,47.7,65,36,47.09,36c-14.48,0-22.61,6.54-26.88,12C7,65,12,93.91,19.28,122.66c5.75,22.64,17.8,33,28.88,37.69A48.12,48.12,0,0,0,92,228a47.87,47.87,0,0,0,36-16.28A48,48,0,0,0,212,180a48.51,48.51,0,0,0-4.14-19.65c11.08-4.67,23.13-15,28.88-37.69C244,93.91,249,65,235.79,48ZM92,204a24,24,0,0,1-24-24,24.36,24.36,0,0,1,21.31-24.07,12,12,0,0,0-2.64-23.86A47.63,47.63,0,0,0,65.17,140c-8.19-.29-18-4.92-22.63-23.24-7.41-29.18-8.55-47.35-3.39-54C39.74,62,41.3,60,47.09,60,58.3,60,75.91,69.83,90.9,84.47c15.25,14.9,25.1,31.86,25.1,43.2V180A24,24,0,0,1,92,204Zm121.45-87.25C208.81,135.07,199,139.7,190.82,140a47.54,47.54,0,0,0-21.51-7.92,12,12,0,1,0-2.64,23.86A24.36,24.36,0,0,1,188,180a24,24,0,1,1-48,0V127.67c0-11.34,9.85-28.3,25.1-43.2C180.09,69.83,197.7,60,208.91,60c5.79,0,7.35,2,7.94,2.76C222,69.4,220.87,87.57,213.46,116.75Z\"/>",
  "Arachnida": "<path d=\"M140,88a16,16,0,1,1,16,16A16,16,0,0,1,140,88ZM100,72a16,16,0,1,0,16,16A16,16,0,0,0,100,72Zm120,72a91.84,91.84,0,0,1-2.34,20.64L236.81,173a12,12,0,0,1-9.62,22l-18-7.85a92,92,0,0,1-162.46,0l-18,7.85a12,12,0,1,1-9.62-22l19.15-8.36A91.84,91.84,0,0,1,36,144v-4H16a12,12,0,0,1,0-24H36v-4a91.84,91.84,0,0,1,2.34-20.64L19.19,83a12,12,0,0,1,9.62-22l18,7.85a92,92,0,0,1,162.46,0l18-7.85a12,12,0,1,1,9.62,22l-19.15,8.36A91.84,91.84,0,0,1,220,112v4h20a12,12,0,0,1,0,24H220ZM60,116H196v-4a68,68,0,0,0-136,0Zm56,94.92V140H60v4A68.1,68.1,0,0,0,116,210.92ZM196,144v-4H140v70.92A68.1,68.1,0,0,0,196,144Z\"/>",
  "Plantae": "<path d=\"M255.62,51.65a12,12,0,0,0-11.27-11.27c-53.27-3.13-96.2,13.36-114.84,44.14-12.14,20-12.56,44.17-1.46,67.3a75.14,75.14,0,0,0-12.28,23l-12.66-12.66c7.19-16.77,6.43-34.11-2.4-48.69C86.73,90.36,54.89,78,15.55,80.27A12,12,0,0,0,4.28,91.55C2,130.89,14.36,162.73,37.45,176.71a49.76,49.76,0,0,0,26,7.27,57.54,57.54,0,0,0,22.7-4.87L112,205v23a12,12,0,0,0,24,0V198.51a51.63,51.63,0,0,1,9.49-29.95,76.82,76.82,0,0,0,32.1,7.39,64.91,64.91,0,0,0,33.89-9.46C242.25,147.85,258.76,104.92,255.62,51.65ZM49.88,156.18c-13.19-8-21.18-27.46-21.83-52.13,24.67.65,44.14,8.64,52.13,21.83a26,26,0,0,1,3.63,17L72.48,131.51a12,12,0,0,0-17,17l11.34,11.34A26.27,26.27,0,0,1,49.88,156.18ZM199.05,146c-10.66,6.45-23,7.67-35.81,3.76l37.25-37.24a12,12,0,0,0-17-17l-37.25,37.24C142.37,120,143.59,107.61,150,97c12.7-21,42.65-33,81.32-33H232C232.14,103,220.14,133.18,199.05,146Z\"/>",
  "Mollusca": "<path d=\"M250,138a12,12,0,0,1-24,0,94.11,94.11,0,0,0-94-94,84.09,84.09,0,0,0-84,84,74.09,74.09,0,0,0,74,74,64.07,64.07,0,0,0,64-64,54.06,54.06,0,0,0-54-54,44.05,44.05,0,0,0-44,44,34,34,0,0,0,34,34,24,24,0,0,0,24-24,14,14,0,0,0-14-14,4,4,0,0,0-2.82,1.17A12,12,0,0,1,124,148a20,20,0,0,1-20-20,28,28,0,0,1,28-28,38,38,0,0,1,38,38,48.05,48.05,0,0,1-48,48,58.07,58.07,0,0,1-58-58,68.07,68.07,0,0,1,68-68,78.09,78.09,0,0,1,78,78,88.1,88.1,0,0,1-88,88,98.11,98.11,0,0,1-98-98A108.12,108.12,0,0,1,132,20,118.13,118.13,0,0,1,250,138Z\"/>",
  "Actinopterygii": "<path d=\"M172,76a16,16,0,1,1-16-16A16,16,0,0,1,172,76Zm48.22,69.58a102,102,0,0,1-26.78,31.29c-.24.2-.47.39-.72.56a109.52,109.52,0,0,1-13.55,8.83c-18.3,10.07-40.88,15.9-67.22,17.36L91,249a12,12,0,0,1-10.89,7q-.41,0-.81,0a12,12,0,0,1-10.66-8.44l-14.16-46-46-14.19A12,12,0,0,1,7,165l45.4-20.92c1.47-26.33,7.3-48.91,17.37-67.2A110.62,110.62,0,0,1,78.57,63.3c.16-.22.34-.44.51-.66A101.91,101.91,0,0,1,110.41,35.8c25.55-14.19,54.33-16.37,74-15.69,17.76.61,36.49,4,40.76,6.52a12.07,12.07,0,0,1,4.23,4.23c2.52,4.26,5.92,23,6.53,40.76C236.57,91.26,234.4,120,220.22,145.58Zm-68.7,26.66a56.92,56.92,0,0,1-11.12-8.64,55.81,55.81,0,0,1-15.9-32.1,55.81,55.81,0,0,1-32.1-15.9,56.63,56.63,0,0,1-8.63-11.13q-7,20.48-7.7,47.69a12,12,0,0,1-7,10.61L45.51,173.64l22.1,6.82a12,12,0,0,1,7.94,7.94l6.79,22.09L93.23,186.9a12,12,0,0,1,10.61-7Q131,179.29,151.52,172.24ZM209,47c-16.25-3.14-61.81-9-95,14.91a76.73,76.73,0,0,0-14,13,32,32,0,0,0,35,32.94,12,12,0,0,1,13.09,13.09,32,32,0,0,0,33,35,76.33,76.33,0,0,0,13-14C218.05,108.81,212.18,63.22,209,47Z\"/>",
  "other": "<path d=\"M241,150.65s0,0,0-.05a51.33,51.33,0,0,0-2.53-5.9L196.93,50.18a12,12,0,0,0-2.5-3.65,36,36,0,0,0-50.92,0A12,12,0,0,0,140,55V76H116V55a12,12,0,0,0-3.51-8.48,36,36,0,0,0-50.92,0,12,12,0,0,0-2.5,3.65L17.53,144.7A51.33,51.33,0,0,0,15,150.6s0,0,0,.05A52,52,0,1,0,116,168V100h24v68a52,52,0,1,0,101-17.35ZM80,62.28a12,12,0,0,1,12-1.22v63.15a51.9,51.9,0,0,0-35.9-7.62ZM64,196a28,28,0,1,1,28-28A28,28,0,0,1,64,196ZM164,61.06a12.06,12.06,0,0,1,12,1.22l23.87,54.31a51.9,51.9,0,0,0-35.9,7.62ZM192,196a28,28,0,1,1,28-28A28,28,0,0,1,192,196Z\"/>"
};

/* The server has already resolved every taxon to an icon we ship, so this is a
   belt-and-braces fallback rather than the decision point. */
function icon(group, cls) {
  const d = TAXA[group] || TAXA.other;
  return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 256 256" aria-hidden="true">${d}</svg>`;
}

const metric = (r) =>
  r.ago ? r.ago : (r.count != null ? r.count.toLocaleString() : '');
const metricNote = (r) => (r.ago ? (r.where || '') : (r.count != null ? 'records' : ''));

function row(r, showSci) {
  return `
    <div class="row">
      <div class="ic">${icon(r.icon || r.group)}</div>
      <div class="nm">
        <div class="cn">${esc(r.name)}</div>
        ${showSci && r.sci ? `<div class="sn">${esc(r.sci)}</div>` : ''}
      </div>
      <div class="mt">
        <div class="mv">${esc(metric(r))}</div>
        ${metricNote(r) ? `<div class="mn">${esc(metricNote(r))}</div>` : ''}
      </div>
    </div>`;
}

function photoCard(r, showSci) {
  /* A nature card: the observer's own photograph, with a solid band carrying
     the name so the type never fights the picture behind it. */
  return `
    <div class="card">
      ${r.photo ? `<img class="shot" src="${esc(r.photo)}" alt="">`
                : '<div class="shot noshot"></div>'}
      <div class="cap">
        <div class="cic">${icon(r.icon || r.group)}</div>
        <div class="cnm">
          <div class="ccn">${esc(r.name)}</div>
          ${showSci && r.sci ? `<div class="csn">${esc(r.sci)}</div>` : ''}
        </div>
        <div class="cmt">${esc(metric(r))}</div>
      </div>
      ${r.credit ? `<div class="credit">${esc(r.credit)}</div>` : ''}
    </div>`;
}

function galleryTile(r) {
  return `
    <div class="tile">
      ${r.thumb ? `<img class="tshot" src="${esc(r.thumb)}" alt="">`
                : '<div class="tshot noshot"></div>'}
      <div class="tcap">
        <div class="tic">${icon(r.icon || r.group)}</div>
        <div class="tnm">${esc(r.name)}</div>
        <div class="tmt">${esc(metric(r))}</div>
      </div>
    </div>`;
}

function hero(r, showSci) {
  return `
    <div class="hero">
      <div class="hic">${icon(r.icon || r.group, 'big')}</div>
      <div class="hnm">
        <div class="hcn">${esc(r.name)}</div>
        ${showSci && r.sci ? `<div class="hsn">${esc(r.sci)}</div>` : ''}
      </div>
      <div class="hmt">
        <div class="hmv">${esc(metric(r))}</div>
        ${metricNote(r) ? `<div class="hmn">${esc(metricNote(r))}</div>` : ''}
      </div>
    </div>`;
}

export default function render(shadow, ctx) {
  const d = (ctx && ctx.data) || {};
  const fragment = (ctx && ctx.cell && ctx.cell.fragment) || 'full';
  const solo = fragment === 'one';
  const showSci = d.show_sci !== false;
  /* an explicitly chosen fragment wins, otherwise the cell option decides */
  const layout = solo ? 'list' : (d.layout || 'list');
  const items = d.items || [];

  let body;
  if (d.error) {
    body = `<div class="msg"><div class="msg-t">Wildlife nearby</div>
            <div class="msg-b">${esc(d.error)}</div></div>`;
  } else if (!items.length) {
    body = `<div class="msg"><div class="msg-t">Wildlife nearby</div>
            <div class="msg-b">Nothing recorded within ${esc(d.radius_km)} km yet.</div>
            <div class="msg-h">Try a wider radius, or turn off verified-only.</div></div>`;
  } else if (solo || layout === 'photo') {
    body = layout === 'photo'
      ? photoCard(items[0], showSci)
      : `<div class="solo">${hero(items[0], showSci)}</div>`;
  } else if (layout === 'gallery') {
    body = `<div class="grid">${items.slice(0, 6).map(galleryTile).join('')}</div>`;
  } else {
    body = `
      ${hero(items[0], showSci)}
      <div class="list">${items.slice(1).map((r) => row(r, showSci)).join('')}</div>`;
  }

  shadow.innerHTML = `
    <link rel="stylesheet" href="/static/style/spectra-widgets.css">
    <div class="wl">
      <div class="head">
        <div class="ht">${esc(d.group_label || 'Wildlife')} nearby</div>
        <div class="hr">${esc(d.mode_label || '')}${d.radius_km ? ` · ${d.radius_km} km` : ''}</div>
      </div>
      ${body}
      ${d.error || solo || layout === 'photo' ? '' : `<div class="foot">
        <span>${esc(d.label || '')}</span>
        <span>${d.total_observations ? d.total_observations.toLocaleString() + ' observations · ' : ''}iNaturalist</span>
      </div>`}
    </div>
    <style>
      :host { display: block; height: 100%; }
      .wl {
        container-type: size; height: 100%; width: 100%;
        display: flex; flex-direction: column;
        background: var(--surface); color: var(--text-primary);
        font-family: var(--font-family, inherit);
        font-variant-numeric: tabular-nums; overflow: hidden;
      }
      .head {
        display: flex; align-items: baseline; justify-content: space-between; gap: 2cqw;
        background: var(--text-primary); color: var(--on-accent, white);
        padding: 1.9cqmin 3cqw 1.7cqmin;
      }
      .ht {
        font-size: 3.4cqmin; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .hr {
        font-size: 2.7cqmin; font-weight: 700; letter-spacing: 0.16em;
        text-transform: uppercase; white-space: nowrap; flex: 0 0 auto;
      }

      .ico { width: 1em; height: 1em; fill: currentColor; flex: 0 0 auto; }

      .hero {
        display: flex; align-items: center; gap: 3cqw;
        padding: 2.6cqmin 3cqw; flex: 0 0 auto;
      }
      .hic { font-size: 11cqmin; line-height: 0; display: flex; }
      .hnm { flex: 1 1 auto; min-width: 0; }
      .hcn {
        font-size: 6.4cqmin; font-weight: 800; line-height: 1.06;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .hsn {
        font-size: 3cqmin; font-style: italic; color: var(--text-secondary);
        margin-top: 0.6cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .hmt { text-align: right; flex: 0 0 auto; }
      .hmv { font-size: 4.4cqmin; font-weight: 800; line-height: 1.05; white-space: nowrap; }
      .hmn {
        font-size: 2.4cqmin; font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase; color: var(--text-secondary); margin-top: 0.4cqmin;
        white-space: nowrap;
      }
      .solo { flex: 1 1 auto; display: flex; align-items: center; }
      .solo .hero { width: 100%; }

      .list { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
      /* rows share whatever height is left, so a long list never pushes the
         footer out from under the plate */
      .row {
        display: flex; align-items: center; gap: 2.4cqw;
        padding: 1cqmin 3cqw; min-width: 0;
        flex: 1 1 0; min-height: 0;
      }
      /* zebra rather than rules: a species list is long and rules stack up into
         a grid, while alternating ground keeps the eye on the row */
      .row:nth-child(odd) { background: var(--surface-sunken); }
      .ic { font-size: 5cqmin; line-height: 0; display: flex; color: var(--text-secondary); }
      .nm { flex: 1 1 auto; min-width: 0; }
      .cn {
        font-size: 3.6cqmin; font-weight: 800; line-height: 1.1;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .sn {
        font-size: 2.5cqmin; font-style: italic; color: var(--text-secondary);
        margin-top: 0.2cqmin; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .mt { text-align: right; flex: 0 0 auto; }
      .mv { font-size: 3cqmin; font-weight: 800; white-space: nowrap; }
      .mn {
        font-size: 2.1cqmin; font-weight: 700; letter-spacing: 0.1em;
        text-transform: uppercase; color: var(--text-secondary); white-space: nowrap;
      }

      .foot {
        display: flex; justify-content: space-between; gap: 2cqw;
        padding: 1.4cqmin 3cqw 1.6cqmin; flex: 0 0 auto;
        font-size: 2.3cqmin; font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase; color: var(--text-secondary);
      }
      .foot span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* ---- photo card ---- */
      .card { flex: 1 1 auto; position: relative; min-height: 0; overflow: hidden; }
      .shot { width: 100%; height: 100%; object-fit: cover; display: block; }
      .noshot { background: var(--surface-sunken); }
      .cap {
        position: absolute; left: 0; right: 0; bottom: 0;
        display: flex; align-items: center; gap: 2.4cqw;
        padding: 2.2cqmin 3cqw; background: var(--text-primary); color: var(--on-accent, white);
      }
      .cic { font-size: 7cqmin; line-height: 0; display: flex; flex: 0 0 auto; }
      .cnm { flex: 1 1 auto; min-width: 0; }
      .ccn {
        font-size: 5.6cqmin; font-weight: 800; line-height: 1.06;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .csn {
        font-size: 2.8cqmin; font-style: italic; opacity: 0.72; margin-top: 0.4cqmin;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cmt { font-size: 4cqmin; font-weight: 800; white-space: nowrap; flex: 0 0 auto; }
      .credit {
        position: absolute; right: 1.4cqw; top: 1.2cqmin;
        font-size: 2cqmin; font-weight: 700; color: var(--on-accent, white);
        background: var(--text-primary); padding: 0.5cqmin 1.2cqw;
        max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      /* ---- gallery ---- */
      .grid {
        flex: 1 1 auto; min-height: 0; display: grid; gap: 0.9cqmin;
        grid-template-columns: repeat(3, 1fr); grid-auto-rows: 1fr; padding: 0.9cqmin;
      }
      .tile { position: relative; overflow: hidden; min-height: 0; }
      .tshot { width: 100%; height: 100%; object-fit: cover; display: block; }
      .tcap {
        position: absolute; left: 0; right: 0; bottom: 0;
        display: flex; align-items: baseline; gap: 1.2cqw;
        padding: 1cqmin 1.4cqw; background: var(--text-primary); color: var(--on-accent, white);
      }
      .tic { font-size: 3cqmin; line-height: 0; align-self: center; flex: 0 0 auto; }
      .tnm {
        flex: 1 1 auto; min-width: 0; font-size: 2.7cqmin; font-weight: 800;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tmt { font-size: 2.2cqmin; font-weight: 700; opacity: 0.8; white-space: nowrap; }

      @container (max-width: 520px) { .grid { grid-template-columns: repeat(2, 1fr); } }

      .msg {
        flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center;
        gap: 1.4cqmin; padding: 4cqmin 4cqw;
      }
      .msg-t {
        font-size: 3cqmin; font-weight: 800; letter-spacing: 0.18em;
        text-transform: uppercase; color: var(--text-secondary);
      }
      .msg-b { font-size: 5.4cqmin; font-weight: 800; line-height: 1.18; }
      .msg-h { font-size: 3cqmin; font-weight: 700; color: var(--text-secondary); }

      /* a short cell cannot hold the hero as well as the list */
      @container (max-height: 220px) {
        .hero { display: none; }
        .foot { display: none; }
      }
      @container (max-width: 380px) {
        .sn, .hsn { display: none; }
        .mn, .hmn { display: none; }
      }
    </style>`;
}
