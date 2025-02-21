import OpenAI from "openai";
import fs from "node:fs";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { Readable } from "node:stream";

const outputMp3File = "recording.mp3";
let silenceTimer = null;
let capturedLogs = [];

const MICROPHONE_DEVICE = "Headset (realme Buds T300 Hands-Free AG Audio)";

function startRecording() {
  console.log("🎙️ Recording started... Will auto-stop on 1s silence.");

  const command = ffmpeg()
    .setFfmpegPath(ffmpegStatic)
    .input(`audio=${MICROPHONE_DEVICE}`)
    .inputFormat("dshow")
    // Use the silence detection filter
    .audioFilters("silencedetect=n=-45dB:d=1")
    // Record directly to MP3 using libmp3lame.
    .audioCodec("libmp3lame")
    .format("mp3")
    .outputOptions([
      "-ac 1", // Mono audio
      "-ar 44100", // 44.1kHz sample rate
      "-y", // Overwrite output file if it exists
      "-loglevel debug", // Detailed logging needed for silence detection
    ])
    .on("start", (cmd) => {
      console.log("FFmpeg command:", cmd);
    })
    .on("stderr", (line) => {
      // Capture logs internally without printing them
      capturedLogs.push(line);

      if (line.includes("silence_start")) {
        console.log("🔕 Silence detected! Scheduling stop in 1 second...");
        if (!silenceTimer) {
          silenceTimer = setTimeout(() => {
            stopRecording(command);
          }, 1000);
        }
      } else if (line.includes("silence_end")) {
        console.log("🔊 Sound resumed. Cancelling scheduled stop if any.");
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      }
    })
    .on("error", (err, stdout, stderr) => {
      console.error("❌ FFmpeg error:", err.message);
      process.exit(1);
    })
    .on("end", () => {
      console.log(`✅ Recording finished. File saved as: ${outputMp3File}`);
      afterRecording();
    })
    .save(outputMp3File);

  process.on("SIGINT", () => {
    console.log("Received SIGINT. Stopping recording...");
    stopRecording(command);
  });
}

startRecording();

async function afterRecording() {
  console.log("Executing post-recording action...");

  const openai = new OpenAI({
    apiKey: process.env.API_TOKEN,
  });

  const transcriptions = await openai.audio.transcriptions.create({
    file: fs.createReadStream(outputMp3File),
    prompt:
      "You are Whisper-1, an advanced speech recognition system. Please transcribe the following audio input, which is entirely in Hindi. Ensure that your transcription accurately captures all nuances, idioms, and context inherent to the Hindi language. Provide only the transcription text with no additional commentary. Begin transcription now.",
    model: "whisper-1",
    language: "hi",
    response_format: "text",
  });

  console.log(transcriptions);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    store: true,
    n: 1,
    messages: [
      {
        role: "system",
        content: `You are now J.A.R.V.I.S., Tony Stark’s AI assistant. Adopt a polite, refined, and slightly witty tone. Provide only short, direct, and concise answers without extra elaboration. Begin your response with a brief pause (indicated by a short silence or ellipsis) to allow for smooth text-to-speech conversion. Stick strictly to the facts and respond in a succinct and efficient manner, while maintaining the characteristic style of J.A.R.V.I.S. Let's begin.`,
      },
      { role: "user", content: transcriptions },
    ],
  });

  console.log(completion.choices[0].message.content);

  const response = await openai.audio.speech.create({
    input: completion.choices[0].message.content,
    model: "tts-1",
    voice: "alloy",
  });

  // @ts-expect-error
  const nodeStream = Readable.fromWeb(response.body);

  const ffplay = spawn("ffplay", ["-autoexit", "-nodisp", "-"]);

  nodeStream.pipe(ffplay.stdin);

  ffplay.on("close", (code) => {
    console.log("Playback finished with code", code);
  });

  ffplay.on("error", (err) => {
    console.error("Error starting ffplay:", err);
  });
}

async function stopRecording(command) {
  console.log("⏹️ Stopping recording gracefully by sending 'q' to FFmpeg...");
  try {
    if (command.ffmpegProc && command.ffmpegProc.stdin) {
      command.ffmpegProc.stdin.write("q");
    } else {
      console.warn("No ffmpeg process or stdin available!");
    }
  } catch (e) {
    console.error("Error while stopping recording:", e);
  }
}
