# Ngrok Tunnel Асуудлын Шийдэл

## Асуудал: Tunnel үүсгэгдэхгүй байна

### Шалгах алхамууд:

#### 1. Container-ууд ажиллаж байгаа эсэхийг шалгах:
```powershell
cd c:\Users\munhb\inspection_app\inspection-app-back-end
docker-compose ps
```

Backend болон ngrok container-ууд "Up" төлөвт байх ёстой.

#### 2. Backend container ажиллаж байгаа эсэхийг шалгах:
```powershell
docker ps | findstr backend
```

Хэрэв зогссон бол:
```powershell
docker-compose up -d backend
```

#### 3. Ngrok container ажиллаж байгаа эсэхийг шалгах:
```powershell
docker ps | findstr ngrok
```

Хэрэв зогссон бол:
```powershell
docker-compose up -d ngrok
```

#### 4. Ngrok log-уудыг харах:
```powershell
docker logs inspection_ngrok --tail 50
```

Алдаануудыг хайх:
- "error", "failed", "unable", "refused" гэх мэт үгс

#### 5. Backend-тэй холболтыг шалгах:
```powershell
docker exec inspection_ngrok wget -qO- http://backend:3000
```

Хэрэв алдаа гарвал backend container ажиллахгүй байна.

#### 6. Ngrok API-г шалгах:
```powershell
Invoke-WebRequest -Uri "http://localhost:4040/api/tunnels" -UseBasicParsing
```

Хэрэв холбогдож чадахгүй бол ngrok container ажиллахгүй байна.

### Засах арга:

#### Арга 1: Бүх container-уудыг дахин эхлүүлэх
```powershell
cd c:\Users\munhb\inspection_app\inspection-app-back-end
docker-compose down
docker-compose up -d backend
Start-Sleep -Seconds 10
docker-compose up -d ngrok
Start-Sleep -Seconds 10
```

#### Арга 2: Зөвхөн ngrok-ийг дахин эхлүүлэх
```powershell
docker-compose restart ngrok
Start-Sleep -Seconds 10
```

#### Арга 3: Ngrok log-уудыг шууд харах
```powershell
docker logs inspection_ngrok -f
```

Энэ командыг ажиллуулж, ngrok эхлэх үеийн log-уудыг харна уу.

#### Арга 4: Backend-ийг шалгах
```powershell
# Backend container дотор тестлэх
docker exec inspection_backend wget -qO- http://localhost:3000

# Эсвэл host-оос
Invoke-WebRequest -Uri "http://localhost:4555" -UseBasicParsing
```

### Түгээмэл асуудлууд:

#### 1. Backend container зогссон
**Шалтгаан**: Backend container ажиллахгүй байна
**Шийдэл**: 
```powershell
docker-compose up -d backend
```

#### 2. Ngrok backend:3000 руу хандахгүй
**Шалтгаан**: Network асуудал эсвэл backend container ажиллахгүй
**Шийдэл**: 
```powershell
docker-compose restart backend ngrok
```

#### 3. Auth token асуудал
**Шалтгаан**: config.env файлд NGROK_AUTHTOKEN буруу эсвэл хоосон
**Шийдэл**: config.env файлыг шалгах:
```powershell
Get-Content config.env | Select-String "NGROK_AUTHTOKEN"
```

#### 4. Port conflict
**Шалтгаан**: 4040 порт аль хэдийн ашиглагдаж байна
**Шийдэл**: 
```powershell
netstat -ano | findstr ":4040"
# PID-ийг олоод process-ийг устгах
```

### Автомат засах скрипт:

```powershell
.\fix-ngrok.ps1
```

Энэ скрипт дээрх бүх алхмуудыг автоматаар гүйцэтгэнэ.

### Tunnel үүсэхэд хүлээх хугацаа:

- Ngrok container эхлэхэд: 5-10 секунд
- Tunnel үүсэхэд: 10-15 секунд
- Нийт: 15-25 секунд

### Шалгах командууд:

```powershell
# Tunnel байгаа эсэхийг шалгах
$response = Invoke-WebRequest -Uri "http://localhost:4040/api/tunnels" -UseBasicParsing
$tunnels = $response.Content | ConvertFrom-Json
$tunnels.tunnels

# Ngrok URL авах
.\get-ngrok-url.ps1
```

### Хэрэв бүх зүйл ажиллахгүй бол:

1. Docker-ийг дахин эхлүүлэх
2. Computer-ийг дахин эхлүүлэх
3. Ngrok auth token-ийг дахин шалгах: https://dashboard.ngrok.com/get-started/your-authtoken



