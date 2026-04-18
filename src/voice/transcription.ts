import fs from "fs";
import os from "os";
import path from "path";
import https from "https";
import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export class TranscriptionClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    if (config.TRANSCRIPTION_PROVIDER === "groq") {
      if (!config.GROQ_API_KEY) {
        throw new Error(
          "GROQ_API_KEY is required when TRANSCRIPTION_PROVIDER=groq. Get one at https://console.groq.com/keys"
        );
      }
      this.client = new OpenAI({
        apiKey: config.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      });
      this.model = config.GROQ_TRANSCRIPTION_MODEL;
      logger.info("Transcription client: Groq (whisper-large-v3)");
    } else {
      if (!config.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY is required when TRANSCRIPTION_PROVIDER=openai. Get one at https://platform.openai.com/api-keys"
        );
      }
      this.client = new OpenAI({
        apiKey: config.OPENAI_API_KEY,
      });
      this.model = config.OPENAI_TRANSCRIPTION_MODEL;
      logger.info("Transcription client: OpenAI Whisper");
    }
  }

  async transcribe(audioUrl: string): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `voice-${Date.now()}.ogg`);

    logger.debug("Downloading voice file", { url: audioUrl, tmpPath });
    await this.downloadFile(audioUrl, tmpPath);

    try {
      logger.debug("Sending to transcription API", { model: this.model });
      const response = await this.client.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: this.model,
      });

      logger.info("Transcription complete", {
        textLength: response.text.length,
      });
      return response.text;
    } finally {
      try {
        fs.unlinkSync(tmpPath);
        logger.debug("Cleaned up temp voice file");
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `Failed to download voice file: HTTP ${response.statusCode}`
              )
            );
            return;
          }
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        })
        .on("error", (err) => {
          try {
            fs.unlinkSync(dest);
          } catch {
            // Ignore
          }
          reject(err);
        });
    });
  }
}

export const transcriptionClient = new TranscriptionClient();
