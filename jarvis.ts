import OpenAI from "openai";
import fs from "node:fs";
import fsPromise from "node:fs/promises";
import { spawn, execSync } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { Readable } from "node:stream";

const output = execSync(
  'cmd /c "ffmpeg -list_devices true -f dshow -i dummy 2>&1"',
  {
    encoding: "utf8",
    stdio: "pipe",
  }
);

const regex = /"([^"]+)" \(audio\)/;
const match = output.match(regex);

const outputMp3File = "recording.mp3";
let silenceTimer = null;
let capturedLogs = [];

const MICROPHONE_DEVICE =
  match[1] ?? "Headset (realme Buds T300 Hands-Free AG Audio)";

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

let conversation = fs.existsSync("./conversation.json")
  ? JSON.parse(await fsPromise.readFile("./conversation.json", "utf8"))
  : [
      {
        role: "system",
        content: `You are J.A.R.V.I.S., Tony Stark’s AI assistant. From now on, always output your responses in English, even if the input is in Hindi. Incorporate common expressions that reflect an Indian dialect in your tone, ensuring the language is clear, direct, and professional.

Your responses should be short, direct, and focused solely on answering the query. Do not elaborate on concepts or provide additional explanations unless explicitly requested by the user. Format your answers in a way that is optimal for text-to-speech conversion, ensuring clarity and a natural conversational flow.

Let's begin.`,
      },
    ];

async function afterRecording() {
  console.log("Executing post-recording action...");

  const openai = new OpenAI({
    apiKey: process.env.API_TOKEN,
  });

  const transcriptions = await openai.audio.transcriptions.create({
    file: fs.createReadStream(outputMp3File),
    model: "whisper-1",
    prompt:
      "Please process the provided audio file. The audio is in Hindi, but instead of transcribing it directly in Hindi, translate the content and output the transcription in English.",
    language: "en",
    response_format: "text",
  });

  console.log(transcriptions);
  conversation.push({ role: "user", content: transcriptions });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    store: false,
    n: 1,
    messages: conversation,
  });

  const assistantMessage = completion.choices[0].message.content;

  // Append the assistant's message to the conversation history.
  conversation.push({ role: "assistant", content: assistantMessage });

  storeDataToFile(conversation);

  console.log(assistantMessage);

  const response = await openai.audio.speech.create({
    input: assistantMessage,
    model: "tts-1",
    voice: "onyx",
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

async function storeDataToFile(data) {
  await fsPromise.writeFile(
    "./conversation.json",
    JSON.stringify(data, null, 2),
    "utf-8"
  );
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
