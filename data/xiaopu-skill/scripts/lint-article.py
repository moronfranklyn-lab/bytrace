#!/usr/bin/env python3
"""Find deterministic risks in a Xiaopu Markdown draft or publication package.

This linter is intentionally narrow. It does not score originality, evidence,
argument quality, naturalness, or resemblance to Xiaopu.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


BANNED_PHRASES = (
    "让我们一起",
    "在当今时代",
    "不可否认",
    "综上所述",
    "值得注意的是",
    "不难发现",
    "说白了",
    "这意味着",
    "本质上",
    "换句话说",
)

UNRESOLVED_PATTERNS = (
    (re.compile(r"【待确认[^】]*】"), "unresolved confirmation marker"),
    (re.compile(r"【待补(?:充)?[^】]*】"), "unresolved content marker"),
    (re.compile(r"【事实待核[^】]*】"), "unresolved fact marker"),
    (re.compile(r"\b(?:TODO|TBD)\b", re.IGNORECASE), "unresolved task marker"),
)

SUGGESTED_VISUAL = re.compile(
    r"【建议(?:配图|封面)｜[^｜】]+｜[^｜】]+｜[^】]+】"
)
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]+\)")
WIKI_IMAGE = re.compile(r"!\[\[([^\]]+)\]\]")
PENDING_PUBLICATION_STATUS = re.compile(
    r"(?:草稿|待配图|待(?:真实)?证据|待写回|未完成|evidence_pending|visual_[a-z_]+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Finding:
    line: int
    code: str
    message: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Lint deterministic risks in a Xiaopu Markdown article."
    )
    parser.add_argument("article", type=Path, help="Path to one Markdown article")
    parser.add_argument(
        "--publication",
        action="store_true",
        help="Fail on unresolved visual suggestions, pending status, or missing image files",
    )
    parser.add_argument(
        "--image-dir",
        type=Path,
        help="Directory for bare Obsidian image filenames; defaults to <article parent>/插图",
    )
    return parser.parse_args()


def body_with_line_numbers(text: str) -> list[tuple[int, str]]:
    """Return body lines while preserving original one-based line numbers."""
    lines = text.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                start = index + 1
                break
    return [(index + 1, line) for index, line in enumerate(lines[start:], start=start)]


def lint_line(number: int, line: str, publication: bool = False) -> list[Finding]:
    findings: list[Finding] = []

    for phrase in BANNED_PHRASES:
        if phrase in line:
            findings.append(
                Finding(number, "AI_PHRASE", f"review high-risk phrase: {phrase}")
            )

    if "—" in line:
        findings.append(Finding(number, "DASH", "review em dash usage"))

    if "→" in line or "⇒" in line:
        findings.append(
            Finding(number, "LOGIC_ARROW", "replace prose logic arrows with words")
        )

    for pattern, message in UNRESOLVED_PATTERNS:
        if pattern.search(line):
            findings.append(Finding(number, "UNRESOLVED", message))

    if ("【建议配图" in line or "【建议封面" in line) and not SUGGESTED_VISUAL.search(line):
        findings.append(
            Finding(
                number,
                "IMAGE_SUGGESTION",
                "use 【建议配图/封面｜类型｜作用｜素材要求】",
            )
        )

    if publication and SUGGESTED_VISUAL.search(line):
        findings.append(
            Finding(
                number,
                "UNRESOLVED_VISUAL",
                "publication still contains a suggested cover or image placeholder",
            )
        )

    if "![[" in line and "]]" not in line:
        findings.append(
            Finding(number, "WIKI_IMAGE", "unclosed Obsidian image placeholder")
        )

    if "![" in line and "![[" not in line and not MARKDOWN_IMAGE.search(line):
        findings.append(
            Finding(number, "MD_IMAGE", "malformed Markdown image syntax")
        )

    return findings


def lint(text: str, publication: bool = False) -> list[Finding]:
    findings: list[Finding] = []
    for number, line in body_with_line_numbers(text):
        findings.extend(lint_line(number, line, publication=publication))
    return findings


def publication_findings(
    text: str, article: Path, image_dir: Path | None
) -> list[Finding]:
    findings: list[Finding] = []
    lines = text.splitlines()

    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            line = lines[index]
            if line.strip() == "---":
                break
            if line.startswith("status:"):
                status = line.partition(":")[2].strip()
                if PENDING_PUBLICATION_STATUS.search(status):
                    findings.append(
                        Finding(
                            index + 1,
                            "PENDING_STATUS",
                            f"publication frontmatter is still pending: {status}",
                        )
                    )

    bare_image_dir = image_dir or article.parent / "插图"
    for number, line in body_with_line_numbers(text):
        for match in WIKI_IMAGE.finditer(line):
            target = match.group(1).split("|", 1)[0].split("#", 1)[0].strip()
            target_path = Path(target)
            if target_path.is_absolute():
                resolved = target_path
            elif len(target_path.parts) > 1:
                resolved = article.parent / target_path
            else:
                resolved = bare_image_dir / target_path
            if not resolved.is_file():
                findings.append(
                    Finding(
                        number,
                        "MISSING_IMAGE",
                        f"Obsidian image target does not exist: {resolved}",
                    )
                )

    return findings


def main() -> int:
    args = parse_args()
    try:
        text = args.article.read_text(encoding="utf-8")
    except OSError as error:
        print(f"{args.article}: error: {error}", file=sys.stderr)
        return 2

    findings = lint(text, publication=args.publication)
    if args.publication:
        findings.extend(
            publication_findings(text, args.article, image_dir=args.image_dir)
        )
    for finding in findings:
        print(
            f"{args.article}:{finding.line}: {finding.code}: {finding.message}"
        )

    if findings:
        print(f"{len(findings)} finding(s)", file=sys.stderr)
        return 1

    print("No deterministic lint findings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
