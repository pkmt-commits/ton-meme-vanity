# Security

This tool creates wallet private keys, so vulnerabilities are taken seriously.

## Reporting a vulnerability

**Do not open a public issue.** Use a private report: the **Security** tab → **Report a vulnerability** in this
repository. Anything about seed generation (`derive_seed` in `cuda/vanity.cu`, the random base from
`std::random_device`) and about where keys end up matters most.

## Threat model (in short)

- The seed of each key = `SHA-256(base ‖ counter)`; the base is 32 bytes from the system CSPRNG and changes every
  ~2000 kernel launches. Leaking one key does not reveal the others.
- Keys are written only to the local files `gems.jsonl` / `favorites.jsonl` (in `.gitignore`). Only the address goes to
  the network (Telegram). Protecting these files on disk is up to the user.
- Every saved key is re-checked with the official `@ton/ton` library.
- The project has not been externally audited.

## Known issues, fixed before publication

1. An early version seeded `mt19937` from a 32-bit number, so keys could be brute-forced (the Profanity class of bug).
2. The seed had the form `counter ‖ base`, so one leaked key let you recover its neighbours.

Do not use keys created by builds from before this repository was first published to hold funds.
