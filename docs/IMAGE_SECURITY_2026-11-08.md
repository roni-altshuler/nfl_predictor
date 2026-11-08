# Image dependency maintenance — November 8, 2026

Next.js and `eslint-config-next` advance from 15.5.27 to the exact **15.5.29**
maintenance release. The [upstream release](https://github.com/vercel/next.js/releases/tag/v15.5.29)
and [SVG rejection advisory](https://github.com/vercel/next.js/security/advisories/GHSA-7qx7-33qx-rqx2)
identify 15.5.29 as the patched Next 15 version. The advisory affects self-hosted
image optimization through 15.5.28: SVG content can bypass the default rejection.
The patch keeps Next 15, React 18 and the matching Next tooling; the lock changes
only twelve Next-family package versions.

The earlier [upstream image library RCE advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw)
lists Next through 15.5.27 and describes glibc Linux image processing. Its stated
workaround is the sharp instance used by Next being at least 0.35.5. Before this
change, clean normal and `--omit=dev` installs already resolved **sharp 0.35.5**
from Next's actual image optimizer; no older nested sharp entry exists in the
retained lock. This establishes the local workaround, not production exposure
or compromise. The sharp version stays unchanged and its exact pin moves from
development dependencies to production dependencies because it is a runtime
image library. No dependency override or unrelated package upgrade is applied.

## Repository exposure and limits

The effective Next configuration retains SVG rejection, with no
`dangerouslyAllowSVG` opt-in, and allows remote images only over HTTPS from
`a.espncdn.com`. The [Next 15 image documentation](https://nextjs.org/docs/15/app/api-reference/components/image)
describes these defaults and host restrictions. Team logos deliberately use
plain `img` elements; the inspected application has no `next/image` imports.
That does not prove `/_next/image` is unavailable: an ordinary self-hosted
Next production server can still expose the optimizer endpoint.

`vercel.json` identifies a Next.js deployment with `npm install` and `next build`.
Repository configuration does not establish the deployed commit, image handler,
native library, libc, or reachability. Live deployment verification is limited
by the connected team's denied deployment read; no alternate route was used.
Local production behavior and subsequent GitHub checks must be distinguished
from live production verification.

## Dependency assurance and reproduction

`npm test` now also checks the installed Next version and matching lock/tooling,
the native sharp version resolved relative to Next's optimizer, every locked
sharp copy, the effective SVG default, and rejection of unapproved hosts. Benign
SVG fixtures beginning with XML comments containing AVIF/HEIC signature text
must remain SVG and receive HTTP-status 400 from the real optimizer. A real
native PNG optimization must succeed without falling back to the input.
These tests make no network requests and write no application artifacts.

Clean normal and production-only installation checks use the committed lock.
Required publication validation is the full backend pytest suite, complete
`npm test` chain, lint, explicit TypeScript, production build and all nine
responsive browser scripts. CI uses Node 20 and Python 3.12; the frontend browser
job uses Ubuntu 24.04 with Playwright's bundled Chromium, while backend-only CI
retains `ubuntu-latest`. Local browser evidence uses the repository's
supported `BROWSER_EXECUTABLE_PATH` with installed Chromium 151; successful
exact-head hosted CI is required before merge.

This change preserves application sources, forecasts, retained data, model,
existing assertions, workflow permissions and schedules. The original checkout,
already published season-record source and held draft PR #14 are preserved.
Complete audit snapshots, install/runtime checks, source hashes and validation
receipts are retained in the saved task environment under
`/workspace/scratch/nfl-security-2026-11-08/evidence/`. An audit snapshot is a
registry report and does not establish that all dependencies are safe.
