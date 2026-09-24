#!/usr/bin/env python3
"""Validate Xiaopu article workspace integrity and release readiness.

The parser intentionally supports the small Markdown/YAML subset documented by
xiaopu-writing. It uses only the Python standard library so it can run in a
fresh Codex environment.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Finding:
    code: str
    message: str


EVIDENCE_LEVEL = {
    "none": 0,
    "public_only": 1,
    "used_once": 2,
    "scenario_tested": 3,
    "controlled_comparison": 4,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a xiaopu-writing article workspace."
    )
    parser.add_argument("workspace", type=Path, help="Article workspace path")
    parser.add_argument(
        "--profile",
        choices=("work", "release"),
        default="work",
        help="work checks integrity; release also enforces publication gates",
    )
    return parser.parse_args()


def clean_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def frontmatter(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for index in range(1, len(lines)):
        if lines[index].strip() == "---":
            return "\n".join(lines[1:index])
    return ""


def scalar(text: str, key: str, *, top_level: bool = False) -> str:
    indent = "" if top_level else r"\s*"
    match = re.search(
        rf"^{indent}{re.escape(key)}:[ \t]*([^\r\n]*)[ \t]*$",
        text,
        flags=re.MULTILINE,
    )
    return clean_scalar(match.group(1)) if match else ""


def section(text: str, key: str) -> str:
    match = re.search(
        rf"^{re.escape(key)}:\s*$\n(.*?)(?=^[A-Za-z_][\w-]*:\s*|\Z)",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
    return match.group(1) if match else ""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(raw: str, base: Path) -> Path:
    path = Path(raw).expanduser()
    return path if path.is_absolute() else base / path


def image_size(path: Path) -> tuple[int, int] | None:
    try:
        with path.open("rb") as handle:
            head = handle.read(24)
            if head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 24:
                return struct.unpack(">II", head[16:24])
            if head[:6] in (b"GIF87a", b"GIF89a") and len(head) >= 10:
                return struct.unpack("<HH", head[6:10])
            if head[:2] != b"\xff\xd8":
                return None
            handle.seek(2)
            while True:
                byte = handle.read(1)
                while byte == b"\xff":
                    byte = handle.read(1)
                if not byte:
                    return None
                marker = byte[0]
                length_raw = handle.read(2)
                if len(length_raw) != 2:
                    return None
                length = struct.unpack(">H", length_raw)[0]
                if marker in {
                    0xC0,
                    0xC1,
                    0xC2,
                    0xC3,
                    0xC5,
                    0xC6,
                    0xC7,
                    0xC9,
                    0xCA,
                    0xCB,
                    0xCD,
                    0xCE,
                    0xCF,
                }:
                    data = handle.read(5)
                    if len(data) != 5:
                        return None
                    height, width = struct.unpack(">HH", data[1:5])
                    return width, height
                handle.seek(max(length - 2, 0), 1)
    except OSError:
        return None


def visual_yaml(handoff: str) -> str:
    match = re.search(
        r"^## 视觉任务\s*$.*?^```ya?ml\s*$\n(.*?)^```\s*$",
        handoff,
        flags=re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    return match.group(1) if match else ""


def task_blocks(yaml_text: str) -> list[str]:
    starts = list(re.finditer(r"^- id:\s*.*$", yaml_text, flags=re.MULTILINE))
    blocks: list[str] = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(yaml_text)
        blocks.append(yaml_text[match.start() : end].rstrip())
    return blocks


def claim_gate_blocks(metadata: str) -> list[str]:
    gate_section = section(metadata, "claim_gates")
    starts = list(
        re.finditer(r"^  - claim_id:[ \t]*[^\r\n]*$", gate_section, re.MULTILINE)
    )
    blocks: list[str] = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(gate_section)
        blocks.append(gate_section[match.start() : end].rstrip())
    return blocks


def claim_gate_fields(block: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    first = re.search(
        r"^  - claim_id:[ \t]*([^\r\n]*)[ \t]*$", block, re.MULTILINE
    )
    if first:
        fields["claim_id"] = clean_scalar(first.group(1))
    for match in re.finditer(
        r"^    ([A-Za-z_][\w-]*):[ \t]*([^\r\n]*)[ \t]*$",
        block,
        re.MULTILINE,
    ):
        fields[match.group(1)] = clean_scalar(match.group(2))
    return fields


def task_fields(block: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    first = re.search(r"^- id:[ \t]*([^\r\n]*)[ \t]*$", block, flags=re.MULTILINE)
    if first:
        fields["id"] = clean_scalar(first.group(1))
    for match in re.finditer(
        r"^  ([A-Za-z_][\w-]*):[ \t]*([^\r\n]*)[ \t]*$",
        block,
        flags=re.MULTILINE,
    ):
        fields[match.group(1)] = clean_scalar(match.group(2))
    return fields


def input_assets(block: str) -> list[tuple[str, str]]:
    match = re.search(
        r"^  input_assets:\s*$\n(.*?)(?=^  [A-Za-z_][\w-]*:\s*|\Z)",
        block,
        flags=re.MULTILINE | re.DOTALL,
    )
    if not match:
        return []
    assets: list[tuple[str, str]] = []
    current_path = ""
    current_hash = ""
    for line in match.group(1).splitlines():
        path_match = re.match(r"^\s*- path:\s*(.*?)\s*$", line)
        hash_match = re.match(r"^\s*sha256:\s*(.*?)\s*$", line)
        if path_match:
            if current_path:
                assets.append((clean_scalar(current_path), clean_scalar(current_hash)))
            current_path = path_match.group(1)
            current_hash = ""
        elif hash_match and current_path:
            current_hash = hash_match.group(1)
    if current_path:
        assets.append((clean_scalar(current_path), clean_scalar(current_hash)))
    return assets


def style_contract(handoff: str) -> tuple[str, str]:
    match = re.search(
        r"^style_contract:\s*$\n(.*?)(?=^[A-Za-z_][\w-]*:\s*|^## |\Z)",
        handoff,
        flags=re.MULTILINE | re.DOTALL,
    )
    if not match:
        return "", ""
    block = match.group(1)
    return scalar(block, "style_reference"), scalar(
        block, "style_reference_sha256"
    )


def normalized_size(value: str) -> str:
    return re.sub(r"\s+", "", value.lower().replace("×", "x"))


def check_file_hash(
    path_raw: str,
    expected_hash: str,
    base: Path,
    code_prefix: str,
    label: str,
) -> list[Finding]:
    findings: list[Finding] = []
    if not path_raw:
        return findings
    path = resolve_path(path_raw, base)
    if not path.is_file():
        return [Finding(f"{code_prefix}_MISSING", f"{label} does not exist: {path}")]
    if not expected_hash:
        findings.append(
            Finding(f"{code_prefix}_HASH_MISSING", f"{label} has no SHA-256: {path}")
        )
    elif sha256(path) != expected_hash:
        findings.append(
            Finding(f"{code_prefix}_HASH_MISMATCH", f"{label} SHA-256 mismatch: {path}")
        )
    return findings


def validate(workspace: Path, profile: str) -> list[Finding]:
    findings: list[Finding] = []
    workspace = workspace.expanduser().resolve()
    brief_path = workspace / "文章简报.md"
    draft_path = workspace / "草稿.md"
    handoff_path = workspace / "配图交接.md"

    for path in (brief_path, draft_path, handoff_path):
        if not path.exists():
            findings.append(Finding("REQUIRED_FILE", f"required file missing: {path}"))
    if findings:
        return findings

    try:
        brief = brief_path.read_text(encoding="utf-8")
        handoff = handoff_path.read_text(encoding="utf-8")
    except OSError as error:
        return [Finding("READ_ERROR", str(error))]

    metadata = frontmatter(brief)
    if not metadata:
        findings.append(Finding("BRIEF_FRONTMATTER", "文章简报.md has no closed frontmatter"))
        return findings

    canonical_raw = scalar(metadata, "canonical_body_path", top_level=True)
    workspace_body_raw = scalar(metadata, "workspace_body_path", top_level=True)
    alias_mode = scalar(metadata, "body_alias_mode", top_level=True)
    canonical = resolve_path(canonical_raw, workspace) if canonical_raw else None
    workspace_body = resolve_path(workspace_body_raw or "草稿.md", workspace)

    if canonical is None:
        findings.append(Finding("CANONICAL_BODY", "canonical_body_path is missing"))
    elif not canonical.is_file():
        findings.append(Finding("CANONICAL_BODY", f"canonical body missing: {canonical}"))

    if alias_mode == "symlink_to_canonical":
        if not workspace_body.is_symlink():
            findings.append(
                Finding("BODY_ALIAS", f"workspace body must be a symlink: {workspace_body}")
            )
        elif canonical is not None and workspace_body.resolve() != canonical.resolve():
            findings.append(
                Finding(
                    "BODY_ALIAS_TARGET",
                    f"workspace body resolves to {workspace_body.resolve()}, expected {canonical}",
                )
            )
    elif alias_mode == "file":
        if workspace_body.is_symlink():
            findings.append(
                Finding("BODY_ALIAS", f"body_alias_mode is file but path is a symlink: {workspace_body}")
            )
        if canonical is not None and workspace_body.resolve() != canonical.resolve():
            findings.append(
                Finding(
                    "DUPLICATE_BODY",
                    "body_alias_mode file requires workspace_body_path to be the canonical body",
                )
            )
    else:
        findings.append(
            Finding("BODY_ALIAS_MODE", "body_alias_mode must be file or symlink_to_canonical")
        )

    locked_hash = scalar(metadata, "locked_draft_sha256")
    if canonical is not None and canonical.is_file():
        actual_body_hash = sha256(canonical)
        if not locked_hash:
            findings.append(Finding("BODY_HASH_MISSING", "locked_draft_sha256 is missing"))
        elif locked_hash != actual_body_hash:
            findings.append(
                Finding(
                    "BODY_HASH_MISMATCH",
                    f"locked draft {locked_hash} != canonical body {actual_body_hash}",
                )
            )

    gates = [claim_gate_fields(block) for block in claim_gate_blocks(metadata)]
    allowed_gate_statuses = {"evidence_pending", "supported", "downgraded", "removed"}
    for gate in gates:
        gate_id = gate.get("claim_id", "<unknown>")
        status = gate.get("status", "")
        required = gate.get("required_evidence_level", "")
        actual = gate.get("actual_evidence_level", "")
        if status not in allowed_gate_statuses:
            findings.append(
                Finding("CLAIM_STATUS", f"{gate_id}: invalid or missing status {status!r}")
            )
        if required not in EVIDENCE_LEVEL:
            findings.append(
                Finding("CLAIM_REQUIRED_LEVEL", f"{gate_id}: invalid required level {required!r}")
            )
        if actual not in EVIDENCE_LEVEL:
            findings.append(
                Finding("CLAIM_ACTUAL_LEVEL", f"{gate_id}: invalid actual level {actual!r}")
            )
        if (
            status == "supported"
            and required in EVIDENCE_LEVEL
            and actual in EVIDENCE_LEVEL
            and EVIDENCE_LEVEL[actual] < EVIDENCE_LEVEL[required]
        ):
            findings.append(
                Finding(
                    "CLAIM_EVIDENCE",
                    f"{gate_id}: supported at {actual}, requires {required}",
                )
            )
        artifacts = gate.get("evidence_artifact_ids", "")
        if status == "supported" and artifacts in {"", "[]"}:
            findings.append(
                Finding("CLAIM_ARTIFACT", f"{gate_id}: supported claim has no evidence artifacts")
            )

    testing_status = scalar(metadata, "testing_status", top_level=True)
    unresolved_gates = [
        gate.get("claim_id", "<unknown>")
        for gate in gates
        if gate.get("status", "") not in {"supported", "downgraded", "removed"}
    ]
    if testing_status == "publish_gate_passed" and unresolved_gates:
        findings.append(
            Finding(
                "TESTING_STATE",
                "publish_gate_passed conflicts with unresolved claims: "
                + ", ".join(unresolved_gates),
            )
        )

    yaml_text = visual_yaml(handoff)
    if not yaml_text:
        findings.append(Finding("VISUAL_MANIFEST", "配图交接.md has no 视觉任务 YAML block"))
        return findings
    blocks = task_blocks(yaml_text)
    if not blocks:
        findings.append(Finding("VISUAL_TASKS", "visual manifest contains no tasks"))
        return findings

    global_style, global_style_hash = style_contract(handoff)
    findings.extend(
        check_file_hash(
            global_style,
            global_style_hash,
            workspace,
            "STYLE_REFERENCE",
            "style contract reference",
        )
    )

    tasks: list[dict[str, str]] = []
    for block in blocks:
        fields = task_fields(block)
        tasks.append(fields)
        task_id = fields.get("id", "<unknown>")
        status = fields.get("status", "")

        if not status:
            findings.append(Finding("TASK_STATUS", f"{task_id}: status is missing"))

        if fields.get("ip_role", "").lower() == "none":
            placeholder = fields.get("placeholder", "")
            positive_ip = (
                "小普 IP 作为" in placeholder
                or "小普 IP 仅" in placeholder
                or "加入小普" in placeholder
                or "出现小普" in placeholder
            )
            if positive_ip:
                findings.append(
                    Finding(
                        "IP_ROLE_CONFLICT",
                        f"{task_id}: ip_role none conflicts with placeholder: {placeholder}",
                    )
                )

        task_style = fields.get("style_reference", "")
        task_style_hash = fields.get("style_reference_sha256", "")
        findings.extend(
            check_file_hash(
                task_style,
                task_style_hash,
                workspace,
                "TASK_STYLE_REFERENCE",
                f"{task_id} style reference",
            )
        )

        for asset_path, asset_hash in input_assets(block):
            findings.extend(
                check_file_hash(
                    asset_path,
                    asset_hash,
                    workspace,
                    "INPUT_ASSET",
                    f"{task_id} input asset",
                )
            )

        if status == "ready":
            output_raw = fields.get("output_path", "")
            output_hash = fields.get("file_sha256", "")
            size_raw = fields.get("pixel_size", "")
            if not output_raw:
                findings.append(Finding("READY_OUTPUT", f"{task_id}: ready task has no output_path"))
                continue
            output = resolve_path(output_raw, workspace)
            if not output.is_file():
                findings.append(Finding("READY_OUTPUT", f"{task_id}: output missing: {output}"))
                continue
            if not output_hash:
                findings.append(Finding("READY_HASH", f"{task_id}: ready task has no file_sha256"))
            elif sha256(output) != output_hash:
                findings.append(Finding("READY_HASH", f"{task_id}: output SHA-256 mismatch"))
            actual_size = image_size(output)
            if not size_raw:
                findings.append(Finding("READY_SIZE", f"{task_id}: ready task has no pixel_size"))
            elif actual_size is None:
                findings.append(Finding("READY_SIZE", f"{task_id}: cannot read image dimensions"))
            elif normalized_size(size_raw) != f"{actual_size[0]}x{actual_size[1]}":
                findings.append(
                    Finding(
                        "READY_SIZE",
                        f"{task_id}: recorded {size_raw}, actual {actual_size[0]}x{actual_size[1]}",
                    )
                )

    visual_status = scalar(metadata, "visual_status", top_level=True)
    task_statuses = [task.get("status", "") for task in tasks]
    if "waiting_source" in task_statuses and visual_status != "evidence_waiting":
        findings.append(
            Finding(
                "VISUAL_STATE",
                "waiting_source task requires visual_status evidence_waiting",
            )
        )
    if visual_status == "assets_ready" and any(
        status not in {"ready", "declined"} for status in task_statuses
    ):
        findings.append(
            Finding(
                "VISUAL_STATE",
                "visual_status assets_ready requires every task to be ready or declined",
            )
        )

    if profile == "release":
        content_status = scalar(metadata, "content_status", top_level=True)
        publication_status = scalar(metadata, "publication_status", top_level=True)
        if content_status != "locked":
            findings.append(Finding("RELEASE_CONTENT", "content_status must be locked"))
        if testing_status not in {"not_applicable", "publish_gate_passed"}:
            findings.append(
                Finding(
                    "RELEASE_TESTING",
                    "testing_status must be not_applicable or publish_gate_passed",
                )
            )
        if unresolved_gates:
            findings.append(
                Finding(
                    "RELEASE_CLAIMS",
                    "claim_gates are unresolved: " + ", ".join(unresolved_gates),
                )
            )
        if visual_status != "assets_ready":
            findings.append(Finding("RELEASE_VISUAL", "visual_status must be assets_ready"))
        if publication_status not in {"ready", "published"}:
            findings.append(
                Finding("RELEASE_STATUS", "publication_status must be ready or published")
            )
        incomplete = [
            task.get("id", "<unknown>")
            for task in tasks
            if task.get("status", "") not in {"ready", "declined"}
        ]
        if incomplete:
            findings.append(
                Finding(
                    "RELEASE_TASKS",
                    "visual tasks not resolved: " + ", ".join(incomplete),
                )
            )

        if canonical is not None and canonical.is_file():
            article_text = canonical.read_text(encoding="utf-8")
            for task in tasks:
                if task.get("status") != "ready":
                    continue
                output_raw = task.get("output_path", "")
                if output_raw and Path(output_raw).name not in article_text:
                    findings.append(
                        Finding(
                            "RELEASE_WRITEBACK",
                            f"{task.get('id', '<unknown>')}: output filename is not referenced by article",
                        )
                    )

            lint_script = Path(__file__).with_name("lint-article.py")
            result = subprocess.run(
                [sys.executable, str(lint_script), "--publication", str(canonical)],
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                details = " | ".join(
                    line for line in result.stdout.splitlines()[:3] if line.strip()
                )
                findings.append(
                    Finding(
                        "ARTICLE_PUBLICATION_LINT",
                        details or "article publication lint failed",
                    )
                )

    return findings


def main() -> int:
    args = parse_args()
    findings = validate(args.workspace, args.profile)
    for finding in findings:
        print(f"{finding.code}: {finding.message}")
    if findings:
        print(f"{len(findings)} finding(s)", file=sys.stderr)
        return 1
    print(f"Workspace {args.profile} profile passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
