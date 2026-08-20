import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  SpeechRecognitionError,
  WhisperBinaryNotFoundError,
  WhisperModelNotFoundError,
} from "../../errors";
import type { SpeechToTextProvider } from "../types";

export interface LocalWhisperOptions {
  /** Binário do whisper.cpp (ex.: "whisper-cli" ou caminho completo). */
  bin: string;
  /** Nome do modelo (ex.: "base", "small"). */
  model: string;
  /** Caminho completo do arquivo do modelo (opcional). */
  modelPath?: string;
  /** Diretório com modelos `ggml-*.bin` (opcional). */
  modelsDir?: string;
  timeoutMs?: number;
}

function resolveModelFile(options: LocalWhisperOptions): string {
  if (options.modelPath) return options.modelPath;
  if (options.modelsDir) {
    return path.join(options.modelsDir, `ggml-${options.model}.bin`);
  }
  return options.model;
}

function isPathLike(value: string): boolean {
  return /[/\\]/.test(value) || value.toLowerCase().endsWith(".exe");
}

function cleanTranscript(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

/**
 * Provider de transcrição via whisper.cpp local.
 *
 * Recebe o caminho de um arquivo de áudio, invoca o binário como subprocesso
 * e devolve somente o texto reconhecido. Não contém lógica de intenção.
 */
export class LocalWhisperProvider implements SpeechToTextProvider {
  constructor(private readonly options: LocalWhisperOptions) {}

  async transcribe(audioPath: string): Promise<string> {
    if (!fs.existsSync(audioPath)) {
      throw new SpeechRecognitionError("Arquivo de áudio não encontrado.");
    }

    this.assertBinary();
    const modelFile = this.assertModel();

    return this.runWhisper(audioPath, modelFile);
  }

  private assertBinary(): void {
    if (isPathLike(this.options.bin) && !fs.existsSync(this.options.bin)) {
      throw new WhisperBinaryNotFoundError(
        "whisper.cpp não encontrado. Configure WHISPER_BIN nas configurações.",
      );
    }
  }

  private assertModel(): string {
    const modelFile = resolveModelFile(this.options);
    const isPath = isPathLike(modelFile);
    if (isPath && !fs.existsSync(modelFile)) {
      throw new WhisperModelNotFoundError(
        `Modelo do whisper não encontrado em "${modelFile}". Configure WHISPER_MODEL_PATH ou WHISPER_MODELS_DIR.`,
      );
    }
    return modelFile;
  }

  private runWhisper(audioPath: string, modelFile: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-m",
        modelFile,
        "-f",
        audioPath,
        "-nt",
        "-l",
        "auto",
      ];

      const child = spawn(this.options.bin, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(
          new SpeechRecognitionError(
            "Whisper excedeu o tempo limite de transcrição.",
          ),
        );
      }, this.options.timeoutMs ?? 60000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error.code === "ENOENT") {
          reject(
            new WhisperBinaryNotFoundError(
              `whisper.cpp não encontrado ("${this.options.bin}"). Configure WHISPER_BIN nas configurações.`,
            ),
          );
          return;
        }
        reject(
          new SpeechRecognitionError(
            `Falha ao executar o whisper. Verifique se o whisper.cpp está instalado.`,
          ),
        );
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new SpeechRecognitionError(
              `Whisper encerrou com código ${code}. ${stderr.trim()}`,
            ),
          );
          return;
        }
        resolve(cleanTranscript(stdout));
      });
    });
  }
}