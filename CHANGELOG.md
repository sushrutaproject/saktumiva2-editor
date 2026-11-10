# Changelog

## 0.6.1 (10 November 2026)

* On Windows, the alignment files removed when passages are merged or split are now reported with forward
  slashes, as everywhere else. Merging and splitting themselves already worked on Windows; only the editor's own
  test of them failed there.
* The Saktumiva code inside the editor is updated to its latest version (`132a83e`). Upstream this adds a licence,
  documentation and a roadmap; the collation code is unchanged, and the editor's collations and apparatus come out
  the same.

## 0.6.0 (10 November 2026)

* **Merge passages.** With several passages shown that follow one another, **Merge…** (above the text) makes one
  passage of them, under the `xml:id` of the first, in the edition and in every witness file. Only the tags between
  the passages are removed: no text changes, and the rest of each file is left exactly as it is. Their notes go with
  them. A witness that has only a later one of the passages has it relabelled; a witness in which the passages are
  not side by side (another order, something in between) is reported, and nothing is merged until that is put right.
* **Split a passage.** **Split…** (beside Add note) divides the passage shown in two. Click in the edition's text
  where the second passage is to begin; each witness is then marked at the matching place, going by the alignment,
  and shown so that the place can be checked and moved (click, or ‹ › « »). The two parts get the ids you give
  (the first may keep the old one, or e.g. `SS.3.2.14` becomes `SS.3.2.14ab` and `SS.3.2.14cd`). Notes anchored in
  the second part go with it. Markup that the cut goes through (`<l>`, `<unclear>` …) is closed and opened again.
* Both are written to the files straight away, as one git commit, after a check that every file's text is letter for
  letter what it was; if any file changed on disk meanwhile, or any result is unsound, nothing is written. They are
  offered only when there are no unsaved changes, and Ctrl+Z does not undo them: revert the commit in git. The
  alignment files of the passages concerned are removed and made afresh.

## 0.5.1 (9 November 2026)

* **Check for updates works on macOS.** Python there does not read the Mac's keychain, so the ready-made Mac
  program (and Python from python.org) had no trusted certificates, and the check failed with
  "CERTIFICATE_VERIFY_FAILED". The editor now falls back to the `certifi` certificates, which the ready-made
  programs include, or else to the Mac's own system certificates. If you have the ready-made program, download
  this release by hand: your copy cannot see it.
* The documentation no longer recommends pipx. Install the ready-made program; on an Intel Mac, or if you prefer,
  install with Python in a virtual environment (see the README). The update command for a Python install now
  names that environment's Python in full.

## 0.5.0 (9 November 2026)

* **Several passages at once.** Shift-click in the passage list shows the range from the passage clicked last;
  Ctrl-click (⌘-click) adds or removes one; **Show several** above the list gives each passage a tick box. The centre
  panel shows them in document order as continuous text, each under its `xml:id`, with the combined apparatus
  grouped under each passage (use/omit, minor readings, long omissions, one legend of sigla), the notes grouped
  the same way, and in the Witnesses panel each witness's text of every passage. Passages that need collating are
  collated in the background in document order, each heading showing its progress ("waiting", "collating… 40%"),
  and each appears as soon as it is ready. use/omit and editing a note work here, recorded against their passage,
  with unsaved markers, undo and Save as usual. Edit text, TEI source, Add note, Correct alignment and a witness's
  edit work on one passage: click a passage's id to open it alone, or press **Show one passage** (or Esc).
  A plain click still shows one passage. The choice is remembered for the browser session. While several are
  shown, the NEXUS export's "This passage only" becomes "The passages shown".
* Browser tests (Playwright) for choosing several passages, the combined apparatus and going back to one passage,
  run by CI.
* **Data export** menu (top bar), with **NEXUS for SplitsTree…**: a character matrix of the aligned readings of the
  whole section (or of one passage), as Saktumiva's matrix editor exports it for one alignment, for SplitsTree to
  compute a tree or network from. SplitsTree's result, saved as NeXML and put in the teiHeader, is what the Stemma
  button draws. Choose the witnesses (the edition is left out unless ticked), first hand or corrected text for
  witnesses with `<add>`/`<del>` (Kac or Kpc), and as in Saktumiva: normalize spellings, merge word groups (one
  character per apparatus entry), gaps significant. The alignments are brought up to date first, as Publish does,
  or the saved alignment files are used as they are (fast). Each character is named after its passage (e.g.
  `SS.1.1.3.2`), the readings are given in Harvard-Kyoto, and a comment at the top records the choices made.
  Unlike Saktumiva, lost text (‡) is written as missing (?), not as a reading of its own.

## 0.4.3

* **Stemma** (top bar): if the edition's teiHeader has a `<stemma format="nexml">` (in `<xenoData>`, as SplitsTree6 and
  Saktumiva write it), the button draws it as a stemma codicum: the root at the top, the witnesses' sigla at the
  leaves, the inner nodes unnamed. Branch lengths are shown in proportion (with a scale), or ignored (one step per
  generation); lines straight or right-angled. Point at a branch for its length, at a siglum for its witness.
  Several stemmata, or several trees in one, are offered in a list. A witness at the root with a single branch
  (SplitsTree roots its trees at the first taxon) is drawn as a leaf, unless "Root as in the file" is ticked.
  *Download SVG* saves the drawing. The button is shown only when there is a stemma; one inside a comment is
  reported, not drawn.

## 0.4.2

* The witnesses toggle at the far right of the top bar is now a ☰ button, like the one for the passage list
  at the far left.
* Starting the editor reuses a copy that is already running only if it is the same version. After an
  update, an old copy still running is no longer opened in place of the new one; you are told it is
  still running instead.

## 0.4.1

* If the editor is already running (perhaps forgotten in another terminal window), starting it again opens
  that copy in the browser instead of starting a second one. If all ports are taken, it says by what
  (listing the running editors and how to stop them) instead of showing a Python error.
* Top bar: the buttons always stay visible in narrow windows (the project name and status are shortened
  with "…" instead). The witnesses button is now at the far right.

## 0.4.0

* Hide or show the passage list (☰ button, or the [ key) and the witnesses (Witnesses button, or ]).
* Text size of the passage: A− / A / A+ above the text (or Ctrl+− / Ctrl+0 / Ctrl++).
* Both are remembered, like the witness order.

## 0.3.0

* Witnesses panel: drag a witness by its handle (⠿) to change the order. The order is remembered for all
  projects (in the editor's preferences, not in the project). Witnesses that lack the current passage are always
  listed last.

## 0.2.0

* "Recently opened" on the start page now lists up to six sections, most recent first, instead of one entry
  per project (which kept only the last section opened in each project). Each entry opens its section directly;
  "Project…" shows the project's other sections.
* Saktumiva updated to commit ed701a3 (Dependabot, pull request #1).

## 0.1.0

First release as a package.

* Installs with pipx, or as a ready-made program for Linux, macOS (Apple silicon) and Windows.
* Project chooser: recent projects, a folder browser, a project's sections, and a setup screen that proposes
  the edition and witnesses and writes `editor.config.json`.
* Works with any project laid out as folders of TEI files (`.xml`, `.txt`, `.tei`), with optional
  `saktumiva-project.json` for shared settings; tested with the Rasendramaṅgala.
* Help → Check for updates, using GitHub Releases.
* Saktumiva is now a git submodule pinned to commit cab59bc; the editor's one change to it is applied as it is served.
* Regression tests for collation, apparatus and Publish; Dependabot proposes Saktumiva updates.
* The cache of computed alignments moved from the program folder to the user's cache folder.
