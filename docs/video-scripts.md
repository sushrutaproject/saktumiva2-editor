# Video scripts

Scripts for a short series of screen recordings to accompany the [tutorial](tutorial.md), for a YouTube playlist
such as *Editing Sanskrit texts with Saktumiva*. Each video covers one or two parts of the tutorial and runs
3–7 minutes. Link each video's description to the matching part of the tutorial.

**Recording notes**

* Record at 1920×1080; set the browser zoom to 125% and the terminal font to 16pt or more so text is legible on a phone.
* Use a small demonstration repository (two or three witnesses, five or six verses) rather than a real project, so
  that collation is quick and the screen is uncluttered. Chapter 1 of the Rasendramaṅgala (CC BY-SA) works well.
* Close notifications and unrelated tabs. Show the mouse pointer; a click highlight helps.
* "SAY" is the narration; "SHOW" is what is on screen. Keep the narration in the present tense and short.

---

## Video 1. What the Saktumiva editor does (overview) — 3 min

| SHOW | SAY |
|---|---|
| Title card: *Saktumiva editor: an overview* | Hello. This series shows you how to make a critical edition of a Sanskrit text with Charles Li's Saktumiva and the Saktumiva editor. |
| A published edition on GitHub Pages (the Suśrutasaṃhitā), scrolling, clicking a variant | This is where we are going: an edition on the web, with a full apparatus linked to every manuscript. |
| The "journey" diagram from the tutorial | You transcribe the manuscripts in TEI XML, make a provisional edition, and then the editor and Saktumiva do the collating while you make decisions. You publish, push to GitHub, and the website updates. |
| The editing screen, pointing at each panel | In the editor: passages on the left, your text in the middle, the apparatus below it, and every witness on the right, with its page image. |
| Pressing **use** on a reading; the apparatus redraws | When you choose a reading, the passage is collated again straight away. |
| Playlist end screen | The next videos go through it step by step. The written tutorial is linked below. |

---

## Video 2. Transcribing a manuscript in TEI — 6 min

| SHOW | SAY |
|---|---|
| A manuscript image beside an empty file in VS Code or Oxygen | Every witness is one TEI XML file. Saktumiva needs very little TEI, and the Saktumiva website lists all of it. |
| saktumiva.org → *TEI tagging* page | Here's the list. Two things are essential. |
| The header: type `<idno type="siglum">K</idno>` | First, a siglum: the name this witness has in the apparatus. |
| Type an `<lg xml:id="SS.3.1.1">` with an `<l>` | Second, every verse or paragraph has an xml:id, and the same passage has the same id in every witness. That's how Saktumiva knows what to compare. |
| A second witness file, same id highlighted in both | Same id, two manuscripts. |
| Transcribe a line: `<pb n="68v"/>`, a `<subst>` with `<del>` and `<add>`, a `<gap/>` | Transcribe what the scribe wrote: page breaks, the scribe's corrections, damaged places. These few tags cover most of what you meet. |
| The TST editor (tst-project.github.io/editor): *new file*, red fields, *IIIF manifest* | If you'd rather not type a header by hand, the TST editor makes one. If the images are online with a IIIF manifest, paste its address here and the editor will show you each page. |
| A `<scriptNote xml:id="script-śa-sa">` in the header | If a scribe doesn't distinguish śa and sa, say so here, and those differences won't be counted as variants for that manuscript. |
| Two files with three verses each | Start small: a few verses from two or three witnesses are enough to try the whole cycle. |

---

## Video 3. A GitHub repository for your edition — 7 min

