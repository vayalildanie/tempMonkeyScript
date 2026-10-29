# Page captures

How to hand the project a fresh copy of the NOVA annotation page, so the
selector tests stay predictable and the scripts can be tested offline.

You provide two things. Neither needs a login or network access afterwards.

1. **A screenshot** of the page as it looks now (PNG or JPG). It is for humans:
   it is stored next to the capture so you can see what the structure was
   meant to look like.
2. **An outerHTML dump** saved as a `.txt` file. In the browser dev tools,
   select the `<html>` element (or the annotation container), choose
   *Copy → Copy outerHTML*, and paste it into a text file.

## Ingest a capture

```
npm run capture -- "C:\path\to\dump.txt" --screenshot "C:\path\to\shot.png"
```

Optional: `--name my-label` (default is today's date; a suffix is added if the
folder exists).

This writes `captures/<name>/`:

| File | What it is |
|---|---|
| `page.html` | The dump with scripts, styles, remote URLs, and `data:` images removed, so it opens offline and stays small |
| `structure.json` | Module names, module keys, and the selector-contract results |
| `screenshot.png` | Your screenshot, copied |

It then prints which lines of the selector contract the page satisfies and
what changed in module names since the previous capture. Exit code is 1 if the
contract is not satisfied, 2 if the input is unusable (for example, the dump
has no `data-module-name` attributes).

## What the contract is

`tests/helpers/selector-contract.js` is one list of the page structure the
scripts depend on: each `TransN` / `TransN Score` / `TransN Remarks` module
(Trans2's Remarks is spelled `Trans 2 Remarks`), the score cascader selectors,
the translation text node, and the Remarks textarea. Every line says why it is
there. It is checked against:

- the reduced fixture `tests/fixtures/annotation.html` (always, including on a
  fresh clone), and
- every `captures/*/page.html` on your machine.

```
npm test
```

## When the site changes

1. Capture the new page (command above).
2. Read the "MISSING" lines and the "Changes since" diff. Those are the exact
   assumptions that broke or moved.
3. Update the selectors in the scripts, and the contract line if the page's
   structure genuinely changed.
4. If scoring or remarks tests need the new layout, update
   `tests/fixtures/annotation.html` from the capture (see
   `tests/fixtures/README.md` for what was kept and redacted) and rerun
   `npm test`.

## Privacy

`captures/*/` is gitignored. A dump contains real task text and identifiers
from the site, so it stays on your machine; only this README is committed. The
committed fixture uses lorem ipsum.

## Limits

A capture is a snapshot of markup. It has no event listeners, so it cannot
prove how the live page reacts to a keypress or a click. For example, the real
Space-to-submit handler is not in any dump, which is why Submit Check is still
listed under "Known unverified" in the main README.
