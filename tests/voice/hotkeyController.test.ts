import { describe, expect, it, vi } from "vitest";
import {
  HotkeyConflictError,
  HotkeyController,
} from "../../src/voice/hotkeyController";

function makeBackend() {
  return {
    set: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
}

describe("HotkeyController", () => {
  it("registra e guarda a combinação", async () => {
    const backend = makeBackend();
    const hk = new HotkeyController(backend);
    await hk.apply("Ctrl+Alt+Space");
    expect(backend.set).toHaveBeenCalledWith("Ctrl+Alt+Space");
    expect(hk.combo).toBe("Ctrl+Alt+Space");
  });

  it("falha com conflito e mantém a combinação anterior", async () => {
    const backend = makeBackend();
    const hk = new HotkeyController(backend, "Ctrl+Alt+A");
    backend.set.mockRejectedValueOnce(new Error("em uso"));
    await expect(hk.apply("Ctrl+Alt+B")).rejects.toBeInstanceOf(
      HotkeyConflictError,
    );
    expect(hk.combo).toBe("Ctrl+Alt+A");
  });

  it("rejeita combinação vazia", async () => {
    const backend = makeBackend();
    const hk = new HotkeyController(backend);
    await expect(hk.apply("   ")).rejects.toBeInstanceOf(HotkeyConflictError);
    expect(backend.set).not.toHaveBeenCalled();
  });

  it("desregistra e zera a combinação", async () => {
    const backend = makeBackend();
    const hk = new HotkeyController(backend, "Ctrl+Alt+C");
    await hk.clear();
    expect(backend.clear).toHaveBeenCalled();
    expect(hk.combo).toBeNull();
  });

  it("propaga erro do backend como HotkeyConflictError", async () => {
    const backend = makeBackend();
    backend.set.mockRejectedValueOnce(new Error("qualquer erro"));
    const hk = new HotkeyController(backend);
    await expect(hk.apply("Ctrl+Alt+X")).rejects.toBeInstanceOf(
      HotkeyConflictError,
    );
  });
});