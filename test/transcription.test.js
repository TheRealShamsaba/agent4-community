import assert from "node:assert/strict";
import test from "node:test";
import {
  checkWhisperService,
  TranscriptionError,
  VOICE_LIMITS,
  createTelegramVoiceTranscriber,
  transcribeMeetingAudio,
  transcribeTelegramVoice,
  whisperTransportTimeouts
} from "../src/transcription.js";

const validVoice = Object.freeze({
  file_id: "telegram-file-id",
  file_size: 4,
  duration: 12,
  mime_type: "audio/ogg; codecs=opus"
});

function jsonResponse(payload, init) {
  return new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

function validOptions(overrides = {}) {
  return {
    whisperEndpoint: "http://127.0.0.1:8080/inference",
    getFile: async () => ({ file_path: "voice/file-1.ogg", file_size: 4 }),
    downloadFile: async () => new Uint8Array([1, 2, 3, 4]),
    fetchImpl: async () => jsonResponse({ text: "Meeting next Wednesday at three" }),
    ...overrides
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof TranscriptionError);
    assert.equal(error.code, code);
    assert.equal(typeof error.retryable, "boolean");
    assert.deepEqual(Object.keys(error.toJSON()), ["name", "code", "message", "retryable"]);
    return true;
  });
}

test("metadata limits reject before Telegram file lookup or download", async (context) => {
  const cases = [
    ["zero size", { ...validVoice, file_size: 0 }, "INVALID_VOICE_METADATA"],
    ["too short", { ...validVoice, duration: 0.99 }, "VOICE_TOO_SHORT"],
    ["too long", { ...validVoice, duration: 120.01 }, "VOICE_TOO_LONG"],
    ["too large", { ...validVoice, file_size: VOICE_LIMITS.maxBytes + 1 }, "VOICE_TOO_LARGE"],
    ["wrong MIME", { ...validVoice, mime_type: "text/plain" }, "UNSUPPORTED_AUDIO_TYPE"]
  ];

  for (const [name, voice, code] of cases) {
    await context.test(name, async () => {
      let calls = 0;
      const options = validOptions({
        getFile: async () => {
          calls += 1;
          return { file_path: "voice/file.ogg" };
        },
        downloadFile: async () => {
          calls += 1;
          return new Uint8Array([1]);
        }
      });
      await expectCode(transcribeTelegramVoice(voice, options), code);
      assert.equal(calls, 0);
    });
  }
});

test("an optional Telegram file size is accepted and bounded after lookup/download", async () => {
  const text = await transcribeTelegramVoice(
    { ...validVoice, file_size: undefined },
    validOptions({ getFile: async () => ({ file_path: "voice/file.ogg" }) })
  );
  assert.equal(text, "Meeting next Wednesday at three");
});

test("duration and size limits are inclusive at their documented boundaries", async () => {
  for (const duration of [VOICE_LIMITS.minDurationSeconds, VOICE_LIMITS.maxDurationSeconds]) {
    const text = await transcribeTelegramVoice({
      ...validVoice,
      duration,
      file_size: VOICE_LIMITS.maxBytes
    }, validOptions({
      getFile: async () => ({ file_path: "voice/file.ogg" })
    }));
    assert.equal(text, "Meeting next Wednesday at three");
  }
});

test("the supported private audio MIME families are accepted", async () => {
  const supported = [
    "audio/ogg",
    "audio/opus",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/mpeg",
    "audio/wav",
    "audio/wave",
    "audio/x-wav"
  ];
  for (const mime_type of supported) {
    const text = await transcribeTelegramVoice({ ...validVoice, mime_type }, validOptions());
    assert.equal(text, "Meeting next Wednesday at three");
  }
});

test("Telegram's resolved size is checked again before download", async () => {
  let downloaded = false;
  await expectCode(transcribeTelegramVoice(validVoice, validOptions({
    getFile: async () => ({
      file_path: "voice/file.ogg",
      file_size: VOICE_LIMITS.maxBytes + 1
    }),
    downloadFile: async () => {
      downloaded = true;
      return new Uint8Array([1]);
    }
  })), "VOICE_TOO_LARGE");
  assert.equal(downloaded, false);
});

test("actual downloaded bytes are bounded even when metadata is smaller", async () => {
  let whisperCalled = false;
  await expectCode(transcribeTelegramVoice(validVoice, validOptions({
    downloadFile: async () => new Uint8Array(VOICE_LIMITS.maxBytes + 1),
    fetchImpl: async () => {
      whisperCalled = true;
      return jsonResponse({ text: "should not run" });
    }
  })), "VOICE_DOWNLOAD_TOO_LARGE");
  assert.equal(whisperCalled, false);
});

