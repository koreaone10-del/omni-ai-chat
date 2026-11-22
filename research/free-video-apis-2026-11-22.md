# Free video-generation & image-to-image options for CHIBANI AI — research

**Date:** 22 November 2026 · **Scope:** free, open-source video generation (image-to-video first) and free image-to-image editing that can actually be wired into the CHIBANI AI site (Next.js 14, Vercel serverless, no GPU).
**Method:** web search + official docs + one anonymous probe of the Hugging Face Spaces API and the public Gradio `/gradio_api/info` endpoints of the top candidates (status + exact endpoint/parameter schemas only — no media generated, no key used, no paid endpoint called). Liveness was checked 22 Nov 2026 ~21:10 CET.

## The honest headline first

**No open-source video model can run on Vercel serverless.** Video diffusion needs a GPU and minutes of compute per clip; a Vercel serverless function has no GPU and times out (10 s Hobby / 60 s Pro). So there are only three honest architectures:

1. **Client-side call to someone else's GPU** — the browser calls a public Hugging Face ZeroGPU Space directly with `@gradio/client` (already a dependency). Free, no key, but the quota belongs to the *visitor*, is tiny, and the Space can die or queue.
2. **User-pays aggregator (Puter.js, already integrated)** — the visitor signs into their own free Puter account and spends *their* monthly allowance. This is the only route that gives adjustable size/duration/quality with a real SLA-ish experience and no server GPU.
3. **Your own GPU host (Modal $30/mo free credit, Kaggle, Colab)** — you run Wan/LTX yourself behind an API the Vercel backend calls. Real, but it is a second service to operate, and the free credit is finite.

Anything that promises "free unlimited video from the Vercel backend" is lying. The rest of this file is the evidence.

## The quota that governs everything: Hugging Face ZeroGPU

Source: https://huggingface.co/docs/hub/en/spaces-zerogpu.md (official, checked Nov 2026).

| Caller | Daily GPU quota | Queue priority |
|---|---|---|
| Unauthenticated (anonymous) | **2 minutes/day** | Low |
| Free HF account | 5 minutes/day | Medium |
| PRO ($9/mo) | 40 minutes/day | Highest |

- Quota resets exactly 24 h after first GPU use (rolling, not midnight).
- Quota is **per caller identity, not per Space**. A 5 s Wan clip costs roughly 30–90 s of GPU time, so an anonymous visitor gets **~1–3 clips/day**; a free-account visitor ~3–6.
- **Critical for CHIBANI AI:** if the *Vercel server* calls a Space, the call is anonymous and comes from one shared IP — the whole site would share **2 min/day total**. Server-side Gradio calls are therefore unusable. The call must be made **from the visitor's browser** (`@gradio/client` in the client component) so each visitor spends their own quota. (Also note: Gradio ZeroGPU accounting uses an `X-IP-Token` handshake; calls made outside a real browser session have been reported as treated as anonymous — verify at build time.)
- ZeroGPU hardware: shared NVIDIA RTX Pro 6000 Blackwell, 48 GB by default (96 GB "xlarge" at 2× quota cost). Gradio Spaces only.

## Video candidates — what was actually checked

### 1. `multimodalart/wan2-1-fast` — ✅ LIVE, RECOMMENDED (video option #1)

- Space: https://huggingface.co/spaces/multimodalart/wan2-1-fast
- Model: Wan 2.1 I2V 14B, Lightning-distilled (few-step) — best open I2V quality available free.
- **Probe 22 Nov 2026: `RUNNING`, hardware `zero-a10g`, `GET /gradio_api/info` → HTTP 200.**
- Key: none. File upload: yes (image input, `FileData` — URL, base64 or Blob via `@gradio/client`).
- Exact endpoint (from live `/gradio_api/info`): **`/generate_video`**
  - `Input Image` (Image upload, auto-resized to target H/W)
  - `Prompt` (Textbox), `Negative Prompt` (Textbox)
  - `Output Height` slider **128–896** (multiple of 32), `Output Width` slider **128–896** → aspect is fully adjustable: 16:9 ≈ 832×480, 9:16 ≈ 480×832, 1:1 ≈ 512×512
  - `Duration (seconds)` slider **0.3–3.4 s** (short! this is the Lightning-distilled limit)
  - `Guidance Scale` 0–20, `Inference Steps` 1–30 (= quality control), `Seed` 0–2147483647, `Randomize seed` checkbox
  - Returns: `Generated Video` (mp4 file) + `Seed`
