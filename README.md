# AutoMerchant

## market

Deno + Playwright automation for a personal Amazon account.

```sh
cd market
deno task install-browser        # one-time Chromium download
cp .env.example .env             # then fill in AMAZON_EMAIL / AMAZON_PASSWORD
deno task login                  # sign in
deno task test
```

Sign-in runs in a visible Chromium window by default — Amazon flags headless
browsers. The session is kept in a persistent profile (`.playwright/`), so
later runs normally skip the login form. Set `AMAZON_TOTP_SECRET` to answer 2FA
automatically; otherwise the code is prompted for on the terminal.
