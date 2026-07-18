# Repository Guidelines

## Project Structure & Related Repository

`_worker.js` is the Cloudflare Worker entry point and contains routing, authentication, subscription generation, and proxy logic. `wrangler.toml` defines the Worker deployment. `chain_proxy.test.mjs` is the current Node regression test; `README.md`, `CHANGELOG`, and `img.png` are user-facing documentation assets. Automation lives in `.github/workflows/`, including synchronization from `cmliu/edgetunnel`.

The sibling repository `../CGAX-Pages` owns the static management UI. Its `admin/`, `login/`, `noADMIN/`, and `noKV/` paths are fetched through `_worker.js`'s `Pages静态页面` constant. Do not duplicate those assets here. Changes to UI paths or Worker endpoints require coordinated, cross-linked pull requests. Add Worker APIs before the UI consumes them; publish new static paths before the Worker references them.

## Build, Test, and Development Commands

There is no package manifest or build step. Use Node.js and Wrangler:

- `node --test chain_proxy.test.mjs` — runs the focused regression and parses the Worker module.
- `npx wrangler dev` — starts the Worker locally using `wrangler.toml`.
- `npx wrangler deploy --dry-run` — validates the Worker bundle without publishing it.
- `npx wrangler deploy` — deploys the Worker; run only with the intended Cloudflare account selected.
- `python -m http.server 8000 --directory ../CGAX-Pages` — previews UI files only.

## Coding Style & Naming Conventions

Match existing JavaScript: tabs for indentation, semicolons, `const` by default, `let` for reassignment, and `async`/`await` for asynchronous flows. Preserve established Chinese identifiers; write concise Simplified Chinese comments. Avoid broad formatting of the large Worker file. In `CGAX-Pages`, keep HTML, CSS, and JavaScript self-contained in existing page files unless reuse already exists.

## Testing Guidelines

Add the smallest `*.test.mjs` regression using `node:assert/strict` for each behavior change. Run the Node test and Wrangler dry run before opening a PR. For cross-repository UI changes, manually verify `/login`, `/admin`, and the relevant missing-configuration page against a Worker, and include screenshots for visible changes. No coverage threshold is configured.

## Commit & Pull Request Guidelines

Follow the repository's recent Conventional Commit style: `feat:`, `fix:`, `chore:`, `test:`, or `docs:` plus a concise description. Keep upstream-sync changes separate from local customizations. PRs should explain behavior and risk, list verification commands, link related issues and the matching `CGAX-Pages` PR, and state deployment order.

## Security & Vendored Assets

Never commit `ADMIN`, API tokens, KV identifiers, cookies, or populated admin configuration/log files. In `CGAX-Pages`, follow `VENDORED.md`: review upstream diffs and manually update pinned `vendor/` or `data/` files rather than silently refreshing them.
