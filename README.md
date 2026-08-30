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

Secrets and settings are kept apart. `market/.env` holds the secrets — the
Amazon login, the 2FA secret, and the connection strings, which carry a
password — and is gitignored. Everything else is in `market/config.toml`,
which is checked in: whether the browser runs headless, where the profile and
the artifacts of a failed run go, where a walk writes, and how many product
pages it reads at once. A missing `config.toml` is not an error; the same
settings apply without it.

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
style, measurements, questions, reviews, and description. A
book's byline names its author rather than a brand, so a book is filed under
`author` and leaves `brand` and the store's name empty; a catalog written
before that reads its books' bylines again the next time it is opened.

Everything lands in `output/market/discover/`:

| | |
| --- | --- |
| `images/<asin>/` | The preview images, downloaded. One already on disk is left alone, so a rerun costs nothing for what it has. Cap them with `--images=N`, or pass `--images=0` to record the URLs without fetching. |
| `discover.log` | The run's progress, timestamped and appended. |

The catalog itself is in Postgres: a table per kind of row, each keyed back to
the ASIN. A product owns its reviews, details, images, and questions, so a
rerun updates a product instead of appending a second copy of it, and
`captures` keeps a row per visit to trace a price or a rating over time. A
product's reviews and detail rows do not fit in a product's row, so each gets a
row of its own rather than being folded into a cell as JSON.

A product's trail — `Home & Kitchen > Kitchen & Dining > Small Appliances >
Blenders > Personal Size Blenders` — is a tree rather than a sentence, so it
lives in `categories`: a row per node naming the parent it hangs from, with
`products.category_id` pointing at the leaf. A branch that two trails share is
one row, so what sits under `Kitchen & Dining` is a walk down `parent_id`
rather than a match against a string, and the same column walks back up to read
a trail out. A node's name is unique among its siblings and nowhere else, which
is what lets `Accessories` sit under both `Electronics` and `Books` without the
two being confused. A catalog that still holds its trails in a cell grows the
tree from them the next time it is opened.

```sh
psql "$DATABASE_URL" -c \
  "WITH RECURSIVE sub AS (
     SELECT id FROM categories WHERE parent_id IS NULL AND name = 'Home & Kitchen'
     UNION ALL
     SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id)
   SELECT p.title, p.price FROM products p JOIN sub ON sub.id = p.category_id
   ORDER BY p.price"
```

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
just market discover --departments=electronics --concurrency=4
```

`--concurrency=N` reads N products at once, a browser tab each, which is the
dial on how long a walk takes. Listing pages are still read one at a time and
in order; it is the product pages behind them that are shared out, and each
tab waits `--pause` between its own, so N tabs make roughly N times the
requests a single tab did. Five is the default; `concurrency` under
`[discover]` in `market/config.toml` sets a different one for every run, and
`--concurrency=N` overrides that for a single walk. Lower it if Amazon starts
serving captchas — a walk that trips its bot checks costs more than the wait
it saved. The catalog behind the tabs takes them one at a time, so a product
still lands whole.

Sign-in runs in a visible Chromium window by default — Amazon flags headless
browsers; `headless` under `[browser]` in `market/config.toml` switches that.
The session is kept in a persistent profile (`market/.playwright/`), so later
runs normally skip the login form. Set `AMAZON_TOTP_SECRET` to answer
2FA automatically; otherwise the code is prompted for on the terminal.
