// KKTC Yasa Gücünde Kararname (YGK) API Scraper.
//
// Çok katmanlı kaynak stratejisi:
// 1) Birincil: mevzuatkibris.com (tur=yasa_gucunde_kararname, hızlı, güncel, temiz OCR edilmiş)
// 2) İkincil:  basimevi.gov.ct.tr (resmi Devlet Basımevi)
// 3) Üçüncül:  web.archive.org (Wayback Machine snapshot'ı)
//
// Yanıt: JSON array [{ sayi, date, rawDate, title, pdf, detailUrl }]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function unescapeUnicode(str) {
  try {
    return str
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  } catch (_) {
    return str;
  }
}

/**
 * mevzuatkibris.com üzerinden belirli bir yılın YGK'lerini çeker.
 * 90 günlük pencere genellikle ilk 2-3 sayfada yer alır; sayfa başına 15-20 kayıt gelir.
 * maxPages varsayılan 5'tir (yaklaşık son 80-100 kararname).
 */
async function fetchFromMevzuatKibris(year, maxPages = 6) {
  const all = [];
  const seen = new Set();

  const pattern = new RegExp(
    'href\\\\":\\\\"(?<href>/karar/(?<year>\\d{4})-[a-z]+-(?<sayi>\\d+)-(?<part>\\d+)-(?<slug>[^\\\\"]+))\\\\"' +
      '.*?dateTime\\\\":\\\\"(?<date>\\d{4}-\\d{2}-\\d{2})\\\\"' +
      '.*?text-xl font-medium[^\\\\"]*\\\\",\\\\"children\\\\":\\\\"(?<title>[^\\\\"]+)\\\\"',
    's'
  );

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://mevzuatkibris.com/ara?tur=yasa_gucunde_kararname&yil=${year}&sayfa=${page}&sirala=yeni`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) throw new Error(`mevzuatkibris HTTP ${res.status}`);
    const html = await res.text();

    let addedThisPage = 0;
    let match;
    const globalPattern = new RegExp(pattern.source, 'gs');

    while ((match = globalPattern.exec(html)) !== null) {
      const g = match.groups;
      const key = `${g.year}-${g.sayi}-${g.part}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const title = unescapeUnicode(g.title).trim();
      const [y, m, d] = g.date.split('-').map(Number);
      const pubDate = new Date(y, m - 1, d);

      all.push({
        sayi: g.sayi,
        date: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`,
        rawDate: pubDate.toISOString(),
        title,
        pdf: `https://basimevi.gov.ct.tr/Portals/6/${g.year}/${g.sayi}.pdf`,
        detailUrl: `https://mevzuatkibris.com${g.href}`,
      });
      addedThisPage++;
    }

    // Eğer sayfada hiç sonuç kalmadıysa dur
    if (addedThisPage === 0) break;
  }

  if (!all.length) throw new Error('mevzuatkibris üzerinde kayıt bulunamadı');
  return { items: all, source: 'mevzuatkibris.com', snapshot: null };
}

/**
 * Resmi basimevi.gov.ct.tr ve Wayback yedeği (fallback).
 * HTML döner, istemci tarafı parser.js ile ayrıştırır.
 */
async function fetchFromBasimeviOrWayback(year) {
  const current = new Date().getFullYear();
  const target =
    !year || Number(year) >= current
      ? 'https://basimevi.gov.ct.tr/'
      : `https://basimevi.gov.ct.tr/${encodeURIComponent('ARŞİV')}/${Number(year)}`;

  // 1) Resmi site
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const html = new TextDecoder('utf-8').decode(await res.arrayBuffer());
      if (html.includes('Portals/6/')) {
        return { html, source: 'basimevi.gov.ct.tr', snapshot: null };
      }
    }
  } catch (_) {}

  // 2) Wayback Machine
  const wbRes = await fetch(`https://web.archive.org/web/29991231id_/${target}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(25000),
  });
  if (wbRes.ok) {
    const html = new TextDecoder('utf-8').decode(await wbRes.arrayBuffer());
    const m = wbRes.url.match(/\/web\/(\d{14})/);
    return { html, source: 'web.archive.org', snapshot: m ? m[1] : null };
  }

  throw new Error('Tüm kaynaklara erişim başarısız oldu');
}

export async function getDecrees(year) {
  const errors = [];

  // 1. Tercih: mevzuatkibris.com (en temiz, hızlı ve güncel)
  try {
    const res = await fetchFromMevzuatKibris(year);
    return { type: 'json', ...res };
  } catch (e) {
    errors.push(`mevzuatkibris: ${e.message}`);
  }

  // 2. Tercih: basimevi / Wayback (HTML)
  try {
    const res = await fetchFromBasimeviOrWayback(year);
    return { type: 'html', ...res };
  } catch (e) {
    errors.push(`basimevi/wayback: ${e.message}`);
  }

  throw new Error(errors.join(' | '));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Source, X-Snapshot, X-Data-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const year = req.query?.year || new Date().getFullYear();
    const result = await getDecrees(year);

    res.setHeader('X-Source', result.source);
    res.setHeader('X-Data-Type', result.type);
    if (result.snapshot) res.setHeader('X-Snapshot', result.snapshot);
    // Vercel edge cache: 1 saat taze, 1 gün revalidate süresi
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    if (result.type === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json(result.items);
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(result.html);
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(502).json({ error: error.message });
  }
}
