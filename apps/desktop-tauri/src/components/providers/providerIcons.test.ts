import { describe, expect, it } from "vitest";
import { TEST_PROVIDER_CATALOG } from "../../test/providerCatalog";
import { getProviderIcon, PROVIDER_ICON_REGISTRY } from "./providerIcons";

describe("provider icon registry", () => {
  it("has explicit icon metadata for every provider in the catalog", () => {
    for (const [id] of TEST_PROVIDER_CATALOG) {
      expect(PROVIDER_ICON_REGISTRY[id], id).toBeDefined();
    }
  });

  it("uses the Codex brand treatment for the ChatGPT account surface", () => {
    const chatgpt = getProviderIcon("chatgpt");
    const codex = getProviderIcon("codex");

    expect(chatgpt.id).toBe("chatgpt");
    expect(codex.id).toBe("codex");
    expect(chatgpt.brandColor).toBe(codex.brandColor);
    expect(chatgpt.fallbackLetter).toBe(codex.fallbackLetter);
    expect(chatgpt.svgPath).toBe(codex.svgPath);
  });
});