test("empty downloaded audio is rejected", async () => {
  await expectCode(transcribeTelegramVoice(validVoice, validOptions({
    downloadFile: async () => new Uint8Array()
  })), "VOICE_AUDIO_EMPTY");
});

test("token-bearing adapter failures and URLs are never exposed", async () => {
  const secret = "123456:telegram-secret";
  await expectCode(transcribeTelegramVoice(validVoice, validOptions({
    getFile: async () => {
      throw new Error(`request failed at https://api.telegram.org/bot${secret}/getFile`);
    }
  })), "TELEGRAM_FILE_UNAVAILABLE");

  try {
    await transcribeTelegramVoice(validVoice, validOptions({
      getFile: async () => ({
        file_path: `https://api.telegram.org/file/bot${secret}/voice.ogg`
      })
    }));
    assert.fail("expected a safe-path rejection");
  } catch (error) {
    assert.equal(error.code, "TELEGRAM_FILE_UNAVAILABLE");
    assert.doesNotMatch(error.message, /telegram-secret|api\.telegram\.org/);
    assert.doesNotMatch(JSON.stringify(error), /telegram-secret|api\.telegram\.org/);
  }
});

test("only a configured loopback Whisper endpoint is allowed", async () => {
  for (const whisperEndpoint of [
    "https://transcription.example.com/inference?token=secret",
    "http://127.evil.example/inference"
  ]) {
    let telegramCalled = false;
    await expectCode(transcribeTelegramVoice(validVoice, validOptions({
      whisperEndpoint,
      getFile: async () => {
        telegramCalled = true;
        return { file_path: "voice/file.ogg" };
      }
    })), "INVALID_WHISPER_ENDPOINT");
    assert.equal(telegramCalled, false);
  }
});

test("Whisper preflight checks the private root before a meeting upload", async () => {
  let request;
  const ready = await checkWhisperService({
    whisperEndpoint: "http://127.0.0.1:8080/inference?private=value",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new globalThis.Response("ready", { status: 200 });
    }
  });
  assert.equal(ready, true);
  assert.equal(request.url, "http://127.0.0.1:8080/");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.signal.aborted, false);
});

test("Whisper preflight fails quickly and sanitizes an offline worker", async () => {
  await expectCode(checkWhisperService({
    whisperEndpoint: "http://127.0.0.1:8080/inference",
    timeoutMs: 10,
    fetchImpl: async () => new Promise(() => {})
  }), "TRANSCRIPTION_UNAVAILABLE");
  await expectCode(checkWhisperService({
    whisperEndpoint: "http://127.0.0.1:8080/inference",
    fetchImpl: async () => {
      throw new Error("private connection details");
    }
  }), "TRANSCRIPTION_UNAVAILABLE");
});

test("Whisper timeout aborts with a retryable sanitized error", async () => {
  await expectCode(transcribeTelegramVoice(validVoice, validOptions({
    transcriptionTimeoutMs: 10,
    fetchImpl: async () => new Promise(() => {})
  })), "TRANSCRIPTION_TIMEOUT");
});

test("long meetings override Node's five-minute response-header timeout", () => {
  const thirtyMinutes = 30 * 60_000;
  const transport = whisperTransportTimeouts(thirtyMinutes);
  assert.equal(transport.headersTimeout, thirtyMinutes + 5_000);
  assert.equal(transport.bodyTimeout, thirtyMinutes + 5_000);
  assert.ok(transport.headersTimeout > 300_000);
  assert.equal(transport.connectTimeout, 10_000);
});

