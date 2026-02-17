# memcli Command Reference

## Command Set

- `courses` / `my-courses`: List teaching courses.
  - `--limit <n>`
  - `--offset <n>`
- `course-by-id <course-id>`: Fetch course by ID.
- `course-by-slug <slug>`: Fetch course by slug.
- `course-levels <course-id>`: List levels in a course.
- `course-columns <course-id>`: Show column configuration.
- `words <course-id>`: List words/items.
  - `--level <index>`: 1-based level index.
  - `--limit <n>`: Limit returned items.
- `learnable <learnable-id>`: Fetch one learnable item.
- `get-pool <pool-id>`: Fetch pool information.
- `search-pool <pool-id>`: Search pool.
  - `--field <key>=<value>` (repeatable)
  - `--exclude <learnable-id>` (repeatable)
  - `--original-only`
- `add-to-course <course-id>`: Add item to a course.
  - `--field <key>=<value>` (repeatable)
  - `--level-index <n>` (default `0`)
- `add-to-level <level-id>`: Add item to a specific level.
  - `--field <key>=<value>` (repeatable)

## Shared Options

- `--output json`: Use machine-readable output for scripts.
- `--columns '{"1":"value"}'`: Alternative to repeated `--field`.
- `--username <name>` and `--password <pass>`: Override env vars.

## Auth Environment Variables

- `MEMRISE_USERNAME`
- `MEMRISE_PASSWORD`
- `MEMRISE_CLIENT_ID` (optional)

## Install

`memcli` is installed by npm package `memrise-cli`:

```bash
npm install -g memrise-cli
# or
bun add -g memrise-cli
```
