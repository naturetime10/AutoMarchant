import type { Page } from "playwright";

/** A region of a page worth pointing at, and what to call it. */
export interface Highlight {
  selector: string;
  note: string;
  /** How many matches to outline; the first three unless set. */
  limit?: number;
}

/** Draws labelled outlines over page regions so a screenshot explains itself. */
export class Highlighter {
  private static readonly CLASS = "automerchant-highlight";
  private static readonly PALETTE = [
    "#e4572e",
    "#1b998b",
    "#3d5a80",
    "#c05299",
  ];

  constructor(private readonly page: Page) {}

  /** Outlines every highlight, returning how many elements were marked. */
  mark(highlights: Highlight[]): Promise<number> {
    return this.page.evaluate(
      ({ highlights, className, palette }) => {
        document.querySelectorAll(`.${className}`).forEach((old) =>
          old.remove()
        );

        let marked = 0;
        highlights.forEach((highlight, index) => {
          const color = palette[index % palette.length];
          // Amazon keeps hidden duplicates of many elements, so discard the
          // ones with no box before taking the first few.
          const matches = [...document.querySelectorAll(highlight.selector)]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width >= 8 && box.height >= 8;
            })
            .slice(0, highlight.limit ?? 3);

          for (const match of matches) {
            const rect = match.getBoundingClientRect();
            const box = document.createElement("div");
            box.className = className;
            box.style.cssText =
              `position:absolute;left:${rect.left + scrollX}px;` +
              `top:${
                rect.top + scrollY
              }px;width:${rect.width}px;height:${rect.height}px;` +
              `border:3px solid ${color};border-radius:4px;pointer-events:none;z-index:2147483647`;

            const label = document.createElement("span");
            label.textContent = highlight.note;
            label.style.cssText =
              `position:absolute;left:0;top:-21px;background:${color};` +
              `color:#fff;font:600 12px/17px system-ui,sans-serif;padding:1px 6px;` +
              `border-radius:3px;white-space:nowrap`;

            box.append(label);
            document.body.append(box);
            marked++;
          }
        });
        return marked;
      },
      {
        highlights,
        className: Highlighter.CLASS,
        palette: Highlighter.PALETTE,
      },
    );
  }
}