- Limits: max ~3.4 s, max 896 px on a side, ZeroGPU quota above, queue when busy. 1,630 likes; last modified 2025-07-07 (stable, not abandoned).
- Source: probe + https://github.com/techfreakworm/wan-studio (reference-space study, May 2026).

### 2. `Lightricks/ltx-video-distilled` (official "LTX Video Fast") — ✅ LIVE, RECOMMENDED (video option #2)

- Space: https://huggingface.co/spaces/Lightricks/ltx-video-distilled
- Model: LTX-Video 13B distilled — the fastest open video model (real-time-class); official Lightricks Space.
- **Probe 22 Nov 2026: `RUNNING`, hardware `zero-a10g`, `GET /gradio_api/info` → HTTP 200.**
- Key: none. File upload: yes (image or video conditioning file).
- Exact endpoint (from live `/gradio_api/info`): **`/image_to_video`** (sibling endpoints `/text_to_video`, `/video_to_video` exist with the same parameter set)
  - `Prompt`, `Negative Prompt`, `Input Image` (upload)
  - `Height` slider **256–1280**, `Width` slider **256–1280** → aspect fully adjustable (16:9, 9:16, 1:1 all possible)
  - `Video Duration (seconds)` slider **0.3–8.5 s** (longest free open option found)
  - `Frames to use from input video` 9–257, `Seed`, `Randomize Seed`
  - `Guidance Scale (CFG)` 1–10, `Improve Texture (multi-scale)` checkbox (= quality control)
  - Returns: `Generated Video` + `Seed`
- Limits: ZeroGPU quota above; LTX quality is a step below Wan 2.1 14B on fine detail, but it is ~2–3× faster and reaches 8.5 s. 1,633 likes; last modified 2026-06-15.
- Source: probe + https://github.com/Lightricks/LTX-Video (official README lists this Space and the fal.ai/Replicate paid routes).

### 3. `Wan-AI/Wan2.1` (official Wan demo) — ❌ DOWN, do not use

- Space: https://huggingface.co/spaces/Wan-AI/Wan2.1
- **Probe 22 Nov 2026: runtime stage `RUNTIME_ERROR`, hardware `cpu-basic`, `GET /gradio_api/info` → HTTP 503.** The official multi-mode (T2V + I2V) demo is broken right now. Use `multimodalart/wan2-1-fast` instead. Re-check before ever linking it.

### 4. `zai-org/CogVideoX-5B-Space` (ex-`THUDM/CogVideoX-5B-Space`, renamed) — ✅ RUNNING, backup only

- Space: https://huggingface.co/spaces/zai-org/CogVideoX-5B-Space
- Model: CogVideoX-5B (T2V + I2V), Apache 2.0. Known specs: ~6 s clips, 720×480, 8 fps; needs ~12 GB VRAM quantized.
- **Probe 22 Nov 2026: `RUNNING`, hardware `zero-a10g`.** (Exact endpoint/parameter names were not pulled in this probe — verify via its `/gradio_api/info` at build time.)
- Why backup only: older (2024) model, visibly weaker motion/quality than Wan 2.1 and LTX; slower per clip.
- Source: probe + https://huggingface.co/spaces/kaidjuric/cogvideox-5b-text-to-video/blob/main/DEPLOY.md (ZeroGPU notes: free-visitor quota ~5 min/day).

### 5. Mochi-1 — ❌ no live public Space found

- Model: Genmo Mochi 1, 10B, Apache 2.0, 480p up to 5.4 s at 30 fps. Needs ~60 GB VRAM native (~20 GB optimized in ComfyUI).
- **Probe 22 Nov 2026: `genmo/mochi-1-preview` does not exist as a Space (HF API: "Invalid username or password").** No verified live Gradio demo. Usable via Genmo web playground (250 lifetime free credits ≈ 2 clips, watermarked) or paid fal.ai/Replicate. Not integrable for free.
- Source: probe + https://hypeart.ai/glossary/open-source-ai-video-generator-free/.

### 6. SkyReels V2/V3 — ❌ weights only, no live Space found

