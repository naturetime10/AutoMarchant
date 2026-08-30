# AutoMerchant

Recipes are run with [`just`](https://github.com/casey/just) from the repo root,
one module per subproject. `just` lists the modules; `just --list market` lists
that module's recipes.

## market

Deno + Playwright automation for a personal Amazon account.

```sh
just market install                  # one-time Chromium download
cp market/.env.example market/.env   # then fill in AMAZON_EMAIL / AMAZON_PASSWORD
just market login                    # sign in
just market check                    # fmt, lint, type check
just market test
```

Sign-in runs in a visible Chromium window by default — Amazon flags headless
browsers. The session is kept in a persistent profile (`market/.playwright/`),
so later runs normally skip the login form. Set `AMAZON_TOTP_SECRET` to answer
2FA automatically; otherwise the code is prompted for on the terminal.
