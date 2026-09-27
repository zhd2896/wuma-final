# Phase 22 Review Explanation Implementation Plan

**Goal:** Explain persisted Phase 21 reviews in Chinese without changing chess or review conclusions.

**Architecture:** A separate explanation service reads a completed GameReview, builds bounded structured prompts, calls an injected LLMProvider, validates all text, and falls back to deterministic templates. A versioned explanation row holds the result. The existing review endpoints and algorithm tables stay intact.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy/Alembic, MySQL 8, httpx, WeChat mini program, Node tests, pytest.

- [x] Write failing API and provider tests for missing review, success, invalid responses, hallucinations, timeout, no key and idempotency.
- [x] Add strict explanation schemas, centralized prompt builder, grounding validator, provider interface and configured HTTP provider.
- [x] Add explanation service with fallback and persistent store contract.
- [x] Add `0006` migration and isolated MySQL persistence tests.
- [x] Add explain API, client DTOs and existing review page explanation area with independent loading.
- [x] Add a real WeChat fallback E2E that creates a finished game, reviews, explains and reloads it.
- [x] Run migration upgrade/downgrade/check and all requested backend, frontend and WeChat tests.
