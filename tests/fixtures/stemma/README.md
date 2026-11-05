# Stemma fixtures

For `tests/js/stemma.test.mjs`.

* `splitstree6.xml`: the `<xenoData><stemma format="nexml">` that SplitsTree6 wrote, copied from the teiHeader of
  `01-su.su-1-31/provisional-edition_sutrasthana-1-31_new.xml` in
  [sushrutaproject1/Sushrutasamhita_Saktumiva2](https://github.com/sushrutaproject1/Sushrutasamhita_Saktumiva2),
  with the comment marks around it removed.
* `commented.xml`: the same, still inside its comment, as that file has it.
* `several.xml`: Saktumiva's own guide tree (from `01-su.su-32-end/alignments/SS.1.33.12.xml`; its `otu` references do
  not match its `otus`, as Saktumiva writes them), then made-up trees: one without branch lengths, one with a witness
  as an inner node and a negative length, a network, and a Newick stemma.
