# Performance baseline

All counted runs used source at commit `d66f98553516072126d36c2b37aec614d7045035`, package version `0.2.13`.

The target inventory is the five `parity/performance/*` rows and 22 `perf/fr-*` rows in `docs/execution/parity-ledger-plan.md`. The final W6 regression-check wave will use this baseline. The baseline adds no benchmark code. Of those 27 rows, `perf/fr-0.3` has five pass/fail samples, and `parity/performance/test-suite-count` has five unit-test count samples but no completed E2E pass count. The other 25 rows have no baseline measurement from the existing tools.

## Environment and protocol

- Machine: Apple M4 Max, 16 logical CPUs, arm64.
- OS: macOS 26.6.2.
- Node.js: `v24.13.0`.
- pnpm: `12.14.0` through Corepack.
- Playwright: `1.64.1`.
- Browser: Google Chrome for Testing `156.0.8078.4`, Playwright project `chromium-webgl`, using SwiftShader for WebGL.
- The package lockfile was installed with `corepack pnpm install --frozen-lockfile`.

The 1-minute load average had to remain at or below 30. I checked `uptime` before and after every counted run. The unit-test and performance-budget tables also include in-run readings; the render-fixture table reports the required before-and-after readings. When the 1-minute average exceeded 30, I waited 60 seconds before checking again, up to a 30-minute maximum. If it remained above 30 at that limit, I would stop and record the load instead of starting another measurement. The 5- and 15-minute averages below are recorded for context; only the 1-minute average controlled eligibility. Load values use the order `1m / 5m / 15m`.

## Unit-test inventory

Command for each sample:

The Nix shell supplies `ast-grep`, which the roster-manifest tests invoke.

```sh
nix shell nixpkgs#ast-grep --command corepack pnpm test --reporter=dot
```

Median and range: 59 files (59–59), 737 tests (737–737).

| Sample | Files / tests | Uptime before | 1m load during run | Uptime after |
| --- | ---: | --- | ---: | --- |
| 1 | 59 / 737 | `1d 6:57; 14.15 / 21.26 / 25.80` | 14.15–21.27 | `1d 6:58; 20.69 / 22.21 / 25.79` |
| 2 | 59 / 737 | `1d 6:58; 19.69 / 21.96 / 25.66` | 17.02–24.92 | `1d 6:59; 24.92 / 22.49 / 25.55` |
| 3 | 59 / 737 | `1d 7:02; 23.88 / 22.32 / 25.47` | 23.88–27.82 | `1d 7:02; 26.31 / 23.06 / 25.63` |
| 4 | 59 / 737 | `1d 7:02; 24.92 / 22.82 / 25.53` | 22.89–27.90 | `1d 7:02; 27.90 / 23.54 / 25.68` |
| 5 | 59 / 737 | `1d 7:02; 26.21 / 24.94 / 26.09` | 24.98–26.29 | `1d 7:02; 24.98 / 24.66 / 25.94` |

## Browser performance-budget gate

Command for each sample:

```sh
corepack pnpm exec playwright test e2e/performance-budget.e2e.ts
```

After a 2-second startup exclusion, the test samples every 250 ms for 8 seconds. It checks desktop `1280x720` and touch mobile `390x844`. Both frame-count-derived and displayed-average FPS must be at least 8. A stall is the longest interval without a frame-counter increase and must not exceed 2,000 ms. If both endpoint `performance.memory.usedJSHeapSize` readings are available, their difference must be no greater than 192 MiB. Passing runs report whether each viewport test passed, but do not log raw FPS, stall, heap-growth values, or whether heap readings were available. Failed assertions can show the value that missed a threshold, so this baseline records only the gate result.

All five runs passed both viewport tests. Median: 2/2 passed; range: 2–2.

