# Ngrok + Flutter App Тохируулга

## Зорилго

Tablet дээрх Flutter app нь **ямар ч WiFi-аас** backend-тэй холбогдож ажиллах ёстой.

## Асуудал

Ngrok CRL алдаа гарч байна - энэ нь network/DNS асуудал байж магадгүй.

## Шийдэл

### Алхам 1: VPN Ашиглах (Зөвлөмж)

CRL алдааг засахын тулд VPN ашиглах:

1. **Cloudflare WARP суулгах:**
   - https://1.1.1.1/ → Download
   - Суулгаад асаана

2. **Ngrok эхлүүлэх:**
   ```cmd
   fix-ngrok-crl.cmd
   ngrok http 4555
   ```

3. **Tunnel URL авах:**
   - Browser: http://localhost:4040
   - "Forwarding" хэсэгт URL харагдана

### Алхам 2: Flutter App-д Ngrok URL Тохируулах

#### Арга 1: Гараар (Зөвлөмж)

1. **Ngrok web interface нээх:**
   ```
   http://localhost:4040
   ```

2. **Tunnel URL хуулах:**
   - "Forwarding" хэсэгт байгаа HTTPS URL (жишээ: `https://xxxx-xxxx-xxxx.ngrok-free.app`)

3. **Flutter app config засах:**
   - Файл: `inspection_flutter_app/lib/config/app_config.dart`
   - Олно: `static const String _ngrokBaseUrl = '';`
   - Засна:
     ```dart
     static const String _ngrokBaseUrl = 'https://xxxx-xxxx-xxxx.ngrok-free.app';
     ```

4. **Flutter app дахин эхлүүлэх:**
   ```bash
   flutter run
   ```

#### Арга 2: Script ашиглах (туршилт)

```cmd
setup-ngrok-for-flutter.cmd
```

**Анхаар:** Энэ script нь ngrok tunnel эхэлсэн байх ёстой.

## Шалгах

1. **Ngrok tunnel шалгах:**
   - http://localhost:4040 → "Session Status" нь "online" байх ёстой

2. **Flutter app шалгах:**
   - Tablet дээр Flutter app эхлүүлэх
   - Login эсвэл API дуудлага хийх
   - Амжилттай холбогдож байгаа эсэхийг шалгах

## Тайлбар

- **Admin-web болон backend:** "measurement engineers" WiFi-д байна
- **Tablet Flutter app:** Ямар ч WiFi-аас backend-тэй холбогдож ажиллах ёстой
- **Ngrok:** Public URL үүсгэж, ямар ч сүлжээнээс хандах боломжтой болгодог

## Асуудал гарвал

1. **CRL алдаа үргэлжилвэл:**
   - VPN ашиглах (Cloudflare WARP)
   - Өөр network туршиж үзэх

2. **Tunnel URL өөрчлөгдвөл:**
   - Ngrok free tier дээр URL container restart хийхэд өөрчлөгддөг
   - Flutter app config дахин шинэчлэх хэрэгтэй

3. **Ngrok-гүйгээр ашиглах:**
   - Зөвхөн ижил WiFi сүлжээнд байвал боломжтой
   - `_ngrokBaseUrl = ''` гэж үлдээх



