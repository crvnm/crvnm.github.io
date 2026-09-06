#!/usr/bin/env python3
"""Safely separate source, staging, and published UK chart JSON data.

Commands are dry-run by default. Pass --apply only after reviewing the plan.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


YEAR_FILE_RE = re.compile(r"\d{4}\.json")
ENRICHMENT_FIELDS = (
    "sid",
    "spotifyUri",
    "spotifyUrl",
    "spotifyMatchScore",
    "spotifyMatchedBy",
    "tm",
    "am",
    "mbid",
)


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def year_files(directory: Path) -> List[Path]:
    return sorted(
        path for path in directory.glob("*.json") if YEAR_FILE_RE.fullmatch(path.name)
    )


def iter_rows(payload: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    for rows in (payload.get("positions") or {}).values():
        if isinstance(rows, list):
            yield from rows


def strip_enrichment(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int, int]:
    clean = copy.deepcopy(payload)
    rows_changed = 0
    fields_removed = 0
    for row in iter_rows(clean):
        removed_here = 0
        for field in ENRICHMENT_FIELDS:
            if field in row:
                del row[field]
                fields_removed += 1
                removed_here += 1
        if removed_here:
            rows_changed += 1
    return clean, rows_changed, fields_removed


def chart_projection(payload: Dict[str, Any]) -> Dict[str, Any]:
    clean, _, _ = strip_enrichment(payload)
    return clean


def validate_year_payload(path: Path, payload: Dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: top level must be an object")
    if not isinstance(payload.get("positions"), dict):
        raise ValueError(f"{path}: missing positions object")
    if not isinstance(payload.get("weeks"), list):
        raise ValueError(f"{path}: missing weeks list")


def command_build_source(args: argparse.Namespace) -> int:
    published = Path(args.published_dir)
    source = Path(args.source_dir)
    files = year_files(published)
    if not files:
        raise SystemExit(f"No year files found in {published}")
    source_is_empty = source.exists() and not any(source.iterdir())
    if source.exists() and not source_is_empty:
        raise SystemExit(
            f"Source directory already exists: {source}\n"
            "Refusing to replace it. Move it aside or choose a different --source-dir."
        )

    planned: List[Tuple[str, Dict[str, Any]]] = []
    total_rows = 0
    total_fields = 0
    for path in files:
        original = load_json(path)
        validate_year_payload(path, original)
        clean, rows_changed, fields_removed = strip_enrichment(original)
        if chart_projection(original) != clean:
            raise SystemExit(f"Internal projection validation failed for {path}")
        planned.append((path.name, clean))
        total_rows += rows_changed
        total_fields += fields_removed

    index_path = published / "index.json"
    if index_path.exists():
        planned.append((index_path.name, load_json(index_path)))

    print("Build clean source dataset")
    print(f"  published: {published}")
    print(f"  source:    {source}")
    print(f"  year files: {len(files)}")
    print(f"  rows containing enrichment fields: {total_rows:,}")
    print(f"  enrichment fields to remove: {total_fields:,}")
    print("  index.json: copied unchanged" if index_path.exists() else "  index.json: absent")
    print("  xmastracks.json: remains published-only")

    if not args.apply:
        print("DRY RUN: no files written. Re-run with --apply to create the source dataset.")
        return 0

    source.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(
        tempfile.mkdtemp(prefix=f".{source.name}.", suffix=".tmp", dir=source.parent)
    )
    try:
        for name, payload in planned:
            write_json_atomic(temp_dir / name, payload)
        if source_is_empty:
            source.rmdir()
        os.replace(temp_dir, source)
    except Exception:
        print(f"Build failed. Temporary output retained for inspection: {temp_dir}")
        raise

    print(f"Created {source} with {len(planned)} files.")
    return command_audit(args)


def command_audit(args: argparse.Namespace) -> int:
    published = Path(args.published_dir)
    source = Path(args.source_dir)
    published_files = {path.name: path for path in year_files(published)}
    source_files = {path.name: path for path in year_files(source)}

    missing = sorted(set(published_files) - set(source_files))
    extra = sorted(set(source_files) - set(published_files))
    problems: List[str] = []
    rows_checked = 0

    if missing:
        problems.append(f"missing source files: {', '.join(missing)}")
    if extra:
        problems.append(f"unexpected source files: {', '.join(extra)}")

    for name in sorted(set(published_files) & set(source_files)):
        published_payload = load_json(published_files[name])
        source_payload = load_json(source_files[name])
        validate_year_payload(published_files[name], published_payload)
        validate_year_payload(source_files[name], source_payload)
        rows_checked += sum(1 for _ in iter_rows(source_payload))
        if source_payload != chart_projection(published_payload):
            problems.append(f"chart data differs: {name}")
        for row in iter_rows(source_payload):
            present = [field for field in ENRICHMENT_FIELDS if field in row]
            if present:
                problems.append(f"enrichment fields remain in {name}: {', '.join(present)}")
                break

    print("Audit source dataset")
    print(f"  published year files: {len(published_files)}")
    print(f"  source year files:    {len(source_files)}")
    print(f"  chart rows checked:   {rows_checked:,}")
    if problems:
        print("FAILED")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("PASSED: source contains identical chart facts and no enrichment fields.")
    return 0


def changed_row_count(left: Dict[str, Any], right: Dict[str, Any]) -> int:
    count = 0
    left_positions = left.get("positions") or {}
    right_positions = right.get("positions") or {}
    for position in set(left_positions) | set(right_positions):
        left_rows = left_positions.get(position) or []
        right_rows = right_positions.get(position) or []
        for index in range(max(len(left_rows), len(right_rows))):
            a = left_rows[index] if index < len(left_rows) else None
            b = right_rows[index] if index < len(right_rows) else None
            if a != b:
                count += 1
    return count


def chart_key(row: Dict[str, Any]) -> Tuple[str, str]:
    return (
        str(row.get("t") or row.get("title") or ""),
        str(row.get("a") or row.get("artist") or ""),
    )


def source_rank(row: Dict[str, Any]) -> Tuple[int, float, int]:
    matched_by = str(row.get("spotifyMatchedBy") or "").strip().lower()
    try:
        score = float(row.get("spotifyMatchScore"))
    except (TypeError, ValueError):
        score = -1.0
    quality = 4 if matched_by == "manual" else 3 if matched_by == "accepted" else 2
    completeness = sum(row.get(field) not in (None, "") for field in ENRICHMENT_FIELDS)
    return quality, score, completeness


def propagation_values(row: Dict[str, Any]) -> Dict[str, Any]:
    values = {field: row.get(field) for field in ENRICHMENT_FIELDS}
    sid = values.get("sid")
    if sid:
        values["spotifyUri"] = values.get("spotifyUri") or f"spotify:track:{sid}"
        values["spotifyUrl"] = values.get("spotifyUrl") or f"https://open.spotify.com/track/{sid}"
    return values


def overlay_enrichment(
    baseline: Dict[str, Any], enriched: Dict[str, Any]
) -> Dict[str, Any]:
    """Copy only enrichment fields onto a structurally identical baseline."""
    if chart_projection(baseline) != chart_projection(enriched):
        raise ValueError("Cannot overlay enrichment onto different chart data")
    combined = copy.deepcopy(baseline)
    combined_positions = combined.get("positions") or {}
    enriched_positions = enriched.get("positions") or {}
    for position, combined_rows in combined_positions.items():
        enriched_rows = enriched_positions.get(position) or []
        if len(combined_rows) != len(enriched_rows):
            raise ValueError(f"Row-count mismatch at position {position}")
        for index, combined_row in enumerate(combined_rows):
            enriched_row = enriched_rows[index]
            for field in ENRICHMENT_FIELDS:
                if field in enriched_row:
                    combined_row[field] = enriched_row.get(field)
    return combined


def command_propagate_exact(args: argparse.Namespace) -> int:
    source = Path(args.source_dir)
    staging = Path(args.staging_dir)
    source_files = year_files(source)
    if not source_files:
        raise SystemExit(f"No source year files found in {source}")

    requested = {f"{year}.json" for year in args.years} if args.years else None
    targets = [path for path in source_files if requested is None or path.name in requested]
    if requested is not None:
        absent = sorted(requested - {path.name for path in targets})
        if absent:
            raise SystemExit(f"Requested source files not found: {', '.join(absent)}")

    authority_rows: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for stage_path in year_files(staging):
        payload = load_json(stage_path)
        validate_year_payload(stage_path, payload)
        source_path = source / stage_path.name
        if not source_path.exists():
            raise SystemExit(f"Staging file has no matching source: {stage_path}")
        if chart_projection(payload) != load_json(source_path):
            raise SystemExit(f"REFUSED: staging changed chart facts in {stage_path.name}")
        for row in iter_rows(payload):
            if row.get("sid"):
                authority_rows.setdefault(chart_key(row), []).append(row)

    ambiguous: Dict[Tuple[str, str], List[str]] = {}
    authority: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for key, rows in authority_rows.items():
        sids = sorted({str(row.get("sid")) for row in rows if row.get("sid")})
        if len(sids) != 1:
            ambiguous[key] = sids
            continue
        authority[key] = max(rows, key=source_rank)

    planned: List[Tuple[Path, Dict[str, Any], int, int]] = []
    ambiguous_target_rows = 0
    normalised_files = 0
    for source_path in targets:
        stage_path = staging / source_path.name
        published_path = Path(args.published_dir) / source_path.name
        if not published_path.exists():
            raise SystemExit(f"Missing published baseline: {published_path}")
        source_payload = load_json(source_path)
        published_payload = load_json(published_path)
        if chart_projection(published_payload) != source_payload:
            raise SystemExit(f"REFUSED: published chart facts differ in {source_path.name}")
        existing_stage = load_json(stage_path) if stage_path.exists() else None
        try:
            target_payload = (
                overlay_enrichment(published_payload, existing_stage)
                if existing_stage is not None
                else copy.deepcopy(published_payload)
            )
        except ValueError as error:
            raise SystemExit(f"REFUSED: invalid staging overlay in {source_path.name}: {error}")
        validate_year_payload(source_path, source_payload)
        validate_year_payload(stage_path if stage_path.exists() else source_path, target_payload)
        if chart_projection(target_payload) != source_payload:
            raise SystemExit(f"REFUSED: target staging changed chart facts in {source_path.name}")

        rows_updated = 0
        groups_updated: set[Tuple[str, str]] = set()
        for row in iter_rows(target_payload):
            if row.get("sid") or row.get("tm") or row.get("am"):
                continue
            key = chart_key(row)
            if key in ambiguous:
                ambiguous_target_rows += 1
                continue
            source_row = authority.get(key)
            if not source_row:
                continue
            for field, value in propagation_values(source_row).items():
                row[field] = value
            rows_updated += 1
            groups_updated.add(key)

        needs_normalising = existing_stage is not None and target_payload != existing_stage
        if needs_normalising:
            normalised_files += 1
        if rows_updated or needs_normalising:
            if chart_projection(target_payload) != source_payload:
                raise SystemExit(f"Internal validation failed after propagating {source_path.name}")
            planned.append((stage_path, target_payload, rows_updated, len(groups_updated)))

    print("Propagate unambiguous exact title + artist matches")
    print(f"  authority staging files: {len(year_files(staging))}")
    print(f"  enriched authority identities: {len(authority_rows):,}")
    print(f"  safe authority identities: {len(authority):,}")
    print(f"  ambiguous identities skipped: {len(ambiguous):,}")
    print(f"  ambiguous target rows skipped: {ambiguous_target_rows:,}")
    print(f"  target files to write: {len(planned)}")
    print(f"  existing staging files normalised: {normalised_files}")
    print(f"  exact identities propagated: {sum(groups for _, _, _, groups in planned):,}")
    print(f"  rows to update: {sum(rows for _, _, rows, _ in planned):,}")
    for path, _, rows, groups in planned:
        print(f"  - {path.name}: {rows:,} rows across {groups:,} identities")
    if ambiguous:
        print("  ambiguous authority examples:")
        for (title, artist), sids in sorted(ambiguous.items())[: args.report_limit]:
            print(f"    - {title} — {artist}: {', '.join(sids)}")

    if not args.apply:
        print("DRY RUN: no files written. Re-run with --apply to update staging.")
        return 0

    for path, payload, _, _ in planned:
        write_json_atomic(path, payload)
    print(f"Updated {len(planned)} staging files atomically.")
    return 0


def command_promote_cross_year(args: argparse.Namespace) -> int:
    source = Path(args.source_dir)
    staging = Path(args.staging_dir)
    published = Path(args.published_dir)
    requested = {f"{year}.json" for year in args.years} if args.years else None

    authority: Dict[Tuple[str, str], List[Tuple[str, Dict[str, Any]]]] = {}
    for stage_path in year_files(staging):
        payload = load_json(stage_path)
        for row in iter_rows(payload):
            if row.get("sid"):
                authority.setdefault(chart_key(row), []).append((stage_path.stem, row))

    plans: List[Tuple[Path, Dict[str, Any], int, int]] = []
    ambiguous_rows = 0
    staging_disagreements = 0
    for source_path in year_files(source):
        if requested is not None and source_path.name not in requested:
            continue
        published_path = published / source_path.name
        if not published_path.exists():
            raise SystemExit(f"Missing published file: {published_path}")
        source_payload = load_json(source_path)
        target_payload = load_json(published_path)
        if chart_projection(target_payload) != source_payload:
            raise SystemExit(f"REFUSED: published chart facts differ in {source_path.name}")
        staged_payload = load_json(staging / source_path.name) if (staging / source_path.name).exists() else None

        rows_updated = 0
        identities: set[Tuple[str, str]] = set()
        for position, rows in (target_payload.get("positions") or {}).items():
            for index, row in enumerate(rows):
                if row.get("sid") or row.get("tm") or row.get("am"):
                    continue
                candidates = [
                    candidate
                    for year, candidate in authority.get(chart_key(row), [])
                    if year != source_path.stem
                ]
                sids = {str(candidate.get("sid")) for candidate in candidates if candidate.get("sid")}
                if len(sids) > 1:
                    ambiguous_rows += 1
                    continue
                if len(sids) != 1:
                    continue
                source_row = max(candidates, key=source_rank)
                if staged_payload is not None:
                    staged_row = staged_payload["positions"][position][index]
                    if staged_row.get("sid") not in (None, source_row.get("sid")):
                        staging_disagreements += 1
                        continue
                for field, value in propagation_values(source_row).items():
                    row[field] = value
                rows_updated += 1
                identities.add(chart_key(row))

        if rows_updated:
            if chart_projection(target_payload) != source_payload:
                raise SystemExit(f"Internal validation failed for {source_path.name}")
            plans.append((published_path, target_payload, rows_updated, len(identities)))

    print("Promote exact matches backed by a different year")
    print(f"  files to update: {len(plans)}")
    print(f"  identities to promote: {sum(groups for _, _, _, groups in plans):,}")
    print(f"  rows to promote: {sum(rows for _, _, rows, _ in plans):,}")
    print(f"  ambiguous rows skipped: {ambiguous_rows:,}")
    print(f"  staging disagreements skipped: {staging_disagreements:,}")
    for path, _, rows, groups in plans:
        print(f"  - {path.name}: {rows:,} rows across {groups:,} identities")

    if not args.apply:
        print("DRY RUN: no files written. Re-run with --apply to update published data.")
        return 0
    for path, payload, _, _ in plans:
        write_json_atomic(path, payload)
    print(f"Updated {len(plans)} published files atomically.")
    return command_audit(args)


def command_promote(args: argparse.Namespace) -> int:
    source = Path(args.source_dir)
    staging = Path(args.staging_dir)
    published = Path(args.published_dir)
    requested = {f"{year}.json" for year in args.years} if args.years else None
    candidates = year_files(staging)
    if requested is not None:
        candidates = [path for path in candidates if path.name in requested]
        absent = sorted(requested - {path.name for path in candidates})
        if absent:
            raise SystemExit(f"Requested staging files not found: {', '.join(absent)}")
    if not candidates:
        raise SystemExit(f"No staging files selected in {staging}")

    validated: List[Tuple[Path, Dict[str, Any], int]] = []
    for stage_path in candidates:
        source_path = source / stage_path.name
        published_path = published / stage_path.name
        if not source_path.exists():
            raise SystemExit(f"Missing source file for {stage_path.name}: {source_path}")
        if not published_path.exists():
            raise SystemExit(f"Missing published file for {stage_path.name}: {published_path}")

        source_payload = load_json(source_path)
        stage_payload = load_json(stage_path)
        published_payload = load_json(published_path)
        validate_year_payload(stage_path, stage_payload)
        if chart_projection(stage_payload) != source_payload:
            raise SystemExit(
                f"REFUSED: staging changed chart facts in {stage_path.name}. "
                "Only enrichment differences may be promoted."
            )
        validated.append(
            (published_path, stage_payload, changed_row_count(published_payload, stage_payload))
        )

    changed_files = [(path, payload, rows) for path, payload, rows in validated if rows]
    print("Promote reviewed staging data")
    print(f"  validated files: {len(validated)}")
    print(f"  files differing from published: {len(changed_files)}")
    print(f"  rows differing from published: {sum(rows for _, _, rows in changed_files):,}")
    for path, _, rows in changed_files:
        print(f"  - {path.name}: {rows:,} changed rows")

    if not args.apply:
        print("DRY RUN: no files written. Re-run with --apply to promote these files.")
        return 0

    for path, payload, _ in changed_files:
        write_json_atomic(path, payload)
    print(f"Promoted {len(changed_files)} files atomically.")
    return command_audit(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--published-dir", default="out/year-json")
    parser.add_argument("--source-dir", default="out/year-json-source")
    parser.add_argument("--staging-dir", default="out/year-json-with-spotify")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser(
        "build-source", help="Create a clean chart-only source dataset from published JSON."
    )
    build.add_argument("--apply", action="store_true")
    build.set_defaults(func=command_build_source)

    audit = subparsers.add_parser(
        "audit", help="Verify source chart facts against the published dataset."
    )
    audit.set_defaults(func=command_audit)

    propagate = subparsers.add_parser(
        "propagate-exact",
        help="Copy unambiguous exact title+artist enrichment into missing staging rows.",
    )
    propagate.add_argument("--years", nargs="*", type=int)
    propagate.add_argument("--report-limit", type=int, default=20)
    propagate.add_argument("--apply", action="store_true")
    propagate.set_defaults(func=command_propagate_exact)

    cross_year = subparsers.add_parser(
        "promote-cross-year",
        help="Promote only missing exact matches backed by an enriched different year.",
    )
    cross_year.add_argument("--years", nargs="*", type=int)
    cross_year.add_argument("--apply", action="store_true")
    cross_year.set_defaults(func=command_promote_cross_year)

    promote = subparsers.add_parser(
        "promote", help="Validate and promote reviewed staging files to published JSON."
    )
    promote.add_argument("--years", nargs="*", type=int)
    promote.add_argument("--apply", action="store_true")
    promote.set_defaults(func=command_promote)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
