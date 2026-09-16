# LLM-PingPong

A lightweight, self-contained HTML5/CSS/JavaScript interface that lets two OpenAI-compatible LLM endpoints have an automatic conversation with each other — no backend, no build step, no frameworks.

Point it at any two [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat)-compatible servers (LM Studio, `llama.cpp`'s `llama-server`, Ollama's OpenAI endpoint, vLLM, LocalAI, OpenRouter, OpenAI itself, ...) — for example LM Studio running on your desktop and `llama-server` running on another machine — and watch them talk to each other.

## Features

- **Two fully independent agents**, each with its own base URL, API key, model, system prompt, temperature and max tokens. There's no shared "provider" setting, so you can freely mix LM Studio, llama.cpp, Ollama, cloud APIs, etc.
- **Test connection** — checks that an endpoint is reachable.
- **Load models** — calls `GET {baseUrl}/models` and populates the model dropdown for you.
- **Automatic ping-pong conversation** — Agent 1's reply is fed to Agent 2 as a user message and vice versa, each with its own independent conversation history, up to a configurable number of turns with a configurable delay between turns. Start/Stop/Clear controls included.
- **Modern chat bubble UI**, with a distinct side/style per agent.
- **Settings persistence** — all fields are saved automatically to `localStorage`.
- **Per-agent Save/Load config** — export a single agent's settings (including its loaded model list) to a JSON file named `[agent name]_[model].json`, and load it back later or on another machine. Config files carry a `"pingpong": "PingPong-agent-config"` marker so random/unrelated JSON files are rejected instead of silently misapplied.

## Usage

1. Serve the folder with any static file server (opening `index.html` directly as a `file://` URL also works, but a local server avoids browser quirks). For example:

   ```bash
   python -m http.server 8123
   ```

2. Open it in a browser and fill in both agents:
   - **Base URL**, e.g. `http://192.168.1.50:1234/v1` (LM Studio) and `http://192.168.1.60:1234/v1` (llama.cpp)
   - **API key** (optional, depending on your server)
   - **Model** — click *Load models* to populate the dropdown, or type one manually
   - **System prompt**, **temperature**, **max tokens**

3. Set an **initial prompt**, **max turns** and **delay**, then hit **Start**.

## CORS note

Because everything runs client-side in the browser, the LLM server itself must allow cross-origin requests from wherever this page is served, and must be bound to a LAN-reachable address (not just `localhost`) if the page isn't served from the same machine — e.g. `llama-server --host 0.0.0.0 ...`.

## Files

- `index.html` — markup
- `style.css` — styling
- `app.js` — all application logic (no dependencies)
