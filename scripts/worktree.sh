#!/usr/bin/env bash
# Prepare an isolated worktree so a branch can be worked on alongside the others.
# A worktree is a full checkout, so it starts without the files git does not
# track: the credentials, the signed-in browser profile, and the Playwright
# install. Those are carried over here, by copy-on-write clone where the
# filesystem offers one.
set -euo pipefail

readonly CARRIED=(
    market/.env
    market/.playwright
    market/node_modules
    .claude/settings.local.json
)

usage() {
    echo "usage: just tree <branch> [base-ref]" >&2
    exit 2
}

# A clone costs no space on APFS; elsewhere it falls back to a plain copy.
clone() {
    cp -Rc "$1" "$2" 2>/dev/null || cp -R "$1" "$2"
}

# The branch a new one starts from: the pushed main, or the local one offline.
default_base() {
    git fetch --quiet origin main 2>/dev/null || true
    if git rev-parse --verify --quiet origin/main >/dev/null; then
        echo origin/main
    else
        echo main
    fi
}

# Chromium refuses to open a profile another Chromium still holds. The clone
# carries those locks over; the browser rebuilds them.
unlock_browser_profile() {
    local tree=$1
    rm -f "$tree"/market/.playwright/*/Singleton{Lock,Cookie,Socket}
}

carry_untracked_state() {
    local tree=$1 path
    for path in "${CARRIED[@]}"; do
        [[ -e $path ]] || continue
        mkdir -p "$tree/$(dirname "$path")"
        clone "$path" "$tree/$path"
    done
    unlock_browser_profile "$tree"
}

report() {
    local location=$1 branch=$2 base=$3
    echo
    echo "  worktree  $location"
    echo "  branch    $branch  ($base)"
    echo "  carried   ${CARRIED[*]}"
    echo
    echo "  work on it  cd $location && claude"
    echo "  done with it  git worktree remove --force $location && git branch -d $branch"
    echo
}

main() {
    (($# >= 1 && $# <= 2)) || usage
    local branch=$1
    local location=".claude/worktrees/$branch"
    local tree="$(git rev-parse --show-toplevel)/$location"

    if [[ -d $tree ]]; then
        report "$location" "$branch" "already checked out"
        return
    fi

    local base
    if git show-ref --verify --quiet "refs/heads/$branch"; then
        base="existing branch"
        git worktree add "$tree" "$branch"
    else
        base=${2:-$(default_base)}
        git worktree add -b "$branch" "$tree" "$base"
        base="from $base"
    fi

    carry_untracked_state "$tree"
    report "$location" "$branch" "$base"
}

main "$@"
