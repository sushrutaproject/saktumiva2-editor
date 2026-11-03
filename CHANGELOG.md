# Changelog

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
