# Year JSON data pipeline

The three data folders have deliberately separate roles:

- `out/year-json-source`: clean chart facts with no Spotify enrichment fields.
- `out/year-json-with-spotify`: working enrichment and manual-review staging.
- `out/year-json`: validated published data read by the website.

All mutating commands are dry runs unless `--apply` is supplied.

## Create the clean source dataset

Preview:

```bash
python3 scripts/manage_year_json_pipeline.py build-source
```

Create it after reviewing the summary:

```bash
python3 scripts/manage_year_json_pipeline.py build-source --apply
```

`index.json` is copied unchanged. `xmastracks.json` remains published-only because it
is application metadata based on Spotify IDs, not a source chart file.

## Audit source against published data

```bash
python3 scripts/manage_year_json_pipeline.py audit
```

The audit removes enrichment fields from the published data in memory and confirms
that the remaining chart facts exactly match the source files.

## Propagate exact matches into staging

Preview all years:

```bash
python3 scripts/manage_year_json_pipeline.py propagate-exact
```

This uses enriched staging rows as the only authority. Rows with the exact same
chart title and artist receive the reviewed enrichment fields. Any identity linked
to multiple Spotify IDs is skipped and reported rather than guessed.

After reviewing the preview, update staging only:

```bash
python3 scripts/manage_year_json_pipeline.py propagate-exact --apply
```

Published website data is not changed by this command.

If a year already contains unrelated manual staging changes, promote only missing
matches supported by a different enriched year:

```bash
python3 scripts/manage_year_json_pipeline.py promote-cross-year --years 2004
python3 scripts/manage_year_json_pipeline.py promote-cross-year --years 2004 --apply
```

This prevents same-year manual work from being included accidentally.

## Preview reviewed staging promotion

All staged years:

```bash
python3 scripts/manage_year_json_pipeline.py promote
```

Selected years:

```bash
python3 scripts/manage_year_json_pipeline.py promote --years 2004 2008 2009 2023
```

Promotion is refused if staging differs from source in any chart fact. After
reviewing the dry-run summary, add `--apply` to update the published files using
atomic file replacements.
