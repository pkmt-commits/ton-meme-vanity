# Contributing

Thanks for your interest! In short:

1. `npm run setup` — environment, build and kernel self-test (needs an NVIDIA GPU).
2. Before a PR: `npm test` and `npm run smoke`. If you changed `cuda/`: `npm run setup -- --force` (selftest 100/100, 0 mismatches)
   and `node scripts/kernel.mjs stats 300`, so the candidate stream doesn't grow several-fold.
3. Changed the dictionary in `src/gems.mjs` / `src/words_curated.mjs`? Rebuild `cuda/words.h`:
   `node -e "import('./src/gems.mjs').then(m=>m.writeWordsHeader())"`.
4. Changed the web pages (`scripts/*-template.html`, `scripts/i18n.mjs`, `web/`, the score)? Rebuild them:
   `npm run build:checker && npm run build:generator` (CI checks that `docs/` matches the sources).
5. Seed generation (`derive_seed`) is not changed without a discussion in an issue: it is security-critical.
6. **Never** commit `gems.jsonl`, `favorites.jsonl`, `hits*.txt`, `telegram.config.json` (CI checks this).

Style: follow the surrounding code; code comments are in English. Issues and PRs in Russian are welcome too.
