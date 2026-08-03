# Third-party ports

## Mineradio-LX-Music desktop/home reference

- Upstream: `ww085213/Mineradio-LX-Music`
- Initial reference revision: `82826df814c32853d99697c0ee60f749a2fcad79`
- Homepage refresh revision: `812e2dc2e18bbc263e61dbd0206cb765e003d6e9`
- License: GNU GPL v3 (`GPL-3.0-only`)
- Port dates: 2026-07-18 (initial), 2026-07-19 (homepage refresh)

Mineradio's full desktop mode adapts the upstream idea of moving the existing
Electron main-window HWND between the Windows WorkerW desktop layer and an
interactive top-level window. The native attach/detach code in this project was
rewritten around the optimized edition's fail-closed WorkerW discovery, DPI
conversion, structured acknowledgements, serialized lifecycle, and cleanup
requirements.

The home dashboard adapts the upstream information hierarchy (continue,
library, daily recommendations, recent playback, today's listening, next up,
discovery, and radio entry points). Its data adapters use this project's current
multi-provider discovery, playlist, search, playback queue, and listen-history
state. Upstream LX-only server routes and the legacy standalone wallpaper
overlay were not copied.

The 2026-07-19 refresh additionally adapts the three-song "For You" strip,
stable cover-image swaps, in-place quick-card updates, daily-review hover
feedback, and compact-height scrolling/settings behavior. These features remain
implemented against Mineradio's existing provider, weather-radio, local-library,
queue, and playback modules rather than the upstream LX/local-only data model.

The combined application remains distributed under the repository's GNU GPL v3
license. Preserve this notice and the corresponding source when redistributing
modified builds.

## KuGouMusicApi concept-edition account protocol reference

- Upstream: `MakcRe/KuGouMusicApi`
- Reference revision: `283f1e97b110726b208a64b486a657c0fc0a6126`
- License: MIT
- Port date: 2026-07-24

Mineradio uses a minimal, rewritten subset of the upstream concept-edition
(`platform=lite`) protocol descriptions for QR login, SMS verification login,
token refresh, profile lookup, and continue-listening lookup. The implementation
uses Node.js built-in cryptography and the existing Mineradio KuGou playlist and
playback adapters; it does not bundle or start the upstream API server.

The upstream simulated SSA/behavior-verification generator was intentionally
not ported. When KuGou asks for additional security verification, Mineradio
returns a user-facing verification-required result and asks the user to complete
the official flow rather than generating synthetic verification data.
