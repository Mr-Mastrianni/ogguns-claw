import fs from "fs";
import os from "os";
import path from "path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export class ElevenLabsClient {
  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private enabled: boolean;

  constructor() {
    this.enabled = !!config.ELEVENLABS_API_KEY;
    this.apiKey = config.ELEVENLABS_API_KEY || "";
    this.voiceId = config.ELEVENLABS_VOICE_ID;
    this.modelId = config.ELEVENLABS_MODEL_ID;

    if (this.enabled) {
      logger.info(
        `ElevenLabs TTS enabled (voice: ${this.voiceId}, model: ${this.modelId})`
      );
    } else {
      logger.info(
        "ElevenLabs TTS disabled. Set ELEVENLABS_API_KEY to enable voice replies."
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async synthesize(text: string): Promise<string> {
    if (!this.enabled) {
      throw new Error("ElevenLabs is not configured");
    }

    const tmpPath = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);

    logger.debug("Synthesizing speech with ElevenLabs", {
      voiceId: this.voiceId,
      textLength: text.length,
    });

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `ElevenLabs API error: ${response.status} ${response.statusText} — ${errorBody}`
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tmpPath, buffer);

    logger.info("Speech synthesized", {
      fileSize: buffer.length,
      tmpPath,
    });

    return tmpPath;
  }

  cleanup(tmpPath: string): void {
    try {
      fs.unlinkSync(tmpPath);
      logger.debug("Cleaned up TTS audio file");
    } catch {
      // Ignore cleanup errors
    }
  }
}

export const elevenlabs = new ElevenLabsClient();
