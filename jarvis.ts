import OpenAI from "openai";
import axios from "axios";
import fs from "node:fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

const outputMp3File = "recording.mp3";
let silenceTimer = null;

// 🛠️ Verify the microphone name is exactly as in:
// ffmpeg -list_devices true -f dshow -i dummy
const MICROPHONE_DEVICE = "Headset (realme Buds T300 Hands-Free AG Audio)";

function startRecording() {
  console.log("🎙️ Recording started... Will auto-stop on 1s silence.");

  const command = ffmpeg()
    .setFfmpegPath(ffmpegStatic)
    .input(`audio=${MICROPHONE_DEVICE}`)
    .inputFormat("dshow")
    // Add silence detection filter: log silence when below -45dB for 1 second.
    .audioFilters("silencedetect=n=-45dB:d=1")
    // Record directly to MP3 using libmp3lame.
    .audioCodec("libmp3lame")
    .format("mp3")
    .outputOptions([
      "-ac 1", // Mono audio
      "-ar 44100", // Sample rate 44.1kHz
      "-y", // Overwrite output file if it exists
      "-loglevel error", // Detailed logging for troubleshooting
    ])
    .on("start", (cmd) => {
      console.log("FFmpeg command:", cmd);
    })
    .on("stderr", (line) => {
      console.log("FFmpeg stderr:", line);

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
      console.error("FFmpeg stderr output:", stderr);
      process.exit(1);
    })
    .on("end", () => {
      console.log(`✅ Recording finished. File saved as: ${outputMp3File}`);
      process.exit(0);
    })
    .save(outputMp3File);

  process.on("SIGINT", () => {
    console.log("Received SIGINT. Stopping recording...");
    stopRecording(command);
  });
}

// Stop recording gracefully by sending "q" to FFmpeg's stdin.
function stopRecording(command) {
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

startRecording();

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

// const completion = await openai.chat.completions.create({
//   model: "gpt-4o-mini",
//   store: true,
//   messages: [
//     { role: "user", content: "write a haiku about ai" },
//     {
//       role: "assistant",
//       name: "Jarvis",
//       content: [{ type: "text", text: transcriptions }],
//     },
//   ],
// });

// const url = "https://api.ttsopenai.com/uapi/v1/text-to-speech";
// const headers = {
//   "Content-Type": "application/json",
//   "x-api-key": process.env.TTS_API_KEY,
// };
// const data = {
//   model: "tts-1",
//   voice_id: "PE0243",
//   speed: 1,
//   input: "Hello world!",
// };

// const res = await axios.post(url, data, { headers });

// console.log(res.data);
