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
from urllib.parse import quote, unquote, urlparse


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


def patch_workarena_instance_reachability() -> None:
    """Retry transient ServiceNow reachability checks during BrowserGym reset."""

    import requests
    from browsergym.workarena.config import SNOW_BROWSER_TIMEOUT
    from browsergym.workarena.instance import SNowInstance

    if getattr(SNowInstance, "_opensidebar_reachability_patch", False):
        return

    def _check_is_reachable_with_retry(self):  # type: ignore[no-untyped-def]
        last_error = None
        for attempt in range(1, 4):
            try:
                requests.get(self.snow_url, timeout=SNOW_BROWSER_TIMEOUT)
                return
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
                last_error = exc
                if attempt < 3:
                    time.sleep(attempt)

        detail = f" Last error: {last_error}" if last_error else ""
        raise RuntimeError(
            f"ServiceNow instance at {self.snow_url} is not reachable. Please check the URL.{detail}"
        )

    SNowInstance._check_is_reachable = _check_is_reachable_with_retry
    SNowInstance._opensidebar_reachability_patch = True


class WorkArenaSession:
    def __init__(self) -> None:
        self.env = None
        self.obs: dict[str, Any] | None = None
        self.info: dict[str, Any] = {}
        self.task_id: str | None = None
        self.env_id: str | None = None
        self.seed: int | None = None
        self.created_at_ms: int | None = None

    def _align_subtask_instances(self, task: Any) -> dict[str, Any]:
        """Keep compositional subtasks bound to the reset task's ServiceNow instance."""

        root_instance = getattr(task, "instance", None)
        root_url = getattr(root_instance, "snow_url", None)
        if root_instance is None or not isinstance(root_url, str) or not root_url:
            return {"attempted": False, "reason": "no_root_instance"}

        visited: set[int] = set()
        changed: list[dict[str, Any]] = []

        def visit(candidate: Any, path: str) -> None:
            if candidate is None:
                return
            identity = id(candidate)
            if identity in visited:
                return
            visited.add(identity)

            candidate_instance = getattr(candidate, "instance", None)
            candidate_url = getattr(candidate_instance, "snow_url", None)
            if (
                candidate is not task
                and candidate_instance is not None
                and isinstance(candidate_url, str)
                and candidate_url
                and candidate_url != root_url
            ):
                setattr(candidate, "instance", root_instance)
                changed.append(
                    {
                        "path": path,
                        "taskClass": type(candidate).__name__,
                        "from": candidate_url,
                        "to": root_url,
                    }
                )

            subtasks = getattr(candidate, "subtasks", None)
            if isinstance(subtasks, list):
                for index, subtask in enumerate(subtasks):
                    visit(subtask, f"{path}.subtasks[{index}]")

        visit(task, "task")
        return {
            "attempted": True,
            "rootUrl": root_url,
            "checked": len(visited),
            "changed": changed,
        }

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
        patch_workarena_instance_reachability()

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
            instance_alignment = self._align_subtask_instances(task)
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
            "diagnostics": {
                "instanceAlignment": instance_alignment,
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

    def _record_detail_url_from_sync(
        self,
        active_url: str | None,
        record_sync: dict[str, Any],
    ) -> str | None:
        if not isinstance(active_url, str) or not active_url:
            return None
        if not isinstance(record_sync, dict) or record_sync.get("ok") is not True:
            return None

        sys_id = record_sync.get("sysId")
        if not isinstance(sys_id, str) or not re.fullmatch(
            r"[0-9a-f]{32}", sys_id, re.IGNORECASE
        ):
            return None

        parsed = urlparse(active_url)
        decoded_path = unquote(parsed.path)
        decoded_query = unquote(parsed.query)
        synced_table = record_sync.get("table")
        target_match = re.search(
            r"/now/nav/ui/classic/params/target/([^?#]+\.do)(?:\?([^#]*))?",
            decoded_path + (f"?{decoded_query}" if decoded_query else ""),
            re.IGNORECASE,
        )
        if target_match:
            table_path = target_match.group(1)
            target_query = target_match.group(2) or ""
        else:
            table_path = decoded_path.lstrip("/")
            target_query = decoded_query

        if table_path not in ("sc_request.do", "sc_req_item.do"):
            table_path = (
                f"{synced_table}.do"
                if synced_table in ("sc_request", "sc_req_item")
                else table_path
            )
        if table_path not in ("sc_request.do", "sc_req_item.do"):
            return None
        if re.search(r"\bsys_id=[0-9a-f]{32}\b", target_query, re.IGNORECASE):
            return None
        if (
            synced_table not in ("sc_request", "sc_req_item")
            and not re.search(
                r"\bsysparm_query=number%?=?|number=", target_query, re.IGNORECASE
            )
        ):
            return None

        return f"{parsed.scheme}://{parsed.netloc}/{table_path}?sys_id={sys_id}"

    def _sync_record_detail_url(
        self,
        active_url: str | None,
        record_sync: dict[str, Any],
    ) -> dict[str, Any]:
        if isinstance(active_url, str):
            decoded_active_url = unquote(active_url)
            if re.search(
                r"/com\.glideapp\.servicecatalog_checkout_view_v2\.do\?[^#]*\bsysparm_sys_id=[0-9a-f]{32}\b",
                decoded_active_url,
                re.IGNORECASE,
            ):
                return {
                    "attempted": False,
                    "reason": "catalog_checkout_url_already_has_sysparm_sys_id",
                }

        record_url = self._record_detail_url_from_sync(active_url, record_sync)
        if record_url is None:
            return {
                "attempted": False,
                "reason": "no_record_detail_url_rewrite",
            }
        sync = self._sync_page_url(record_url)
        return {
            **sync,
            "recordDetailRewrite": True,
            "originalUrl": active_url,
        }

    def _resolve_catalog_request_record_id(
        self,
        submitted_record_number: Any,
    ) -> dict[str, Any]:
        if not isinstance(submitted_record_number, str) or not re.fullmatch(
            r"REQ\d+", submitted_record_number.strip(), re.IGNORECASE
        ):
            return {
                "attempted": False,
                "reason": "not_catalog_request_number",
            }

        record_number = submitted_record_number.strip().upper()
        browser_env = self.env.unwrapped
        task = getattr(browser_env, "task", None)
        instance = getattr(task, "instance", None)
        context = getattr(browser_env, "context", None)
        page = getattr(browser_env, "page", None)
        if page is None and context is not None:
            pages = getattr(context, "pages", [])
            page = pages[0] if pages else None

        records: list[dict[str, Any]] = []
        source = "none"
        workarena_api_candidate_count = None
        if instance is not None:
            try:
                from browsergym.workarena.api.utils import table_api_call

                response = table_api_call(
                    instance=instance,
                    table="sc_request",
                    params={
                        "sysparm_query": f"number={record_number}^ORDERBYDESCsys_created_on",
                        "sysparm_fields": "sys_id,number,sys_created_on,sys_updated_on",
                        "sysparm_limit": "5",
                    },
                    wait_for_record=True,
                    max_retries=20,
                    raise_on_wait_expired=False,
                )
                api_records = response.get("result") if isinstance(response, dict) else []
                workarena_api_candidate_count = (
                    len(api_records) if isinstance(api_records, list) else None
                )
                if isinstance(api_records, list):
                    records = [
                        record for record in api_records if isinstance(record, dict)
                    ]
                    source = "workarena_table_api"
            except Exception:
                records = []

        if not records and page is not None:
            records = self._query_submitted_record_from_page_session(
                page=page,
                table_name="sc_request",
                record_number=record_number,
                direct_sys_id=None,
            )
            source = "browser_session_rest_api"

        if not records:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "table": "sc_request",
                "workarenaApiCandidateCount": workarena_api_candidate_count,
                "error": "Catalog request number was not found in ServiceNow.",
            }

        first_record = records[0]
        sys_id = first_record.get("sys_id")
        if not isinstance(sys_id, str) or not sys_id:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "table": "sc_request",
                "candidateCount": len(records),
                "error": "Catalog request record did not include a sys_id.",
            }

        return {
            "attempted": True,
            "ok": True,
            "recordNumber": record_number,
            "table": "sc_request",
            "sysId": sys_id,
            "candidateCount": len(records),
            "workarenaApiCandidateCount": workarena_api_candidate_count,
            "source": source,
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

    def _find_submitted_record_task(self, task: Any) -> Any:
        if task is None:
            return None
        session_key = getattr(task, "session_sys_id_field", None)
        table_name = getattr(task, "table_name", None)
        if isinstance(session_key, str) and session_key and isinstance(table_name, str) and table_name:
            return task

        subtasks = getattr(task, "subtasks", None)
        if not isinstance(subtasks, list):
            return task

        valid_index = getattr(task, "valid_index", None)
        if isinstance(valid_index, int) and 0 <= valid_index < len(subtasks):
            candidate = subtasks[valid_index]
            session_key = getattr(candidate, "session_sys_id_field", None)
            table_name = getattr(candidate, "table_name", None)
            if isinstance(session_key, str) and session_key and isinstance(table_name, str) and table_name:
                return candidate

        for candidate in subtasks:
            session_key = getattr(candidate, "session_sys_id_field", None)
            table_name = getattr(candidate, "table_name", None)
            if isinstance(session_key, str) and session_key and isinstance(table_name, str) and table_name:
                return candidate

        return task

    def _sync_submitted_record_id(self, submitted_record_number: Any) -> dict[str, Any]:
        if not isinstance(submitted_record_number, str) or not submitted_record_number:
            return {
                "attempted": False,
                "reason": "no_submitted_record_number",
            }

        record_identity = submitted_record_number.strip()
        record_number = (
            record_identity.upper()
            if re.fullmatch(r"[A-Z]{2,}\d+", record_identity, re.IGNORECASE)
            else None
        )
        direct_sys_id = (
            record_identity.lower()
            if re.fullmatch(r"[0-9a-f]{32}", record_identity, re.IGNORECASE)
            else None
        )
        if record_number is None and direct_sys_id is None:
            return {
                "attempted": True,
                "ok": False,
                "recordIdentity": submitted_record_number,
                "error": "submittedRecordNumber is neither a ServiceNow record number nor sys_id",
            }

        browser_env = self.env.unwrapped
        task = getattr(browser_env, "task", None)
        record_task = self._find_submitted_record_task(task)
        session_key = getattr(record_task, "session_sys_id_field", None)
        table_name = getattr(record_task, "table_name", None)
        instance = getattr(record_task, "instance", None)
        record_task_name = type(record_task).__name__ if record_task is not None else None
        instance_url = getattr(instance, "snow_url", None)
        if not isinstance(session_key, str) or not session_key:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "sysId": direct_sys_id,
                "error": "Active WorkArena task does not expose session_sys_id_field.",
                "taskClass": type(task).__name__ if task is not None else None,
            }
        if not isinstance(table_name, str) or not table_name or instance is None:
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "sysId": direct_sys_id,
                "sessionKey": session_key,
                "recordTaskClass": record_task_name,
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
                "sysId": direct_sys_id,
                "sessionKey": session_key,
                "table": table_name,
                "recordTaskClass": record_task_name,
                "error": "No BrowserGym page is available for record id sync.",
            }
        try:
            page_url = page.url
        except Exception:
            page_url = None
        page_origin = None
        if isinstance(page_url, str) and page_url:
            parsed_page_url = urlparse(page_url)
            page_origin = f"{parsed_page_url.scheme}://{parsed_page_url.netloc}"

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
                "sysId": direct_sys_id or existing,
                "sessionKey": session_key,
                "table": table_name,
                "recordTaskClass": record_task_name,
                "existing": True,
            }

        try:
            from browsergym.workarena.api.utils import table_api_call

            query = (
                f"sys_id={direct_sys_id}"
                if direct_sys_id is not None
                else f"number={record_number}^ORDERBYDESCsys_created_on"
            )
            response = table_api_call(
                instance=instance,
                table=table_name,
                params={
                    "sysparm_query": query,
                    "sysparm_fields": "sys_id,number,sys_created_on,sys_updated_on",
                    "sysparm_limit": "5",
                },
                wait_for_record=True,
                max_retries=20,
                raise_on_wait_expired=False,
            )
            records = response.get("result") if isinstance(response, dict) else []
            workarena_api_candidate_count = len(records) if isinstance(records, list) else None
            record_source = "workarena_table_api"
            if (not isinstance(records, list) or len(records) == 0) and page is not None:
                records = self._query_submitted_record_from_page_session(
                    page=page,
                    table_name=table_name,
                    record_number=record_number,
                    direct_sys_id=direct_sys_id,
                )
                record_source = "browser_session_rest_api"
            if not isinstance(records, list) or len(records) == 0:
                return {
                    "attempted": True,
                    "ok": False,
                    "recordNumber": record_number,
                    "sysId": direct_sys_id,
                    "sessionKey": session_key,
                    "table": table_name,
                    "recordTaskClass": record_task_name,
                    "instanceUrl": instance_url,
                    "pageOrigin": page_origin,
                    "workarenaApiCandidateCount": workarena_api_candidate_count,
                    "error": "Submitted record identity was not found in ServiceNow.",
                }
            first_record = records[0] if isinstance(records[0], dict) else {}
            sys_id = first_record.get("sys_id")
            if not isinstance(sys_id, str) or not sys_id:
                sys_id = direct_sys_id
            if not isinstance(sys_id, str) or not sys_id:
                return {
                    "attempted": True,
                    "ok": False,
                    "recordNumber": record_number,
                    "sysId": direct_sys_id,
                    "sessionKey": session_key,
                    "table": table_name,
                    "recordTaskClass": record_task_name,
                    "error": "Submitted record identity did not include a sys_id.",
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
                "recordTaskClass": record_task_name,
                "instanceUrl": instance_url,
                "pageOrigin": page_origin,
                "workarenaApiCandidateCount": workarena_api_candidate_count,
                "sysId": sys_id,
                "candidateCount": len(records),
                "sysCreatedOn": first_record.get("sys_created_on"),
                "sysUpdatedOn": first_record.get("sys_updated_on"),
                "source": record_source,
                "existing": False,
            }
        except Exception as exc:  # noqa: BLE001 - preserve validation diagnostics.
            return {
                "attempted": True,
                "ok": False,
                "recordNumber": record_number,
                "sessionKey": session_key,
                "table": table_name,
                "recordTaskClass": record_task_name,
                "error": f"{type(exc).__name__}: {str(exc)[:1000]}",
            }

    def _query_submitted_record_from_page_session(
        self,
        page: Any,
        table_name: str,
        record_number: str | None,
        direct_sys_id: str | None,
    ) -> list[dict[str, Any]]:
        if direct_sys_id is None and record_number is None:
            return []

        try:
            records = page.evaluate(
                """async payload => {
                    const table = encodeURIComponent(payload.tableName);
                    const fields = "sys_id,number,sys_created_on,sys_updated_on";
                    const headers = { Accept: "application/json" };
                    if (window.g_ck) headers["X-UserToken"] = String(window.g_ck);
                    let url;
                    if (payload.directSysId) {
                        url = `/api/now/table/${table}/${encodeURIComponent(payload.directSysId)}?sysparm_fields=${fields}`;
                    } else {
                        const params = new URLSearchParams({
                            sysparm_query: `number=${payload.recordNumber}^ORDERBYDESCsys_created_on`,
                            sysparm_fields: fields,
                            sysparm_limit: "5",
                        });
                        url = `/api/now/table/${table}?${params.toString()}`;
                    }

                    for (let attempt = 0; attempt < 8; attempt += 1) {
                        const response = await fetch(url, {
                            credentials: "same-origin",
                            headers,
                        });
                        if (response.ok) {
                            const payload = await response.json();
                            const result = payload && payload.result;
                            if (Array.isArray(result) && result.length > 0) return result;
                            if (result && typeof result === "object" && result.sys_id) return [result];
                        }
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    return [];
                }""",
                {
                    "tableName": table_name,
                    "recordNumber": record_number,
                    "directSysId": direct_sys_id,
                },
            )
        except Exception:
            return []

        if not isinstance(records, list):
            return []
        return [record for record in records if isinstance(record, dict)]

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
            if record_sync.get("ok") is not True:
                catalog_record_sync = self._resolve_catalog_request_record_id(
                    submitted_record_number
                )
                if catalog_record_sync.get("ok") is True:
                    record_sync = catalog_record_sync
            record_url_sync = self._sync_record_detail_url(active_url, record_sync)
            answer_sync = self._sync_assistant_answer(final_answer)
            reward, done, user_message, info = self.env.unwrapped._task_validate()
            validation_details = info if isinstance(info, dict) else {}
            validation_details = {
                **validation_details,
                "urlSync": url_sync,
                "storageSync": storage_sync,
                "reloadSync": reload_sync,
                "recordSync": record_sync,
                "recordUrlSync": record_url_sync,
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
        task = getattr(browser_env, "task", None)
        role = "infeasible" if hasattr(task, "infeasible_reasons") else "assistant"
        messages = getattr(chat, "messages", [])
        if (
            isinstance(messages, list)
            and messages
            and isinstance(messages[-1], dict)
            and messages[-1].get("role") == role
            and messages[-1].get("message") == answer
        ):
            return {
                "attempted": True,
                "ok": True,
                "existing": True,
                "role": role,
                "messageLength": len(answer),
            }

        try:
            chat.add_message(role=role, msg=answer)
        except Exception:
            if not isinstance(messages, list):
                return {
                    "attempted": True,
                    "ok": False,
                    "error": "BrowserGym chat messages are not mutable.",
                }
            messages.append({"role": role, "message": answer})

        return {
            "attempted": True,
            "ok": True,
            "existing": False,
            "role": role,
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
