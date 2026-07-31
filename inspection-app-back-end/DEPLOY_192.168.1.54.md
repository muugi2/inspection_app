# 192.168.1.54:3002 дээр өөрчлөлтүүдийг ажиллуулах

## Товч (нэг команд)

PowerShell-ээс төслийн root (`inspection-app-back-end`) дотор:

```powershell
.\deploy-updates.ps1
```

Дараа нь http://192.168.1.54:3002 нээгээд PDF татах, Mail илгээх, Үзлэг устгах зэргийг шалгана.

---

## Гараар хийх алхамууд

### 1. Backend (өөрчлөлт: үзлэг дуусахад автомат mail болиулах)

Код нь `./` folder-оор volume mount хийгдсэн тул **дахин build хийх шаардлагагүй**. Зөвхөн restart:

```powershell
cd C:\Users\munhb\inspection_app\inspection-app-back-end
docker-compose restart backend
```

### 2. Admin-web (өөрчлөлт: 192.168.1.54:3002-оор API зөв дуудагдах)

Frontend-ийн JavaScript bundle нь image-д build-аар ордог тул **rebuild заавал хийх**:

```powershell
cd C:\Users\munhb\inspection_app\inspection-app-back-end
docker-compose build --no-cache admin-web
docker-compose up -d admin-web
```

### 3. Шалгах

- Admin web: http://192.168.1.54:3002
- Нэвтрээд үзлэгийн хариулт дээр **PDF татах**, **Mail илгээх**, **Үзлэг устгах** товчууд ажиллаж байгаа эсэхийг шалгана.

---

## Ямар өөрчлөлтүүд орсон бэ

| Зүйл | Тайлбар |
|------|--------|
| **API URL** | Admin web нь одоогийн host-оор backend руу дуудна (192.168.1.54:3002 нээхэд → 192.168.1.54:4555). Ингэснээр PDF/Mail/Устгах 192.168.1.54:3002 дээр ажиллана. |
| **Автомат mail** | Үзлэг дуусахад байгууллага руу автоматаар mail илгээх болгосонгүй. |
| **Mail илгээх** | Зөвхөн admin web-ээс "Mail илгээх" товч дарсан үед PDF-ээр mail явагдана. |
