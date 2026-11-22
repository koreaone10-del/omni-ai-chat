# Free Video & Image Generation for CHIBANI AI — Research Report

**Date:** 2026-11-22 · **Scope:** research only, no code changed, nothing pushed/deployed.
**Site constraints:** Next.js 14 on Vercel Hobby, serverless functions capped at 60 s.
**Current paths being replaced/augmented:** keyed provider image models → FreeLLMAPI router → HF FLUX.1-schnell Gradio Space (ZeroGPU anonymous quota exhausts from shared IPs).
**Pollinations is EXCLUDED by the user — not recommended anywhere in this report.**

## Headline finding

There is **no genuinely free, recurring, server-side video API** in November 2026. Every free video route is one of: (a) client-side with the end user paying/logging in (Puter.js), (b) a one-time signup credit, (c) a consumer app's daily credits that are **not** exposed via API, or (d) self-hosting an open model on someone else's free GPU allowance (Modal $30/mo, HF ZeroGPU minutes/day). **Images are a different story: Cloudflare Workers AI is the one clear winner** — a real recurring daily free allowance, no card, callable from a Vercel serverless function in ~1.4 s.

## Ranking (a) genuinely free · (b) works from Vercel serverless · (c) reliability

| Rank | Candidate | Free? | From Vercel fn? | Reliable? | Verdict |
|---|---|---|---|---|---|
| 1 | **Cloudflare Workers AI** (images) | ✅ 10,000 neurons/day, recurring, no card | ✅ sync REST, ~1.4 s | ✅ high | **Integrate — primary image path** |
| 2 | **Puter.js** (images + video, client-side) | ✅ $0 to developer; end user pays from own Puter allowance | ❌ browser/Node user session only, not a shared server key | ⚠️ medium (depends on Puter + user login) | **Integrate — client-side video + image fallback** |
| 3 | **Vercel AI Gateway** free credits | ⚠️ free tier exists; "$5/30 days" is secondary-source only, must verify in dashboard | ✅ same origin, OpenAI-compatible | ⚠️ unknown which image/video models are free-tier eligible | Verify before integrating |
| 4 | **Modal Starter** ($30/mo compute) for self-hosted Wan/LTX | ✅ $30/mo recurring compute, no card required to start | ⚠️ needs a Modal service + async job pattern (video takes minutes) | ⚠️ you operate it | Best long-term free-video path; real build work |
| 5 | **HF ZeroGPU Spaces as API** | ✅ 2 min/day anonymous, 5 min/day free account | ⚠️ Gradio queue, waits often >60 s | ❌ low (queue + shared-IP quota) | Fallback only, not primary |
| 6 | Luma / Runway one-time credits | ⚠️ one-time only | ✅ async REST | ⚠️ tiny | Demo/testing only |
| 7 | Novita AI | ⚠️ $0.50 one-time signup credit | ✅ REST | ⚠️ one-time | Testing only |
| — | HF Inference Providers, Together AI, Gemini image/video, fal.ai | ❌ free tier withdrawn / paid-only | — | — | **Do not integrate as "free"** |

---

## 1. Hugging Face Inference Providers — FREE TIER IS GONE

