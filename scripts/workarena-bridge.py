#!/usr/bin/env python3
"""Small WorkArena environment probe used by scripts/workarena-doctor.ts."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import platform
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from typing import Any


DATASET_ID = "ServiceNow/WorkArena-Instances"
DATASET_INSTANCE_FILE = "instances_v2.json"


if os.environ.get("HUGGING_FACE_HUB_TOKEN") and not os.environ.get("HF_TOKEN"):
    os.environ["HF_TOKEN"] = os.environ["HUGGING_FACE_HUB_TOKEN"]


@dataclass
class Check:
    name: str
    status: str
    detail: str


@dataclass
class TaskInfo:
    id: str
    category: str | None
    kind: str
    level: str | None
    seed: int | None
    className: str


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False


def check_import(name: str, module_names: list[str]) -> Check:
    found = [module_name for module_name in module_names if has_module(module_name)]
    if found:
        return Check(name, "ok", f"importable as {', '.join(found)}")
    return Check(name, "missing", f"not importable; tried {', '.join(module_names)}")


def check_hf_access(token_present: bool) -> Check:
    if not token_present:
        return Check(
            "huggingface_access",
            "missing",
            "HUGGING_FACE_HUB_TOKEN is not set",
        )
    if not has_module("huggingface_hub"):
        return Check(
            "huggingface_access",
            "blocked",
            "huggingface_hub is not installed, so gated dataset access cannot be checked",
        )

    try:
        from huggingface_hub import hf_hub_download

        hf_hub_download(
            repo_id=DATASET_ID,
            filename=DATASET_INSTANCE_FILE,
            repo_type="dataset",
            token=os.environ.get("HUGGING_FACE_HUB_TOKEN") or os.environ.get("HF_TOKEN"),
        )
        return Check(
            "huggingface_access",
            "ok",
            f"access granted for {DATASET_ID}/{DATASET_INSTANCE_FILE}",
        )
    except Exception as exc:  # noqa: BLE001 - keep diagnostic broad and non-fatal.
        message = str(exc).replace(os.environ.get("HUGGING_FACE_HUB_TOKEN", ""), "<redacted>")
        lower = message.lower()
        if "gated" in lower or "awaiting" in lower or "403" in lower or "401" in lower:
            return Check(
                "huggingface_access",
                "pending",
                f"token found, but gated dataset access is not available yet: {message[:400]}",
            )
        return Check(
            "huggingface_access",
            "blocked",
            f"could not verify gated dataset access: {message[:400]}",
        )


def check_playwright_browser() -> Check:
    if not has_module("playwright"):
        return Check("playwright_browser", "missing", "playwright package is not installed")

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            executable = playwright.chromium.executable_path
            if executable and os.path.exists(executable):
                return Check(
                    "playwright_browser",
                    "ok",
                    f"chromium executable found at {executable}",
                )
            return Check(
                "playwright_browser",
                "missing",
                "chromium executable was not found; run `python -m playwright install`",
            )
    except Exception as exc:  # noqa: BLE001 - Playwright reports platform-specific setup errors.
        return Check(
            "playwright_browser",
            "blocked",
            f"could not inspect Playwright chromium install: {str(exc)[:400]}",
        )


def check_playwright_cli() -> Check:
    if not has_module("playwright"):
        return Check("playwright_cli", "missing", "playwright package is not installed")

    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "--version"],
            capture_output=True,
            check=False,
            text=True,
            timeout=15,
        )
        output = (result.stdout or result.stderr).strip()
        if result.returncode == 0:
            return Check("playwright_cli", "ok", output)
        return Check("playwright_cli", "blocked", output or "playwright CLI failed")
    except Exception as exc:  # noqa: BLE001 - command failures should stay diagnostic.
        return Check("playwright_cli", "blocked", str(exc)[:400])


def build_result(args: argparse.Namespace) -> dict[str, Any]:
    token_present = bool(os.environ.get("HUGGING_FACE_HUB_TOKEN"))
    checks = [
        Check(
            "python",
            "ok",
            f"{platform.python_implementation()} {platform.python_version()} at {sys.executable}",
        ),
        Check(
            "huggingface_token",
            "ok" if token_present else "missing",
            "HUGGING_FACE_HUB_TOKEN is set" if token_present else "HUGGING_FACE_HUB_TOKEN is not set",
        ),
        check_import("huggingface_hub", ["huggingface_hub"]),
        check_import("browsergym_workarena", ["browsergym.workarena", "browsergym_workarena"]),
        check_import("browsergym_core", ["browsergym.core", "browsergym"]),
        check_import("gymnasium", ["gymnasium"]),
        check_import("playwright_package", ["playwright"]),
        check_playwright_cli(),
        check_playwright_browser(),
        check_hf_access(token_present),
    ]

    hard_failures = {"missing", "blocked"}
    if args.allow_pending_hf:
        ready = all(
            check.status not in hard_failures
            for check in checks
            if check.name != "huggingface_access"
        )
    else:
        ready = all(check.status == "ok" for check in checks)

    return {
        "benchmark": "workarena",
        "ready": ready,
        "dataset": DATASET_ID,
        "pythonExecutable": sys.executable,
        "platform": platform.platform(),
        "checks": [asdict(check) for check in checks],
    }


def infer_level(task_id: str) -> str | None:
    if task_id.endswith("-l1"):
        return "l1"
    if task_id.endswith("-l2"):
        return "l2"
    if task_id.endswith("-l3"):
        return "l3"
    return None


def task_info(task_class: type, category: str | None = None, seed: int | None = None) -> TaskInfo:
    import browsergym.workarena as workarena

    task_id = task_class.get_task_id()
    _, mapped_category = workarena.get_task_category(task_id)
    is_atomic = task_id in set(workarena.workarena_tasks_atomic)
    return TaskInfo(
        id=task_id,
        category=category or mapped_category,
        kind="atomic" if is_atomic else "compositional",
        level=infer_level(task_id),
        seed=seed,
        className=task_class.__name__,
    )


def curriculum_category_map(level: str) -> dict[str, str]:
    import browsergym.workarena as workarena

    curriculum = (
        workarena.AGENT_CURRICULUM_L2
        if level == "l2"
        else workarena.AGENT_CURRICULUM_L3
    )
    categories: dict[str, str] = {}
    for category, items in curriculum.items():
        for bucket in items["buckets"]:
            for task_class in bucket:
                categories[task_class.get_task_id()] = category
    return categories


def compositional_category_map() -> dict[str, str]:
    categories = curriculum_category_map("l2")
    categories.update(curriculum_category_map("l3"))
    return categories


def build_list_result(args: argparse.Namespace) -> dict[str, Any]:
    import browsergym.workarena as workarena

    suite = args.suite
    tasks: list[TaskInfo] = []

    if suite == "atomic":
        tasks = [task_info(task_class) for task_class in workarena.ATOMIC_TASKS]
    elif suite == "all":
        categories = compositional_category_map()
        tasks = [
            task_info(task_class, category=categories.get(task_class.get_task_id()))
            for task_class in workarena.ALL_WORKARENA_TASKS
        ]
    else:
        categories = curriculum_category_map(suite)
        for task_class, seed in workarena.get_all_tasks_agents(suite):
            tasks.append(
                task_info(
                    task_class,
                    category=categories.get(task_class.get_task_id()),
                    seed=seed,
                )
            )

    if args.category:
        tasks = [task for task in tasks if task.category == args.category]

    categories: dict[str, int] = {}
    for task in tasks:
        category = task.category or "uncategorized"
        categories[category] = categories.get(category, 0) + 1

    return {
        "benchmark": "workarena",
        "suite": suite,
        "count": len(tasks),
        "categories": [
            {"category": category, "count": count}
            for category, count in sorted(categories.items())
        ],
        "tasks": [asdict(task) for task in tasks],
    }


def get_task_class(task_id: str) -> type:
    import browsergym.workarena as workarena

    for task_class in workarena.ALL_WORKARENA_TASKS:
        if task_class.get_task_id() == task_id:
            return task_class
    raise ValueError(f"Unknown WorkArena task id: {task_id}")


def task_category(task_id: str) -> str | None:
    import browsergym.workarena as workarena

    _, category = workarena.get_task_category(task_id)
    if category:
        return category
    return compositional_category_map().get(task_id)


def compact_goal_object(goal_object: Any) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for message in list(goal_object or []):
        if not isinstance(message, dict):
            compact.append({"type": "unknown", "text": str(message)})
            continue
        msg_type = message.get("type")
        if msg_type == "text":
            compact.append({"type": "text", "text": message.get("text", "")})
        elif msg_type == "image_url":
            compact.append({"type": "image_url", "image_url": "<image omitted>"})
        else:
            compact.append({"type": str(msg_type), "text": str(message)[:500]})
    return compact


def build_dry_result(args: argparse.Namespace) -> dict[str, Any]:
    import gymnasium as gym

    # Importing WorkArena registers browsergym/workarena.* env ids.
    import browsergym.workarena  # noqa: F401

    task_id = args.task
    task_class = get_task_class(task_id)
    env_id = f"browsergym/{task_id}"
    level = infer_level(task_id)
    category = task_category(task_id)
    seed = args.seed

    result: dict[str, Any] = {
        "benchmark": "workarena",
        "mode": "dry",
        "taskId": task_id,
        "envId": env_id,
        "seed": seed,
        "category": category,
        "kind": "atomic" if level is None else "compositional",
        "level": level,
        "className": task_class.__name__,
        "resetAttempted": not args.no_reset,
        "resetSucceeded": False,
        "teardownSucceeded": None,
        "durationMs": 0,
        "goal": None,
        "goalObject": [],
        "startUrl": None,
        "activeUrl": None,
        "openPages": [],
        "openPageTitles": [],
        "taskInfo": {},
        "error": None,
        "notes": [
            "No OpenSidebar run was started.",
            "No LLM provider calls were made.",
        ],
    }

    if args.no_reset:
        result["notes"].append("Environment reset was skipped by --no-reset.")
        return result

    env = None
    start = time.time()
    try:
        env = gym.make(
            env_id,
            headless=not args.show_browser,
            wait_for_user_message=False,
            use_raw_page_output=True,
        )
        obs, info = env.reset(seed=seed)
        browser_env = env.unwrapped
        task = browser_env.task
        result.update(
            {
                "resetSucceeded": True,
                "goal": obs.get("goal"),
                "goalObject": compact_goal_object(obs.get("goal_object")),
                "startUrl": getattr(task, "start_url", None),
                "activeUrl": obs.get("url"),
                "openPages": list(obs.get("open_pages_urls", [])),
                "openPageTitles": list(obs.get("open_pages_titles", [])),
                "taskInfo": info.get("task_info", {}),
            }
        )
    except Exception as exc:  # noqa: BLE001 - diagnostics should preserve failures.
        result["error"] = f"{type(exc).__name__}: {str(exc)[:1000]}"
    finally:
        if env is not None:
            try:
                env.close()
                result["teardownSucceeded"] = True
            except Exception as exc:  # noqa: BLE001 - teardown failure is diagnostic.
                result["teardownSucceeded"] = False
                result["teardownError"] = f"{type(exc).__name__}: {str(exc)[:1000]}"
        result["durationMs"] = int((time.time() - start) * 1000)

    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", nargs="?", choices=["doctor", "list", "dry"], default="doctor")
    parser.add_argument("--allow-pending-hf", action="store_true")
    parser.add_argument("--suite", choices=["all", "atomic", "l1", "l2", "l3"], default="all")
    parser.add_argument("--category")
    parser.add_argument("--task")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-reset", action="store_true")
    parser.add_argument("--show-browser", action="store_true")
    args = parser.parse_args()
    if args.command == "list":
        result = build_list_result(args)
    elif args.command == "dry":
        if not args.task:
            parser.error("--task is required for dry")
        result = build_dry_result(args)
    else:
        result = build_result(args)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
