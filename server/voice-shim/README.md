# voice-shim — local dev backend for the voice in the deep

The DEV stand-in for the production LLM proxy. It funnels `POST /api/ai`
into a **warm daemon-core Claude Code session** and returns one line. This is
the dev/authoring plane of the two-plane architecture in
`docs/ALPHA-AND-BACKEND.md`:

- **dev (here):** game → `/api/ai` → **voice-shim** → daemon session (Max
  pool, full quality) → line. Iterate the voice locally, off the dev server,
  on your phone via the QR.
- **prod (later):** game → `/api/ai` → **Cloudflare Worker** → Anthropic
  (Haiku + cache + spend cap). Same contract, no game change.

The contract both ends implement (one seam for every AI verb):
`POST /api/ai { kind, context, idempotencyKey? } -> { line? , name?, flavor? }`
where `kind` is `voice` | `item-skin` | `fate-card`. Add a verb = add a `kind`
(a persona in `persona.ts` + a prompt branch in `voice-shim.ts`), not a new endpoint.

## Run it

The easy way — brings up daemon + shim + game in one terminal, Ctrl-C stops all:

```sh
npm run dev:all
```

(It auto-starts the daemon from the aiinfluencer checkout — override with
`DELVE_DAEMON_DIR`, or `SKIP_DAEMON=1` if you run the daemon yourself. The
daemon must listen on `:7429` with NO auth token for local use — the WS
subscribe can't send auth headers via Node's global WebSocket. Default transport
is SDK mode (`claude --print`, clean stdio); set `VOICE_USE_BRIDGE=1` for bridge / Max pool.)

The manual way — three terminals:

```sh
# 1. daemon-core daemon on :7429 (in the aiinfluencer repo)
node --experimental-strip-types daemon-core/daemon/src/start.ts
# 2. the shim:
npm run voice-shim
# 3. the game (vite proxies /api/ai → localhost:8787):
npm run dev
```

Die in-game → the deep speaks (top-right broadcast pop, "THE VOICE IN THE DEEP").
If the daemon/shim isn't running, the game no-ops silently — nothing breaks.

## Tune the voice

Edit `persona.ts` — that's the whole point of prototyping here. The shim logs
every line to the console so you can iterate fast without dying repeatedly.

## Env knobs

| Var | Default | Notes |
|---|---|---|
| `VOICE_SHIM_PORT` | `8787` | Must match the vite proxy in `vite.config.ts`. |
| `DAEMON_URL` | `http://localhost:7429` | The daemon-core daemon. |
| `VOICE_MODEL` | `sonnet` | Prototype at quality; `haiku` to preview prod cost/quality; `opus` for the ceiling. |
| `VOICE_USE_BRIDGE` | `0` | SDK mode (`claude --print`, clean stdio — default, simplest for dev). `1` = bridge mode (tmux + Max pool). |
| `DAEMON_AUTH_TOKEN` | — | Only if your daemon requires it (then the WS result stream won't work — run the local daemon without auth). |

## Port to production

Reimplement `POST /api/ai` as a Cloudflare Worker (Anthropic Messages API,
Haiku, content-hash cache, AI Gateway spend cap). Keep the request/response
shape identical and the game needs zero changes — only the `VOICE_ENABLED` gate
in `src/broadcast/voice.ts` flips to include prod. The persona in `persona.ts`
becomes the Worker's system prompt.
