# Memrise API notes

Reverse-engineered notes on the endpoints behind
`https://community-courses.memrise.com`, the host that still serves
community ("Decks") courses.

None of this is public API. It was recovered by watching the web editor,
reading its JavaScript bundle, and probing endpoints against live courses.
Everything marked **verified** below was exercised directly and is dated;
anything else is marked as such. Endpoints can change without notice.

Last verified: 2026-08-21.

## Contents

- [Object model](#object-model)
- [Thing IDs are packed into learnable IDs](#thing-ids-are-packed-into-learnable-ids)
- [Authentication](#authentication)
- [JSON API (`/v1.25/`)](#json-api-v125)
- [Editor AJAX (`/ajax/`)](#editor-ajax-ajax)
- [HTML surfaces](#html-surfaces)
- [Endpoints seen but not exercised](#endpoints-seen-but-not-exercised)
- [Gotchas](#gotchas)
- [Re-verifying these notes](#re-verifying-these-notes)

## Object model

Five identifiers, easy to confuse:

| Object | What it is |
| --- | --- |
| **course** | The top-level container a user teaches or learns. Has a numeric id and a slug. |
| **pool** | The database of rows behind a course. Defines the *columns* (Word, Definition, Audio, …) and *attributes* (Pronunciation, Gender, …). |
| **thing** | One row in a pool. This is the authoring identity — what you add and delete. |
| **level** | An ordered selection of things, presented as a lesson. Several levels can share one pool. |
| **learnable** | A thing *plus the pair of columns being tested*. This is the review-facing identity. |

The distinction that matters: **levels report learnable IDs, but mutation
endpoints take thing IDs.** One thing can back several learnables — the same
row tested Word→Definition and Thai→Definition is two learnables.

Column and attribute keys are numeric strings (`"1"`, `"2"`, …) everywhere,
never names. Fetch the mapping from `/ajax/pool/get/` before writing rows.

## Thing IDs are packed into learnable IDs

A learnable ID is a composite key. The thing ID occupies the high bits and the
low 16 bits hold the column pair being tested:

```
learnableId = (thingId << 16) | (learningColumn << 8) | definitionColumn
```

So `thingId = learnableId >> 16`, and the low bytes are literal column indices:

```
33075772588290  =  504696237 << 16 | 0x0102
                   ^^^^^^^^^         ^^ ^^
                   thing id          |  definition column 2
                                     learning column 1
```

Consecutive things in a level make this obvious — thing IDs step by 1 while
learnable IDs step by exactly 65536:

```
learnable_ids: [ 33075772588290, 33075772653826, 33075772719362 ]
thing ids:     [      504696237,      504696238,      504696239 ]
```

**Verified** (2026-08-21). The clearest evidence that the low bytes are real
column indices rather than padding comes from one pool feeding levels with
different pairings. Pool `7776382` has columns `1=Word`, `2=Definition`,
`3=Thai`:

| Level | Pair | Tests |
| --- | --- | --- |
| 16255118 | `0x0302` | Thai → Definition |
| 16255125 | `0x0302` | Thai → Definition |
| 16288103 | `0x0102` | Word → Definition |
| 16374893 | `0x0102` | Word → Definition |

Cross-checked four independent ways over 1257 items:

1. IDs derived from `learnable_ids` match the `data-thing-id` rows in the level
   editor HTML exactly (61 items across 8 levels of one course, 0 mismatches).
2. Every derived thing ID appears in the paginated pool database pages.
3. `/ajax/thing/get/` content matches the learnable's `learning_element` and
   `definition_element`, with the low bytes correctly picking which columns are
   prompt and answer.
4. Thing IDs returned authoritatively by a bulk add show up in `learnable_ids`
   exactly as predicted, and deleting by the derived ID removes the right rows.

`thingIdFromLearnableId()` implements this. The reverse direction is **not**
derivable without knowing the column pair.

### Converting between the two

The conversion is deliberately **explicit** rather than baked into every
response. Raw API responses are left exactly as the API returned them:
`Learnable.id` is a learnable ID, `MemriseThing.id` is a thing ID, and neither
grows a derived sibling field.

That is a design decision, not an oversight:

- **It could not be symmetric.** `Learnable` and `CourseLevel` could carry a
  derived thing ID, but `MemriseThing` and `SearchPoolResultItem` cannot carry a
  learnable ID — that needs a level's column pair. An API where "responses carry
  both" holds only half the time is worse than one where it never does.
- **Provenance matters.** An ID the server sent and one computed from an
  undocumented bit layout are different kinds of fact. Blending them into one
  object makes the rule above unenforceable, because nothing distinguishes them
  at the call site.
- **Blast radius.** If the packing ever changes, one function is wrong instead
  of every response type silently carrying bad data.

| Direction | Call | Needs |
| --- | --- | --- |
| learnable → thing | `thingIdFromLearnableId(id)` | nothing, pure |
| learnable → columns | `columnPairFromLearnableId(id)` | nothing, pure |
| thing → learnable | `learnableIdFromThingId(id, pair)` | the column pair |
| thing → learnable, safely | `client.getLearnableIdInLevel(courseId, levelId, thingId)` | one request |
| level's pairing | `client.getLevelColumnPair(courseId, levelId)` | one request |

Prefer `getLearnableIdInLevel`: it reads the pair off the level and returns
`null` when the thing is not in it, instead of handing back an ID that will not
resolve. Verified that a rebuilt ID resolves to the right learnable on levels
using both `0x0102` and `0x0302` off the same pool, and that a wrong pairing
resolves to nothing.

Domain types this SDK defines carry both IDs where both are derivable —
`getLevelThings()` yields `{ thingId, learnableId, … }` — so the bit unpacking
lives in one place instead of in every consumer. Raw network response types
(`MemriseThing`, `Learnable`, `SearchPoolResultItem`) stay exactly as the
server sent them.

Note the enrichment cannot be symmetric: a domain type built from a learnable
can carry a thing ID, but one built from a thing cannot carry a learnable ID
without a level's column pair. So it is a per-type decision, never an
optional field that is sometimes populated.

`ThingId` and `LearnableId` are branded types, erased at runtime, so the
compiler rejects passing one where the other belongs. At runtime,
`assertThingId()` catches the same mistake by magnitude — thing IDs sit around
2^29 and learnable IDs start near 2^43, a comfortable 14-bit gap — and reports
the ID the caller probably meant. That check is for error quality only;
correctness still comes from verifying membership against the level.

> **Use it for lookups, not for destructive calls.** This packing is an
> undocumented implementation detail. It is safe where a wrong answer surfaces
> as "not found" — membership checks, enumerating a level. Never feed a derived
> ID to a delete or overwrite that has not been confirmed against the API
> first. `deleteThingFromLevel` in this client always receives the caller's
> thing ID verbatim; derived IDs are only ever compared.

## Authentication

Three sequential calls, all on `community-courses.memrise.com`. Cookies
accumulate across them and carry the session; the bearer token is only used to
mint the web session.

| Step | Request | Purpose |
| --- | --- | --- |
| 1 | `GET /v1.25/web/ensure_csrf` | Returns `{ csrf_token }` and sets the `csrftoken` cookie. |
| 2 | `POST /v1.25/auth/access_token/` | Body `{ username, password, grant_type: "password", client_id }`. Returns `{ access_token: { access_token, … }, user }`. |
| 3 | `GET /v1.25/auth/web/?token=…&invalidate_token_after=true` | Exchanges the token for a logged-in web session. Refreshes `csrftoken`. |

Afterwards, send the accumulated `cookie` on every request plus:

- `x-csrftoken` — required for all `/ajax/` POSTs.
- `x-requested-with: XMLHttpRequest`
- `origin: https://community-courses.memrise.com`
- A browser-like `user-agent`.

`/v1.25/` endpoints authenticate by **session cookie**, not by the bearer
token. Setting an `authorization` header globally is unnecessary.

`client_id` defaults to `1e739f5e77704b57a703` (the web client's public id).

## JSON API (`/v1.25/`)

### `GET /v1.25/dashboard/courses/`

Params: `filter` (`teaching`), `limit`, `offset`.

**`limit` above 9 answers 400** (verified: 9 succeeds, 10 does not), so the
whole dashboard has to be walked a page at a time. `getAllMyCourses()` does
that; `getMyCourses()` exposes the raw single page and will silently look
complete when it is not.

```jsonc
{ "applied_filter": …, "categories": [...], "has_more_pages": false,
  "courses": [ { "id", "name", "slug", "is_official", "photo_url",
                 "next_session", "goal", "progress" } ] }
```

### `GET /v1.25/courses/{courseId}/levels/`

```jsonc
{ "version": …,
  "levels": [ { "course_id": 6717539, "id": 16396184, "index": 10, "kind": 1,
                "pool_id": 7778482, "title": "Thai Vocab Practice",
                "learnable_ids": [33075772588290, …] } ] }
```

The single most useful endpoint: `learnable_ids` gives a level's contents, and
`>> 16` turns them into thing IDs with no further request.

**Empty levels are omitted.** A level with no things does not appear here at
all, which is why level *index* is an unreliable addressing scheme — parse the
course edit page instead (see [HTML surfaces](#html-surfaces)). Verified on one
course that reports 8 levels here and 10 on its edit page, the two extras being
empty drafts.

There is **no** level-by-id endpoint. `/v1.25/levels/{id}/`,
`/v1.25/level/{id}/`, `/v1.25/levels/{id}/learnables/` and
`/v1.25/courses/levels/{id}/` all 404 (verified). Reaching a single level means
listing its course's levels and filtering, so you always need the course ID.

### `GET /v1.25/learnables/{ids}/`

**`{ids}` accepts a comma-separated list.** This is undocumented and easy to
miss, since the singular form is what the web client uses.

```jsonc
{ "learnables": { "33075772588290": {
    "id", "learning_element", "definition_element",
    "learning_element_tokens", "definition_element_tokens",
    "item_type", "difficulty", "screens", "sample_sentences", … } } }
```

Keyed by ID as a string. Missing IDs are simply absent rather than an error.

Batch size is bounded by URL length, not a documented count:

| IDs | URL length | Result |
| --- | --- | --- |
| 400 | 5618 | 200 |
| 793 | 11120 | **414 URI Too Long** |

This client chunks at 200. Payloads are large — each learnable embeds full
`screens` data for every review template — so batching trades many small
requests for a few big ones.

`screens` also exposes the column *labels* and directions for the pair the
learnable tests, which is a convenient cross-check on the ID packing.

## Editor AJAX (`/ajax/`)

POSTs are `application/x-www-form-urlencoded` and need `x-csrftoken`. Responses
are `{ "success": bool, … }`.

| Endpoint | Method | Params |
| --- | --- | --- |
| `/ajax/pool/get/` | GET | `pool_id` |
| `/ajax/pool/search/` | GET | `pool_id`, `columns`, `exclude_thing_ids`, `original_only` |
| `/ajax/thing/get/` | GET | `thing_id` |
| `/ajax/level/thing/add/` | POST | `level_id`, `columns` |
| `/ajax/level/thing_remove/` | POST | `level_id`, `thing_id` |
| `/ajax/level/add_things_in_bulk/` | POST | `level_id`, `data`, `word_delimiter` |
| `/ajax/pool/add_things_in_bulk/` | POST | `pool_id`, `data`, `word_delimiter` |
| `/ajax/level/add/` | POST | `course_id`, `pool_id`, `kind` |
| `/ajax/level/delete/` | POST | `level_id` |
| `/ajax/level/set_title/` | POST | `level_id`, `new_val` |

### `GET /ajax/pool/get/`

```jsonc
{ "pool": { "id", "name", "can_curate", "can_moderate",
    "columns":    { "1": { "kind": "text", "label": "Word", "typing_disabled",
                           "typing_strict", "show_after_tests", "always_show",
                           "keyboard", "tapping_disabled", "classes" }, … },
    "attributes": { "1": { "kind": "text", "label": "Pronunciation",
                           "show_at_tests": false }, … } } }
```

Call this before writing rows, to map field names onto numeric keys.

### `GET /ajax/pool/search/`

`columns` is a JSON-encoded object of `{ "<columnKey>": "<search term>" }`.

**There is no "return everything" mode.** The endpoint always needs a term:

| `columns` | Response |
| --- | --- |
| `{"1": "hola"}` | 200 |
| `{}` | **500** |
| omitted | 400 `columns is required.` |
| `""` | 400 `columns was not valid json` |
| `[]` | 400 `columns was not a dict` |
| `{"1": ""}` | 400 `column_search must contain at least 1 characters.` |

**Verified** (2026-08-21). The empty-object case answering a bare 500 rather
than a 400 is what made this look like a size or pagination bug; it is neither,
and it fails on pools of any size.

The web editor never issues an unfiltered search. Its `searchable()` guard
refuses to fire unless a value fails `/^[a-zA-Z\s]{0,2}$/` — i.e. it wants more
than two latin characters before it will even ask.

To enumerate a pool or level, use `learnable_ids` from the levels endpoint.
This client's `searchPool` rejects an empty filter up front rather than
surfacing the 500.

Returns `{ success, result: [ { id, columns: { "1": { val } } } ] }`, where
`id` is a **thing** ID.

### `GET /ajax/thing/get/`

```jsonc
{ "thing": { "id", "pool_id",
    "columns": { "1": { "val", "alts", "choices", "distractors",
                        "kind", "accepted", "typing_corrects" }, … },
    "attributes": { … } } }
```

The authoritative view of a single row, including every column — not just the
pair a learnable tests.

### Bulk add

`data` is newline-separated rows of delimiter-separated values, in column
order, with `word_delimiter` naming the separator (`comma`, `tab` or
`semicolon`). Values may not contain the chosen delimiter or a newline.

Adding to a **pool** creates rows without attaching them to any level; adding
to a **level** does both. Both return the created things, and that response is
the authoritative source of new thing IDs.

## HTML surfaces

Some data has no JSON equivalent. These are scrapes and correspondingly
fragile — prefer the JSON paths above.

### `GET /ajax/level/editing_html/?level_id={id}`

Returns `{ success, rendered }` where `rendered` is the level's editing table.
Rows are `<tr class="thing" data-thing-id="…">` with cells carrying `data-key`
and `data-cell-type="column|attribute"`, each wrapping a `<div class="text">`.

Useful because it needs **only a level ID** (no course ID) and returns every
column and attribute value in one request. This client no longer uses it —
`learnable_ids >> 16` covers the same need in JSON — but it remains the only
single-request source of non-tested column values for a level.

### `GET /course/{courseId}/{slug}/edit/database/{poolId}/?page=N`

The whole pool, 20 things per page, same `data-thing-id` row markup. Covers
things not attached to any level, which `learnable_ids` cannot see. The slug is
not checked — a wrong one 301s to the right URL — but the course ID is.

### `GET /course/{courseId}/{slug}/edit/`

Lists every level *including empty ones*, as
`<div id="l_{id}" class="level…" data-level-id data-pool-id>` with
`.level-handle` for the index and `.level-name` for the title. This is how
`getCourseLevelsIncludingEmpty` recovers levels the JSON endpoint omits.

## Endpoints seen but not exercised

Present in the editor bundle (`/editing/dist/js/editing-*.js`) and presumably
live, but **not tested here** — no shapes or parameters confirmed:

```
/ajax/course/delete/                /ajax/pool/attributes/set/
/ajax/course/picture/               /ajax/pool/columns/set/
/ajax/course/pool/delete/           /ajax/pool/structure_add/
/ajax/course/pool/levelify/         /ajax/pool/structure_delete/
/ajax/course/pool/set_title/        /ajax/thing/add/
/ajax/course/reorder_levels/        /ajax/thing/cell/update/
/ajax/level/duplicate/              /ajax/thing/cell/upload_file/
/ajax/level/reorder/                /ajax/thing/column/delete_from/
/ajax/level/set_columns/            /ajax/thing/column/update_alts/
/ajax/level/set_multimedia/         /ajax/thing/delete/
/ajax/user/get/                     /ajax/user/mempals_following/
```

`/ajax/thing/delete/` and `/ajax/level/thing_remove/` are almost certainly
different operations — deleting the pool row outright versus detaching it from
a single level — but only the latter has been exercised, and the distinction is
inferred from naming rather than tested. Be careful before reaching for the
former.

## Gotchas

- **Column keys are numeric strings.** `{"term": "hola"}` will not work;
  `{"1": "hola"}` will. Read them from `/ajax/pool/get/`.
- **`pool/search/` cannot list a pool.** An empty filter is a 500, not an empty
  result. See the table above.
- **Level *positions* skip empty levels** in the JSON endpoint, so indexing
  into the returned array silently drifts. Each level's own `index` field is
  1-based and authoritative — it matches the editor, gaps included — so match
  on that rather than on array position.
- **Learnable IDs are not thing IDs**, but they contain them. Passing a
  learnable ID to a thing endpoint fails.
- **Learnable IDs exceed 2³²** (~3.3×10¹³) but stay inside `Number.MAX_SAFE_INTEGER`,
  so plain JS numbers are fine — no BigInt needed.
- **Writes are immediately consistent.** `learnable_ids` reflects an add or a
  remove on the very next request; no cache delay was observed, which is what
  makes it usable for verifying a mutation.
- **Batch learnable URLs 414** past roughly 400 IDs.
- **Bulk adds are delimiter-separated text**, so a value containing the
  delimiter corrupts every column after it. Commas are common in definitions,
  which made the obvious default the dangerous one. `pickBulkDelimiter()`
  chooses comma, tab or semicolon based on the data.
- **Adding a word that already exists in the pool reuses the existing row**
  rather than creating a duplicate, and returns that row's thing ID.
- **A thing can outlive its levels.** Removing it from every level leaves the
  row in the pool, where only the database pages will show it.

## Re-verifying these notes

The claims above were produced by probing live courses. To re-check the ID
packing after an upstream change, compare a level's derived IDs against an
independent oracle:

```ts
const derive = (l: number) => Math.floor(l / 65536);

const level = await client.getLevel(courseId, levelId);
const derived = (level.learnable_ids ?? []).map(derive);

// Oracle: the level editor's own markup, fetched directly
const { data } = await axios.get("/ajax/level/editing_html/", {
  params: { level_id: levelId },
  headers: { cookie, "x-requested-with": "XMLHttpRequest" },
});
const scraped = [...data.rendered.matchAll(/data-thing-id="(\d+)"/g)]
  .map((m) => Number(m[1]));

console.log(JSON.stringify(derived) === JSON.stringify(scraped));
```

The strongest single check is a round trip: bulk-add a row, confirm the thing ID
from the add response appears in the level's `learnable_ids` under the
derivation, then delete it again. `index.test.ts` pins the arithmetic against
recorded IDs, but only a live call can catch the encoding changing.