| SHOW | SAY |
|---|---|
| The two-copies diagram from the tutorial | Your edition is published from GitHub. There are two copies of your work: one on your computer and one on GitHub. Git keeps them in step. |
| github.com → **+ → New repository**; name, Public, README, Create | Make a repository: a short name, public, with a README. |
| GitHub Desktop: **File → Clone repository**, choose a folder | Now a copy on your computer. GitHub Desktop is the easiest way: Clone, choose where it goes. |
| File manager: create `chapter1/`, copy the witness files in | One folder per chapter. Each one is a *section*: its edition and its witnesses. |
| GitHub Desktop: the new files listed, summary "Add transcriptions of chapter 1", **Commit to main** | A commit is a saved version. Tick the files, describe the change, commit. |
| **Push origin**; the repository page on GitHub now shows the files | Push sends it to GitHub. Nothing goes online until you push. |
| A second computer (or a collaborator's change on GitHub); **Fetch origin**, **Pull origin** | And before you start work, pull, to get anything that changed elsewhere. Pull at the start, push at the end. |
| (Optional, 30 s) The same with `git pull`, `git add`, `git commit -m`, `git push` in a terminal | If you prefer the command line, these are the same four steps. |
| **Settings → Pages**, Deploy from a branch, main, root, Save | Finally, turn on GitHub Pages. That's what makes the repository a website. We'll see the result once we've published. |

---

## Video 4. The provisional edition: working file and published file — 5 min

| SHOW | SAY |
|---|---|
| Copy the vulgate witness file; rename it `provisional-edition_ch1_new.xml` | The edition file is your text. The easiest start is a copy of your best witness. Its name should contain "edition", and it ends in `_new`: this is the working copy. |
| Edit the header: title, `<idno type="siglum">Ed</idno>`; delete the msDesc | Give it its own title and siglum, and take out the manuscript description. |
| Delete `<pb/>`, `<lb/>`, `<subst>` …; leave clean `<lg>`/`<l>` | Remove the manuscript's own markup, so that what's left is plain edited text. |
| Highlight ids in the edition and in a witness | Keep the ids exactly as they are in the witnesses. |
| The working-file/published-file diagram | Now an important distinction. The `_new` file is your working file: your text and notes, no apparatus. You edit this one. Publish makes the other file, without `_new`: the same text with the full apparatus. That's the one readers see. |
| Open a published file; scroll to the `<standOff type="apparatus">` | Never edit the published file by hand: the next Publish replaces it. Fix the working file and publish again. |
| GitHub Desktop: commit the new edition file | And commit. |

---

## Video 5. Installing the editor and checking for updates — 5 min

| SHOW | SAY |
|---|---|
| github.com/sushrutaproject/saktumiva2-editor → **Releases → Latest** | The editor is on GitHub. Under the latest release are ready-made programs for Windows, macOS and Linux. |
| Download the Windows zip, unzip, double-click `saktumiva-editor.exe`; SmartScreen → **More info → Run anyway** | Download the one for your computer and unzip it. On Windows, the first time, SmartScreen asks: More info, Run anyway. |
| (Cut) macOS: right-click → **Open** → **Open** | On a Mac, right-click and choose Open the first time. |
| The terminal window, then the browser with the project chooser | A terminal window opens, and then the editor in your browser. Keep the terminal open while you work; closing it stops the editor. |
| (Optional) `pipx install git+https://github.com/sushrutaproject/saktumiva2-editor.git` | If you use Python, you can install it with pipx instead. |
| **Help ▾ → Check for updates…** showing "up to date", then (staged) a newer version with a download link | To see whether there's a newer version: Help, Check for updates. It tells you what's new and how to update. For the ready-made program, download the new one and replace the old. Your files are never touched: they live in your repository, not in the program. |
| Terminal: `saktumiva-editor --check-updates` | You can also check from a terminal. |

---

## Video 6. Opening your section — 4 min

| SHOW | SAY |
|---|---|
| The chooser: *Recent projects* empty; **Open a folder → Browse…**, find the repository, **Use this folder** | The first screen is the project chooser. Open your repository's folder. |
| The list of sections (chapter1) | The editor finds the sections in it. |
| The setup screen: Edition, Witnesses, Publish to | The first time you open a section, it proposes which file is the edition and which are the witnesses. Check it. Here I set *Publish to* to the name without `_new`. |
| **Create editor.config.json and open** | Confirm, and the choice is saved in the section folder as editor.config.json. Commit that too. |
| The editing screen; Saktumiva collates the first passage | And here's the editing screen. The first time you look at a passage, Saktumiva collates it. |
| Restart the editor: the project is under *Recent projects* | Next time, it's in the recent list. |

---

## Video 7. The work cycle: edit, save, publish, push — 7 min

| SHOW | SAY |
|---|---|
| The work-cycle diagram | The daily cycle: pull, edit, save, publish, check, push. |
| GitHub Desktop: **Fetch origin** | Pull first. |
| Click an underlined word; the apparatus entry is highlighted | Underlined words have variants. Click one to find its entry. |
| Point at a reading, **use**; the text and apparatus change | To adopt a reading, press use. The old reading becomes a variant. |
| **Edit text**, type a correction, tick **Record as emendation**, **Done** | You can type in the text, and record it as an emendation, which adds a note. |
| Select a word, **Add note here**, type, **Add note** | Notes: select a word and add one. |
| A witness's **edit** button, fix a typo | If a transcription is wrong, correct it here. That's saved to the witness file at once. |
| Dot in the passage list; Ctrl+S; toast; **History** | Unsaved passages have a dot. Ctrl+S saves: only what you changed is written, into the working file, and each save is a git commit. History shows them. |
| **Publish** → **Publish**; progress bar; result list | When you've done a piece of work, Publish. This writes the published file, with a fresh apparatus for every passage. |
| GitHub Desktop: *History* tab, the diff of the published file | Check it: GitHub Desktop shows exactly what changed. |
| **Push origin**; wait; reload the GitHub Pages address | And push. A minute or two later the website shows the new version. |
| End card: links to tutorial and README | That's the cycle. The written tutorial and the editor's README have the details. Thanks for watching. |

---

## Thumbnails and titles

Suggested titles, numbered so the playlist sorts in order:

1. Saktumiva editor 1: overview
2. Saktumiva editor 2: transcribing manuscripts in TEI
3. Saktumiva editor 3: your edition on GitHub
4. Saktumiva editor 4: the provisional edition
5. Saktumiva editor 5: installing and updating
6. Saktumiva editor 6: opening your files
7. Saktumiva editor 7: edit, save, publish, push

For thumbnails, a screenshot of the editing screen with a large number and two or three words ("Install",
"Publish") is enough.
