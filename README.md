# AutoMerchant

Recipes are run with [`just`](https://github.com/casey/just) from the repo root.
Repo-wide recipes fan out across subprojects; each subproject is a module with
its own. `just` lists the former, `just --list market` the latter.

```sh
just install                         # one-time setup for every subproject
just test
just check                           # fmt, lint, type check
just fmt
```

## market

Deno + Playwright automation for a personal Amazon account.

```sh
cp market/.env.example market/.env   # then fill in AMAZON_EMAIL / AMAZON_PASSWORD
just market run                      # sign in
just market discover                 # walk every department, product by product
```

`discover` walks each department's listings page by page and reads every
product detail page it ranks — title, images, price, rating, store, details,
style, measurements, styling ideas, questions, reviews, and description.

Each department is written to `output/market/discover/`, a row appended to
`<department>.csv` as each product is read, alongside a `<department>.jsonl`
that keeps the nested fields whole and lets a rerun skip what an earlier run
captured. The run's progress is appended to `discover.log` there too.

```sh
just market discover --departments=electronics,books --pages=2 --products=50
```

Sign-in runs in a visible Chromium window by default — Amazon flags headless
browsers. The session is kept in a persistent profile (`market/.playwright/`),
so later runs normally skip the login form. Set `AMAZON_TOTP_SECRET` to answer
2FA automatically; otherwise the code is prompted for on the terminal.
