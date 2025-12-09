# Windows Firewall-д Ngrok Зөвшөөрөл Шалгах Заавар

## Арга 1: Windows Security Settings (Хамгийн хялбар)

### Алхам 1: Windows Security нээх

1. **Windows Settings нээх:**
   - `Windows + I` товчлуур дарна
   - Эсвэл Start menu → Settings

2. **Privacy & Security → Windows Security:**
   - Settings цонхны зүүн талаас "Privacy & Security" сонгоно
   - "Windows Security" дарна
   - Эсвэл шууд Start menu → "Windows Security" хайна

3. **Firewall & network protection:**
   - "Firewall & network protection" дарна

### Алхам 2: Firewall Settings нээх

1. **"Allow an app through firewall" дарна:**
   - Доод хэсэгт "Allow an app through firewall" эсвэл "Advanced settings" дарна

2. **"Change settings" дарна:**
   - "Change settings" товчлуур дарна (Admin эрх шаардлагатай)

### Алхам 3: Ngrok олох

1. **List-ээс ngrok хайх:**
   - Scroll хийж "ngrok" эсвэл "ngrok.exe" хайна
   - Хэрэв олдвол checked байх ёстой

2. **Хэрэв олдохгүй бол:**
   - "Allow another app..." дарна
   - "Browse..." дарна
   - Ngrok executable олох:
     - Ихэвчлэн: `C:\Users\<username>\AppData\Local\ngrok\ngrok.exe`
     - Эсвэл: `C:\Program Files\ngrok\ngrok.exe`
     - Эсвэл command prompt дээр: `where ngrok`

## Арга 2: Command Line (Хурдан)

### Ngrok firewall rule шалгах:

```cmd
netsh advfirewall firewall show rule name=all | findstr /I "ngrok"
```

### Хэрэв олдохгүй бол зөвшөөрөл өгөх:

```cmd
REM Admin эрхтэй Command Prompt нээх
REM Ngrok байрлал олох
where ngrok

REM Firewall rule нэмэх (өөрийн ngrok path-ийг оруулна)
netsh advfirewall firewall add rule name="Ngrok" dir=in action=allow program="C:\Users\<username>\AppData\Local\ngrok\ngrok.exe" enable=yes
```

## Арга 3: PowerShell (Дэлгэрэнгүй)

### Admin эрхтэй PowerShell нээх:

```powershell
# Ngrok firewall rule шалгах
Get-NetFirewallRule | Where-Object {$_.DisplayName -like "*ngrok*"}

# Ngrok executable байрлал олох
Get-Command ngrok | Select-Object -ExpandProperty Source

# Firewall rule нэмэх (хэрэв байхгүй бол)
$ngrokPath = (Get-Command ngrok).Source
New-NetFirewallRule -DisplayName "Ngrok" -Direction Inbound -Program $ngrokPath -Action Allow
```

## Арга 4: Windows Defender Firewall with Advanced Security

1. **Windows Defender Firewall with Advanced Security нээх:**
   - Start menu → "Windows Defender Firewall with Advanced Security" хайна
   - Эсвэл `wf.msc` command ажиллуулах

2. **Inbound Rules хэсэг:**
   - "Inbound Rules" дарна
   - "Name" баганаар sort хийж "ngrok" хайна

3. **Outbound Rules хэсэг:**
   - "Outbound Rules" дарна
   - "ngrok" хайна

## Зөвшөөрөл Өгөх

### Хэрэв ngrok олдсон боловч disabled байвал:

1. **Rule дээр right-click:**
   - "Properties" дарна
   - "Enabled" checkbox-ийг check хийх
   - "OK" дарна

### Хэрэв ngrok олдохгүй бол:

1. **"New Rule..." дарна:**
   - "Program" сонгоно
   - "Next" дарна

2. **Ngrok executable олох:**
   - "Browse..." дарна
   - Ngrok executable олох (дээрх байрлалууд)

3. **Action:**
   - "Allow the connection" сонгоно
   - "Next" дарна

4. **Profile:**
   - Бүх checkbox-үүдийг check хийх (Domain, Private, Public)
   - "Next" дарна

5. **Name:**
   - Name: "Ngrok"
   - "Finish" дарна

## Шалгах

Ngrok firewall rule нэмсний дараа:

```cmd
REM Ngrok дахин эхлүүлэх
taskkill /F /IM ngrok.exe
ngrok http 4555
```

Browser дээр http://localhost:4040 нээж, "Session Status" нь "online" байгаа эсэхийг шалгана.



