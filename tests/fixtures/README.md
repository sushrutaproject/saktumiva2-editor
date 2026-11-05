# Test fixtures

Real sections, copied as they were, for the regression tests in `tests/js`. Each folder has

* `section/`: the section folder (edition, witnesses, `editor.config.json`, and for some, alignment files),
* `fixture.json`: where it comes from and which passages are tested:
  * `stored`: the apparatus made from the stored alignment file,
  * `fresh`: a fresh collation (alignment) and its apparatus,
  * `scriptNotes`: passages whose apparatus must change when the witnesses' script notes are switched off
    (this tests the editor's patch to Saktumiva, see `src/saktumiva_editor/saktumiva-patches.json`),
  * `publish`: the `<standOff type="apparatus">` that Publish writes.

Sources:

* `sushruta-sarira`: [sushrutaproject1/Sushrutasamhita_Saktumiva2](https://github.com/sushrutaproject1/Sushrutasamhita_Saktumiva2), `03-su.sa`, with six of its alignment files.
* `rasendramangala-ch1`: [wujastyk/Rasendramangala](https://github.com/wujastyk/Rasendramangala), `chapter1`, licensed CC BY-SA 4.0.
  The TEI files have the extension `.txt`, and there are no alignment files, so everything is collated afresh.

`stemma/` holds small TEI files for the Stemma view's tests (`tests/js/stemma.test.mjs`); see its README.
