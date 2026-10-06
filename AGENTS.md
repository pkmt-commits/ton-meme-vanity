# Instructions for AI coding agents

You are helping a user install and run **TON Vanity**: a GPU (CUDA) generator of eye-catching, meme-worthy TON wallet addresses.
The user is probably not a developer. Talk to them in their language (the docs are in English; there is a Russian README.ru.md),
keep messages short, and do the work yourself instead of giving them instructions, except where noted below.

## Rule 0 — private keys (read before anything else)

The files `gems.jsonl`, `favorites.jsonl`, `found.secret.jsonl`, `hits*.txt` contain **wallet private keys**
(`seedHex`, `secretKeyHex`, or `HIT <seed> <address>` lines). Anyone who sees a key can steal the money.

- NEVER print, `cat`, `head`, `tail`, `grep`, open, summarize or upload these files, not even "just a few lines".
  (For Claude Code, `.claude/settings.json` in this repo denies the Read tool on them — do not work around it with shell commands.)
- To show results, ONLY use `npm run top` (prints addresses and scores, never keys).
- NEVER commit these files, paste them into chat, send them to any API, website or another tool.
- The ONLY exception: the user explicitly asks for the key of ONE specific address to import it into their wallet.
  Then extract only that one record with a small node script, show the `seedHex` alone in its own code block,
  and remind them not to share it.
- Never disable the thermal protection (`--no-thermal`) and never change fan/power/system settings yourself.

## Step 1 — install (one command)

From the repository root:

```
npm run setup
```

It is safe to run repeatedly. It checks Node.js, NVIDIA driver, CUDA Toolkit and (Windows) MSVC, detects
the GPU architecture, compiles `cuda/vanity.cu`, then runs three self-checks. Success looks like:

```
  OK    selftest: 100/100 match @ton/ton (W5, V4R2, V3R2, V3R1; with and without the table)
  OK    detector check: 0 mismatches
  Done. Next:
```

If it prints `FAIL`, it also prints what to do. Typical fixes:

| FAIL message | What to do |
|---|---|
| `Node.js: version ..., 20+ required` | Ask the user to install Node.js LTS (https://nodejs.org), open a new terminal. On Windows you may run `winget install OpenJS.NodeJS.LTS` if the user agrees. |
| `GPU: nvidia-smi not found or not responding` | No NVIDIA GPU or driver. A driver must be installed by the user (https://www.nvidia.com/drivers); without an NVIDIA GPU this project cannot run. |
| `CUDA Toolkit: nvcc compiler not found` | User installs CUDA Toolkit (https://developer.nvidia.com/cuda-downloads, default options), then a NEW terminal, then `npm run setup` again. |
| `C++ compiler: Visual Studio Build Tools (MSVC) not found` (Windows) | User installs "Build Tools for Visual Studio 2022" with "Desktop development with C++". With the user's consent: `winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`. |
| `kernel build: ... unsupported Microsoft Visual Studio version` | The CUDA Toolkit does not support this MSVC version. Install the Visual Studio version listed in the CUDA release notes (usually 2022). |
| `kernel build: ... unsupported gpu architecture` | CUDA Toolkit too old or too new for this GPU. Install a matching CUDA Toolkit. |
| `self-test`, `v5-lite sieve check` or `detector check` failed | Run `npm run setup -- --force`. If it still fails, STOP: the build computes wrong addresses, do not use it. Tell the user to open an issue with the output. |

Installing software (drivers, CUDA, Visual Studio, Node) is the user's decision: ask before running installers.

## Step 2 — run the hunt

```
npm run hunt
```

It runs until stopped (Ctrl+C) and redraws a dashboard. If you need to run it in the background,
redirect output and read the last ~30 lines of the log, for example:

```
node src/run_cuda.mjs > run.log 2> run.err
```

On the dashboard, check: `Speed` is non-zero, `GPU temp` stays near the target (80°C by default),
and there is no `mismatches` count with a non-zero number. Useful flags: `--max-temp 75`
(cooler and quieter), `--per-hour 6` (fewer Telegram messages). All flags are in README.md, "Hunt options".

## Step 3 — show results (safely)

```
npm run top            # 30 best addresses found so far, no keys
npm run top -- 100     # 100 best
npm run top -- 30 --fav  # addresses the user starred in Telegram
```

## Optional — Telegram notifications

The user must create a bot with @BotFather and send the bot any message. Then:
1. Copy `telegram.config.example.json` to `telegram.config.json` and put the bot token in `"token"`
   (ask the user to paste the token themselves if possible; never commit this file).
2. `npm run telegram-setup` — finds the chat id, writes it into the config, sends a test message.
3. Restart the hunt. Only addresses are ever sent to Telegram, never keys.

If Telegram is blocked in the user's country, set `HTTPS_PROXY` (or enable a system proxy on Windows).

## Optional — exact suffix instead of meme addresses

```
node scripts/kernel.mjs --suffix _durov > hits.txt    # hits.txt contains KEYS (Rule 0)
node src/check_hits.mjs hits.txt                       # verifies each hit, prints only addresses
```

Rough cost: each extra letter is ~32x more attempts (see README.md, "How long it takes").

## Optional — importing a found wallet

Follow README.md, "Importing a found wallet" (MyTonWallet, import by `seedHex`). Remind the user to compare
the imported address with the found address character by character before sending any money.

## Do not

- Do not "optimize" or rewrite `cuda/vanity.cu` / `cuda/detector_words.inc` unless asked; if you do, `npm run setup -- --force`
  must pass (selftest 100/100 and 0 mismatches) before the user uses it.
- Do not change how seeds are generated (`derive_seed` in `cuda/vanity.cu`). It is security-critical.
- Do not add telemetry, uploads or any network calls other than the existing Telegram bot.
