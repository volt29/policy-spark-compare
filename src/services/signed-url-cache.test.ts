// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { SignedUrlCache } from "./signed-url-cache";

describe("SignedUrlCache", () => {
  it("reuses cached preview URLs until the TTL elapses", async () => {
    let now = 0;
    let callCount = 0;
    const cache = new SignedUrlCache(
      {
        preview: async (key) => {
          callCount += 1;
          return `https://example.com/preview/${key}?v=${callCount}`;
        },
        download: async () => {
          throw new Error("not used");
        },
      },
      {
        now: () => now,
        previewExpiresIn: 10,
        previewBufferSeconds: 2,
      }
    );

    const first = await cache.getPreviewUrl("insurance-documents/policy.pdf");
    expect(first).toBe("https://example.com/preview/policy.pdf?v=1");
    expect(callCount).toBe(1);

    const second = await cache.getPreviewUrl("policy.pdf");
    expect(second).toBe(first);
    expect(callCount).toBe(1);

    now += 9000; // 9 seconds > (10 - 2) * 1000 TTL
    const third = await cache.getPreviewUrl("policy.pdf");
    expect(callCount).toBe(2);
    expect(third).toBe("https://example.com/preview/policy.pdf?v=2");
  });

  it("shares in-flight requests for the same key", async () => {
    let resolveFn: ((value: string) => void) | null = null;
    let callCount = 0;
    const cache = new SignedUrlCache(
      {
        preview: async () => {
          throw new Error("not used");
        },
        download: (key) => {
          callCount += 1;
          return new Promise<string>((resolve) => {
            resolveFn = (value) => resolve(value.replace("{key}", key));
          });
        },
      },
      {
        downloadExpiresIn: 10,
        downloadBufferSeconds: 1,
      }
    );

    const promiseA = cache.getDownloadUrl("insurance-documents/report.pdf");
    const promiseB = cache.getDownloadUrl("report.pdf");

    expect(callCount).toBe(1);

    const combined = Promise.all([promiseA, promiseB]);
    resolveFn?.("https://example.com/{key}");
    const [resultA, resultB] = await combined;
    expect(resultA).toBe("https://example.com/report.pdf");
    expect(resultB).toBe(resultA);

    const cached = await cache.getDownloadUrl("report.pdf");
    expect(cached).toBe(resultA);
    expect(callCount).toBe(1);
  });
});
