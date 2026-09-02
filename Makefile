\
# Flatcraft — project Makefile
#
# The deployable artifact is the static site under docs/ (TypeScript source
# in src/, compiled to docs/js/ by tsc). docs/ is served both by GitHub
# Pages and by the nginx container on this host (see deploy target below).
#
# The Python code under flatcraft/, world/ and deploy/ is an older,
# unrelated prototype (Python 2 era) and is intentionally out of scope for
# these targets; `test` only covers world/'s own unit tests, best-effort.

NGINX_LIVE_DIR := /home/svp/nginx/www/sublayers.net.retired-by-symlink

.PHONY: install build watch typecheck clean test deploy help

help:
	@echo "make install    — install client (TypeScript) dependencies"
	@echo "make build      — compile src/*.ts to docs/js/*.js"
	@echo "make watch      — recompile on change"
	@echo "make typecheck  — type-check only, no output files"
	@echo "make clean      — remove compiled JS/maps and node_modules"
	@echo "make test       — run the legacy world/ Python unit tests (best-effort)"
	@echo "make deploy     — build, then report deploy status (nginx serves docs/ directly)"

install:
	npm install

build:
	npm run build

watch:
	npm run watch

typecheck:
	npm run typecheck

clean:
	rm -f docs/js/*.js docs/js/*.js.map
	rm -rf node_modules

test:
	-python3 -m pytest world -q

deploy: build
	@echo "docs/ compiled. nginx (container nginx-nginx-1) serves it directly"
	@echo "via the bind mount configured in /home/svp/nginx/docker-compose.yml"
	@echo "— no copy step needed. If nginx.conf or the compose file changed,"
	@echo "run: (cd /home/svp/nginx && docker compose exec nginx nginx -t && docker compose up -d)"
