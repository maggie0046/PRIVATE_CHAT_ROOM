# privateroom

A lightweight chat room written in Go: built on long-lived TCP connections, a **custom framing protocol** (4-byte length + payload), and **AES-GCM end-to-end encryption**. It supports CLI interaction, online user lists, rename, and **file upload/download**.

---

## Project Highlights

- **Reliable packet framing/deframing**: custom Frame protocol `[4-byte length][payload]`, using `io.ReadFull` plus looped writes to ensure complete send/receive.
- **Secure encrypted transport**: all communication is encrypted with **AES-GCM** over the Frame layer (nonce + ciphertext+tag).
- **Abuse protection**: max frame length `MaxFrameSize = 64MB` to avoid memory blowups from malicious sizes.
- **Friendly key input**: supports base64 / hex parsing; if invalid, falls back to `sha256(keyStr)` to generate a 32-byte key.
- **CLI experience**: client uses readline for history and nicer input.
- **File upload/download**:
  - Upload: send a `FILE|<filename>|<size>` header frame first, then stream binary frames.
  - Server stores into `uploads/` and broadcasts an upload message.
  - Download: `/download <filename>` sends the file back from server to client.
- **Core chat features**: online list, set nickname, broadcast messages, quit, etc.

---

## Bubble Tea TUI Client

Built with **Charmbracelet Bubble Tea**, using an event-driven TUI (Terminal User Interface) architecture. It stays lightweight while offering a modern IM-like experience (e.g., Slack / WeChat).

### TUI Design Highlights

- **Split screen layout**
  - Upper: message viewport
  - Lower: input box (textinput)
  - Async network messages update only the message area and do not interrupt typing

- **Event-driven model (Msg / Cmd)**
  - Network I/O runs in a separate goroutine
  - All network events flow via `channel → tea.Msg` into the UI loop
  - UI state changes only in `Update()`, avoiding race conditions

- **Consistent cross-platform UX**
  - Same behavior on macOS / Linux / Windows
  - Works in SSH, tmux, and remote server environments

- **Keyboard-friendly**
  - `Enter`: send message
  - `↑ / ↓`:
    - Input non-empty: browse input history
    - Input empty: scroll messages
  - `Ctrl+C`: safe exit

- **Command history**
  - Input history saved to a local temp file
  - After restart, history can be recalled with arrow keys
  - Behavior matches shell / readline

- **Async file transfer**
  - Upload/download runs in the background
  - UI stays responsive
  - Results shown as system messages

## Protocol Overview

### 1) Frame Packaging (solves TCP sticky/partial packets)
- Write: `[4-byte big-endian length][payload]`
- Read: read 4-byte length, then read payload (empty allowed), and validate max length (64MB).

### 2) Secure Frame (encryption layer)
- `plaintext -> AES-GCM -> WriteFrame`
- `ReadFrame -> AES-GCM decrypt -> plaintext`

---

## Quick Start (build to run)

### 0) Requirements
- Go 1.20+
- macOS / Linux / Windows

Check Go installation:
```bash
go version
```

### 1) Initialize dependencies (first run only)

If the repo already has `go.mod`:

```
go mod tidy
```

If this is a new repo and `go.mod` does not exist (run once only):

```
go mod init goLearning
go mod tidy
```

------

### 2) Build

```
mkdir -p bin

go build -o bin/server ./cmd/server
go build -o bin/client ./cmd/client
go build -o bin/web ./cmd/web
```

------

### 3) Start the server

The server listens on a port passed via CLI args:

```
./bin/server 9000
```

On startup, the server prints a **base64 AES key** for client encryption, e.g.:

```
Server listening on :9000
AES Key (base64): <COPY_THIS_KEY>
```

✅ **Copy this key**, you will need it for the client.

------

### 4) Start the client and connect

Client args: `host port key`

```
./bin/client 127.0.0.1 9000 <COPY_THIS_KEY>
```

After connecting, you enter interactive input.

------

## Web UI (new)

Adds `cmd/web` as a web gateway and frontend page. The browser connects to the gateway via WebSocket, and the gateway forwards to the TCP chat server. AES-GCM encrypt/decrypt happens in the browser; the gateway forwards only encrypted frames.

### How to run

1) Start the server (as above) and get the AES key.

2) Start the web gateway:

```
./bin/web 8080
```

3) Open the browser:

```
http://127.0.0.1:8080
```

4) Fill in on the page:
- TCP Host/Port (server address, e.g. `127.0.0.1:9000`)
- AES Key (the key printed by the server)

### Notes and limits
- Web page supports basic chat and common commands (like `/onlineUsers`, `/setName`).
- File upload/download is not wired into the Web UI yet (still available via CLI/TUI clients).
