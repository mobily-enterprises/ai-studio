import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const finishDialogPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionFinishDialog.vue"
);

describe("Vibe64 session Finish confirmation", () => {
  it("warns in red when the existing source-safety state is unsafe", () => {
    const source = fs.readFileSync(finishDialogPath, "utf8");

    expect(source).toContain("sourceSafetyIsUnsafe(sourceSafety.value)");
    expect(source).toContain("studio-ai-session-finish-dialog--unsafe");
    expect(source).toContain(":color=\"unsafeWork ? 'error' : 'primary'\"");
    expect(source).toContain("These changes will be archived away with the session.");
    expect(source).toContain("They will not be pushed to origin/main.");
    expect(source).toContain(":source-safety=\"sourceSafety\"");
    expect(source).not.toContain("/source-safety");
  });
});
