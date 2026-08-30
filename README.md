# AutoMerchant

Recipes are run with [`just`](https://github.com/casey/just) from the repo root;
`just` on its own lists them.

## market

Deno + Playwright automation for a personal Amazon account.

```sh
just install                     # one-time Chromium download
cp market/.env.example market/.env   # then fill in AMAZON_EMAIL / AMAZON_PASSWORD
just login                       # sign in
just check                       # fmt, lint, type check
just test
```

Sign-in runs in a visible Chromium window by default — Amazon flags headless
browsers. The session is kept in a persistent profile (`market/.playwright/`),
so later runs normally skip the login form. Set `AMAZON_TOTP_SECRET` to answer
2FA automatically; otherwise the code is prompted for on the terminal.
