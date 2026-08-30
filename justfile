# Run `just` with no arguments to list every recipe.
default:
    @just --list

mod market

# Install what every subproject needs, once.
install: market::install

# Run every subproject's tests.
test: market::test

# Check formatting, lint, and types across subprojects.
check: market::check

# Apply formatting across subprojects.
fmt: market::fmt
