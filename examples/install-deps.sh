#!/usr/bin/env bash
# Installs the example project's Solidity dependencies into examples/lib (not committed).
# Pinned: forge-std bd8c870, OpenZeppelin Contracts v5.1.0.
set -euo pipefail
cd "$(dirname "$0")"
command -v forge >/dev/null || { echo "forge not found: install Foundry first (https://getfoundry.sh)"; exit 1; }
mkdir -p lib
[ -d lib/forge-std/src ] || forge install --no-git foundry-rs/forge-std@bd8c870
[ -d lib/openzeppelin-contracts/contracts ] || forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.1.0
echo "Dependencies ready in examples/lib"
