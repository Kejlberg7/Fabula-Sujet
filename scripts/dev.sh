#!/bin/sh
# Starts the interface from anywhere, on the Node the project needs.
#
# Watches only src/: the server restarts when the API changes, and does not
# restart every time the frontend is rebuilt into web/dist.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v20.20.1/bin:$PATH"
exec node --watch-path=./src --import tsx src/server/http.ts
