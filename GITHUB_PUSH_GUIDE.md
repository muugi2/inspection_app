# GitHub дээр Repository үүсгэх болон Push хийх заавар

## Алхам 1: GitHub дээр шинэ repository үүсгэх

1. GitHub.com дээр нэвтрэх
2. Баруун дээд буланд "+" товч дарж "New repository" сонгох
3. Repository нэр оруулах (жишээ: `inspection_app`)
4. Description оруулах (optional)
5. Public эсвэл Private сонгох
6. **"Initialize this repository with a README" гэснийг сонгохгүй байх**
7. "Create repository" товч дарна

## Алхам 2: Local repository-д remote нэмэх

```bash
# Root directory руу очих
cd C:\Users\munhb\inspection_app

# Шинэ remote нэмэх (GitHub дээр үүсгэсэн repository URL-ийг ашиглах)
git remote add github https://github.com/YOUR_USERNAME/inspection_app.git

# Remote шалгах
git remote -v
```

## Алхам 3: Бүх өөрчлөлтүүдийг commit хийх

```bash
# Бүх файлуудыг add хийх
git add .

# Commit хийх
git commit -m "Initial commit: Inspection app with backend and Flutter app"

# Эсвэл илүү дэлгэрэнгүй commit message
git commit -m "feat: Complete inspection app

- Backend API with Node.js/Express
- Admin web dashboard with Next.js
- Flutter mobile app
- Docker configuration
- Ngrok integration for public access"
```

## Алхам 4: GitHub руу push хийх

```bash
# Main branch руу push хийх
git push -u github main

# Эсвэл master branch байвал
git push -u github master

# Эсвэл одоогийн branch-ийг push хийх
git push -u github $(git branch --show-current)
```

## Хэрэв алдаа гарвал:

### Branch нэр засах:
```bash
# Main branch үүсгэх
git checkout -b main
git push -u github main
```

### Force push (зөвхөн шаардлагатай бол):
```bash
git push -u github main --force
```

## Анхаарах зүйлс:

1. **config.env файл** - мэдээллийн файл тул GitHub руу push хийхгүй (gitignore дээр байна)
2. **node_modules** - dependencies тул push хийхгүй
3. **.next** - build output тул push хийхгүй
4. **.env файлууд** - мэдээллийн файлууд тул push хийхгүй

## Шалгах:

GitHub дээр repository нээж, бүх файлууд байгаа эсэхийг шалгана уу.




