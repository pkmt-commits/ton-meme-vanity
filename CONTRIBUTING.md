# Как помочь проекту

Спасибо за интерес! Коротко:

1. `npm run setup` — окружение, сборка, самопроверка ядра (нужна видеокарта NVIDIA).
2. Перед PR: `npm test` и `npm run smoke`. Если меняли `cuda/` — `npm run setup -- --force` (selftest 100/100, 0 расхождений)
   и `node scripts/kernel.mjs stats 300`, чтобы поток кандидатов не вырос в разы.
3. Изменили словарь в `src/gems.mjs` / `src/words_curated.mjs` — пересоберите `cuda/words.h`:
   `node -e "import('./src/gems.mjs').then(m=>m.writeWordsHeader())"`.
4. Генерацию сидов (`derive_seed`) без обсуждения в issue не меняем — это критично для безопасности.
5. **Никогда** не коммитьте `gems.jsonl`, `favorites.jsonl`, `hits*.txt`, `telegram.config.json` (CI это проверяет).

Стиль: как в окружающем коде; комментарии в коде — на русском.