- **What it is:** router at `router.huggingface.co` fronting providers (fal, Novita, WaveSpeed, Together, hf-inference…). Text-to-image via `POST https://router.huggingface.co/{provider}/models/{model}` or OpenAI-compatible `https://router.huggingface.co/v1/...`; text-to-video models exist in the catalogue (Wan-AI/Wan2.1-T2V-14B, tencent/HunyuanVideo, Lightricks/LTX-Video, genmo/mochi-1-preview) but are served by paid providers (fal/Novita/WaveSpeed), not by hf-inference.
- **Free allowance: $0.** Verified on the official pricing page (fetched 2026-11-22): *"Free Users | None | — | yes (credits purchase required)"* and *"Free users can use Inference Providers by purchasing credits, or by upgrading to PRO."* The old $0.10/month free credit was removed 7 Oct 2026 (HF docs PR #2865). PRO ($9/mo) gets $2.00/month compute credits.
- **Key:** free HF account token with "Make calls to Inference Providers" permission — but the token alone buys nothing; credits must be purchased by card.
- **Verdict: DO NOT integrate as a free path.** Keep only if the user ever pays. The current FLUX Gradio Space path is actually the better free HF route (see §7).
- Sources: https://huggingface.co/docs/inference-providers/pricing · https://huggingface.co/docs/inference-providers/tasks/text-to-video · https://freellmcredits.com/offers/hugging-face-inference-free-tier

## 2. Puter.js — free for the developer, user-pays, client-side

- **What it is:** JS library (`<script src="https://js.puter.com/v2/">` or `npm install @heyputer/puter.js`). `puter.ai.txt2img(prompt, {model})` returns an `<img>` element; `puter.ai.txt2vid(prompt, {model})` returns a `<video>` element. Image models include `google/gemini-3.1-flash-image` (Nano Banana 2), `google/gemini-2.5-flash-image`, `black-forest-labs/flux-schnell`, `openai/gpt-image-2.6-flare`, Ideogram, Qwen-Image, FLUX.2. Video models include Vidu Q3/Q3 Turbo (up to 16 s, 1080p, native audio), Wan 2.7 (default `togetherai:wan-ai/wan2.7-t2v`), Kling, Seedance (via BytePlus), Gemini Omni, HappyHorse 1.1, PixVerse.
- **Free allowance:** **$0 to the developer at any scale — but it is NOT free to the end user.** Puter's "User-Pays" model: each user signs in with a free Puter account; calls are metered to that user's own allowance; new accounts get starter credit (amount **not published** on Puter's pricing page — unverified); heavy users pay Puter directly. Puter's own docs: *"Each successful generation consumes the user's AI credits."*
- **Can it be called from a server?** No, in any useful sense for this site. It is browser-first; `txt2vid` docs note Node.js/Workers resolve to a plain object instead of a DOM element, but auth is a **logged-in user session** — there is no service-account / shared-key mode. A Vercel serverless function has no Puter user to bill. **Integration = client-side in the Next.js page** (the user is prompted once to create/sign in to a free Puter account).
- **Latency:** video is async server-side inside Puter (renders take minutes); the promise resolves when the clip is ready — fine in a browser tab, **not** fittable in a 60 s Vercel function.
- **Verdict: integrate client-side as the free VIDEO path** (and as an image fallback), with honest UX copy: "Sign in once with a free Puter account — generations use your own free allowance." Do not present it as "unlimited free" to the user.
- Sources: https://developer.puter.com/tutorials/free-unlimited-image-generation-api/ · https://developer.puter.com/tutorials/free-unlimited-vidu-api/ · https://docs.puter.com/AI/txt2vid/ · https://developer.puter.com/pricing/

## 3. fal.ai — NO free tier

- **What it is:** queue API (`https://queue.fal.run/fal-ai/<model>` + `https://api.fal.ai/v1/models`), one key, 100+ video endpoints: Seedance 2.5, Kling v3, Veo 3.1 (deprecated on fal 17 Nov 2026 — already gone from the catalogue), MiniMax H3, Wan 3.0/2.7, LTX 2.5, HunyuanVideo, Luma Ray 3.2, PixVerse, Vidu Q3. Async: submit → poll queue → result URL.
- **Free allowance: none published.** Official pricing page lists only pay-per-use (video $0.015–$0.40/s depending on model; e.g. Veo 3.1 $0.40/s with audio, Kling 3.0 ~$0.084/s, Seedance 2.5 ~$0.22–$1.16/s). Third-party reviews note "trial credits on sign-up" but **no amount is published anywhere I could verify**; one review states flatly "there is no free tier… a person must sign up in a browser and buy credit."
- **Verdict: keep the existing fal key path as the PAID video path only. Do not present fal as free.**
- Sources: https://fal.ai/pricing · https://www.anchorterminal.com/tools/fal-video · https://www.teamday.ai/blog/fal-ai-pricing-2026

## 4. Together AI — NO free trial

- **Free allowance: none.** Together's billing docs: *"does not currently offer free trials."* Fully prepaid; **first purchase minimum $15** per organisation, later top-ups $5; credits do not expire; API stops at $0 balance. Older $5 signup credit is gone (verified by third-party trackers against Together's billing pages, Oct 2026). Some models are listed at $0 on the pricing page, but you still need the $15 purchase to access the platform.
- **Image/video prices (for reference):** FLUX.2 [dev] ~$0.0154/image; video $0.115/clip (Seedance 2.5) to $2.50 (Veo 2.0). Endpoint: OpenAI-compatible `https://api.together.xyz/v1`, key `Authorization: Bearer <key>`.
- **Verdict: do not integrate as free.** It is cheap, not free.
- Sources: https://grabaicredits.com/en/deals/together-ai-signup-credits · https://devmixa.com/software/together-ai/ · https://broadrouter.com/alternatives/together-ai-alternative/

## 5. Google Gemini API — text is free; image & video are PAID-ONLY

- **Verified on Google's official pricing page (fetched 2026-11-22):** `gemini-3.1-flash-image` (Nano Banana 2) — **Free Tier: Not available**; paid $0.50/1M input tokens, image output $60/1M tokens = **$0.067 per 1K image** ($0.045/0.5K, $0.101/2K, $0.151/4K). `gemini-3.1-flash-lite-image` — Free Tier: Not available; $0.0336 per 1K image. Same "Not available" for `gemini-2.5-flash-image` and `gemini-3-pro-image`.
- **Free tier still exists, but only for text models** (Gemini 3.x Flash, 2.5 Pro/Flash/Flash-Lite, Gemma 4, embeddings). Rate limits are per-project and shown only in AI Studio, not published as fixed numbers. A Sept 2026 live test reported 429 "quota exceeded" on the first image call from a new free key.
- **Veo 3 video:** requires a billed project; no free tier. Exact per-second Veo 3.1 API price **could not be verified from Google's pricing page in this session** (no Veo section found in the fetched page); secondary sources put Veo 3.1 Standard 1080p with audio at ~$0.40/s, Fast ~$0.15/s. The Gemini app (not API) gives ~20 free images/day and 50 Flow credits/day — not usable from the site.
- **Endpoint (paid):** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent` with `x-goog-api-key` header; image returned as base64 `inlineData`. Video: `POST .../models/veo-3.1-generate-preview:predict`, async, poll `operations`.
- **Verdict: do not integrate Gemini image/video as free.** Keep the existing Gemini key path as paid-only; it will 429 on a free key.
- Sources: https://ai.google.dev/gemini-api/docs/pricing · https://www.aifreeapi.com/en/posts/gemini-image-free-tier-2026 · https://blog.picassoia.com/gemini-api-free-tier-limits-models-rate-limits-and-image-generation

## 6. Luma, Runway, Kling, Pika, Hailuo/MiniMax — consumer free tiers, (almost) no free API

| Vendor | Consumer free tier | API free tier? | API endpoint / notes |
|---|---|---|---|
| **Luma Dream Machine** | ~30 generations/mo (or ~5/day), 720p, watermarked, non-commercial | **Conflicting sources:** one API comparison says the API free tier is 30 gen/mo; another says API access requires Standard ($30/mo). **Unverified — check lumalabs.ai/pricing + API docs before integrating.** API is async REST (`api.lumalabs.ai/dream-machine/v1/generations`), models `ray-2`/`ray-flash-2`, ~$0.08/s Ray-2, ~$0.20/gen Ray-3. | https://singularitybyte.com/tools/best-free-ai-video-generator-apis-for-developers-2026.html · https://fast.io/resources/luma-ai-review-2026/ |
| **Runway** | **125 one-time credits** (not recurring), Gen-4.5 = 12 credits/s → ~10 s of video total, then paid. API credits $0.01 each. | The 125 credits are the free tier; nothing recurring. | https://testedintelligence.com/best-ai-video-generators-in-2026/ |
| **Kling** | **66 credits/day** in the consumer app (watermarked, non-commercial, 5 s/720p) | **No free tier verified for the Kling API** — the daily credits are app-only. API is paid (~$0.07/s). | https://blog.hoelee.com/posts/best-ai-video-generators-2026/ |
| **Pika** | 80 credits/mo, 480p, watermarked | No free API tier verified; API access is via brokers (fal). | https://www.layer3labs.io/comparisons/pika-labs-alternatives |
| **Hailuo / MiniMax** | Daily free credits in the app (amount varies) | No free API tier verified; API via fal/MiniMax paid per second (~$0.04/s H3 Max Turbo). | https://blog.hoelee.com/posts/best-ai-video-generators-2026/ |

- **Verdict:** none of these is a usable free *server-side* video path. Luma is the only one worth a 5-minute check (does the free account get an API key with 30 gen/mo, or is API paywalled behind Standard?). Runway's 125 credits are useful only to smoke-test an integration.

## 7. Open-source self-hostable models — cannot run on Vercel; two free hosted routes exist

- **Honest statement:** Wan 2.x, HunyuanVideo, LTX-Video, Mochi-1, CogVideoX are open-weight, but Vercel serverless has no GPU and a 60 s cap. Self-hosting means a GPU host, not Vercel.
- **Route A — HF ZeroGPU Spaces as an API (free, tiny):** every public Gradio Space is an API endpoint (`POST https://<space>.hf.space/gradio_api/call/<api_name>` → `event_id`, then SSE poll). Quotas are **per caller**: unauthenticated **2 min GPU/day**, free HF account **5 min/day**, PRO 40 min/day; reset is rolling 24 h after first use; low queue priority for anonymous callers. A public FLUX.1-schnell Space (e.g. `black-forest-labs/FLUX.1-schnell`) can be called with no key, but the shared-IP/queue problem the site already has **remains**, and queue waits routinely exceed 60 s. **Fallback only.**
  Sources: https://huggingface.co/docs/hub/spaces-api-endpoints · https://aifree.dev/learn/free-hugging-face-inference
- **Route B — Modal Starter (best free-video infrastructure):** **$30/month compute credits, recurring, $0 plan, no card required to start** (verified on modal.com/pricing, fetched via search 2026-11-22). 10 GPU concurrency, 100 containers, 1 TiB/mo free egress. Per-second billing: T4 ~$0.59/h, A100 80GB ~$2.50/h, H100 ~$3.95/h — so $30 ≈ ~50 h T4 or ~7.5 h H100 per month. You deploy Wan 2.2 / LTX-Video as a Modal web endpoint; the Vercel function (or the browser) submits a job and polls. This is a real engineering task (Python function, model download to a Modal Volume, cold starts of minutes for a 5B–14B model), not a drop-in API — but it is the **only route to genuinely free recurring video** that the site operator controls.
  Source: https://modal.com/pricing
- **Route C — Inference Providers for open video models:** Wan/HunyuanVideo/LTX are listed on the HF router via fal/Novita/WaveSpeed — but see §1: paid-only since Oct 2026.

## 8. Other genuinely free no-key image APIs found

- **Kavel (`kavel.ai`)** — anonymous tier, no key: invent an `x-anon-id` header, `POST https://www.kavel.ai/api/ai/generate`, poll `.../anon-query?taskId=…`. Wallet is **15 credits, one-time, non-renewing** (text-to-image costs 5), 1K output, watermarked; failures return HTTP 200 shaped like success. Single dev.to post, no official docs. **Do NOT integrate** — one-time, obscure, fragile.
  Source: https://dev.to/kavel/a-free-image-generation-api-with-no-key-and-no-account-and-the-three-failures-that-look-like-success-f06
- **"Free-ChatGPT-Api" GitHub project** — unofficial proxy wrapping public third-party endpoints, 60 req/min/IP, self-deploy to Cloudflare Workers. **Do NOT integrate** — unofficial, no SLA, provenance unknown.
  Source: https://github.com/darksasa1-eng/Free-Chatgpt-Api
- **Novita AI** — $0.50 one-time signup credits (secondary sources, June 2026 snapshot; one source claims a $10 promo). FLUX.1-schnell from $0.001/image, OpenAI-compatible `https://api.novita.ai/v3beta/flux-1-schnell`, 60 RPM. One-time only; useful for testing, not a free tier. **Not verified from Novita's own pages in this session.**
  Sources: https://yangmao.ai/en/providers/novita/free-tier/ · https://aicredits.dev/submissions/54-novita-ai-10-free-credits-for-new-users
- **Replicate** — no free tier (FLUX-schnell $3.00/1,000 images). Paid only.
  Source: https://blog.laozhang.ai/en/posts/free-ai-image-generation-api

## 9. Bonus find: Vercel AI Gateway free tier (verify before use)

- Vercel's own gateway (`https://ai-gateway.vercel.sh/v1`, OpenAI-compatible) has a free tier: a subset of models, rate-limited, credits start on first request; buying credits ends the free credit. **The official pricing page fetched 2026-11-22 does NOT state a dollar amount** — the "$5 every 30 days" figure comes from multiple secondary sources (Oct–Nov 2026). **Must verify in the dashboard** at `vercel.com/ai-gateway/models?freeTier=true` whether any image or video model is free-tier eligible (video jobs are async through the gateway). If FLUX or an image model is eligible, this is the easiest integration of all (same Vercel account, no new key).
- Sources: https://vercel.com/docs/ai-gateway/pricing · https://flatkey.ai/blog/ai-gateway-pricing

## 10. Bonus find: Cloudflare Workers AI (the #1 recommendation — images)

- **Free allowance (verified on Cloudflare's official pricing page, fetched 2026-11-22, updated 2026-11-18):** **10,000 Neurons/day at no charge** on both Workers Free and Paid plans; resets 00:00 UTC; on Free, calls fail with an error once exhausted (nothing is ever charged). No credit card needed for a free Cloudflare account.
- **Models:** `@cf/black-forest-labs/flux-1-schnell` (4.80 neurons/512×512 tile + 9.60/step), plus `@cf/black-forest-labs/flux-2-klein-4b`, `flux-2-dev`, Leonardo Lucid Origin / Phoenix. **No video models exist in Workers AI** — image only.
- **How many images/day?** Two honest numbers: the pricing-page formula gives 57.6 neurons for a 1024×1024, 4-step image → ~173/day; a **live metered measurement** (2026-10-12, `cf-ai-neurons` response header) shows the step price is charged **per tile**, i.e. 172.8 neurons → **~57 images/day at 1024×1024/4 steps**, ~173/day at 1 step, ~230/day at 512×512. Plan on **~57/day**; treat 173 as the optimistic reading.
- **Latency:** ~1.4 s for a 4-step FLUX image (measured) — fits easily in a 60 s Vercel function.
- **Key:** free Cloudflare account → Account ID + API token (Workers AI template permission). No card.

---

## Recommended integration (1–2)

### Recommendation 1 — Cloudflare Workers AI for IMAGES (primary)

**Endpoint (from a Vercel serverless function):**
```
POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell
Authorization: Bearer {CLOUDFLARE_API_TOKEN}
Content-Type: application/json
```
**Request body:**
```json
{ "prompt": "… (max 2048 chars)", "steps": 4 }
```
(`steps` optional, default 4, max 8. There is no documented width/height parameter; output is 1024×1024 JPEG.)
**Response shape (JSON envelope):**
```json
{ "success": true, "errors": [], "messages": [],
  "result": { "image": "<base64 JPEG>" } }
```
Decode `result.image` from base64 → JPEG bytes. On quota exhaustion the API returns an error (Free plan) — surface "daily free image limit reached, resets 00:00 UTC" and fall back to the next provider.
**Setup:** create a free Cloudflare account (no card) → copy Account ID from the dashboard → create an API token with the Workers AI "Edit" template → store `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` as Vercel env vars. No SDK needed — plain `fetch`.
**Sources:** https://developers.cloudflare.com/workers-ai/platform/pricing/ · https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/ · https://xndr.io/blog/cloudflare-workers-ai-free-tier-neurons (metered 172.8 neurons/image)

### Recommendation 2 — Puter.js for VIDEO (client-side) + image fallback

**Install:** `npm install @heyputer/puter.js` (or `<script src="https://js.puter.com/v2/"></script>`).
**Image:**
```js
import { puter } from '@heyputer/puter.js';
const img = await puter.ai.txt2img("A peaceful mountain landscape at sunset",
  { model: "google/gemini-3.1-flash-image" }); // or "black-forest-labs/flux-schnell"
document.body.appendChild(img); // img.src is a usable URL
```
**Video:**
```js
const video = await puter.ai.txt2vid("A cat playing with a ball of yarn",
  { model: "vidu/vidu-q3" }); // or "togetherai:wan-ai/wan2.7-t2v", "alibaba/happyhorse-1.1-t2v"
document.body.appendChild(video); // resolves when the clip is ready; video.src is the clip URL
```
**Notes:** first use prompts the user to create/sign in to a free Puter account; generations consume that user's own allowance (starter credit amount unpublished). Runs in the browser — do not call from a serverless function. Video renders take minutes; show progress in the UI. Test mode: `puter.ai.txt2vid(prompt, { testMode: true })` returns a sample clip without spending credits.
**Sources:** https://developer.puter.com/tutorials/free-unlimited-image-generation-api/ · https://developer.puter.com/tutorials/free-unlimited-vidu-api/ · https://docs.puter.com/AI/txt2vid/

### Longer-term video option (not a quick integration)
**Modal Starter ($30/mo recurring compute):** deploy Wan 2.2-TI2V-5B or LTX-Video as a Modal `@app.function(gpu="A10G")` + `@modal.fastapi_endpoint`/`web_endpoint`; Vercel function submits a job, returns a job ID immediately, client polls Modal for completion (video takes minutes — never block the 60 s function). $30 ≈ ~50 h T4 / ~7.5 h H100 per month. Requires a Python service, model weights on a Modal Volume, and cold-start handling.
Source: https://modal.com/pricing

---

## What could NOT be verified — do NOT integrate on these claims

1. **fal.ai trial-credit amount** — "trial credits on sign-up" is claimed by third parties; no amount on fal.ai/pricing. Treat fal as paid-only.
2. **Vercel AI Gateway "$5 every 30 days"** — official docs confirm a free tier but state no dollar amount; also unverified whether any image/video model is free-tier eligible. Check the dashboard model list (`?freeTier=true`) first.
3. **Luma API free tier** — sources conflict (30 gen/mo free API vs API requires Standard $30/mo). Unverified.
4. **Kling / Pika / Hailuo API free tiers** — consumer-app daily credits exist; no evidence of a free *API* tier for any of them.
5. **Novita $0.50 (or $10 promo) signup credit** — secondary sources only, June 2026 snapshot; not verified on novita.ai in this session.
6. **Gemini Veo 3.1 API per-second price** — not found on Google's pricing page in this session; ~$0.40/s figure is secondary only.
7. **Puter.js per-user free allowance amount** — Puter publishes no number; "starter credit" size unknown, and whether a signed-in user can generate video without topping up is untested.
8. **Gemini image free-tier behaviour on old keys** — some older keys may still have legacy quota, but a Sept 2026 live test got 429 on the first call from a new free key; do not build on it.
9. **Kavel / Free-ChatGPT-Api** — found, but single-post/unofficial; explicitly not recommended.
10. **HF Inference Providers video-model pricing** — catalogue lists Wan/HunyuanVideo/LTX via paid providers, but per-model prices were not verified; irrelevant while the free tier is $0.

## Bottom line

- **Images:** replace the HF Gradio Space path with **Cloudflare Workers AI FLUX.1-schnell** (~57 free 1024×1024 images/day, sync, no card). Keep the HF Space only as a last-resort fallback.
- **Video:** there is no free server-side video API. Ship **Puter.js client-side** (Vidu Q3 / Wan 2.7) with honest "uses your free Puter account" UX, keep **fal.ai as the paid path**, and consider **Modal ($30/mo)** as the real free-video backend project.
- **Do not build on:** HF Inference Providers free credits (ended 7 Oct 2026), Together AI (no trial, $15 min), Gemini image/video (paid-only on the API), Pollinations (excluded by user).
