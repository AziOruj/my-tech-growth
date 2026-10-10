# Cloud routine konfiqurasiyası

claude.ai/code/routines → **New routine** formunu bu dəyərlərlə doldur.

| Sahə | Dəyər |
|---|---|
| Ad | `daily-ai-java-mentor` |
| Repo | `AziOruj/my-tech-growth` |
| Vaxt | Hər gün 08:00 Asia/Baku (= 04:00 UTC, cron `0 4 * * *`) |
| Model | Sonnet (default) |
| Alətlər | Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch |
| Branch push | Unrestricted (main-ə birbaşa push üçün) |

## Prompt

```
Sən my-tech-growth repo-sundasan. Bu, Java backend Tech Lead üçün gündəlik AI-in-Java öyrənmə jurnalıdır.

1. Əvvəlcə CLAUDE.md faylını tam oxu və oradakı 'Gündəlik iş axını', fayl strukturu və qaydalara dəqiq əməl et.
2. Bugünkü tarixi Asia/Baku saat qurşağına görə müəyyən et: TZ=Asia/Baku date +%F. Əgər daily/ qovluğunda bu tarixlə başlayan fayl artıq varsa, heç nə yaratma, 'Bu gün üçün fayl artıq var' yaz və bitir.
3. topics.md-ni oxu, keçilmiş mövzuları təkrarlama, CLAUDE.md-dəki yol xəritəsinə uyğun növbəti mövzunu seç.
4. Kitabxana versiyalarını və API-ləri WebSearch/WebFetch ilə rəsmi mənbələrdən (docs.spring.io, docs.langchain4j.dev, GitHub releases və s.) yoxla. Uydurma API yazma; əmin olmadığın metodu istifadə etmə və ya qeyd et.
5. daily/YYYY-MM-DD-movzu-adi.md faylını yarat (Azərbaycan dilində, texniki terminlər ingiliscə, 10-15 dəqiqəlik oxu, yalnız Java nümunələri). topics.md cədvəlinə yeni sətir əlavə et (Fayl sütununda nisbi markdown link).
6. git config user.name 'AziOruj' və user.email '85117267+AziOruj@users.noreply.github.com' təyin et. Commit mesajı: 'daily: YYYY-MM-DD <mövzu adı>'. main branch-ına push et (git push origin HEAD:main).
7. Əgər main-ə push rədd edilərsə, claude/daily-YYYY-MM-DD branch-ına push et və cavabının sonunda bunu aydın yaz.
8. Sonda 3-4 cümləlik xülasə ver: mövzu, faylın adı, push nəticəsi.
```
