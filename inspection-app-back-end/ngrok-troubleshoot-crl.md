# Ngrok CRL Алдаа Засах Заавар

## Асуудал
Ngrok "reconnecting (failed to fetch CRL)" алдаа гарч байна.

## Шалтгаан
CRL (Certificate Revocation List) татахад алдаа гарч байна. Энэ нь ихэвчлэн:
- DNS асуудал
- Network/Firewall хязгаарлалт
- VPN асуудал

## Шийдэл

### Арга 1: DNS Тохируулга Засах (Зөвлөмж)

**Дэлгэрэнгүй заавар:** `windows11-dns-setup.md` файлыг үзнэ үү.

**Товч заавар:**

1. **Network Settings нээх (Windows 11):**
   - `Windows + I` → **Network & Internet**
   - **Ethernet** эсвэл **Wi-Fi** сонгоно
   - **Hardware properties** эсвэл **More network adapter options** дарна
   - Идэвхтэй adapter дээр **right-click** → **Properties**
   - **"Internet Protocol Version 4 (TCP/IPv4)"** → **Properties**

2. **Google DNS ашиглах:**
   - **"Use the following DNS server addresses"** сонгоно
   - **Preferred DNS server:** `8.8.8.8`
   - **Alternate DNS server:** `8.8.4.4`
   - **OK** дарна

3. **DNS cache цэвэрлэх:**
   ```cmd
   ipconfig /flushdns
   ```

4. **Ngrok дахин эхлүүлэх:**
   ```cmd
   fix-ngrok-crl.cmd
   ngrok http 4555
   ```

### Арга 2: VPN Ашиглах

Хэрэв DNS засварлалт ажиллахгүй бол VPN ашиглах:
- Cloudflare WARP (free)
- Бусад VPN service

### Арга 3: Firewall Шалгах

Windows Firewall эсвэл antivirus ngrok-д зөвшөөрөл өгсөн эсэхийг шалгах.

### Арга 4: Өөр Network Ашиглах

Хэрэв боломжтой бол:
- Өөр WiFi сүлжээнд холбогдох
- Mobile hotspot ашиглах

## Шалгах Командууд

```cmd
REM Internet connection шалгах
ping google.com

REM Ngrok API шалгах
ping api.ngrok.com

REM CRL сервер шалгах
ping crl.ngrok-agent.com

REM DNS тохируулга харах
ipconfig /all | findstr "DNS Servers"
```

## Тайлбар

Ngrok v3 дээр `crl_noverify` тохируулга байхгүй тул CRL шалгалтыг идэвхгүй болгох боломжгүй. 
Тиймээс network/DNS асуудлыг засах шаардлагатай.



