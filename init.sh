#!/bin/bash
set -e

echo "=== Kitcrate Harness Initialization ==="

if [ ! -f package.json ]; then
  echo "No package.json found. Run feat-001 project bootstrap first."
  exit 1
fi

# Detect package manager
if [ -f pnpm-lock.yaml ]; then
  PM="pnpm"
elif [ -f yarn.lock ]; then
  PM="yarn"
elif [ -f bun.lock ] || [ -f bun.lockb ]; then
  PM="bun"
else
  PM="npm"
fi

echo "=== Installing dependencies with $PM ==="
if [ "$PM" = "npm" ]; then
  npm install
else
  "$PM" install
fi

echo "=== Type check ==="
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.typecheck?0:1)"; then
  [ "$PM" = "npm" ] && npm run typecheck || "$PM" run typecheck
else
  echo "No typecheck script; running tsc --noEmit directly"
  npx tsc --noEmit
fi

echo "=== Lint ==="
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.lint?0:1)"; then
  [ "$PM" = "npm" ] && npm run lint || "$PM" run lint
else
  echo "No lint script; skipping"
fi

echo "=== Tests ==="
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.test?0:1)"; then
  [ "$PM" = "npm" ] && npm test || "$PM" test
else
  echo "No test script; skipping"
fi

echo "=== Build ==="
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.build?0:1)"; then
  [ "$PM" = "npm" ] && npm run build || "$PM" run build
else
  echo "No build script; skipping"
fi

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read feature_list.json to see current feature state"
echo "2. Pick ONE unfinished feature to work on"
echo "3. Implement only that feature"
echo "4. Re-run verification before claiming done"
