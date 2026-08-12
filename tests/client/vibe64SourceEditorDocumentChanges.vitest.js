import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import {
  sourceEditorDocumentChanges
} from "../../src/lib/vibe64SourceEditorDocumentChanges.js";

describe("source editor document changes", () => {
  it("keeps separate edits separate so unchanged positions remain mappable", () => {
    const currentText = [
      "first",
      "keep before viewport",
      "visible line",
      "keep after viewport",
      "last",
      ""
    ].join("\n");
    const nextText = [
      "inserted",
      "first",
      "keep before viewport",
      "visible line changed",
      "keep after viewport",
      "last",
      ""
    ].join("\n");

    const changeSpecs = sourceEditorDocumentChanges(currentText, nextText);
    const visibleLineStart = currentText.indexOf("visible line");
    expect(changeSpecs).toEqual([
      {
        from: 0,
        insert: "inserted\n",
        to: 0
      },
      {
        from: visibleLineStart,
        insert: "visible line changed\n",
        to: visibleLineStart + "visible line\n".length
      }
    ]);
    const state = EditorState.create({
      doc: currentText
    });
    const changes = state.changes(changeSpecs);
    expect(changes.apply(state.doc).toString()).toBe(nextText);
    expect(changes.mapPos(currentText.indexOf("keep after viewport"))).toBe(
      nextText.indexOf("keep after viewport")
    );
  });

  it("returns no changes for identical text", () => {
    expect(sourceEditorDocumentChanges("same\n", "same\n")).toEqual([]);
  });
});
