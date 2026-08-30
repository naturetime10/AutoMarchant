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

The catalog lives in Postgres. Create the role and databases once, and put the
connection strings in `market/.env` as `DATABASE_URL` and `TEST_DATABASE_URL`:

```sh
psql -d postgres -c "CREATE ROLE automerchant LOGIN PASSWORD 'choose-one'"
createdb -O automerchant automerchant
createdb -O automerchant automerchant_test
```

`just test` writes real tables, so it needs `TEST_DATABASE_URL` to be
reachable; the database tests are skipped, with a warning, when it is not.

`discover` walks each department's listings page by page and reads every
product detail page it ranks — title, images, price, rating, store, details,
style, measurements, styling ideas, questions, reviews, and description.

Everything lands in `output/market/discover/`:

| | |
| --- | --- |
| `images/<asin>/` | The preview images, downloaded. One already on disk is left alone, so a rerun costs nothing for what it has. Cap them with `--images=N`, or pass `--images=0` to record the URLs without fetching. |
| `*.csv` | The same catalog as CSV, one file per table, joined on `asin`. Rows are appended as each product is read, and the files are rewritten from the database when the walk ends, so they match it exactly. |
| `discover.log` | The run's progress, timestamped and appended. |

The catalog itself is in Postgres: a table per kind of row, each keyed back to
the ASIN. A product owns its reviews, details, images, and questions, so a
rerun updates a product instead of appending a second copy of it, and
`captures` keeps a row per visit to trace a price or a rating over time. A
product's reviews and detail rows do not fit in a product's row, so each gets a
row of its own rather than being folded into a cell as JSON.

```sh
psql "$DATABASE_URL" -c \
  "SELECT title, price, rating_average FROM products
   WHERE department = 'electronics' AND rating_count > 1000
   ORDER BY rating_average DESC LIMIT 10"
```

A product already in the catalog is skipped, so a walk resumes where it left
off. `--refresh` reads it again instead: the product is updated in place and a
row is added to `captures`, which is how a price series accumulates.

```sh
just market discover --departments=electronics,books --pages=2 --products=50
just market discover --departments=electronics --refresh --images=0
```

Sign-in runs in a visible Chromium window by default — Amazon flags headless
browsers. The session is kept in a persistent profile (`market/.playwright/`),
so later runs normally skip the login form. Set `AMAZON_TOTP_SECRET` to answer
2FA automatically; otherwise the code is prompted for on the terminal.