test("Whisper provider bodies are not surfaced on HTTP failure", async () => {
  const providerSecret = "provider-secret-body";
  try {
    await transcribeTelegramVoice(validVoice, validOptions({
      fetchImpl: async () => new globalThis.Response(providerSecret, { status: 503 })
    }));
    assert.fail("expected provider failure");
  } catch (error) {
    assert.equal(error.code, "TRANSCRIPTION_UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /provider-secret-body|503/);
    assert.doesNotMatch(JSON.stringify(error), /provider-secret-body|503/);
  }
});

test("invalid, missing, and empty transcription responses are rejected", async (context) => {
  await context.test("invalid JSON", async () => {
    await expectCode(transcribeTelegramVoice(validVoice, validOptions({
      fetchImpl: async () => new globalThis.Response("not json")
    })), "TRANSCRIPTION_INVALID_RESPONSE");
  });
  await context.test("missing text", async () => {
    await expectCode(transcribeTelegramVoice(validVoice, validOptions({
      fetchImpl: async () => jsonResponse({ model: "whisper" })
    })), "TRANSCRIPTION_INVALID_RESPONSE");
  });
  await context.test("empty text", async () => {
    await expectCode(transcribeTelegramVoice(validVoice, validOptions({
      fetchImpl: async () => jsonResponse({ text: "  \n  " })
    })), "TRANSCRIPT_EMPTY");
  });
});

test("transcripts have a hard caller-tightenable character bound", async () => {
  await expectCode(transcribeTelegramVoice(validVoice, validOptions({
    maxTranscriptChars: 8,
    fetchImpl: async () => jsonResponse({ text: "nine chars" })
  })), "TRANSCRIPT_TOO_LONG");
});

test("successful transcription sends bounded audio to whisper.cpp multipart fields", async () => {
  const calls = [];
  const transcribe = createTelegramVoiceTranscriber(validOptions({
    getFile: async (fileId, { signal }) => {
      calls.push(["get", fileId]);
      assert.equal(signal.aborted, false);
      return { file_path: "voice/opaque-file.ogg", file_size: 4 };
    },
    downloadFile: async (filePath, { signal, maxBytes }) => {
      calls.push(["download", filePath]);
      assert.equal(filePath, "voice/opaque-file.ogg");
      assert.equal(maxBytes, VOICE_LIMITS.maxBytes);
      assert.equal(signal.aborted, false);
      return new Uint8Array([1, 2, 3, 4]);
    },
    fetchImpl: async (url, request) => {
      calls.push(["whisper", url]);
      assert.equal(url, "http://127.0.0.1:8080/inference");
      assert.equal(request.method, "POST");
      assert.equal(request.signal.aborted, false);
      assert.ok(request.body instanceof FormData);
      assert.equal(request.body.get("response_format"), "json");
      assert.equal(request.body.get("language"), "auto");
      const audio = request.body.get("file");
      assert.ok(audio instanceof Blob);
      assert.equal(audio.size, 4);
      assert.equal(audio.type, "audio/ogg");
      assert.equal(audio.name, "voice.ogg");
      return jsonResponse({ text: "  جلسه چهارشنبه\nساعت سه  " });
    }
  }));

  const text = await transcribe(validVoice);
  assert.equal(text, "جلسه چهارشنبه ساعت سه");
  assert.deepEqual(calls, [
    ["get", "telegram-file-id"],
    ["download", "voice/opaque-file.ogg"],
    ["whisper", "http://127.0.0.1:8080/inference"]
  ]);
});

test("whisper.cpp segment arrays are extracted into one bounded transcript", async () => {
  const text = await transcribeTelegramVoice(validVoice, validOptions({
    fetchImpl: async () => jsonResponse({
      segments: [{ text: "Book the meeting" }, { text: "next Wednesday" }]
    })
  }));
  assert.equal(text, "Book the meeting next Wednesday");
});

test("long-form Film Room audio passes an explicit Farsi language hint to Whisper", async () => {
  let uploaded;
  const text = await transcribeMeetingAudio(new Uint8Array([1, 2, 3, 4, 5]), {
    mimeType: "audio/webm; codecs=opus",
    language: "fa",
    whisperEndpoint: "http://127.0.0.1:8080/inference",
    fetchImpl: async (_url, request) => {
      uploaded = request.body.get("file");
      assert.equal(request.body.get("language"), "fa");
      assert.equal(request.body.get("response_format"), "json");
      return jsonResponse({ text: "  قرار شد فردا نسخه نهایی را بفرستیم.\n\nبودجه هنوز مشخص نیست.  " });
    }
  });
  assert.equal(uploaded.type, "audio/webm");
  assert.equal(uploaded.name, "voice.webm");
  assert.equal(text, "قرار شد فردا نسخه نهایی را بفرستیم.\n\nبودجه هنوز مشخص نیست.");
});

test("Film Room groups adjacent Whisper segments into readable paragraphs", async () => {
  const firstParagraph = "بخش اول ".repeat(45).trim();
  const secondParagraph = "بخش دوم ".repeat(45).trim();
  const text = await transcribeMeetingAudio(new Uint8Array([1, 2, 3]), {
    mimeType: "audio/mpeg",
    language: "fa",
    whisperEndpoint: "http://127.0.0.1:8080/inference",
    fetchImpl: async () => jsonResponse({
      text: "این بخش اول است. این بخش دوم است.",
      segments: [
        { start: 0, end: 8, text: `  ${firstParagraph}  ` },
        { start: 8, end: 14, text: `  ${secondParagraph}  ` }
      ]
    })
  });
  assert.equal(text, `${firstParagraph}\n\n${secondParagraph}`);
});

test("mixed-language Film Room audio leaves language detection to Whisper", async () => {
  await transcribeMeetingAudio(new Uint8Array([1, 2, 3]), {
    mimeType: "audio/mpeg",
    language: "mixed",
    whisperEndpoint: "http://127.0.0.1:8080/inference",
    fetchImpl: async (_url, request) => {
      assert.equal(request.body.get("language"), "auto");
      return jsonResponse({ text: "سلام, let us start." });
    }
  });
});
