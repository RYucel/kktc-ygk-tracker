import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMevzuatKibrisHtml, extractMaxPage } from '../api/scrape.js';

const SAMPLE_HTML = `
<div class="results">
  <a href="/karar/2026-x-219-1-kamu-ihalelerinde-teklif-hazirlama-giderleri" class="row">
    <div><time dateTime="2026-11-10">10 Kas 2026</time></div>
    <div>
      <span class="text-xl font-medium leading-[1.38] tracking-tight text-ink">Kamu ihalelerinde teklif hazırlama giderleri hakkında yasa gücünde kararname</span>
      <span class="text-base leading-[1.55] text-ink-muted">Özet metin</span>
    </div>
  </a>
  <a href="/karar/2026-x-219-0-deprem-ve-diger-dogal-afetlere-yonelik-mali-yardim" class="row">
    <div><time dateTime="2026-11-10">10 Kas 2026</time></div>
    <div>
      <span class="text-xl leading-[1.38]"><span class="font-normal text-ink">DEPREM VE DİĞER DOĞAL AFETLERE YÖNELİK MALİ YARDIM HAKKINDA YASA GÜCÜNDE KARARNAME</span></span>
      <span class="text-base leading-[1.55] text-ink-muted">Özet metin 2</span>
    </div>
  </a>
  <a href="/karar/2026-x-217-1-bilancolarin-guncellenmesine-iliskin-mali-duzenleme" class="row">
    <div><time dateTime="2026-11-06">6 Kas 2026</time></div>
    <div>
      <span class="text-xl font-medium leading-[1.38] tracking-tight text-ink">Toprak Ürünleri Kurumu&#x27;nun &amp; Bilançoların güncellenmesine ilişkin kararname</span>
      <span class="text-base leading-[1.55] text-ink-muted">Özet metin 3</span>
    </div>
  </a>
  <a href="/karar/2026-x-216-0-eksik-baslikli-kayit" class="row">
    <div><time dateTime="2026-11-05">5 Kas 2026</time></div>
    <div><span class="text-base">Başlık yok</span></div>
  </a>
  <a href="/karar/2026-x-214-1-sirketler-yasasi-onbirinci-cetvel" class="row">
    <div><time dateTime="2026-11-03">3 Kas 2026</time></div>
    <div>
      <span class="text-xl font-medium leading-[1.38]">Şirketler yasası onbirinci cetvel yasa gücünde kararname</span>
    </div>
  </a>
</div>
<nav>
  <a href="/ara?tur=yasa_gucunde_kararname&amp;yil=2026&amp;sayfa=1">1</a>
  <a href="/ara?tur=yasa_gucunde_kararname&amp;yil=2026&amp;sayfa=7">7</a>
</nav>
`;

test('parseMevzuatKibrisHtml extracts both font-medium and nested leading-[1.38] titles without cross-item bleed', () => {
  const items = parseMevzuatKibrisHtml(SAMPLE_HTML);
  assert.equal(items.length, 4);

  assert.equal(items[0].sayi, '219');
  assert.equal(items[0].isoDate, '2026-11-10');
  assert.equal(items[0].date, '10.11.2026');
  assert.equal(items[0].rawDate, '2026-11-10T00:00:00.000Z');
  assert.match(items[0].title, /^Kamu ihalelerinde/);

  // Previously dropped & caused item 217's title to bleed into 219-0
  assert.equal(items[1].sayi, '219');
  assert.equal(items[1].isoDate, '2026-11-10');
  assert.equal(items[1].pdf, 'https://basimevi.gov.ct.tr/Portals/6/2026/219.pdf');
  assert.match(items[1].title, /^DEPREM VE DİĞER DOĞAL AFETLERE/);

  // Entity decoding & accurate pairing with 217
  assert.equal(items[2].sayi, '217');
  assert.equal(items[2].isoDate, '2026-11-06');
  assert.equal(items[2].date, '06.11.2026');
  assert.equal(items[2].pdf, 'https://basimevi.gov.ct.tr/Portals/6/2026/217.pdf');
  assert.equal(
    items[2].title,
    "Toprak Ürünleri Kurumu'nun & Bilançoların güncellenmesine ilişkin kararname"
  );

  // Item 216 has no title; item 214 must still parse cleanly without bleeding
  assert.equal(items[3].sayi, '214');
  assert.equal(items[3].isoDate, '2026-11-03');
  assert.match(items[3].title, /^Şirketler yasası/);
});

test('extractMaxPage discovers highest pagination index', () => {
  assert.equal(extractMaxPage(SAMPLE_HTML), 7);
  assert.equal(extractMaxPage('<div>no pagination</div>'), 1);
});
