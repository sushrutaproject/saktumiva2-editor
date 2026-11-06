# Changelog

## Unreleased

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
