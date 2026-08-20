import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SpeechRecognitionError,
  WhisperBinaryNotFoundError,
  WhisperModelNotFoundError,
} from "../../src/errors";
import { LocalWhisperProvider } from "../../src/voice/providers/localWhisper";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

const tempDirs: string[] = [];

function makeTempFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sva-test-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(100));
  return file;
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  mocks.spawn.mockReturnValue(child);
  return child;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe("LocalWhisperProvider", () => {
  it("devolve a transcrição limpa no sucesso", async () => {
    const audio = makeTempFile("a.wav");
    const model = makeTempFile("ggml-base.bin");
    const child = fakeChild();
    const provider = new LocalWhisperProvider({
      bin: "whisper-cli",
      model: "base",
      modelPath: model,
    });

    const promise = provider.transcribe(audio);
    child.stdout.emit("data", Buffer.from("pausa\n"));
    child.stderr.emit("data", Buffer.from("log de carregamento\n"));
    child.emit("close", 0);

    await expect(promise).resolves.toBe("pausa");
  });

  it("lança WhisperBinaryNotFoundError quando o binário não existe", async () => {
    const audio = makeTempFile("a.wav");
    const model = makeTempFile("ggml-base.bin");
    const provider = new LocalWhisperProvider({
      bin: "C:\\inexistente\\whisper-cli.exe",
      model: "base",
      modelPath: model,
    });

    await expect(provider.transcribe(audio)).rejects.toBeInstanceOf(
      WhisperBinaryNotFoundError,
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("lança WhisperModelNotFoundError quando o modelo não existe", async () => {
    const audio = makeTempFile("a.wav");
    const provider = new LocalWhisperProvider({
      bin: "whisper-cli",
      model: "base",
      modelPath: "C:\\inexistente\\ggml-base.bin",
    });

    await expect(provider.transcribe(audio)).rejects.toBeInstanceOf(
      WhisperModelNotFoundError,
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("lança WhisperBinaryNotFoundError no erro ENOENT do spawn", async () => {
    const audio = makeTempFile("a.wav");
    const model = makeTempFile("ggml-base.bin");
    const child = fakeChild();
    const provider = new LocalWhisperProvider({
      bin: "whisper-cli",
      model: "base",
      modelPath: model,
    });

    const promise = provider.transcribe(audio);
    child.emit(
      "error",
      Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    );

    await expect(promise).rejects.toBeInstanceOf(WhisperBinaryNotFoundError);
  });

  it("lança SpeechRecognitionError em saída com erro", async () => {
    const audio = makeTempFile("a.wav");
    const model = makeTempFile("ggml-base.bin");
    const child = fakeChild();
    const provider = new LocalWhisperProvider({
      bin: "whisper-cli",
      model: "base",
      modelPath: model,
    });

    const promise = provider.transcribe(audio);
    child.stderr.emit("data", Buffer.from("modelo incompatível"));
    child.emit("close", 1);

    await expect(promise).rejects.toBeInstanceOf(SpeechRecognitionError);
  });

  it("rejeita áudio inexistente", async () => {
    const model = makeTempFile("ggml-base.bin");
    const provider = new LocalWhisperProvider({
      bin: "whisper-cli",
      model: "base",
      modelPath: model,
    });

    await expect(provider.transcribe("nope.wav")).rejects.toBeInstanceOf(
      SpeechRecognitionError,
    );
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});