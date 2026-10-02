import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

interface Capability {
  permissions: Array<string | { identifier: string; allow?: Array<{ url?: string }> }>;
}

const capabilitiesPath = path.resolve(
  __dirname,
  "../../src-tauri/capabilities/default.json",
);

const capability = JSON.parse(fs.readFileSync(capabilitiesPath, "utf-8")) as Capability;

function allowedHttpUrls(): string[] {
  const urls: string[] = [];
  for (const permission of capability.permissions) {
    if (typeof permission !== "object") continue;
    if (permission.identifier !== "http:default") continue;
    for (const entry of permission.allow ?? []) {
      if (entry.url) urls.push(entry.url);
    }
  }
  return urls;
}

describe("capabilities HTTP (tauri-plugin-http)", () => {
  it("não usa scope HTTP irrestrito (https://*)", () => {
    const urls = allowedHttpUrls();
    expect(urls.some((u) => u === "https://*" || u === "https://*.spotify.com/*")).toBe(false);
  });

  it("permite o endpoint de troca/refresh de token", () => {
    expect(allowedHttpUrls()).toContain("https://accounts.spotify.com/api/token");
  });

  it("permite a Web API do Spotify (https://api.spotify.com/v1/*)", () => {
    expect(allowedHttpUrls()).toContain("https://api.spotify.com/v1/*");
  });
});