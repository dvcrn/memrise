# Memrise API notes

Reverse-engineered notes on the endpoints behind
`https://community-courses.memrise.com`, the host that still serves
community ("Decks") courses.

None of this is public API. It was recovered by watching the web editor,
reading its JavaScript bundle, and probing endpoints against live courses.
Everything marked **verified** below was exercised directly and is dated;
anything else is marked as such. Endpoints can change without notice.

Last verified: 2026-08-26.

## Contents

- [Object model](#object-model)
- [Thing IDs are packed into learnable IDs](#thing-ids-are-packed-into-learnable-ids)
- [Authentication](#authentication)
- [JSON API (`/v1.25/`)](#json-api-v125)
- [Learning sessions and progress (`/v1.25/`)](#learning-sessions-and-progress-v125)
- [Editor AJAX (`/ajax/`)](#editor-ajax-ajax)
  - [Detach versus delete](#detach-versus-delete)
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
| **thing** | One row in a pool. This is the authoring identity: what you add and delete. |
| **level** | An ordered selection of things, presented as a lesson. Several levels can share one pool. |
| **learnable** | A thing *plus the pair of columns being tested*. This is the review-facing identity. |

The distinction that matters: **levels report learnable IDs, but mutation
endpoints take thing IDs.** One thing can back several learnables: the same
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

Consecutive things in a level make this obvious, since thing IDs step by 1 while
learnable IDs step by exactly 65536:

```
learnable_ids: [ 33075772588290, 33075772653826, 33075772719362 ]
thing ids:     [      504696237,      504696238,      504696239 ]
```

The clearest evidence that the low bytes are real
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
  learnable ID, which needs a level's column pair. An API where "responses carry
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

Domain types this SDK defines carry both IDs where both are derivable
(`getLevelThings()` yields `{ thingId, learnableId, … }`), so the bit unpacking
lives in one place instead of in every consumer. Raw network response types
(`MemriseThing`, `Learnable`, `SearchPoolResultItem`) stay exactly as the
server sent them.

Note the enrichment cannot be symmetric: a domain type built from a learnable
can carry a thing ID, but one built from a thing cannot carry a learnable ID
without a level's column pair. So it is a per-type decision, never an
optional field that is sometimes populated.

`ThingId` and `LearnableId` are branded types, erased at runtime, so the
compiler rejects passing one where the other belongs. At runtime,
`assertThingId()` catches the same mistake by magnitude (thing IDs sit around
2^29 and learnable IDs start near 2^43, a comfortable 14-bit gap) and reports
the ID the caller probably meant. That check is for error quality only;
correctness still comes from verifying membership against the level.

> **Use it for lookups, not for destructive calls.** This packing is an
> undocumented implementation detail. It is safe where a wrong answer surfaces
> as "not found": membership checks, enumerating a level. Never feed a derived
> ID to a delete or overwrite that has not been confirmed against the API
> first. `detachThingFromLevel` in this client always receives the caller's
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

- `x-csrftoken`: required for all `/ajax/` POSTs.
- `x-requested-with: XMLHttpRequest`
- `origin: https://community-courses.memrise.com`
- A browser-like `user-agent`.

`/v1.25/` endpoints authenticate by **session cookie**, not by the bearer
token. Setting an `authorization` header globally is unnecessary.

`client_id` defaults to `1e739f5e77704b57a703` (the web client's public id).

## JSON API (`/v1.25/`)

### `GET /v1.25/me/`

No params. Answers for whoever the session cookie belongs to.

```jsonc
{ "profile": {
    "id": 8046313, "username": "…", "email": "…@example.com",
    "date_joined": "2015-05-14T10:04:53Z", "language": "en",
    "timezone": "Asia/Tokyo", "is_staff": false, "is_pro": true,
    "is_guest": false, "has_facebook": true, "has_password_set": true,
    "has_lapsed_pro": false, "pro_trial_ended": null,
    "subscription": { "expiry", "is_active", "is_on_hold",
                      "subscription_type" },
    "avatar": { "normal", "small", "large" },
    "statistics": { "points", "longest_streak", "num_things_flowered" },
    "business_model": { "value": "mode-locked-legacy" } } }
```

Everything sits under a single `profile` key, which
`getMe()` unwraps.

Two fields read backwards from their names. `subscription.is_active` was
`false` on a **Pro** account whose `expiry` is `9999-12-31T23:59:59Z`. The
subscription block describes a recurring billing subscription, not
entitlement, so read `is_pro` for that. And `business_model.value` is a
free-form string (`"mode-locked-legacy"` here), so it is left untyped.

This is the only account-level endpoint this client exercises; the editor's
`/ajax/user/get/` is still untested.

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
all, which is why level *index* is an unreliable addressing scheme. Parse the
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

This client chunks at 200. Payloads are large, since each learnable embeds full
`screens` data for every review template, so batching trades many small
requests for a few big ones.

`screens` also exposes the column *labels* and directions for the pair the
learnable tests, which is a convenient cross-check on the ID packing.

## Learning sessions and progress (`/v1.25/`)

Everything above is authoring. This is the learner side: what the account has
studied, how well, and when each item is next due. None of it is wired into
this client yet; the shapes below come from watching a real session on the
dummy course and from read-only probes afterwards.

These endpoints take the same session cookie as the rest of `/v1.25/`, plus
`x-csrftoken` on writes. The web client also sends `x-client-type: web`,
`x-device-type`, `x-timezone` and friends; only the cookie and the CSRF token
were needed to get a 200.

### How a session hangs together

Four endpoints, in order, all keyed by the same `session_source_*` triple. The
session itself is not a server-side object with an ID: nothing is handed back
to correlate the calls, and the triple plus the learnable IDs is the only
thread between them.

```
POST /v1.25/learning_sessions/learn/     -> learnables + their current progress
       (or .../review/ for due items)
  |
  |   the client runs the screens locally and scores each answer itself
  v
POST /v1.25/progress/register/           -> one event per answered test,
       (repeatedly, batched)                 posted in batches as they pile up
  |
  v
POST /v1.25/learning_sessions/end/       -> closes the session, session_points only
  |
  v
GET  /v1.25/courses/{courseId}/goal/     -> daily-goal state for the summary screen
```

The scoring is the client's, not the server's. `register/` is told the outcome
*and* the resulting counters (`growth_level`, `correct`, `attempts`, the
streaks, `next_date`, `interval`), so the scheduling decision is made on the
client and merely recorded here. The two `register/` posts from one session
show this directly: the second continues the counters where the first left off
(`mcp-update-probe` ends the first batch at `growth_level` 0 / `correct` 1 and
climbs 1 -> 6 across the second), with nothing read back in between.

`end/` carries only `session_points`, again a number the client arrived at
itself. Nothing links it back to the events, so it is the summary screen's
total rather than a checksum on them. `register/` alone is what moves an
item's progress; the session bracket is bookkeeping around it.

Batching is not per item: one batch carried dozens of events spanning every
learnable in the level and all three test templates, in answer order, so an
item appears once per test it was shown. `sync_token: 0` and
`limit: 0` were sent on both posts and appear to be vestigial on the write
path, where the same names on `GET /v1.25/progress/` are the real cursor.

To read progress without any of this, skip the session endpoints and call
`GET /v1.25/progress/`.

### `POST /v1.25/learning_sessions/learn/`

```jsonc
{ "session_source_id": 6717539,
  "session_source_type": "course_id_and_level_index",
  "session_source_sub_index": 1 }
```

`session_source_type` is a fixed choice list; an unknown value answers
400 `"x" is not a valid choice.` (`course_id` is *not* one of them). Response:

```jsonc
{ "learnables": [ { "id", "learning_element", "definition_element",
                    "learning_element_tokens", "definition_element_tokens",
                    "difficulty", "item_type", "screens",
                    "sample_sentences", "pitch_accent", "kana" }, … ],
  "progress": [ … see below … ],
  "session_source_info": { "source_id", "source_type", "name",
    "translated_name", "learnable_ids_to_course_ids", "num_due_for_review",
    "level_id", "level_name", "source_sub_index", "template_id",
    "parent_source_id", "parent_template_id" },
  "settings": { "disable_multimedia", "disable_tapping",
                "prioritize_typing", "disable_typing" } }
```

`screens` is keyed `"1"`..`"4"`: `presentation`, `multiple_choice`,
`reversed_multiple_choice`, `typing`. The presentation screen carries the
column values and their `alternatives` (hidden `_`-prefixed alts are already
filtered out); the test screens carry `prompt`, `answer`, `correct`, `choices`,
`is_strict` and `post_answer_info`.

**`progress` is only populated for items the account has already touched.** On
a course with no history it is `[]`, which is what makes it look like the
endpoint has no progress data. The session also only returns items it intends
to teach, so a fully-learned item drops out of both arrays.

### `POST /v1.25/learning_sessions/review/`

Same request and response shape, for items that are due rather than new.

### `POST /v1.25/progress/register/`

How answers are reported. The client batches them and posts

```jsonc
{ "events": [ … ], "sync_token": 0, "limit": 0 }
```

One event per test answered:

```jsonc
{ "box_template": "typing", "course_id": 6717539, "learnable_id": 31330459648258,
  "test_id": "862e9822-…", "mem_id": null,
  "learning_element": "AddLevel", "definition_element": "New level item",
  "given_answer": "AddLevel", "score": 1, "points": 77, "bonus_points": 0,
  "time_spent": 3948, "created_date": 1788257607, "when": 1788258318,
  "last_date": 1788258318, "next_date": 1788273071, "interval": 0.1666,
  "growth_level": 6, "correct": 6, "attempts": 7,
  "current_streak": 3, "total_streak": 2,
  "starred": false, "ignored": false, "not_difficult": false }
```

The counters are the item's running state *after* this answer, not this
answer's outcome. Only `score` (1 or 0), `points` and `given_answer` describe
the single test:

- `correct` and `attempts` are cumulative for that learnable, and
  `growth_level` tracked `correct` exactly across the observed session.
- `current_streak` resets to 0 on a wrong answer; `total_streak` goes
  *negative* (-1, -2) instead.
- `next_date` and `interval` stay `null` until `growth_level` reaches 6, where
  the item becomes scheduled: `interval: 0.1666` days, i.e. the first review
  about four hours out.
- `points` is 0 whenever `score` is 0. Correct answers were worth 1 point at
  growth level 0 and 45-531 afterwards, so the award depends on more than the
  streak alone.
- `created_date` is the session start and repeats across every event in the
  batch; `when` and `last_date` are per answer. All are epoch seconds, unlike
  the ISO strings the read endpoints return.
- `time_spent` is milliseconds.

### `POST /v1.25/learning_sessions/end/`

```jsonc
{ "session_points": 2406, "session_type": "learn",
  "session_source_type": "course_id_and_level_index",
  "session_source_id": 6717539, "session_source_sub_index": 1 }
```

Scoring is registered by `progress/register/`, so this closes the session
rather than carrying the results.

### `GET /v1.25/progress/?sync_token={epoch}`

**The whole account's per-item learning state, in one request.** Omitting
`sync_token` is a 400 (`This field is required.`); `0` returns everything.

```jsonc
{ "sync_token": 1788258456,
  "thingusers": [ { "learnable_id": 298237362434, "ignored": false,
      "created_date": "2015-06-06T08:03:12", "last_date": "2015-06-06T12:21:25",
      "next_date": "2015-06-06T16:21:39", "interval": 0.166837,
      "growth_level": 6, "current_streak": 6, "total_streak": 9,
      "correct": 9, "attempts": 9, "starred": 0, "not_difficult": 0 }, … ] }
```

`sync_token` is a cursor, not a page number: the returned value is the newest
`last_date` in epoch seconds, and passing it back returns only rows that
changed since. A full sync of one account came back as 1818 rows / 490 KB;
the same call with a token from ten minutes earlier returned 11.

Rows are keyed by **learnable** ID, so they carry the tested column pair, not
just the thing. `growth_level` is not capped at the 6 a learn session reaches:
long-studied items were seen up to 17.

The same row appears in a session response's `progress` array in a slightly
different shape: booleans instead of 0/1 for `starred` and `not_difficult`,
`learnable_id` as a string, plus `user_id` and an extra `is_difficult`.

### `GET /v1.25/courses/{courseId}/goal/`

404 `{"detail": "Not found."}` on a course with no goal set. The shape when one
exists has not been seen.

## Editor AJAX (`/ajax/`)

POSTs are `application/x-www-form-urlencoded` and need `x-csrftoken`. Responses
are `{ "success": bool, … }`.

| Endpoint | Method | Params |
| --- | --- | --- |
| `/ajax/pool/get/` | GET | `pool_id` |
| `/ajax/pool/search/` | GET | `pool_id`, `columns`, `exclude_thing_ids`, `original_only` |
| `/ajax/thing/get/` | GET | `thing_id` |
| `/ajax/thing/cell/update/` | POST | `thing_id`, `cell_id`, `cell_type`, `new_val` |
| `/ajax/level/thing/add/` | POST | `level_id`, `columns` |
| `/ajax/level/thing_remove/` | POST | `level_id`, `thing_id` |
| `/ajax/thing/delete/` | POST | `thing_id` |
| `/ajax/level/add_things_in_bulk/` | POST | `level_id`, `data`, `word_delimiter` |
| `/ajax/pool/add_things_in_bulk/` | POST | `pool_id`, `data`, `word_delimiter` |
| `/ajax/level/add/` | POST | `course_id`, `pool_id`, `kind` |
| `/ajax/level/delete/` | POST | `level_id` |
| `/ajax/level/set_title/` | POST | `level_id`, `new_val` |
| `/ajax/level/set_columns/` | POST | `level_id`, `column_a`, `column_b` |
| `/ajax/pool/columns/set/` | POST | `pool_id`, `column_key`, `label`, `keyboard`, 7 flags |

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

The empty-object case answering a bare 500 rather
than a 400 is what made this look like a size or pagination bug; it is neither,
and it fails on pools of any size.

The web editor never issues an unfiltered search. Its `searchable()` guard
refuses to fire unless a value fails `/^[a-zA-Z\s]{0,2}$/`, i.e. it wants more
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

The authoritative view of a single row, including every column, not just the
pair a learnable tests.

`alts` is a list of `{ id, val }`, not of strings. The IDs are positional
within the cell and are reassigned on every write, so they are not handles.
`accepted` is the answers marked correct: the cell value plus its
alternatives, with the hidden-alt `_` prefix stripped and duplicates removed.

### `POST /ajax/thing/column/update_alts/`

Params: `thing_id`, `column_key`, `alts` (a JSON-encoded list of strings).
Columns only; attributes have no alternatives.

Alternatives are accepted as correct answers at test time and are listed under
"More" on presentation screens. One prefixed with `_` stays accepted but is
hidden from presentations, e.g. `"_cat"`.

The list is an **overwrite**, not an append: whatever is sent becomes the whole
set, and `[]` clears it. Duplicates and surrounding whitespace are stored as
given.

| `alts` | Response |
| --- | --- |
| `["cat","_cat"]` | 200 `{"success": null}` |
| `[]` | 200 `{"success": null}`, alternatives cleared |
| `"notjson"` | 400 `alts must be a valid json list` |
| any, with an unknown `column_key` | **500** |

Like `thing/cell/update/`, it answers `{"success": null}` either way, so verify
by reading the thing back.

### Bulk add

`data` is newline-separated rows of delimiter-separated values, in column
order, with `word_delimiter` naming the separator (`comma`, `tab` or
`semicolon`). Values may not contain the chosen delimiter or a newline.

Adding to a **pool** creates rows without attaching them to any level; adding
to a **level** does both. Both return the created things, and that response is
the authoritative source of new thing IDs.

### Detach versus delete

Two endpoints remove an item, and they are not interchangeable.

| | `/ajax/level/thing_remove/` | `/ajax/thing/delete/` |
| --- | --- | --- |
| Params | `level_id`, `thing_id` | `thing_id` |
| Effect | takes the row out of **one level** | destroys the **pool row** |
| Other levels using it | unaffected | lose it too |
| Repeat call | succeeds | **404** `Thing not found` |
| Reversible | re-attach it | no |

`thing/delete/` answers `{"success": true}`, after
which `/ajax/thing/get/` on that ID is a 404. A neighbouring row was untouched
and the course's level count did not change, so the blast radius is the single
row. But every level of a course normally shares **one** pool, so a row used
by several levels disappears from all of them at once.

Rows detached from every level stay in the pool forever and are invisible to
the JSON API: `learnable_ids` only reports attached rows and `pool/search/`
cannot list. Finding them means diffing the pool's database pages against the
levels. `findOrphanedThings()` does this.

### `POST /ajax/thing/cell/update/`

Overwrites **one** cell of an existing thing. There is no multi-cell form, so
editing a row means one request per field.

```
thing_id=504646011&cell_id=2&cell_type=column&new_val=Bear+edit
```

`cell_type` is `column` or `attribute`; `cell_id` is the numeric key from
`/ajax/pool/get/` for that family. `new_val` replaces the value outright.

The response is `{"success": null}`, not `true`,
whether or not it wrote, so it says nothing about the outcome. Read the row
back with `/ajax/thing/get/` to confirm; `updateThing()` does this for you.

**Writes are dropped silently under the account rate limit.** Observed once
during testing: a 200 with the usual `{"success": null}`, and the row still
held its old value on read-back. There is no error, no status code and no
flag to distinguish this from a successful write, so the read-back is the
only way to know. Budget requests accordingly: a named single-cell edit is
four requests unless the pool is already known.
`accepted` is regenerated from the new value, and the `choices` /
`distractors` arrays refill from the rest of the pool.

### `POST /ajax/level/delete/`

```
level_id=16405677
```

The response is exactly `{"success": true}`, with no
other keys, and unlike `thing/cell/update/` the flag is meaningful. Deleting a
level that is not there answers **404** rather than `{"success": false}`, so a
repeat delete throws instead of being idempotent.

A non-empty level answers the same `{"success": true}`, and its things survive
in the pool. Deleting a level detaches rows rather than destroying them, so
the only way to see them afterwards is the database pages.

Confirm a delete with `getCourseLevelsIncludingEmpty()`, not
`/v1.25/courses/{id}/levels/`, because the JSON endpoint omits empty levels, so a
freshly created level looks deleted there before it is.

### `POST /ajax/level/set_columns/`

```
level_id=16264988&column_a=1&column_b=2
```

`column_a` is what the learner is **prompted with**, `column_b` is what they
are **tested on**. The editor labels these "Prompt with" and "Test On"
respectively, so the payload order is the reverse of the form's reading order.

Answers `{"success": true}`.

The pairing is stored on the **level**, not the pool, so levels sharing a pool
can test different pairs. It does not appear in `/ajax/pool/get/` at all. Read
it back from `learnable_ids` instead: the low 16 bits of a learnable ID are
`(column_a << 8) | column_b`, which is what `getLevelColumnPair` decodes.

Because learnable IDs encode the pair, every ID in the level changes when this
is called. Re-read the level rather than reusing IDs from before the call.

### `POST /ajax/pool/columns/set/`

```
pool_id=7778482&column_key=2&label=Definition&keyboard=abc+def
&show_bigger=false&never_italicize=false&typing_disabled=false
&tapping_disabled=false&typing_strict=false&always_show=false
&show_after_tests=false
```

Answers `{"saved": true}`. The key is `saved`, not the `success` every
neighbouring endpoint returns, so a caller checking `success` reads `undefined`.

This is a **whole-config replace**, not a patch: every field must be sent on
every call, and anything omitted reverts. `setPoolColumnSettings` reads the
pool first and resends the unchanged fields so callers can pass one flag.

Two of the flags do not round-trip under their own names. `/ajax/pool/get/`
reports them as entries in the column's `classes` array instead:

| Sent as | Read back as |
| --- | --- |
| `show_bigger=true` | `classes: ["bigger"]` |
| `never_italicize=true` | `classes: ["unitalic"]` |

The remaining five (`typing_disabled`, `tapping_disabled`, `typing_strict`,
`always_show`, `show_after_tests`) round-trip as booleans of the same name.

`keyboard` is the literal character set for the on-screen keyboard; a space
wraps it onto a new row. Empty means the learner's own keyboard.

Settings live on the pool, so they apply to every level sharing it. Which
columns a level tests is a separate, level-scoped call (see
`/ajax/level/set_columns/`).

## HTML surfaces

Some data has no JSON equivalent. These are scrapes and correspondingly
fragile, so prefer the JSON paths above.

### `GET /ajax/level/editing_html/?level_id={id}`

Returns `{ success, rendered }` where `rendered` is the level's editing table.
Rows are `<tr class="thing" data-thing-id="…">` with cells carrying `data-key`
and `data-cell-type="column|attribute"`, each wrapping a `<div class="text">`.

Useful because it needs **only a level ID** (no course ID) and returns every
column and attribute value in one request. This client no longer uses it
(`learnable_ids >> 16` covers the same need in JSON), but it remains the only
single-request source of non-tested column values for a level.

### `GET /course/{courseId}/{slug}/edit/database/{poolId}/?page=N`

The whole pool, 20 things per page, same `data-thing-id` row markup. Covers
things not attached to any level, which `learnable_ids` cannot see. The slug is
not checked (a wrong one 301s to the right URL), but the course ID is.

### `GET /course/{courseId}/{slug}/edit/`

Lists every level *including empty ones*, as
`<div id="l_{id}" class="level…" data-level-id data-pool-id>` with
`.level-handle` for the index and `.level-name` for the title. This is how
`getCourseLevelsIncludingEmpty` recovers levels the JSON endpoint omits.

## Endpoints seen but not exercised

Present in the editor bundle (`/editing/dist/js/editing-*.js`) and presumably
live, but **not tested here**, with no shapes or parameters confirmed:

```
/ajax/course/delete/                /ajax/pool/attributes/set/
/ajax/course/picture/               /ajax/pool/structure_add/
/ajax/course/pool/delete/           /ajax/pool/structure_delete/
/ajax/course/pool/levelify/         /ajax/thing/add/
/ajax/course/pool/set_title/        /ajax/thing/cell/upload_file/
/ajax/course/reorder_levels/        /ajax/thing/column/delete_from/
/ajax/level/duplicate/              /ajax/user/get/
/ajax/level/reorder/                /ajax/user/mempals_following/
/ajax/level/set_multimedia/
```

Both `/ajax/thing/delete/` and `/ajax/level/thing_remove/` have now been
exercised. See [detach versus delete](#detach-versus-delete).
`/ajax/thing/column/update_alts/` has too; see
[update_alts](#post-ajaxthingcolumnupdate_alts).

## Gotchas

- **Column keys are numeric strings.** `{"term": "hola"}` will not work;
  `{"1": "hola"}` will. Read them from `/ajax/pool/get/`.
- **`pool/search/` cannot list a pool.** An empty filter is a 500, not an empty
  result. See the table above.
- **Level *positions* skip empty levels** in the JSON endpoint, so indexing
  into the returned array silently drifts. Each level's own `index` field is
  1-based and authoritative (it matches the editor, gaps included), so match
  on that rather than on array position.
- **Detaching is not deleting.** `level/thing_remove/` leaves the pool row in
  place; only `thing/delete/` destroys it. See the table above.
- **`thing/cell/update/` always answers `{"success": null}`.** Success and
  failure look identical; verify by reading the thing back. So does
  `thing/column/update_alts/`.
- **Alternatives are replaced wholesale.** `update_alts` takes the complete
  list, so read the current one first unless you mean to drop it.
- **Learnable IDs are not thing IDs**, but they contain them. Passing a
  learnable ID to a thing endpoint fails.
- **Learnable IDs exceed 2³²** (~3.3×10¹³) but stay inside `Number.MAX_SAFE_INTEGER`,
  so plain JS numbers are fine, with no BigInt needed.
- **Writes are immediately consistent.** `learnable_ids` reflects an add or a
  remove on the very next request; no cache delay was observed, which is what
  makes it usable for verifying a mutation.
- **Batch learnable URLs 414** past roughly 400 IDs.
- **`progress` in a session response is empty until the account has studied
  the course**, which reads as "no progress data here" when it is really "no
  progress yet". `GET /v1.25/progress/` is the authoritative source.
- **`sync_token` is a timestamp cursor**, not a page number. Pass `0` for
  everything, or the last one you got for a delta.
- **Bulk adds are delimiter-separated text**, so a value containing the
  delimiter corrupts every column after it. Commas are common in definitions,
  which made the obvious default the dangerous one. `pickBulkDelimiter()`
  chooses comma, tab or semicolon based on the data.
- **Adding a word that already exists in the pool reuses the existing row**
  rather than creating a duplicate, and returns that row's thing ID.
- **Rate limiting is account-wide and unforgiving.** Sustained traffic earns
  `429 {"error": "Too Many Requests"}` on *every* endpoint at once, `/v1.25/`
  and `/ajax/` alike, and it persists well past 25 minutes. There is no
  `Retry-After` header to read. This client does not retry or back off, so a
  429 surfaces as a bare `Request failed with status code 429`; batch work
  should pace itself rather than discover the limit.
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