- Model: SkyworkAI SkyReels-V2 (1.3B/5B/14B, infinite-length autoregressive), V3 adds reference-to-video. 14B needs ~51 GB VRAM at 540p.
- **Probe 22 Nov 2026: `SkyworkAI/SkyReels-V2` is not a Space.** No verified live Gradio demo. Self-host only (ComfyUI nodes exist).
- Source: probe + https://github.com/SkyworkAI/SkyReels-V2.

### 7. FramePack — ❌ no HF Space; local-only

- Model: lllyasviel FramePack, 13B next-frame-prediction I2V, Apache 2.0. Famous for 60 s / 30 fps video on **6 GB VRAM** (the lowest VRAM of any quality I2V model).
- No public HF Space — it ships a local Gradio GUI (Windows one-click / pip install) only. It is the best candidate **if** a GPU host is ever rented (Modal T4, $0.59/h, would run it), because 6 GB VRAM fits the cheapest GPUs. Not integrable as-is.
- Source: https://github.com/lllyasviel/FramePack.

### 8. Open-Sora 2.0 — ❌ weights only

- Model: hpcaitech Open-Sora, 11B, Apache 2.0. T2V/I2V/V2V, 2–16 s up to 720p. Inference needs 16–24 GB VRAM (60 GB at 768p single-GPU per the model card).
- No verified live Space. Self-host only.
- Source: https://github.com/hpcaitech/Open-Sora.

### 9. Pyramid Flow — ❌ weights only

- Model: Pyramid Flow, up to 10 s at 768p/24 fps (5 s at 384p checkpoint). No verified live Space; self-host only.
- Source: https://github.com/jy0205/Pyramid-Flow (via awesome-video-generation list).

### 10. Stable Video Diffusion (SVD / SVD-XT) — ⚠️ superseded, no maintained live Space verified

- Model: Stability AI SVD, 25 frames at 576×1024. Older (2023–24), short clips, weaker than Wan/LTX. Community Spaces exist but none was verified live in this probe; do not build on it.
- Source: https://convly.ai/hugging-face-image-to-video/ (updated 2026-11-09).

### 11. AnimateDiff — ⚠️ superseded

- Older motion-module approach, short low-res clips, no verified live I2V Space. Superseded by Wan/LTX for this use. Not recommended.

### 12. Wan 2.2 family — exists, not probed

- Wan 2.2 I2V-A14B (720p, 5 s, Apache 2.0) is the current quality leader, and community Spaces exist (e.g. `multimodalart/wan-2-2-first-last-frame` for first-last-frame, per the wan-studio study). Not probed live in this round — worth a 2-minute probe at build time as a possible upgrade over wan2-1-fast, but wan2-1-fast is the verified one today.

## Non-Space video routes

### Puter.js `puter.ai.txt2vid()` — ✅ ALREADY INTEGRATED, best real-world option

