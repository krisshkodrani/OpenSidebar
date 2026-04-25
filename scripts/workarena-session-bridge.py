#!/usr/bin/env python3
"""Long-lived WorkArena session bridge for reset, session export, validation, teardown.

The bridge speaks newline-delimited JSON on stdin/stdout. It is intentionally
small and conservative so the TypeScript runner can keep the BrowserGym
environment alive while OpenSidebar acts in a separate extension-loaded Chrome.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


BRIDGE_PATH = Path(__file__).with_name("workarena-bridge.py")
DATASET_ID = "ServiceNow/WorkArena-Instances"


def load_bridge_module():
    spec = importlib.util.spec_from_file_location("workarena_bridge", BRIDGE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {BRIDGE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["workarena_bridge"] = module
    spec.loader.exec_module(module)
    return module


workarena_bridge = load_bridge_module()


if os.environ.get("HUGGING_FACE_HUB_TOKEN") and not os.environ.get("HF_TOKEN"):
    os.environ["HF_TOKEN"] = os.environ["HUGGING_FACE_HUB_TOKEN"]


class WorkArenaSession:
    def __init__(self) -> None:
        self.env = None
        self.obs: dict[str, Any] | None = None
        self.info: dict[str, Any] = {}
        self.task_id: str | None = None
        self.env_id: str | None = None
        self.seed: int | None = None
        self.created_at_ms: int | None = None

    def describe(self) -> dict[str, Any]:
        return {
            "benchmark": "workarena",
            "mode": "held-session-bridge",
            "ready": True,
            "protocolVersion": "2026-04-25",
            "dataset": DATASET_ID,
            "commands": [
                {
                    "command": "describe",
                    "mutatesServiceNow": False,
                    "requiresReset": False,
                },
                {
                    "command": "reset",
                    "mutatesServiceNow": True,
                    "requiresReset": True,
                    "requiresAllowServiceNowReset": True,
                },
                {
                    "command": "export_session",
                    "mutatesServiceNow": False,
                    "requiresReset": True,
                },
                {
                    "command": "validate",
                    "mutatesServiceNow": False,
                    "requiresReset": True,
                },
                {
                    "command": "teardown",
                    "mutatesServiceNow": False,
                    "requiresReset": False,
                },
            ],
            "state": self.state_summary(),
            "safety": [
                "The bridge does not reset WorkArena unless reset.allowServiceNowReset is true.",
                "The bridge keeps BrowserGym alive after reset so validation can run after OpenSidebar acts elsewhere.",
                "The caller must send teardown before process exit when reset succeeds.",
            ],
        }

    def state_summary(self) -> dict[str, Any]:
        return {
            "active": self.env is not None,
            "taskId": self.task_id,
            "envId": self.env_id,
            "seed": self.seed,
            "createdAtMs": self.created_at_ms,
        }

    def reset(self, message: dict[str, Any]) -> dict[str, Any]:
        if not message.get("allowServiceNowReset"):
            return {
                "ok": False,
                "status": "blocked_requires_reset_flag",
                "error": "reset requires allowServiceNowReset=true",
                "state": self.state_summary(),
            }

        task_id = message.get("taskId")
        if not isinstance(task_id, str) or not task_id:
            return {
                "ok": False,
                "status": "blocked_invalid_request",
                "error": "reset requires a taskId string",
                "state": self.state_summary(),
            }

        if self.env is not None:
            self.teardown()

        import gymnasium as gym

        import browsergym.workarena  # noqa: F401

        seed = message.get("seed", 42)
        if not isinstance(seed, int):
            seed = 42
        show_browser = bool(message.get("showBrowser", False))
        env_id = f"browsergym/{task_id}"
        start = time.time()

        self.env = gym.make(
            env_id,
            headless=not show_browser,
            wait_for_user_message=False,
            use_raw_page_output=True,
        )
        self.obs, self.info = self.env.reset(seed=seed)
        browser_env = self.env.unwrapped
        task = browser_env.task
        self.task_id = task_id
        self.env_id = env_id
        self.seed = seed
        self.created_at_ms = int(time.time() * 1000)

        return {
            "ok": True,
            "status": "reset_succeeded",
            "durationMs": int((time.time() - start) * 1000),
            "task": {
                "taskId": task_id,
                "envId": env_id,
                "seed": seed,
                "category": workarena_bridge.task_category(task_id),
                "kind": "atomic" if workarena_bridge.infer_level(task_id) is None else "compositional",
                "level": workarena_bridge.infer_level(task_id),
                "className": workarena_bridge.get_task_class(task_id).__name__,
            },
            "prompt": {
                "source": "workarena_goal_after_reset",
                "value": self.obs.get("goal"),
                "goalObject": workarena_bridge.compact_goal_object(self.obs.get("goal_object")),
            },
            "browser": {
                "startUrl": getattr(task, "start_url", None),
                "activeUrl": self.obs.get("url"),
                "openPages": list(self.obs.get("open_pages_urls", [])),
                "openPageTitles": list(self.obs.get("open_pages_titles", [])),
            },
            "state": self.state_summary(),
        }

    def export_session(self) -> dict[str, Any]:
        if self.env is None:
            return {
                "ok": False,
                "status": "blocked_no_active_session",
                "error": "export_session requires a successful reset first",
                "state": self.state_summary(),
            }

        browser_env = self.env.unwrapped
        storage_state = browser_env.context.storage_state()
        return {
            "ok": True,
            "status": "session_exported",
            "state": self.state_summary(),
            "storageState": storage_state,
            "browser": {
                "activeUrl": self.obs.get("url") if self.obs else None,
                "openPages": list(self.obs.get("open_pages_urls", [])) if self.obs else [],
                "openPageTitles": list(self.obs.get("open_pages_titles", [])) if self.obs else [],
            },
        }

    def validate(self) -> dict[str, Any]:
        if self.env is None:
            return {
                "ok": False,
                "status": "blocked_no_active_session",
                "error": "validate requires a successful reset first",
                "state": self.state_summary(),
            }

        start = time.time()
        try:
            reward, done, user_message, info = self.env.unwrapped._task_validate()
            return {
                "ok": True,
                "status": "validated",
                "durationMs": int((time.time() - start) * 1000),
                "state": self.state_summary(),
                "validation": {
                    "passed": bool(done),
                    "score": reward,
                    "message": user_message,
                    "details": info or {},
                },
            }
        except Exception as exc:  # noqa: BLE001 - preserve validation failure details.
            return {
                "ok": False,
                "status": "validation_error",
                "durationMs": int((time.time() - start) * 1000),
                "state": self.state_summary(),
                "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
            }

    def teardown(self) -> dict[str, Any]:
        if self.env is None:
            return {
                "ok": True,
                "status": "teardown_noop",
                "state": self.state_summary(),
            }

        start = time.time()
        try:
            self.env.close()
            status = "teardown_succeeded"
            ok = True
            error = None
        except Exception as exc:  # noqa: BLE001 - teardown should be reported.
            status = "teardown_failed"
            ok = False
            error = f"{type(exc).__name__}: {str(exc)[:1000]}"

        self.env = None
        self.obs = None
        self.info = {}
        self.task_id = None
        self.env_id = None
        self.seed = None
        self.created_at_ms = None

        result = {
            "ok": ok,
            "status": status,
            "durationMs": int((time.time() - start) * 1000),
            "state": self.state_summary(),
        }
        if error:
            result["error"] = error
        return result


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def handle(session: WorkArenaSession, message: dict[str, Any]) -> dict[str, Any]:
    command = message.get("command")
    try:
        if command == "describe":
            return session.describe()
        if command == "reset":
            return session.reset(message)
        if command == "export_session":
            return session.export_session()
        if command == "validate":
            return session.validate()
        if command == "teardown":
            return session.teardown()
        return {
            "ok": False,
            "status": "unknown_command",
            "error": f"Unknown command: {command}",
            "state": session.state_summary(),
        }
    except Exception as exc:  # noqa: BLE001 - protocol should report failures as JSON.
        return {
            "ok": False,
            "status": "bridge_error",
            "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
            "state": session.state_summary(),
        }


def main() -> int:
    session = WorkArenaSession()
    emit(session.describe())
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError as exc:
                emit({"ok": False, "status": "invalid_json", "error": str(exc)})
                continue
            if not isinstance(message, dict):
                emit({"ok": False, "status": "invalid_request", "error": "expected object"})
                continue
            emit(handle(session, message))
    finally:
        session.teardown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
