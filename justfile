# Run `just` with no arguments to list every recipe.
default:
    @just --list

# One-time Chromium download for Playwright.
[working-directory('market')]
install:
    deno run -A npm:playwright@^1.62.1 install chromium

# Sign in to Amazon; the session is kept in the browser profile.
[working-directory('market')]
login:
    deno run -A --env-file=.env main.ts

# Unit tests.
[working-directory('market')]
test:
    deno test --allow-env

# Formatting, lint, and type check.
[working-directory('market')]
check:
    deno fmt --check
    deno lint
    deno check main.ts main_test.ts

# Apply formatting.
[working-directory('market')]
fmt:
    deno fmt