- Docs: https://docs.puter.com/AI/txt2vid/ (read 22 Nov 2026).
- Status: live and actively developed. **Sora was retired 2026-09-24** (OpenAI shut the Sora Videos API); default model is now **Veo 3.1 Lite** on Gemini (`veo-3.1-lite-generate-preview`). Catalog refreshed Sep 2026 (PR HeyPuter/puter #3828).
- **Image-to-video: YES, on every provider** — `input_reference` (Blob/File/URL/data-URI) starts the clip from an image; `last_frame` sets the end frame; `reference_images[]` keeps subjects/style consistent.
- Adjustable params (unified option names across providers): `size` as `'WIDTHxHEIGHT'` (e.g. `'1280x720'`; aliases `resolution`/`width`/`height`), `seconds` (alias `duration`; each model has a fixed supported set, unsupported values fall back to the model default), `model`, `provider`, `generate_audio` (Seedance/Kling/Together audio models), `test_mode` (returns a sample clip, **spends no credits** — use it for UI testing), `puter_output_path` (saves the mp4 to the user's Puter drive; provider URLs are temporary).
- Useful models (Nov 2026): default `togetherai:wan-ai/wan2.7-t2v` (Wan 2.7, open-weight); `byteplus/seedance-2.5` / Seedance 2.0 (up to 4K, 15 s, image+video+audio refs); `vidu/vidu-q3-turbo` (I2V up to 16 s, 360p–1080p, motion intensity); `pixverse/pixverse-v6` (1–15 s, 360p–1080p); Veo 3.1 Lite/Fast (Gemini); Kling 3.0 / MiniMax.
- Cost model — **user-pays, NOT free**: every successful generation consumes the *visitor's* Puter AI credits (free monthly allowance per account; Puter does not publish the amount; community testing puts a soft cap around ~100 requests/account/day, error `usage-limited`). Free accounts: 30 req/10 s, 3 concurrent. When the balance can't cover the requested length, Puter **silently shortens the clip** to fit — read `video.duration` after load. Failures/timeouts are not charged. Puter waits up to 14 min per job.
- Limits for CHIBANI AI: each visitor must sign into a Puter account (friction, but the same deal as the already-integrated Puter image path); "free" means the *site* pays $0, not that clips are unlimited. This is still the best video UX available: real aspect/size/duration controls, I2V, no server GPU, no keys to manage.
- Source: https://docs.puter.com/AI/txt2vid/, https://developer.puter.com/ai/vidu/vidu-q3-turbo/, https://github.com/HeyPuter/puter/pull/3828, https://a2agent.me/blog/free-ai-api-guide-2026.

### fal.ai — paid, no standing free tier

- No free tier on the published pricing page (checked 10–16 Nov 2026 by multiple trackers). Some older guides report **$10 signup/trial credits** — unpublished and unverified on fal's own pages; treat as "maybe, once".
- Prices (Nov 2026): Wan 2.5 video $0.05/s; Wan I2V ~$0.20 (480p) / $0.40 (720p) per ~5 s clip; Kling 2.5 Turbo Pro I2V $0.07/s; Seedance 2.0/2.5 from ~$0.014/1k tokens. Endpoints e.g. `fal-ai/ltx-video/image-to-video`, `fal-ai/wan-i2v`.
- Note: **fal deprecated Veo 3.1 on 17 Nov 2026** (established in the site's earlier research) — the fal Veo path may already be dead; do not rely on it.
- Verdict: the cheapest *paid* route and the right one if the user ever funds video with USDT revenue — but it is not free, and it needs a fal key in Vercel env vars.
- Source: https://fal.ai/pricing, https://aitrendtool.com/compare/fal-vs-replicate, https://youraitools.co/compare/fal-vs-replicate.

### Replicate — paid, no standing free tier

- No free tier on the published pricing page. "Select public models run free until Replicate asks you to add billing" (unpublished, temporary).
- Prices: Wan 2.1 I2V 720p $0.25/s of output; FLUX schnell $0.003/image; hardware T4 $0.81/h → H100 $5.49/h.
- Verdict: best async job API (prediction ID + polling/webhook, which fits Vercel's timeouts better than any other paid host), but paid from the first real clip.
- Source: https://replicate.com/pricing (via https://youraitools.co/compare/fal-vs-replicate).

### Modal — the real free GPU host ($30/month recurring credit)

- Starter plan: **$30 of compute credit every month, recurring**, billed per second. At list rates that's ≈ 50 h T4 ($0.59/h), ≈ 37 h L4, ≈ 27 h A10, ≈ 14 h A100-40GB, ≈ 7.6 h H100. 10 concurrent GPUs, 100 containers on Starter.
- This is the only free route that lets *you* run Wan 2.1/2.2, LTX or FramePack behind your own API endpoint that Vercel can call (with a job queue, since a clip takes minutes). A T4 ($0.59/h) runs FramePack or Wan 2.1-I2V-1.3B; an A10/L4 runs the 14B models.
- Catch: code-first serverless (Python decorators), not a notebook; credit is finite and shared across the whole site's users; needs a Modal account + token in Vercel env vars; you operate a second service.
- Verdict: the honest "free GPU backend" answer — but it is a project, not a toggle. Budget ~1 day to build a Modal endpoint + Vercel polling route.
- Source: https://modal.com/pricing (via https://gpuperhour.com/blog/free-cloud-gpus-and-credits, https://aisotools.com/blog/free-google-colab-alternatives-2026, checked Sep–Oct 2026).

### Google Colab (free) — not usable as a site backend

- Free tier: unpublished quota ("heavily restricted", GPU not guaranteed, usually T4), sessions max 12 h, idle timeouts. **Colab's terms prohibit running web UIs/servers as a service on the free tier.** Good for prototyping a pipeline once, useless as CHIBANI AI's backend.
- Source: https://gpuperhour.com/blog/free-cloud-gpus-and-credits.

### Kaggle Notebooks — 30 GPU-hours/week, also not a backend

- Free T4/P100 GPUs, **30 GPU-hours/week** published quota, sessions up to 9–12 h. Notebooks, not an always-on API. Useful for batch-rendering test clips, not for serving site users.
- Source: https://www.kaggle.com/docs/efficient-gpu-usage (via https://aisotools.com/blog/free-google-colab-alternatives-2026).

### Hugging Face Inference Providers — free accounts get $0

- **As of Oct 2026, free HF accounts get NO monthly inference credits** ("None" on the pricing page; PRO $9/mo gets $2/mo). Every routed call is pay-as-you-go after buying credits. Video is served via the fal-ai provider at ~$0.25/video. Not a free route.
- Source: https://huggingface.co/docs/inference-providers/pricing (via https://blog.laozhang.ai/en/posts/free-ai-image-generation-api and https://aionx.co/ai-comparisons/huggingface-inference-api/, Oct 2026).

### FreeLLMAPI catalog — no video or image models

- Fetched https://freellmapi.co/models 22 Nov 2026: **487 models across 52 providers**, described as "a free LLM API… one OpenAI-compatible key" for **chat/vision LLMs** (filters: tools, vision). The word "video" does not appear anywhere on the fetched catalog page, and no image-generation model is listed. FreeLLMAPI is an LLM router; it has no video-generation or image-generation models to integrate. (The site's earlier v2.0 plan to list "all 393 models" is a chat-model list — do not expect video/image models from it.)
- Source: https://freellmapi.co/models (fetched 22 Nov 2026).

## Image-to-image (reference-image edit) endpoints

### 1. `Qwen/Qwen-Image-Edit` (official) — ✅ LIVE, RECOMMENDED (img2img #1)

- Space: https://huggingface.co/spaces/Qwen/Qwen-Image-Edit
- Model: Qwen-Image-Edit (2511 generation), **Apache 2.0**, strongest open editor for text rendering + multi-image editing.
- **Probe 22 Nov 2026: `RUNNING`, hardware `zero-a10g`, `GET /gradio_api/info` → HTTP 200.**
- Key: none. File upload: yes.
- Exact endpoint (from live `/gradio_api/info`): **`/infer`**
  - `Input Image` (upload), `Prompt` (edit instruction), `Seed` (0–2147483647), `Randomize seed`
  - `True guidance scale` 1–10, `Number of inference steps` 1–50 (= quality control), `Rewrite prompt` checkbox
  - Returns: `Result` image + `Seed`
- Limits: ZeroGPU quota above (an edit is typically 10–30 s GPU → ~10–20 edits/day per anonymous visitor, fewer on xlarge); queue when busy.
- Also available via HF Inference Providers (`client.image_to_image(..., model="Qwen/Qwen-Image-Edit", provider="fal-ai")`) — but that route is paid (see above).
- Source: probe + https://huggingface.co/docs/inference-providers/guides/image-editor.

### 2. `black-forest-labs/FLUX.1-Kontext-Dev` (official) — ✅ listed RUNNING, RECOMMENDED (img2img #2)

- Space: https://huggingface.co/spaces/black-forest-labs/FLUX.1-Kontext-Dev
- Model: FLUX.1 Kontext dev — in-context editing, best character/style consistency across repeated edits.
- Status: listed as **Running** in the HF leaderboard dataset (updated ~3 days before this research); demo has upload + prompt + guidance (~2.5 default) + steps (~28 default) + seed controls. (Endpoint/parameter names not pulled in this probe — verify via its `/gradio_api/info` at build time.)
- Key: none. File upload: yes. License: **FLUX.1-dev Non-Commercial** — commercial use needs a separate licence from Black Forest Labs; fine for a free site, flag it if the site ever monetises edits.
- Limits: ZeroGPU quota above.
- Source: https://huggingface.co/spaces/black-forest-labs/FLUX.1-Kontext-Dev, https://imagetoolkit.org/ai-image-tools/flux-1-kontext, https://acta.ai/blogs/build-an-ai-image-editor-image-text-to-image.

### 3. `timbrooks/instruct-pix2pix` — ✅ RUNNING, legacy only

- Space: https://huggingface.co/spaces/timbrooks/instruct-pix2pix
- Model: InstructPix2Pix (2023), the original instruction editor. **Probe 22 Nov 2026: `RUNNING`, `zero-a10g`.** Works, but quality is far behind Qwen-Image-Edit and Kontext. Keep only as a fallback.
- Source: probe.

### 4. Cloudflare Workers AI — already integrated for text-to-image; no img2img

- The site's live image path (`@cf/black-forest-labs/flux-1-schnell`, 10,000 neurons/day free) is **text-to-image only** — Cloudflare offers no image-editing model. Do not expect img2img from it.
- Source: site's own `research/free-media-apis-2026-11-22.md`.

### 5. Puter.js image editing — already integrated, worth wiring up

- BytePlus **Seedream** models on Puter do generation *and* editing in one model (multiple reference images, up to 4K output) via `puter.ai.txt2img()` with an input image; Nano Banana / Gemini image models on Puter also edit from a reference image. Same user-pays deal as txt2vid: visitor's Puter allowance, no site key. This is the lowest-friction img2img path because Puter auth is already in the site.
- Source: https://developer.puter.com/blog/puter-byteplus-announcement/.

### 6. Pollinations — documented only, DO NOT re-add

- Pollinations (`image.pollinations.ai`) offers free anonymous image generation/editing endpoints. The user **explicitly rejected Pollinations for images before** — it is recorded here only so the option is documented, and it is **not recommended** and must not be re-added without the user asking for it.
- Source: site history (MEMORY.md).

## Ranked recommendation

### Video — integrate in this order

**#1 — Puter.js `txt2vid` (already integrated — extend it, don't rebuild it).**
Add an image-upload field that passes the image as `input_reference`, plus `size` (`'1280x720'` / `'720x1280'` / `'1024x1024'` presets for 16:9 / 9:16 / 1:1), `seconds` (model-supported durations), and a model picker defaulting to `togetherai:wan-ai/wan2.7-t2v` with Seedance 2.5 and Veo 3.1 Lite as paid-quality alternates. It is the only option that gives the user everything they asked for (reference image, aspect, duration, quality tiers) with no server GPU, no keys, and honest per-user limits. Cost: $0 to the site; visitors spend their own free Puter allowance. Add a clear "uses your Puter account" note + `test_mode: true` for UI testing (free sample clip).

**#2 — `multimodalart/wan2-1-fast` via `@gradio/client`, called from the browser.**
The truly-free, no-account fallback. Exact call: `Client.connect("multimodalart/wan2-1-fast")` → `client.predict("/generate_video", [imageBlob, prompt, height, width, negativePrompt, durationSeconds, guidanceScale, steps, seed, randomizeSeed])`. Map aspect presets to H/W (16:9 → 832×480, 9:16 → 480×832, 1:1 → 512×512), duration slider 0.5–3.4 s, steps slider 4–30 as the "quality" control. Show the ZeroGPU reality in the UI ("~1–3 free clips/day, no account — sign into Hugging Face for more"). Keep as a second tab/button next to Puter, not the default, because it will queue and fail when the visitor's quota is spent.

**#2b — `Lightricks/ltx-video-distilled` `/image_to_video`** as the alternate Space when wan2-1-fast is busy or the user wants up to 8.5 s: `client.predict("/image_to_video", [prompt, negativePrompt, imageBlob, "", height, width, "image-to-video", durationSeconds, 9, seed, true, guidanceScale, improveTexture])` — verify argument order against `/gradio_api/info` at build time (the hidden `video_i`/`image_n` string params are positional placeholders).

**Do NOT build on:** `Wan-AI/Wan2.1` (down — `RUNTIME_ERROR`/503 on 22 Nov 2026). Do not route Gradio calls through a Vercel API route (shared anonymous 2 min/day quota + function timeout). Do not present fal.ai/Replicate as free — they are paid ($0.05–0.25/s); only add them later behind the USDT subscription if the user funds it.

**If the user ever wants a real free backend:** Modal, $30/mo recurring credit — run FramePack (fits a cheap T4) or Wan 2.1-I2V behind a Modal endpoint + a Vercel polling route. ~1 day of work, finite credit, a second service to operate.

### Image-to-image — integrate in this order

**#1 — `Qwen/Qwen-Image-Edit` via `@gradio/client`, browser-side.**
Exact call: `Client.connect("Qwen/Qwen-Image-Edit")` → `client.predict("/infer", [imageBlob, prompt, seed, randomizeSeed, trueGuidanceScale, steps, rewritePrompt])`. Steps 1–50 is the quality control; guidance 1–10. Apache 2.0, best open editor, verified RUNNING 22 Nov 2026.

**#2 — Puter image editing (Seedream / Nano Banana via `txt2img` with reference image)** as the no-quota-friction alternate, since Puter auth is already in the site.

**#3 — `black-forest-labs/FLUX.1-Kontext-Dev`** as a second Space fallback (verify its `/gradio_api/info` endpoint names at build time; note the non-commercial licence).

## Integration notes for the builder

- **Client-side only for Gradio.** `new Client(...)` / `client.predict()` must run in a client component; a Vercel route handler would (a) time out on a minutes-long generation and (b) burn the single anonymous 2 min/day ZeroGPU quota for all users. Upload the user's image as a `Blob`/`File` — `@gradio/client` accepts it for `Image` inputs.
- **Long jobs need polling UX.** Gradio `predict()` is async with queue updates — surface queue position/progress, not a spinner. Puter `txt2vid` resolves after up to 14 min — same treatment.
- **Map the user's controls to real params:** aspect → H/W sliders (Wan) or H/W + `size` (Puter); duration → `Duration` slider (Wan 0.3–3.4 s; LTX 0.3–8.5 s) or `seconds` (Puter); quality → `Inference Steps` (Wan 1–30; Qwen-Edit 1–50) / `Improve Texture` (LTX) / model tier (Puter).
- **Honest UI copy:** show remaining-quota behaviour ("free clips are limited per day by Hugging Face / by your Puter account") and the fallback order (Puter → Wan Space → LTX Space) instead of a fake "unlimited" label.
- **Verify at build time:** re-probe `/gradio_api/info` for `multimodalart/wan2-1-fast`, `Lightricks/ltx-video-distilled`, `Qwen/Qwen-Image-Edit` (argument order can shift when Spaces update), confirm CORS from the browser origin, and re-check `Wan-AI/Wan2.1` — Spaces change state without notice.

## Sources

- HF ZeroGPU docs: https://huggingface.co/docs/hub/en/spaces-zerogpu.md
- HF Inference Providers pricing: https://huggingface.co/docs/inference-providers/pricing
- HF image-editor guide: https://huggingface.co/docs/inference-providers/guides/image-editor
- Puter txt2vid docs: https://docs.puter.com/AI/txt2vid/
- Puter rate limits/quotas: https://github.com/madskid/puter/blob/HEAD/src/docs/src/rate-limits-and-quotas.md
- Puter catalog refresh (Sora retired, Veo 3.1 Lite default): https://github.com/HeyPuter/puter/pull/3828
- Puter BytePlus (Seedance/Seedream): https://developer.puter.com/blog/puter-byteplus-announcement/
- FreeLLMAPI catalog: https://freellmapi.co/models
- fal vs Replicate pricing (Nov 2026): https://aitrendtool.com/compare/fal-vs-replicate, https://youraitools.co/compare/fal-vs-replicate
- Free GPU landscape (Modal $30/mo, Kaggle 30 h/wk, Colab limits): https://gpuperhour.com/blog/free-cloud-gpus-and-credits, https://aisotools.com/blog/free-google-colab-alternatives-2026
- HF free-tier changes (Oct 2026): https://blog.laozhang.ai/en/posts/free-ai-image-generation-api, https://aionx.co/ai-comparisons/huggingface-inference-api/
- Video-model landscape: https://hypeart.ai/glossary/open-source-ai-video-generator-free/, https://convly.ai/hugging-face-image-to-video/, https://news.hamidun.com/en/news/8286/google-kling-and-yandex-where-to-generate-ai-video-for-free
- LTX-Video repo: https://github.com/Lightricks/LTX-Video
- Wan reference-space study: https://github.com/techfreakworm/wan-studio/blob/HEAD/raw/05_ux_patterns.md
- FLUX Kontext editor guide: https://acta.ai/blogs/build-an-ai-image-editor-image-text-to-image
- Free-API quotas roundup: https://a2agent.me/blog/free-ai-api-guide-2026
- Live probes (22 Nov 2026 ~21:10 CET): `huggingface.co/api/spaces/{Wan-AI/Wan2.1, multimodalart/wan2-1-fast, Lightricks/ltx-video-distilled, zai-org/CogVideoX-5B-Space, Qwen/Qwen-Image-Edit, timbrooks/instruct-pix2pix}` + `{wan-ai-wan2-1, multimodalart-wan2-1-fast, lightricks-ltx-video-distilled, qwen-qwen-image-edit}.hf.space/gradio_api/info`
