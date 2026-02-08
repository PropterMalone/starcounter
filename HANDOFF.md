# Starcounter Handoff — 2026-02-08

## Completed This Session

### Fragment filter (committed + pushed: `dde1803`)

- `filterFragmentTitles()` in thread-dictionary.ts — consistent-prefix detection
- Rule A (case-based) was removed — catastrophically wrong for social media
- Only Rule B (consistent prefix) remains, with `PREFIX_SKIP_WORDS` for articles/prepositions/possessives
- 4 tests added, all 939 tests passing
- Verified on karaoke-songs (1 correct filter), dad-movies (0 filtered), letterboxd (0 filtered)

### Rivers fixture captured

- `bench/fixtures/rivers.json` — 6,387 posts from the "home river" thread
- `bench/fixtures/rivers-validation-cache.json` — self-validation cache
- `bench/build-self-validation-cache.mjs` — new script for self-validated threads
- Diagnostic results: Mississippi (216), Hudson (146), Potomac (120), Thames (116), Ohio (107)
- Known noise: Rock (100), Grand (99), Bay (96), Pea (76), Main (55) — common words that are also river names

### Video games fixture captured

- `bench/fixtures/video-games.json` — 433 posts from the "steam sale recs" thread
- `bench/fixtures/video-games-validation-cache.json` — API-validated against IGDB (173/311 candidates)
- Diagnostic: 66 dictionary titles, 109 of 432 non-root posts labeled
- Top results: Tactical Breach Wizards (7), Blue Prince (7), The Witness (7), Return of the Obra Dinn (7), Baba Is You (6)
- Very clean — nearly all entries are real games. Low noise.
- Minor noise: "Rock and Stone" (DRG catchphrase, not a title), "The Return of the King" (film)

## TODO

### Rivers quality — noise reduction for self-validated threads

The rivers thread shows self-validation's weakness: 2531 dictionary entries, 1952 with count=1.
Common words that are also river names (Rock, Grand, Bay, Main, Don, Sun) inflate results.
Possible approaches:

- Higher minimum frequency for self-validated entries (e.g., ≥2 mentions)
- Exclude single-word titles that are common English words (need a word frequency list)
- Let the user manually exclude entries via the existing cluster-review UI

### Commands

```bash
cd /c/Users/karls/starcounter
npm run validate
node bench/run-karaoke-diagnostic.mjs rivers
node bench/run-karaoke-diagnostic.mjs karaoke-songs
node bench/run-karaoke-diagnostic.mjs dad-movies
node bench/run-karaoke-diagnostic.mjs letterboxd
node bench/run-karaoke-diagnostic.mjs video-games
```
