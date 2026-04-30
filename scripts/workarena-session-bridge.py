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
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


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
                    "optionalActiveUrlSync": True,
                    "optionalSubmittedRecordNumber": True,
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
        phase = "gym_make"

        try:
            self.env = gym.make(
                env_id,
                headless=not show_browser,
                wait_for_user_message=False,
                use_raw_page_output=True,
            )
            phase = "env_reset"
            self.obs, self.info = self.env.reset(seed=seed)
            phase = "task_metadata"
            browser_env = self.env.unwrapped
            task = browser_env.task
            self.task_id = task_id
            self.env_id = env_id
            self.seed = seed
            self.created_at_ms = int(time.time() * 1000)
        except Exception as exc:  # noqa: BLE001 - reset diagnostics must cross the bridge.
            return {
                "ok": False,
                "status": "reset_failed",
                "durationMs": int((time.time() - start) * 1000),
                "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
                "diagnostics": {
                    "phase": phase,
                    "taskId": task_id,
                    "envId": env_id,
                    "seed": seed,
                    "showBrowser": show_browser,
                    "errorType": type(exc).__name__,
                },
                "state": self.state_summary(),
            }

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

    def _origin(self, value: Any) -> str | None:
        if not isinstance(value, str) or not value:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"

    def _same_service_now_origin(self, active_url: str, current_url: str | None) -> bool:
        target_origin = self._origin(active_url)
        if target_origin is None:
            return False

        origins = {origin for origin in [self._origin(current_url)] if origin is not None}
        if self.env is not None:
            task = getattr(self.env.unwrapped, "task", None)
            origins.add(self._origin(getattr(task, "start_url", None)))
        return target_origin in origins

    def _sync_page_url(self, active_url: str | None) -> dict[str, Any]:
        if not active_url:
            return {
                "attempted": False,
                "requestedUrl": None,
                "activeUrl": self.obs.get("url") if self.obs else None,
            }

        browser_env = self.env.unwrapped
        context = getattr(browser_env, "context", None)
        page = getattr(browser_env, "page", None)
        if page is None and context is not None:
            pages = getattr(context, "pages", [])
            page = pages[0] if pages else None
        if page is None:
            return {
                "attempted": True,
                "ok": False,
                "requestedUrl": active_url,
                "error": "No BrowserGym page is available for validation URL sync.",
            }

        current_url = getattr(page, "url", None) or (self.obs.get("url") if self.obs else None)
        if not self._same_service_now_origin(active_url, current_url):
            return {
                "attempted": True,
                "ok": False,
                "requestedUrl": active_url,
                "activeUrl": current_url,
                "error": "Validation URL sync requires the same origin as the reset ServiceNow page.",
            }

        if current_url != active_url:
            page.goto(active_url, wait_until="domcontentloaded", timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=10000)
            except Exception:
                pass

        synced_url = getattr(page, "url", active_url)
        if self.obs is not None:
            self.obs["url"] = synced_url
            self.obs["open_pages_urls"] = [synced_url]
            self.obs["open_pages_titles"] = [page.title()]

        return {
            "attempted": True,
            "ok": True,
            "requestedUrl": active_url,
            "activeUrl": synced_url,
        }

    def _import_storage_state(
        self, storage_state: Any, active_url: str | None = None
    ) -> dict[str, Any]:
        if not isinstance(storage_state, dict):
            return {
                "attempted": False,
                "cookies": 0,
                "localStorage": 0,
                "sessionStorage": 0,
                "origins": [],
            }

        browser_env = self.env.unwrapped
        context = getattr(browser_env, "context", None)
        page = getattr(browser_env, "page", None)
        if page is None and context is not None:
            pages = getattr(context, "pages", [])
            page = pages[0] if pages else None
        if page is None:
            return {
                "attempted": True,
                "ok": False,
                "error": "No BrowserGym page is available for storage sync.",
            }

        active_origin = self._origin(active_url)
        current_origin = self._origin(getattr(page, "url", None))
        task = getattr(browser_env, "task", None)
        task_origin = self._origin(getattr(task, "start_url", None))
        allowed_origins = {
            origin for origin in [active_origin, current_origin, task_origin] if origin is not None
        }

        cookies = storage_state.get("cookies")
        cookie_count = 0
        if context is not None and isinstance(cookies, list) and cookies:
            sanitized_cookies: list[dict[str, Any]] = []
            for cookie in cookies:
                if not isinstance(cookie, dict):
                    continue
                name = cookie.get("name")
                value = cookie.get("value")
                if not isinstance(name, str) or not isinstance(value, str):
                    continue
                sanitized = {
                    "name": name,
                    "value": value,
                }
                for key in ["domain", "path", "sameSite"]:
                    if isinstance(cookie.get(key), str):
                        sanitized[key] = cookie[key]
                for key in ["httpOnly", "secure"]:
                    if isinstance(cookie.get(key), bool):
                        sanitized[key] = cookie[key]
                expires = cookie.get("expires")
                if isinstance(expires, (int, float)) and expires >= 0:
                    sanitized["expires"] = expires
                sanitized_cookies.append(sanitized)
            if sanitized_cookies:
                context.add_cookies(sanitized_cookies)
                cookie_count = len(sanitized_cookies)

        local_storage_count = 0
        session_storage_count = 0
        synced_origins: list[str] = []
        skipped_origins: list[str] = []
        origins = storage_state.get("origins")
        if isinstance(origins, list):
            for origin_record in origins:
                if not isinstance(origin_record, dict):
                    continue
                origin = origin_record.get("origin")
                if not isinstance(origin, str) or self._origin(origin) not in allowed_origins:
                    if isinstance(origin, str):
                        skipped_origins.append(origin)
                    continue

                if self._origin(getattr(page, "url", None)) != self._origin(origin):
                    page.goto(origin, wait_until="domcontentloaded", timeout=30000)

                local_entries = origin_record.get("localStorage")
                session_entries = origin_record.get("sessionStorage")
                local_entries = local_entries if isinstance(local_entries, list) else []
                session_entries = session_entries if isinstance(session_entries, list) else []
                payload = {
                    "localStorageEntries": [
                        {"name": item.get("name"), "value": item.get("value")}
                        for item in local_entries
                        if isinstance(item, dict)
                        and isinstance(item.get("name"), str)
                        and isinstance(item.get("value"), str)
                    ],
                    "sessionStorageEntries": [
                        {"name": item.get("name"), "value": item.get("value")}
                        for item in session_entries
                        if isinstance(item, dict)
                        and isinstance(item.get("name"), str)
                        and isinstance(item.get("value"), str)
                    ],
                }
                page.evaluate(
                    """payload => {
                        for (const entry of payload.localStorageEntries) {
                            window.localStorage.setItem(entry.name, entry.value);
                        }
                        for (const entry of payload.sessionStorageEntries) {
                            window.sessionStorage.setItem(entry.name, entry.value);
                        }
                    }""",
                    payload,
                )
                local_storage_count += len(payload["localStorageEntries"])
                session_storage_count += len(payload["sessionStorageEntries"])
                synced_origins.append(origin)

        return {
            "attempted": True,
            "ok": True,
            "cookies": cookie_count,
            "localStorage": local_storage_count,
            "sessionStorage": session_storage_count,
            "origins": synced_origins,
            "skippedOrigins": skipped_origins,
        }

    def _reload_after_storage_sync(
        self, active_url: str | None,
        storage_sync: dict[str, Any],
    ) -> dict[str, Any]:
        if not storage_sync.get("attempted"):
            return {
                "attempted": False,
                "reason": "storage_sync_not_attempted",
            }

        browser_env = self.env.unwrapped
        context = getattr(browser_env, "context", None)
        page = getattr(browser_env, "page", None)
        if page is None and context is not None:
            pages = getattr(context, "pages", [])
            page = pages[0] if pages else None
        if page is None:
            return {
                "attempted": True,
                "ok": False,
                "error": "No BrowserGym page is available for post-storage reload.",
            }

        target_url = active_url or (self.obs.get("url") if self.obs else None)
        if not target_url:
            return {
                "attempted": False,
                "reason": "no_active_url",
            }
        if not self._same_service_now_origin(target_url, getattr(page, "url", None)):
            return {
                "attempted": True,
                "ok": False,
                "requestedUrl": target_url,
                "activeUrl": getattr(page, "url", None),
                "error": "Post-storage reload requires the same origin as the reset ServiceNow page.",
            }

        page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass

        synced_url = getattr(page, "url", target_url)
        title = page.title()
        if self.obs is not None:
            self.obs["url"] = synced_url
            self.obs["open_pages_urls"] = [synced_url]
            self.obs["open_pages_titles"] = [title]

        return {
            "attempted": True,
            "ok": True,
            "requestedUrl": target_url,
            "activeUrl": synced_url,
            "title": title,
        }

    def _sync_submitted_record_id(self, submitted_record_number: Any) -> dict[str, Any]:
        if not isinstance(submitted_record_number, str) or not submitted_record_number:
            return {
                "attempted": False,
                "reason": "no_submitted_record_number",
            }

        record_number = submitted_record_number.strip().upper()
        if not re.fullmatch(r"[A-Z]{2,}\d+", record_number):
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": submitted_record_number,
                "error": "submittedRecordNumber is not a ServiceNow record number",
            }

        browser_env = self.env.unwrapped
        task = getattr(browser_env, "task", None)
        session_key = getattr(task, "session_sys_id_field", None)
        table_name = getattr(task, "table_name", None)
        instance = getattr(task, "instance", None)
        if not isinstance(session_key, str) or not session_key:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "error": "Active WorkArena task does not expose session_sys_id_field.",
            }
        if not isinstance(table_name, str) or not table_name or instance is None:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "sessionKey": session_key,
                "error": "Active WorkArena task does not expose a queryable ServiceNow table.",
            }

        context = getattr(browser_env, "context", None)
        page = getattr(browser_env, "page", None)
        if page is None and context is not None:
            pages = getattr(context, "pages", [])
            page = pages[0] if pages else None
        if page is None:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "sessionKey": session_key,
                "table": table_name,
                "error": "No BrowserGym page is available for record id sync.",
            }

        try:
            existing = page.evaluate(
                "key => window.localStorage.getItem(key)",
                session_key,
            )
        except Exception:
            existing = None
        if isinstance(existing, str) and existing:
            return {
                "attempted": True,
                "ok": True,
                "recordNumber": record_number,
                "sessionKey": session_key,
                "table": table_name,
                "existing": True,
            }

        try:
            from browsergym.workarena.api.utils import table_api_call

            response = table_api_call(
                instance=instance,
                table=table_name,
                params={
                    "sysparm_query": f"number={record_number}^ORDERBYDESCsys_created_on",
                    "sysparm_fields": "sys_id,number,sys_created_on,sys_updated_on",
                    "sysparm_limit": "5",
                },
                wait_for_record=True,
                max_retries=20,
                raise_on_wait_expired=False,
            )
            records = response.get("result") if isinstance(response, dict) else []
            if not isinstance(records, list) or len(records) == 0:
                return {
                    "attempted": True,
                    "ok": False,
                    "recordNumber": record_number,
                    "sessionKey": session_key,
                    "table": table_name,
                    "error": "Submitted record number was not found in ServiceNow.",
                }
            first_record = records[0] if isinstance(records[0], dict) else {}
            sys_id = first_record.get("sys_id")
            if not isinstance(sys_id, str) or not sys_id:
                return {
                    "attempted": True,
                    "ok": False,
                    "recordNumber": record_number,
                    "sessionKey": session_key,
                    "table": table_name,
                    "error": "Submitted record did not include a sys_id.",
                }

            page.evaluate(
                """payload => {
                    window.localStorage.setItem(payload.sessionKey, payload.sysId);
                }""",
                {"sessionKey": session_key, "sysId": sys_id},
            )
            return {
                "attempted": True,
                "ok": True,
                "recordNumber": record_number,
                "sessionKey": session_key,
                "table": table_name,
                "sysId": sys_id,
                "candidateCount": len(records),
                "sysCreatedOn": first_record.get("sys_created_on"),
                "sysUpdatedOn": first_record.get("sys_updated_on"),
                "existing": False,
            }
        except Exception as exc:  # noqa: BLE001 - preserve validation diagnostics.
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "sessionKey": session_key,
                "table": table_name,
                "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
            }

    def validate(
        self,
        active_url: str | None = None,
        storage_state: Any | None = None,
        submitted_record_number: Any | None = None,
        final_answer: Any | None = None,
    ) -> dict[str, Any]:
        if self.env is None:
            return {
                "ok": False,
                "status": "blocked_no_active_session",
                "error": "validate requires a successful reset first",
                "state": self.state_summary(),
            }

        start = time.time()
        try:
            url_sync = self._sync_page_url(active_url)
            if url_sync.get("ok") is False:
                return {
                    "ok": False,
                    "status": "blocked_invalid_validation_url",
                    "durationMs": int((time.time() - start) * 1000),
                    "state": self.state_summary(),
                    "error": url_sync.get("error"),
                    "urlSync": url_sync,
                }

            storage_sync = self._import_storage_state(storage_state, active_url)
            if storage_sync.get("ok") is False:
                return {
                    "ok": False,
                    "status": "blocked_storage_sync_failed",
                    "durationMs": int((time.time() - start) * 1000),
                    "state": self.state_summary(),
                    "error": storage_sync.get("error"),
                    "urlSync": url_sync,
                    "storageSync": storage_sync,
                }

            reload_sync = self._reload_after_storage_sync(active_url, storage_sync)
            if reload_sync.get("ok") is False:
                return {
                    "ok": False,
                    "status": "blocked_storage_reload_failed",
                    "durationMs": int((time.time() - start) * 1000),
                    "state": self.state_summary(),
                    "error": reload_sync.get("error"),
                    "urlSync": url_sync,
                    "storageSync": storage_sync,
                    "reloadSync": reload_sync,
                }

            record_sync = self._sync_submitted_record_id(submitted_record_number)
            answer_sync = self._sync_assistant_answer(final_answer)
            reward, done, user_message, info = self.env.unwrapped._task_validate()
            validation_details = info if isinstance(info, dict) else {}
            validation_details = {
                **validation_details,
                "urlSync": url_sync,
                "storageSync": storage_sync,
                "reloadSync": reload_sync,
                "recordSync": record_sync,
                "answerSync": answer_sync,
            }
            return {
                "ok": True,
                "status": "validated",
                "durationMs": int((time.time() - start) * 1000),
                "state": self.state_summary(),
                "browser": {
                    "activeUrl": url_sync.get("activeUrl")
                    if isinstance(url_sync, dict)
                    else None,
                },
                "validation": {
                    "passed": bool(done),
                    "score": reward,
                    "message": user_message,
                    "details": validation_details,
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

    def _sync_assistant_answer(self, final_answer: Any) -> dict[str, Any]:
        if not isinstance(final_answer, str) or not final_answer.strip():
            return {
                "attempted": False,
                "reason": "no_final_answer",
            }

        browser_env = self.env.unwrapped
        chat = getattr(browser_env, "chat", None)
        if chat is None:
            return {
                "attempted": True,
                "ok": False,
                "error": "BrowserGym environment does not expose chat.",
            }

        answer = final_answer.strip()
        messages = getattr(chat, "messages", [])
        if (
            isinstance(messages, list)
            and messages
            and isinstance(messages[-1], dict)
            and messages[-1].get("role") == "assistant"
            and messages[-1].get("message") == answer
        ):
            return {
                "attempted": True,
                "ok": True,
                "existing": True,
                "messageLength": len(answer),
            }

        try:
            chat.add_message(role="assistant", msg=answer)
        except Exception:
            if not isinstance(messages, list):
                return {
                    "attempted": True,
                    "ok": False,
                    "error": "BrowserGym chat messages are not mutable.",
                }
            messages.append({"role": "assistant", "message": answer})

        return {
            "attempted": True,
            "ok": True,
            "existing": False,
            "messageLength": len(answer),
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
            active_url = message.get("activeUrl")
            return session.validate(
                active_url if isinstance(active_url, str) else None,
                message.get("storageState"),
                message.get("submittedRecordNumber"),
                message.get("finalAnswer"),
            )
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
