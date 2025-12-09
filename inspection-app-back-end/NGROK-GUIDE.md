# Ngrok ашиглах заавар

## Ngrok гэж юу вэ?

Ngrok нь таны local backend-ийг интернэтээр хандах боломжтой болгодог tool юм. Энэ нь:
- Public HTTPS URL үүсгэдэг (жишээ: `https://abc123def456.ngrok-free.dev`)
- Энэ URL нь таны local backend (`localhost:4555`) руу tunnel үүсгэдэг
- Ямар ч WiFi/сүлжээнээс хандах боломжтой болгодог

## Үйл ажиллагаа

### 1. Ngrok container эхлэх
```powershell
docker-compose up -d ngrok
```

### 2. Ngrok автоматаар tunnel үүсгэдэг
- Ngrok container эхлэхэд автоматаар public URL үүсгэдэг
- Энэ URL нь `backend:3000` (Docker network дотор) руу холбогддог
- Tunnel үүсэхэд ngrok web interface дээр харагдана: `http://localhost:4040`

### 3. Flutter app-д ngrok URL тохируулах

#### Автоматаар (скрипт ашиглах):
```powershell
.\get-ngrok-url.ps1
```

Энэ скрипт:
- Ngrok API-аас active tunnel URL-ийг авна
- Flutter app-ийн `app_config.dart` файлыг автоматаар шинэчилнэ

#### Гараар:
1. Ngrok web interface нээх: `http://localhost:4040`
2. "Forwarding" хэсэгт байгаа HTTPS URL-ийг хуулах
3. `inspection_flutter_app/lib/config/app_config.dart` файлыг нээх
4. `_ngrokBaseUrl`-ийг шинэчилнэ:
```dart
static const String _ngrokBaseUrl = 'https://abc123def456.ngrok-free.dev';
```

## WiFi-ийн 16 оронт код гэж юу вэ?

Энэ нь магадгүй:
- **Ngrok public URL-ийн нэг хэсэг**: `https://abc123def456.ngrok-free.dev` → "abc123def456" (~16 тэмдэгт)
- **Ngrok auth token-ийн нэг хэсэг**: Token нь урт тоо/үсэгний хослол байдаг

**Чухал**: WiFi-ийн сүлжээ нь хамаагүй! Ngrok нь интернэтээр дамжуулдаг тул:
- Backend орж байгаа WiFi-аас ngrok URL авах
- Flutter app-аас өөр WiFi/сүлжээнээс хандах боломжтой

## Асуудлын шийдэл

### Tunnel үүсэхгүй байвал:

1. **Backend container ажиллаж байгаа эсэхийг шалгах:**
```powershell
docker ps | findstr backend
```

2. **Ngrok log-уудыг харах:**
```powershell
docker logs inspection_ngrok --tail 50
```

3. **Ngrok-ийг дахин эхлүүлэх:**
```powershell
docker-compose restart ngrok
```

### Flutter app холбогдож чадахгүй байвал:

1. **Ngrok URL зөв эсэхийг шалгах:**
```powershell
.\get-ngrok-url.ps1
```

2. **Flutter app-ийг дахин эхлүүлэх** (config өөрчлөлт хийсний дараа)

3. **Ngrok URL-ийг шууд тестлэх:**
```powershell
Invoke-WebRequest -Uri "https://your-ngrok-url.ngrok-free.dev/health"
```

## Чухал тэмдэглэл

⚠️ **Ngrok Free Tier-д:**
- URL нь container restart хийхэд өөрчлөгддөг
- Тиймээс Flutter app-ийн config-ийг дахин шинэчлэх хэрэгтэй
- `get-ngrok-url.ps1` скриптийг ашиглах нь хамгийн хялбар арга

✅ **Ngrok Paid Tier-д:**
- Fixed domain ашиглах боломжтой
- URL өөрчлөгдөхгүй

## Ашиглах командууд

```powershell
# Ngrok төлөв шалгах
docker ps | findstr ngrok

# Ngrok URL авах
.\get-ngrok-url.ps1

# Ngrok log харах
docker logs inspection_ngrok -f

# Ngrok эхлүүлэх
docker-compose up -d ngrok

# Ngrok зогсоох
docker-compose stop ngrok
```



