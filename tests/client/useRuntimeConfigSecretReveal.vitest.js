import { describe, expect, it, vi } from "vitest";

import {
  useRuntimeConfigSecretReveal
} from "../../src/composables/useRuntimeConfigSecretReveal.js";

describe("runtime config secret reveal", () => {
  it("tracks loading and revealed values by secret key", async () => {
    let finishReveal;
    const revealValue = vi.fn(() => new Promise((resolve) => {
      finishReveal = resolve;
    }));
    const reveal = useRuntimeConfigSecretReveal({ revealValue });
    const pending = reveal.revealSecret({ key: "DB_PASSWORD", secret: true });

    expect(reveal.secretRevealBusyKey.value).toBe("DB_PASSWORD");
    finishReveal("private");
    await expect(pending).resolves.toBe(true);
    expect(reveal.secretRevealBusyKey.value).toBe("");
    expect(reveal.revealedSecrets.value).toEqual({ DB_PASSWORD: "private" });

    expect(reveal.hideSecret("DB_PASSWORD")).toBe(true);
    expect(reveal.revealedSecrets.value).toEqual({});
  });
});
