# Dalga — Ege Deniz ve Derinlik Tahmini

Dört arkadaşın yaz aylarındaki tekne gezilerini daha iyi planlama fikrinden doğan Dalga; Gülkent/Karaburun, Çeşme ve Ege kıyıları için dalga, rüzgâr ve deniz tabanı bilgilerini tek ekranda toplar.

**Canlı site:** [grand-crepe-055005.netlify.app](https://grand-crepe-055005.netlify.app/)

## Neler var?

- **7 günlük deniz tahmini:** Günlük ortalama dalga, saatlik yükseklik, periyot, dalga yönü ve soluğan yüksekliği.
- **Etkileşimli grafikler:** Dalga/rüzgâr geçişi, kişisel eşik çizgisi, saat seçimi ve saatlik tablo. Klavyeyle gün ve saat seçilebilir.
- **Rüzgâr ve hava:** Knot cinsinden hız ve hamle; hava/deniz sıcaklığı, görüş, yağış olasılığı, UV ve gün doğumu/batımı.
- **Aktivite profilleri:** Tekne, yelken ve kano/SUP için değiştirilebilir dalga, rüzgâr ve hamle eşikleri. Bunlar kişisel karşılaştırma eşikleridir; güvenlik onayı değildir.
- **Daha sakin üç saat:** Gündüzde kalan, gelecekteki ve verisi eksiksiz üç saatlik aralıklar karşılaştırılır. Dalga, rüzgâr ve hamleden kişisel eşiğine oranı en yüksek olan değişken değerlendirilir. Üç saatin en kötü oranı en düşük pencere seçilir. Düşük görüş ve gök gürültülü hava bulunan aralıklar önerilmez.
- **Gerçek derinlik haritası:** EMODnet verisinden sığdan derine altı renk bandı, isteğe bağlı izobatlar, noktaya dokunarak yaklaşık derinlik okuma ve o noktayı dalga tahminine aktarma.
- **Konum araçları:** Hazır Ege noktaları, özel koordinatlar, cihaz konumu ve bu tarayıcıda saklanan favoriler.
- **Planlama:** Kuş uçuşu deniz mili, hızdan süre ve tek yön yakıta %30 pay hesabı; günlük hazırlık listesi; CSV indirme.
- **Veri şeffaflığı:** Model hücresinin seçilen noktaya uzaklığı, eksiksiz saat sayısı, kaynak ve ızgara boyutu. Bağlantı sorunu halinde kaydedilmiş tahmin açıkça etiketlenir.
- Telefon, tablet ve masaüstüne uyumlu arayüz. Örnek görünüm gerçek tahminden ayrı etiketlenir; haritaya kurgusal derinlik eklenmez.

## Veri kaynakları ve doğruluk sınırları

| Bilgi | Kaynak | Nasıl yorumlanmalı? |
| --- | --- | --- |
| Dalga ve deniz yüzeyi sıcaklığı | [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Sayısal model çıktısıdır; canlı şamandıra ölçümü değildir. |
| Rüzgâr ve hava | [Open-Meteo Weather API](https://open-meteo.com/en/docs) | Rüzgâr hızları knot cinsindedir. Deniz ve hava serileri dizi sırasına göre değil zaman damgasıyla eşleştirilir. |
| Derinlik | [EMODnet Bathymetry](https://emodnet.ec.europa.eu/en/bathymetry) | Yaklaşık 115 metrelik, 1/16 yay dakikası ızgara. Hücre ortalamasıdır; en sığ nokta veya anlık su yüksekliği değildir. |
| Harita altlığı | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Coğrafi bağlam sağlar. |
| Harita arayüzü | [Leaflet 1.9.4](https://leafletjs.com/) | Lisansıyla birlikte `vendor/leaflet/` içinde tutulur. |

- Dalga yüksekliğine yapay Ay veya geçmiş dalga katsayısı uygulanmaz. “Belirgin dalga yüksekliği”, tek tek bütün dalgaların yüksekliği değildir; daha büyük dalgalar görülebilir.
- Eksik, negatif veya beklenmedik birimdeki değerler sessizce sıfıra çevrilmez. Eksik veri “sakin deniz” sayılmaz. Bilinen yüksek dalga, kuvvetli hamle, düşük görüş veya gök gürültüsü, diğer veriler eksik olsa da gizlenmez.
- Gün içi en düşük/en yüksek saatlik değerler bir güven aralığı değildir. Servisler konuma özel bir **± hata aralığı sağlamadığı için kesin doğruluk yüzdesi üretilmez**.
- Kıyı biçimi, dar koylar, küçük kayalıklar ve ani sığlıklar model/ızgara içinde çözülemeyebilir. Haritadaki büyütme kaynak çözünürlüğünü artırmaz. EMODnet katmanının kapsamı dışında derinlik uydurulmaz.
- Kaynak metadatası bulunamazsa doğrudan ölçüm olduğu varsayılmaz. Derinlik servisi veya harita parçaları yüklenmezse hata görünür kalır; önceki noktanın değeri yeni noktanın sonucu gibi gösterilmez.
- Seyir ve omurga altı açıklık değerlendirmesi için güncel resmî deniz haritası ve iskandil gerekir. Mesafe hesabı karadan geçebilir; seyredilebilir rota oluşturmaz. Yakıt hesabına dönüş, akıntı, dalga ve manevralar dahil değildir.
- Bütün tarihler ve saatler **Türkiye saati / Europe/Istanbul (UTC+3)** ile gösterilir. İleri tarihli tahminleri tarih yaklaştığında tekrar kontrol edin.

## Yerelde çalıştırma

Uygulama statik HTML, CSS ve JavaScript'tir. API anahtarı, sunucu veya uygulama bağımlılığı kurulumu gerekmez.

1. Depoyu indirin veya klonlayın.
2. `index.html` dosyasını tarayıcıda açın; yanındaki dosyaları ve `vendor/` klasörünü birlikte tutun.
3. Gerçek veriler ve harita katmanları için internet bağlantısı gerekir. Cihaz konumu için tarayıcı izni gerekir; en iyi destek HTTPS veya localhost üzerindedir.

İsteğe bağlı yerel HTTP sunucusu:

```sh
python -m http.server 5173 --bind 127.0.0.1
```

Ardından [localhost:5173](http://localhost:5173) adresini açın.

Favoriler, ayarlar, günlük kontrol listesi ve son tahminler tarayıcının `localStorage` alanında tutulur. Kaydedilmiş tahmin en fazla 48 saat geriye gider ve güncel tahmin yerine açıkça etiketlenir. Kayıt alanı tarayıcı tarafından engellenirse saklama özellikleri kullanılamayabilir.

## Testler

Node.js 22 veya üzeri ile, ek paket kurmadan:

```sh
npm test
```

**19 test**; tarih/saat sınırları, eksik veri, birim kontrolü, rüzgâr yönü, saatlik eşleştirme, gündüz pencereleri, mesafe/yakıt hesabı, derinlik renkleri, koordinat sırası, kapsam ve geçersiz derinlik yanıtlarını kapsar.

Tarayıcı kontrolü için ayrı bir Chrome profiliyle uzaktan hata ayıklamayı `9222` portunda açın ve yerel HTTP sunucusunu başlatın. Ardından:

```sh
node tests/browser-smoke.cjs
```

Bu kontrol servis yanıtlarını taklit ederek mobil taşma, klavye kullanımı, favoriler, CSV, çevrimdışı tahmin, kısmi veri, derinlik sorgusu/harita hataları, hızlı nokta değişimi ve haritadan tahmine geçişi sınar. Ekran görüntülerini işletim sisteminin geçici klasörüne yazar.

`--live` gerçek servisleri de kontrol eder; `--file` HTTP yerine doğrudan `index.html` açılışını sınar. Test kendi açtığı sayfanın yerel kayıtlarını temizlediği için kişisel tarayıcı profiliniz yerine ayrı bir test profili kullanın.

## Yayınlama

```sh
npm run build
```

`dist/` klasörüne yalnızca sitenin çalışma dosyaları ve Leaflet lisansı kopyalanır. Testler, README ve Git dosyaları yayın paketine alınmaz.

`netlify.toml`, Netlify için derleme komutunu ve `dist/` yayın klasörünü tanımlar. Netlify projesi bu GitHub deposunun `main` dalına bağlıysa push sonrasında otomatik dağıtım başlar. Bağlantı henüz yapılmadıysa Netlify'de mevcut sitenin repository/continuous deployment ayarından bu depoyu bağlayın; alternatif olarak `dist/` klasörünü mevcut sitenin dağıtım ekranına yükleyin. Yeni bir dağıtımdan sonra canlı adresteki sürümü ayrıca doğrulayın.

## Dosyalar

| Dosya | Görevi |
| --- | --- |
| `index.html`, `styles.css` | Ana arayüz ve responsive tasarım |
| `app.js` | Tahmin istekleri, kullanıcı etkileşimleri, kayıt ve dışa aktarma |
| `forecast-core.js` | Test edilebilir tahmin ve seyir hesaplamaları |
| `bathymetry-map.js`, `bathymetry.css` | Derinlik haritası ve nokta inceleme arayüzü |
| `bathymetry-core.js` | WMS sorguları, renk sınıfları ve derinlik yanıtı doğrulama |
| `scripts/build-site.cjs` | Statik yayın paketi hazırlama |
| `tests/` | Hesaplama ve tarayıcı kontrolleri |
| `vendor/leaflet/` | Yerel harita kütüphanesi ve lisansı |
