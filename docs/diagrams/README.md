# Diagram sources

The diagrams in the [tutorial](../tutorial.md) are drawn from these [Mermaid](https://mermaid.js.org) files.
The tutorial shows them as SVG images (`../img/`), because the GitHub Pages site, unlike github.com, does not draw
Mermaid code.

To change a diagram: edit its `.mmd` file, paste it into the [Mermaid live editor](https://mermaid.live), and
export it as SVG to `docs/img/` with the same name. The images were drawn with Mermaid 11.4 with `htmlLabels` off,
so that the labels are plain SVG text (an SVG with embedded HTML labels does not display as an image). Each has a
white background, so that it can be read in dark mode too, and a fixed `width` and `height` (the size given by its
`viewBox`), so that narrow diagrams are not stretched to the full width of the page.