| Sample | Result | Uptime before | 1m load during run | Uptime after |
| --- | --- | --- | ---: | --- |
| 1 | 2/2 passed | `1d 7:18; 17.62 / 24.02 / 26.92` | 17.62–22.96 | `1d 7:18; 22.28 / 24.24 / 26.00` |
| 2 | 2/2 passed | `1d 7:56; 15.83 / 35.03 / 42.58` | 15.83–22.67 | `1d 7:56; 22.67 / 34.82 / 42.25` |
| 3 | 2/2 passed | `1d 7:57; 20.65 / 33.99 / 41.86` | 20.65–24.43 | `1d 7:57; 24.43 / 33.65 / 41.47` |
| 4 | 2/2 passed | `1d 7:57; 23.43 / 33.29 / 41.29` | 22.41–24.90 | `1d 7:57; 24.90 / 32.61 / 40.76` |
| 5 | 2/2 passed | `1d 7:58; 24.02 / 32.30 / 40.61` | 21.74–24.02 | `1d 7:58; 21.74 / 30.99 / 39.85` |

## Fixed-seed render fixture

Command for each sample:

```sh
corepack pnpm exec playwright test e2e/render-preview.e2e.ts -g 'a fixture chunk draws'
```

The fixture seed is `20260728`; the camera pose is `{x: 8, y: 48, z: 32, yaw: 0, pitch: -0.16}`, with yaw and pitch in radians. The canvas is `640x360`; the Playwright page is `1280x720`. The test passed in all five runs.

| Metric | Five samples | Median | Range |
| --- | --- | ---: | ---: |
| Chunks generated | 49, 49, 49, 49, 49 | 49 | 49–49 |
| Mesh quads | 13,218, 13,218, 13,218, 13,218, 13,218 | 13,218 | 13,218–13,218 |
| Loaded chunks in render report | 20, 20, 20, 20, 20 | 20 | 20–20 |
| Pixels drawn | 99,077, 99,077, 99,077, 99,077, 99,077 | 99,077 | 99,077–99,077 |
| Canvas pixels | 230,400, 230,400, 230,400, 230,400, 230,400 | 230,400 | 230,400–230,400 |
| Distinct tile colours | 31, 31, 31, 31, 31 | 31 | 31–31 |

The render report counts pixels whose RGB values fall outside a per-channel tolerance of 2 around the configured sky clear colour. Distinct tile colours is the number of RGB bins among those pixels after each 8-bit channel is shifted right by 4. The E2E uses this count to check that visible texture tiles remain distinguishable and requires more than one colour. The report is produced after the fixture draws at the fixed camera pose, before camera interaction starts.

The baseline image is [`docs/execution/perf-baseline/render-preview.png`](perf-baseline/render-preview.png), a 1280x720 PNG of 30,374 bytes for human inspection. The E2E saves the image but does not compare it with a reference. The PNG's SHA-256 is `561d99e2d9e451fb6744e7a780fad151929e01da7fcb1f31728a3a34a4431f99`.

| Sample | Uptime before | 1m load before → after | Uptime after |
| --- | --- | ---: | --- |
| 1 | `1d 8:01; 23.16 / 28.31 / 37.43` | 23.16 → 22.26 | `1d 8:01; 22.26 / 28.04 / 37.28` |
| 2 | `1d 8:01; 20.68 / 27.51 / 36.99` | 20.68 → 19.82 | `1d 8:01; 19.82 / 27.22 / 36.83` |
| 3 | `1d 8:01; 19.82 / 27.22 / 36.83` | 19.82 → 19.12 | `1d 8:01; 19.12 / 26.95 / 36.68` |
| 4 | `1d 8:01; 19.12 / 26.95 / 36.68` | 19.12 → 21.67 | `1d 8:01; 21.67 / 27.35 / 36.76` |
| 5 | `1d 8:01; 21.67 / 27.35 / 36.76` | 21.67 → 20.98 | `1d 8:01; 20.98 / 27.11 / 36.62` |

## Metric availability

“Unavailable” means the existing tests or E2Es do not emit the requested number or a repeatable metric for a baseline. A functional assertion alone does not provide a numeric baseline. The W6 comparison needs measurement methods for these values; implementation ownership remains as listed in the parity ledger.

