/*
 * KKTC Resmi Gazete sayfası ayrıştırıcı.
 *
 * Sayfa yapısı (2026 itibarıyla):
 *   <table class="table">                     <- ana tablo
 *     <tr>
 *       <td><a href="/Portals/6/2026/217.pdf">217</a></td>   SAYI
 *       <td>6.11.2026</td>                                       TARİH
 *       <td><table>                                              İÇERİK (iç tablo)
 *             <tr><td>EK I BÖLÜM II</td><td></td><td>... YASA GÜCÜNDE KARARNAME</td></tr>
 *             <tr><td></td><td></td><td>... YASA GÜCÜNDE KARARNAME</td></tr>
 *             <tr><td>EK IV BÖLÜM I</td><td>Ü(K-I) 2745-2026</td><td>...</td></tr>
 *           </table></td>
 *       <td>[indir]</td>
 *     </tr>
 *
 * Yasa Gücünde Kararnameler "EK I BÖLÜM II" altında yayımlanır. "EK IV" altındaki
 * Bakanlar Kurulu kararları (Ü(K-I)...) aynı başlığı tekrar ettiği için dışlanır.
 */
(function (root) {
  const YGK = 'YASA GÜCÜNDE KARARNAME';
  const DATE_RE = /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/;

  const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const up = (s) => s.toLocaleUpperCase('tr-TR');

  function parseDate(str) {
    const m = clean(str).match(DATE_RE);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }

  function directRows(table) {
    const rows = [];
    for (const child of table.children) {
      if (child.tagName === 'TR') rows.push(child);
      else if (/^T(BODY|HEAD|FOOT)$/.test(child.tagName)) {
        for (const tr of child.children) if (tr.tagName === 'TR') rows.push(tr);
      }
    }
    return rows;
  }

  function directCells(tr) {
    return Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  }

  function findMainTable(doc) {
    // Gazete PDF linki içeren ve bir hücresinde tarih bulunan en dış tablo
    const candidates = Array.from(doc.querySelectorAll('table')).filter(
      (t) => !t.parentElement || !t.parentElement.closest('table')
    );
    let best = null;
    let bestScore = 0;
    for (const t of candidates) {
      const score = directRows(t).filter((tr) => {
        const tds = directCells(tr);
        return tds.length >= 3 && tds[0].querySelector('a[href*="Portals/6/"]') && parseDate(tds[1].textContent);
      }).length;
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  }

  /** Bir içerik hücresinden (bölüm, başlık) listesi çıkarır. */
  function extractItems(contentCell) {
    const inner = contentCell.querySelector('table');
    if (!inner) {
      // Eski düz biçim: tüm metni tek kalem say
      return [{ section: '', ref: '', title: clean(contentCell.textContent) }];
    }
    const items = [];
    let section = '';
    for (const tr of inner.querySelectorAll('tr')) {
      const tds = directCells(tr);
      if (!tds.length) continue;
      if (tds.length >= 3) {
        const first = clean(tds[0].textContent);
        if (first) section = up(first);
        items.push({ section, ref: clean(tds[1].textContent), title: clean(tds[2].textContent) });
      } else {
        items.push({ section, ref: '', title: clean(tds[tds.length - 1].textContent) });
      }
    }
    return items;
  }

  function isDecree(item) {
    const title = up(item.title);
    if (!title.includes(YGK)) return false;
    // Bakanlar Kurulu kararları / diğer ekler -> hariç
    if (/^EK\s+(II|III|IV|V|VI)\b/.test(item.section)) return false;
    if (/^Ü\s*\(K/i.test(item.ref)) return false;
    return true;
  }

  /**
   * @param {Document} doc
   * @param {string} [baseUrl]
   * @returns {{sayi:string, pubDate:Date, title:string, pdf:string, section:string}[]}
   */
  function parseGazettes(doc, baseUrl = 'https://basimevi.gov.ct.tr') {
    const table = findMainTable(doc);
    if (!table) throw new Error('Resmi Gazete tablosu sayfada bulunamadı (site yapısı değişmiş olabilir).');

    const out = [];
    const seen = new Set();
    for (const tr of directRows(table)) {
      const tds = directCells(tr);
      if (tds.length < 3) continue;
      const pubDate = parseDate(tds[1].textContent);
      if (!pubDate) continue;

      const link = tds[0].querySelector('a[href]');
      const sayi = clean(tds[0].textContent);
      let pdf = '#';
      if (link) {
        const href = link.getAttribute('href');
        pdf = /^https?:/i.test(href) ? href : baseUrl + (href.startsWith('/') ? '' : '/') + href;
      }

      for (const item of extractItems(tds[2])) {
        if (!isDecree(item)) continue;
        const key = `${sayi}|${pubDate.getFullYear()}|${item.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ sayi, pubDate, title: item.title, pdf, section: item.section });
      }
    }
    return out;
  }

  const api = { parseGazettes, parseDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YGKParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
