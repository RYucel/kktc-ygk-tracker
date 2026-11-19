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

function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Tek bir SSR <a href="/karar/..."> bloğu içindeki başlık span'ini
 * (iç içe <span> etiketleri olsa bile) dengeli etiket sayımıyla çıkarır.
 */
function extractTitleFromCard(cardHtml) {
  const openRe = /<span\b[^>]*\btext-xl\b[^>]*>/i;
  const openMatch = openRe.exec(cardHtml);
  if (!openMatch) return null;

  const contentStart = openMatch.index + openMatch[0].length;
  const tagRe = /<\/?span\b[^>]*>/gi;
  tagRe.lastIndex = contentStart;

  let depth = 1;
  let endIndex = -1;
  let m;
  while ((m = tagRe.exec(cardHtml)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        endIndex = m.index;
        break;
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }

  if (endIndex === -1) return null;
  const inner = cardHtml.slice(contentStart, endIndex);
  const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * mevzuatkibris.com arama sayfası HTML'inden kararname kayıtlarını çıkarır.
 * Her kayıt kendi <a> bloğu içinde ayrıştırıldığı için komşu kayıtlar birbirine karışmaz.
 */
export function parseMevzuatKibrisHtml(html) {
  const items = [];
  const cardRe = /<a\b[^>]*href="(\/karar\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const hrefRe = /^\/karar\/(?<year>\d{4})-[a-z]+-(?<sayi>\d+)-(?<part>\d+)-(?<slug>[^?#]+)/i;
  const dateRe = /dateTime="(\d{4}-\d{2}-\d{2})"/i;

  let match;
  while ((match = cardRe.exec(html)) !== null) {
    const [, href, body] = match;
    const hm = hrefRe.exec(href);
    if (!hm) continue;

    const dm = dateRe.exec(body);
    if (!dm) continue;

    const title = extractTitleFromCard(body);
    if (!title) continue;

    const { year, sayi, part } = hm.groups;
    const isoDate = dm[1];
    const [y, m, d] = isoDate.split('-').map(Number);

    items.push({
      key: `${year}-${sayi}-${part}`,
      sayi,
      part: Number(part),
      isoDate,
      date: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`,
      rawDate: `${isoDate}T00:00:00.000Z`,
      title,
      pdf: `https://basimevi.gov.ct.tr/Portals/6/${year}/${sayi}.pdf`,
      detailUrl: `https://mevzuatkibris.com${href}`,
    });
  }

  return items;
}

export function extractMaxPage(html) {
  let max = 1;
  const re = /sayfa=(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

async function fetchMevzuatKibrisPage(year, page) {
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
  return res.text();
}

/**
 * mevzuatkibris.com üzerinden belirli bir yılın tüm YGK'lerini çeker.
 * İlk sayfadan toplam sayfa sayısını öğrenip kalan sayfaları paralel gruplar halinde getirir.
 */
async function fetchFromMevzuatKibris(year, maxPages = 15) {
  const all = [];
  const seen = new Set();

  const addItems = (items) => {
    let added = 0;
    for (const item of items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      all.push(item);
      added++;
    }
    return added;
  };

  const firstHtml = await fetchMevzuatKibrisPage(year, 1);
  addItems(parseMevzuatKibrisHtml(firstHtml));

  let targetMax = Math.min(maxPages, extractMaxPage(firstHtml));
  let nextPage = 2;
  const BATCH_SIZE = 5;

  while (nextPage <= targetMax) {
    const batchPages = [];
    for (let p = nextPage; p <= targetMax && batchPages.length < BATCH_SIZE; p++) {
      batchPages.push(p);
    }

    const htmlList = await Promise.all(batchPages.map((p) => fetchMevzuatKibrisPage(year, p)));
    let sawEmpty = false;

    for (const html of htmlList) {
      const parsed = parseMevzuatKibrisHtml(html);
      if (parsed.length === 0) {
        sawEmpty = true;
        break;
      }
      addItems(parsed);
      const discovered = Math.min(maxPages, extractMaxPage(html));
      if (discovered > targetMax) targetMax = discovered;
    }

    if (sawEmpty) break;
    nextPage = batchPages[batchPages.length - 1] + 1;
  }

  if (!all.length) throw new Error('mevzuatkibris üzerinde kayıt bulunamadı');

  all.sort(
    (a, b) =>
      b.isoDate.localeCompare(a.isoDate) ||
      Number(b.sayi) - Number(a.sayi) ||
      b.part - a.part
  );

  const items = all.map(({ key, part, ...rest }) => rest);
  return { items, source: 'mevzuatkibris.com', snapshot: null };
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
    if (html.includes('Portals/6/')) {
      const m = wbRes.url.match(/\/web\/(\d{14})/);
      return { html, source: 'web.archive.org', snapshot: m ? m[1] : null };
    }
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
    const parsedYear = Number(req.query?.year);
    const year =
      Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
        ? parsedYear
        : new Date().getFullYear();
    const result = await getDecrees(year);

    res.setHeader('X-Source', result.source);
    res.setHeader('X-Data-Type', result.type);
    if (result.snapshot) res.setHeader('X-Snapshot', result.snapshot);
    // Vercel edge cache: 30 dk taze, 1 gün revalidate süresi
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');

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