| Ledger row | Result | Existing measurement limitation |
| --- | --- | --- |
| `parity/performance/fps-rd5` | Unavailable | The performance E2E does not select or report render distance 5 / 225 meshes. |
| `parity/performance/fps-rd8` | Unavailable | The performance E2E does not select or report render distance 8 / 289 meshes. |
| `parity/performance/frustum-cull-ratio` | Unavailable | No cull-to-loaded mesh counter is exposed. |
| `parity/performance/teleport-readiness` | Unavailable | No 200-block teleport readiness timer or complete-ring measurement exists. |
| `parity/performance/test-suite-count` | Partial | Five unit runs report 737 passing tests across 59 files. The E2E pass count is unavailable because both full-browser attempts crossed the load limit before completion. |
| `perf/fr-0.1` | Unavailable | The shader probe compiles shaders but reports no GPU timer-query duration. |
| `perf/fr-0.2` | Unavailable | No stage timing entries are emitted for a baseline. |
| `perf/fr-0.3` | Gate only | The performance E2E gives five pass/fail results. It does not print the raw FPS, stall, or heap-growth values. |
| `perf/fr-1.1` | Unavailable | No existing run reports a measured cancellation count or duration for frame stages. |
| `perf/fr-1.2` | Unavailable | No adaptive-quality downgrade measurement is exposed by the existing E2E. |
| `perf/fr-1.3` | Unavailable | Fixed-step integration and the delta cap are functional contracts; the existing unit test does not report a performance series. |
| `perf/fr-1.4` | Unavailable | Persistence E2E checks reload behavior but reports no save duration. |
| `perf/fr-2.1` | Unavailable | No LRU order or eviction metric is reported as a baseline value. |
| `perf/fr-2.2` | Unavailable | No concurrent chunk-load count is emitted. |
| `perf/fr-2.3` | Unavailable | Round-trip behavior has no I/O duration measurement. |
| `perf/fr-2.4` | Unavailable | No lake-seed determinism measurement is available. |
| `perf/fr-3.1` | Unavailable | No per-LOD vertex ratios are reported. |
| `perf/fr-3.2` | Unavailable | No fluid LOD values are reported. |
| `perf/fr-3.3` | Unavailable | Mesh tests exercise opaque and water output but do not report submesh counts for a baseline. |
| `perf/fr-3.4` | Unavailable | No ambient-occlusion sharing counter is exposed. |
| `perf/fr-3.5` | Unavailable | Light tests cover cardinal-boundary changes but do not report boundary update counts. |
| `perf/fr-4.1` | Unavailable | No dirty subregion remesh range is emitted. |
| `perf/fr-4.2` | Unavailable | No dirty-AABB queue metric is reported. |
| `perf/fr-4.3` | Unavailable | Shader-probe success does not report shared composite-program or preset-gate measurements. |
| `perf/fr-4.4` | Unavailable | No water refraction ratio is reported. |
| `perf/fr-4.5` | Unavailable | No SSIM value or adaptive-quality threshold result is measured. |
| `perf/fr-4.6` | Unavailable | No slice-cache invalidation or reuse measurement exists. |

The availability review covered existing test and E2E output, standalone bench commands, and `docs/e2e-triage.md`; none provides repeatable values for the missing rows.

## Load-limited attempts

These attempts are excluded from the sample tables because their 1-minute load average crossed 30 while running. Interrupted runs were stopped after the threshold was exceeded, and neither a pass nor a failure from these attempts is treated as a baseline result.

| Attempt | 1m load readings | Outcome |
| --- | ---: | --- |
| Full `corepack pnpm e2e:browser` | 24.81 before; 35.03 during; 37.35 after | 7 passed, 1 interrupted, 1 skipped, 101 not run. |
| Full performance-budget file | 21.89 before; 28.52 and 31.48 during; 38.80 after | 1 passed, 1 interrupted. |
| Desktop performance-budget test | 22.95 before; 32.97 during; 33.69 after | The observed average was 6.858 FPS against the 8 FPS gate; the run was under excessive load and is not a regression result. |
| Full `corepack pnpm e2e:browser` | 21.38 before; 30.09 during; 29.10 after | 2 passed, 1 interrupted, 107 not run. |

An initial unit run failed before completion because `ast-grep` was not found. It is excluded; the five counted runs used the Nix-provided tool.
