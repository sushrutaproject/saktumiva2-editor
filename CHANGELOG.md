# Changelog

## Unreleased

* If the editor is already running (perhaps forgotten in another terminal window), starting it again opens
  that copy in the browser instead of starting a second one. If all ports are taken, it says by what
  (listing the running editors and how to stop them) instead of showing a Python error.
* Top bar: the buttons always stay visible in narrow windows (the project name and status are shortened
  with "…" instead). The witnesses button is now at the far right ("Witnesses ▸", or "◂ Witnesses" when hidden).

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
