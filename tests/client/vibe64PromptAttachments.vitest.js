import { describe, expect, it } from "vitest";
import { labelComposerAttachments, updateComposerAttachmentReferences } from "../../src/lib/vibe64PromptAttachments.js";

describe("shared composer references", () => {
  const files = [
    { attachmentId: "a", fileName: "one.png" },
    { attachmentId: "b", fileName: "notes.txt" },
    { attachmentId: "c", fileName: "two.jpg" }
  ];
  it("numbers image and file references separately", () => {
    expect(labelComposerAttachments(files).map((file) => file.reference)).toEqual(["[Image #1]", "[File #1]", "[Image #2]"]);
  });
  it("explicit removal deletes the exact reference and renumbers surviving references without touching edited text", () => {
    const before = labelComposerAttachments(files);
    const after = labelComposerAttachments(files.slice(1));
    expect(updateComposerAttachmentReferences("See [Image #1], [Image #2] and [File #1]. Keep [Image edited].", before, after))
      .toBe("See , [Image #1] and [File #1]. Keep [Image edited].");
    expect(updateComposerAttachmentReferences("My own message", before, after)).toBe("My own message");
  });
  it("treats SVG and unknown binaries as files", () => {
    expect(labelComposerAttachments([{ fileName: "unsafe.svg" }, { fileName: "binary.exe" }]).map((file) => file.reference))
      .toEqual(["[File #1]", "[File #2]"]);
  });
});
