# Saktumiva editor

A local editing screen for critical editions in TEI, collated with Charles Li's
[Saktumiva](https://github.com/chchch/saktumiva). Saktumiva's own collation code runs in the
background; your decisions are written straight back into the TEI files. Everything runs on your
own computer. The only outside traffic is your browser fetching manuscript images from the archives'
IIIF servers, and "Check for updates" asking GitHub for the latest release.

It was written for the [Suśrutasaṃhitā](https://github.com/sushrutaproject1/Sushrutasamhita_Saktumiva2)
and works for any project laid out as folders of TEI files, for example the
[Rasendramaṅgala](https://github.com/wujastyk/Rasendramangala).

<img width="1907" height="721" alt="image" src="https://github.com/user-attachments/assets/315f60d2-1ced-475c-b555-e36c4bdcc09a" />


## Install

**Ready-made program** (no Python needed): download the file for your computer from the
[latest release](https://github.com/sushrutaproject/saktumiva2-editor/releases/latest), unzip it and run
`saktumiva-editor` (`saktumiva-editor.exe` on Windows). A terminal window opens, and the editor
opens in your web browser. Close the terminal window, or press Ctrl+C in it, to stop.

* **macOS**: the program is not signed by Apple. The first time, right-click it and choose *Open*,
  or run `xattr -d com.apple.quarantine saktumiva-editor` in a terminal. It is built for Apple
  silicon (M1 and later); on an Intel Mac, use pipx.
* **Windows**: SmartScreen may warn about an unknown publisher: choose *More info → Run anyway*.

**With [pipx](https://pipx.pypa.io)** (Python 3.10 or later; works everywhere):

```bash
pipx install git+https://github.com/sushrutaproject/saktumiva2-editor.git
```

or, from a release, `pipx install https://github.com/sushrutaproject/saktumiva2-editor/releases/download/v0.1.0/saktumiva_editor-0.1.0-py3-none-any.whl`.
Then run `saktumiva-editor` in a terminal.

**Updating**: *Help → Check for updates* in the editor (or `saktumiva-editor --check-updates`)
tells you whether there is a newer release and gives the command or download link for the way you installed it.

## Start

```bash
saktumiva-editor                      # choose a project; recently used ones are listed
saktumiva-editor ~/git/Rasendramangala      # choose one of the project's sections
saktumiva-editor ~/git/Sushrutasamhita_Saktumiva2/03-su.sa   # edit that section straight away
```

Options: `--port 8800` (the next free port is used if it is taken), `--no-browser`, `--version`.
The **Projects** button in the editor goes back to the chooser.

## Projects and sections

A **section** is one folder with an edition file and the witness transcriptions collated with it.
The files are TEI XML; their names may end in `.xml`, `.txt` or `.tei` (the editor looks inside to
see whether a file is TEI). A **project** is a folder of sections, for example a git repository with
one folder per chapter. Without further instructions, any folder (the project folder itself, or one
level below it) with an `editor.config.json`, a `saktumiva.config.json` or at least two TEI files is
offered as a section.

The first time you open a section, the editor proposes which file is the edition (a name containing
"edition") and which are the witnesses (the other TEI files; files that already contain a Saktumiva
apparatus are taken to be published output, not witnesses). Check the proposal, change it if
needed, and it is saved as **`editor.config.json`** in the section folder:

* **edition**: the working edition, the master text you edit (in the editor or in another XML editor).
* **witnesses**: the manuscript and printed-edition files. Corrections made in the editor are saved there.
* **publishTo**: the file **Publish** writes: the edition with a fresh apparatus (default
  `<edition>_with-apparatus.xml`).
* **alignmentsDir** (`alignments`), **settingsFrom** (an alignment file whose collation settings are used),
  **collation**, **apparatus**, **extraIgnoreTags**, **scriptNoteRules**: see Settings below.
* **publishStylesheet** / **publishPolyfill**: the `<?xml-stylesheet?>` and the XSLT polyfill script put at the
  top of the published file (both are used only if the section has an `edition.xsl`).
* **idPrefix**: the part of the passage ids left out in the passage list (by default the first part
  they all share, e.g. `SS.` or `ch1.`).

A project may have a **`saktumiva-project.json`** in its top folder. Every key is optional:

```json
{
  "name": "Rasendramaṅgala",
  "sections": ["chapter*", "commentary"],
  "fileExtensions": [".xml", ".txt"],
  "editionPattern": "provisional[-_]edition",
  "defaults": {"extraIgnoreTags": ["trailer"], "apparatus": {"normlem": true, "mergerdgs": true}}
}
```

`sections` lists the section folders (patterns allowed); `editionPattern` is a regular expression for
recognising the edition file; `defaults` are settings for every section, which a section's own
`editor.config.json` can override.

If the section is in a git repository, every save and every Publish is a git commit. Nothing goes
online until you push. Work cycle: edit → Publish → check the published file → `git push`.

## What it does

* **Passage list** (left): every `lg`, `p` and `l` with an `xml:id`. A dot marks unsaved changes.
* **Text** (centre): the passage as it stands in the edition file. Underlined words have variants.
  Click one to find its apparatus entry.
* **Apparatus**: built by Saktumiva for this passage, from the alignment settings of your
  existing alignment files. Point at a reading and press **use** to put it in the text;
  the passage is collated again and the old lemma becomes a variant.
* **Edit text**: type in the verse lines. Grey boxes are markup (caesura, anchors, page breaks);
  they are protected but can be deleted. Tick "Record as emendation" to add an Emendation note.
  **TEI source** edits the passage as XML for anything else.
* **Notes**: select a word, press "Add note here". The `<anchor>` and the `<standOff>` note are
  created together with matching ids (`SS.3.1.4-n1`, `-n2` …). Edit or delete notes in the Notes panel.
* **Correct alignment** (button above the apparatus, or key A): shows how the witnesses are lined
  up, one column per apparatus entry. **join** merges a column with the next; click between two
  syllables of the edition row to split a column; **‹ ›** move one witness's syllable into the
  neighbouring column. The apparatus follows as you work. Saving writes `alignments/<passage>.xml`
  (marked in its header as corrected by hand) with a git commit, and the editor uses that file from
  then on. No witness's text can be changed here, and every column keeps some text of the edition.
* **Witnesses** (right): each witness's text of the passage, with a button that opens the page image,
  and **edit**, which corrects the witness's own transcription of the passage (as TEI). That is saved
  at once to the witness file, with a git commit, and the passage is collated again.
  Drag a witness by its handle (⠿) to reorder the list; the order is remembered. Witnesses that lack the
  passage are listed last.
* **Publish** (top bar): writes the edition with the full apparatus to a separate file, by default
  `<edition>_with-apparatus.xml` in the section folder (set `"publishTo"` in `editor.config.json` to change
  it). It is your edition file exactly as written, plus the stylesheet header, the witnesses in `<listWit>`
  and, after `</text>`, one `<standOff type="apparatus">` per passage, made by Saktumiva's own code exactly as
  its command-line `apparatus` tool does. Corrected alignments are used as they are; the rest are collated if
  needed (slow the first time for long prose passages; cached afterwards). Alignment files are brought up to
  date and everything is one git commit. Passages without an apparatus are listed at the end.
* **Settings** (top bar): the collation and apparatus parameters, stored in `editor.config.json`.
  * *Variants to leave out of the apparatus*: Saktumiva's normalizations (final nasals, visarga sandhi, b/v,
    gemination …). Readings that differ only in these ways become "minor" readings under the lemma.
    Turning one on works at once, even for existing alignment files; turning off one that an alignment
    was made with means that passage is collated again.
  * *Letters treated as the same in all witnesses*, e.g. `ś=s, ṇ=n`.
  * *Witnesses' own script notes*: the `<scriptNote xml:id="…">` entries in each witness's `<scriptDesc>`
    apply to that witness only. `script-X-Y` (script-ba-va, script-śa-sa, script-na-ṇa …) makes X and Y the
    same letter; `svarna-nasals` (or `savarna-nasals`) treats anusvāra and the nasal of the same class, and final
    m and ṃ, as the same. Other notes can be given a rule in `editor.config.json`, e.g.
    `"scriptNoteRules": {"script-ya-ja": "y=j"}`. The Settings screen lists what it found in each witness.
  * *Apparatus*: normalized readings, merge groups, separate note for long omissions, show minor readings.
  * *XML elements*: which elements are left out of the collation with their contents (Saktumiva's
    "Ignore <…>" options). Saktumiva's defaults are listed first, then every other element found inside
    `<text>` in your files, with counts; anything else can be typed in.
  * *Alignment*: tokenization, scoring, distance function. Changing these means passages
    are collated again (for the whole Śārīrasthāna of the Suśrutasaṃhitā, about 5 minutes), except those you corrected by hand.
  Applying settings reloads the editor; save your changes first.
* **Save** (Ctrl+S) writes only the passages and notes you changed, keeps the file's own
  formatting elsewhere, writes the passage's alignment file to `alignments/`, and makes a git commit
  listing your edits. Undo (Ctrl+Z) works until you save; after that, use git (History button).

Safety checks on every save: the file must not have been changed on disk meanwhile (e.g. in Oxygen),
the result must be well-formed XML, and `xml:id`s must stay unique. New notes that point nowhere
are reported before saving.


## Not yet possible

* Splitting or merging passages (new `xml:id`s).
* Carrying hand corrections of an alignment over when the passage's text later changes: the editor
  then warns you, collates afresh, and asks before replacing the corrected file (the old one stays in git).
* Devanāgarī display.

## Where the editor keeps its own files

Recent projects and computed alignments (so that each passage is collated only once) are kept outside
your projects: on Linux in `~/.config/saktumiva-editor` and `~/.cache/saktumiva-editor`, on macOS in
`~/Library/Application Support/saktumiva-editor` and `~/Library/Caches/saktumiva-editor`, on Windows in
`%APPDATA%\saktumiva-editor` and `%LOCALAPPDATA%\saktumiva-editor\Cache`. The cache is safe to delete.

## Development

```bash
git clone --recurse-submodules https://github.com/sushrutaproject/saktumiva2-editor.git
cd saktumiva-editor
python -m pip install -e ".[test]"
saktumiva-editor
```

* `src/saktumiva_editor/server.py`: the local server (Python standard library only); `cli.py`, `project.py`
  (sections, configuration, recent projects), `updates.py` (GitHub Releases).
* `src/saktumiva_editor/app/`: the editing screen (`index.html`, `main.mjs` …) and the project chooser (`chooser.*`).
* `src/saktumiva_editor/app/saktumiva/`: **Saktumiva, as a git submodule** pinned to one commit of
  [chchch/saktumiva](https://github.com/chchch/saktumiva). Only its `lib/` and the OpenSeadragon image viewer are
  served and packaged.
* `src/saktumiva_editor/saktumiva-patches.json`: the one change the editor needs in Saktumiva's code (a hook in
  `lib/apparatus.mjs` through which the editor applies per-witness script notes and the extra "same letters" when
  deciding whether a reading agrees with the lemma). It is applied in memory as the file is served, so the
  submodule stays a clean copy of upstream.

### Tests

```bash
python -m pytest                     # the server, configuration, update check
cd tests/js && npm ci && node --test # the collation regression tests
```

The regression tests run the editor's collation and apparatus code, with the pinned Saktumiva, on real sections
(`tests/fixtures`: the Suśrutasaṃhitā Śārīrasthāna and Rasendramaṅgala chapter 1) and compare the alignments,
apparatus and published `<standOff>` with the stored results in `tests/golden`. They also check that the patch
still fits and still matters (switching script notes off must change the apparatus of certain passages).

### Updating Saktumiva

Dependabot proposes a pull request when Saktumiva has new commits; the tests run on it.

* **Tests pass**: nothing the editor uses has changed in effect. Merge.
* **Tests fail**: look at what changed. If the patch no longer fits, update `find` in `saktumiva-patches.json`
  (or drop the patch if Saktumiva now offers the hook itself). If the apparatus has changed and the change is an
  improvement, run `npm run update-golden` in `tests/js`, review `git diff tests/golden`, and commit.

By hand: `cd src/saktumiva_editor/app/saktumiva && git fetch && git checkout <commit>`, run the tests, commit.

### Releasing

1. Set `__version__` in `src/saktumiva_editor/__init__.py` and add a section to `CHANGELOG.md`.
2. Commit, then `git tag v0.2.0 && git push --follow-tags`.

`.github/workflows/release.yml` then builds the wheel and the programs for Linux, macOS and Windows, checks that
each one starts, and publishes them as a GitHub Release, where *Check for updates* finds them.

## Licence

The Saktumiva editor is free software under the GNU General Public License, version 3 (see `LICENSE`).
Saktumiva itself is a separate project with its own terms.

## Credits

Saktumiva is by Charles Li ([github.com/chchch/saktumiva](https://github.com/chchch/saktumiva)); it does the
collation and makes the apparatus. The test fixtures come from the projects named in `tests/fixtures/README.md`;
the Rasendramaṅgala transcriptions are licensed CC BY-SA 4.0.
