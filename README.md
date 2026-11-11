# KKTC Yasa Gücünde Kararname (YGK) – 90 Gün Takipçisi

KKTC Resmi Gazete'de (Devlet Basımevi) yayımlanan Yasa Gücünde Kararnameleri listeler ve
90 günlük Meclis görüşme süresinin ne kadarının geçtiğini/kaldığını gösterir.

## Çalıştırma

```bash
npm start            # http://localhost:3000
```

Bağımlılık yoktur (Node 18+). Vercel'e olduğu gibi deploy edilebilir (`api/scrape.js` serverless fonksiyon olur).

## Nasıl çalışır

- `api/scrape.js` – basimevi.gov.ct.tr ana sayfasını (cari yıl) veya `ARŞİV/<yıl>` sayfasını çeker.
  Resmi siteye erişilemezse en güncel **Wayback Machine** kopyasına düşer ve `X-Source` / `X-Snapshot`
  başlıklarıyla bunu bildirir (arayüz bu durumda uyarı gösterir).
- `parser.js` – Gazete tablosunu ayrıştırır. Her gazete satırındaki iç tabloda yer alan
  `EK I BÖLÜM II` kalemlerinden YGK başlıklarını ayrı ayrı çıkarır; `EK IV` altındaki Bakanlar Kurulu
  kararı tekrarlarını eler.
- `index.html` – Arayüz. 90 günlük pencere yıl başını aşıyorsa önceki yılın arşivini de çeker.
- `server.js` – Yerel geliştirme sunucusu (statik dosyalar + `/api/scrape`, 30 dk önbellek).
