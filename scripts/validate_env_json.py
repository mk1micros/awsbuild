#!/usr/bin/env python3
import json, sys
from typing import Any, Dict, List


def fail(msg: str):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def load(path: str) -> Dict[str, Any]:
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        fail(f"failed to load JSON '{path}': {e}")


def is_str(x: Any) -> bool:
    return isinstance(x, str) and len(x.strip()) > 0


def validate(root: Dict[str, Any]) -> None:
    # environments must be a list
    envs = root.get("environments")
    if not isinstance(envs, list):
        fail("'environments' must be a list")
    for i, env in enumerate(envs):
        if not isinstance(env, dict):
            fail(f"environments[{i}] must be an object")
        if not is_str(env.get("name", "")):
            fail(f"environments[{i}].name must be a non-empty string")
        access = env.get("access")
        if access is None:
            # allow missing access; continue
            continue
        if not isinstance(access, list):
            fail(f"environments[{i}].access must be a list")
        for j, entry in enumerate(access):
            if not isinstance(entry, dict):
                fail(f"environments[{i}].access[{j}] must be an object")
            if not is_str(entry.get("sso_group_name", "")):
                fail(f"environments[{i}].access[{j}].sso_group_name must be a non-empty string")
            if not is_str(entry.get("level", "")):
                fail(f"environments[{i}].access[{j}].level must be a non-empty string")
    # optional codeowners array of strings
    if "codeowners" in root:
        co = root["codeowners"]
        if not isinstance(co, list) or not all(isinstance(x, str) for x in co):
            fail("'codeowners' must be a list of strings when present")
    # optional tags object
    if "tags" in root and not isinstance(root["tags"], dict):
        fail("'tags' must be an object when present")


def main():
    if len(sys.argv) != 2:
        fail("usage: validate_env_json.py <path>")
    data = load(sys.argv[1])
    validate(data)
    print("Environment JSON validation passed")


if __name__ == "__main__":
    main()
