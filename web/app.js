const statusEl = document.getElementById("status");
const connectForm = document.getElementById("connect-form");
const hostInput = document.getElementById("host");
const portInput = document.getElementById("port");
const keyInput = document.getElementById("key");
const nameInput = document.getElementById("name");
const messagesEl = document.getElementById("messages");
const composer = document.getElementById("composer");
const inputEl = document.getElementById("input");
const disconnectBtn = document.getElementById("disconnect");

let ws = null;
let cryptoKey = null;
let pendingName = "";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.style.background = ok
    ? "rgba(28, 109, 112, 0.2)"
    : "rgba(255, 255, 255, 0.7)";
}

function appendMessage(text, className) {
  const div = document.createElement("div");
  div.className = `msg ${className || ""}`.trim();
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function wsUrl() {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

async function connect() {
  if (ws) {
    ws.close();
  }

  const keyStr = keyInput.value.trim();
  if (!keyStr) {
    appendMessage("[SYSTEM] AES key is required", "system");
    return;
  }
  cryptoKey = await deriveKey(keyStr);
  if (!cryptoKey) {
    appendMessage("[SYSTEM] Invalid AES key", "system");
    return;
  }
  pendingName = nameInput.value.trim();

  ws = new WebSocket(wsUrl());
  setStatus("Connecting...", false);

  ws.addEventListener("open", () => {
    const payload = {
      type: "connect",
      host: hostInput.value.trim(),
      port: portInput.value.trim(),
    };
    ws.send(JSON.stringify(payload));
  });

  ws.addEventListener("message", async (event) => {
    let msg = null;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    if (msg.type === "status") {
      setStatus(msg.text, msg.text === "connected");
      appendMessage(`[SYSTEM] ${msg.text}`, "system");
      if (msg.text === "connected") {
        await sendEncrypted("Infernity");
        if (pendingName) {
          await sendEncrypted(`/setName ${pendingName}`);
        }
      }
      return;
    }

    if (msg.type === "error") {
      setStatus("Disconnected", false);
      appendMessage(`[ERROR] ${msg.text}`, "system");
      return;
    }

    if (msg.type === "frame") {
      const raw = base64ToBytes(msg.data || "");
      if (!raw) {
        appendMessage("[SYSTEM] Bad frame data", "system");
        return;
      }
      const text = await decryptMessage(raw);
      if (text === null) {
        appendMessage("[SYSTEM] Decrypt failed", "system");
        return;
      }
      const isSystem = text.startsWith("[SYSTEM]");
      appendMessage(text, isSystem ? "system" : "");
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected", false);
  });
}

connectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  connect();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) {
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    appendMessage("[SYSTEM] Not connected", "system");
    return;
  }
  await sendEncrypted(text);
  appendMessage(`You: ${text}`, "mine");
  inputEl.value = "";
  inputEl.focus();
});

disconnectBtn.addEventListener("click", () => {
  if (ws) {
    ws.close();
    ws = null;
    setStatus("Disconnected", false);
  }
});

setStatus("Disconnected", false);

async function sendEncrypted(text) {
  if (!cryptoKey || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const enc = await encryptMessage(text);
  if (!enc) {
    appendMessage("[SYSTEM] Encrypt failed", "system");
    return;
  }
  ws.send(
    JSON.stringify({
      type: "frame",
      data: bytesToBase64(enc),
    })
  );
}

async function deriveKey(keyStr) {
  const base = tryDecodeBase64(keyStr);
  if (base && isValidKeyLength(base.length)) {
    return importKey(base);
  }
  const hex = tryDecodeHex(keyStr);
  if (hex && isValidKeyLength(hex.length)) {
    return importKey(hex);
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(keyStr)));
  return importKey(hash);
}

function isValidKeyLength(len) {
  return len === 16 || len === 24 || len === 32;
}

async function importKey(bytes) {
  try {
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } catch (err) {
    return null;
  }
}

async function encryptMessage(text) {
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = textEncoder.encode(text);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      cryptoKey,
      plaintext
    );
    return concatBytes(nonce, new Uint8Array(ciphertext));
  } catch (err) {
    return null;
  }
}

async function decryptMessage(data) {
  try {
    if (data.length < 12) {
      return null;
    }
    const nonce = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      cryptoKey,
      ciphertext
    );
    return textDecoder.decode(plaintext);
  } catch (err) {
    return null;
  }
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function tryDecodeBase64(input) {
  const cleaned = input.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned) || cleaned.length % 4 !== 0) {
    return null;
  }
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    return null;
  }
}

function tryDecodeHex(input) {
  const cleaned = input.trim();
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(input) {
  if (!input) {
    return null;
  }
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    return null;
  }
}
