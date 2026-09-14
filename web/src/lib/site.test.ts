import { describe, expect, it, afterEach } from "vitest";
import { authCallbackUrl } from "./site";

function setHost(hostname: string, origin: string) {
  // @ts-expect-error - test shim
  globalThis.window = { location: { hostname, origin } };
}
afterEach(() => {
  // @ts-expect-error - test shim
  delete globalThis.window;
});

describe("authCallbackUrl", () => {
  it("canonicalises the www production host to the allow-listed apex", () => {
    setHost("www.speechprep.ai", "https://www.speechprep.ai");
    expect(authCallbackUrl()).toBe("https://speechprep.ai/auth/callback?next=%2Fapp");
  });
  it("leaves the apex host alone", () => {
    setHost("speechprep.ai", "https://speechprep.ai");
    expect(authCallbackUrl()).toBe("https://speechprep.ai/auth/callback?next=%2Fapp");
  });
  it("keeps localhost on its own origin", () => {
    setHost("localhost", "http://localhost:3000");
    expect(authCallbackUrl()).toBe("http://localhost:3000/auth/callback?next=%2Fapp");
  });
  it("keeps preview deployments on their own origin", () => {
    setHost("speech-prep-abc.vercel.app", "https://speech-prep-abc.vercel.app");
    expect(authCallbackUrl()).toBe(
      "https://speech-prep-abc.vercel.app/auth/callback?next=%2Fapp",
    );
  });
  it("falls back to the canonical origin during SSR", () => {
    expect(authCallbackUrl()).toBe("https://speechprep.ai/auth/callback?next=%2Fapp");
  });
  it("encodes a custom next path", () => {
    setHost("www.speechprep.ai", "https://www.speechprep.ai");
    expect(authCallbackUrl("/app/onboarding")).toBe(
      "https://speechprep.ai/auth/callback?next=%2Fapp%2Fonboarding",
    );
  });
});
