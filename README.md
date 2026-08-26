# Memrise API Client

Unofficial Memrise Community Courses API client JavaScript

## Installation

```bash
npm install memrise
```

## Usage

```typescript
import { MemriseClient } from "memrise";

// Initialize with username and password
const client = new MemriseClient("username", "password");

// Get the signed-in account
const me = await client.getMe();
console.log(me.username, me.is_pro);

// Get your courses
const courses = await client.getMyCourses();
console.log(courses);

// Get course by ID or slug
const course = await client.getCourseById("123456");
const courseBySlug = await client.getCourseBySlug("my-course");

// Get course columns (to see what fields are available)
const columns = await client.getCourseColumns("123456");
console.log(columns);
// { "1": { "kind": "text", "label": "Word", ... }, ... }

// Add items to a course
await client.addThingToCourse("123456", {
  "1": "hello",
  "2": "こんにちは",
});

// Get course levels
const levels = await client.getCourseLevels("123456");

// Get course levels including empty levels visible in the editor
const allLevels = await client.getCourseLevelsIncludingEmpty("123456");

// Get all items from a course
const allItems = await client.getCourseItems("123456");

// Get limited items from a course (first 10 items)
const limitedItems = await client.getCourseItems("123456", 10);

// Get all items from a specific level (level 0)
const levelItems = await client.getLevelItems("123456", 0);

// Get limited items from a specific level (first 5 items from level 1)
const limitedLevelItems = await client.getLevelItems("123456", 1, 5);

// Add items to a specific level
await client.addThingToLevel("level-id", {
  "1": "word",
  "2": "definition",
});

// Bulk add items to a specific level
await client.bulkAddToLevel("level-id", [
  ["word", "definition"],
  ["word2", "definition2"],
]);

// Bulk add to a course (default: first level)
await client.bulkAddToCourse("123456", [
  ["hello", "こんにちは"],
  ["goodbye", "さようなら"],
]);

// Bulk add to the course database only (not attached to a level)
await client.bulkAddToPool("pool-id", [
  { "1": "hello", "2": "こんにちは" },
  { "1": "goodbye", "2": "さようなら" },
]);

// Or pass the raw delimited text the site uses
await client.bulkAddToLevel("level-id", "foo,bar\nfoo2,bar2");

// Add a new level to a course (auto-uses pool from first existing level)
await client.addLevelToCourse("123456");

// Add a new level to a course with explicit pool_id and kind
await client.addLevelToCourse("123456", "7772442", "things");

// Rename a level
await client.setLevelTitle("level-id", "02/19");

// Delete a level
await client.deleteLevel("level-id");

// Edit an existing item, by column name or numeric key
await client.updateThing("thing-id", { Definition: "corrected" });

// Cheaper: numeric keys and poolId skip lookups, verify: false skips the
// read-back. One request instead of four.
await client.updateThing(
  "thing-id",
  { "2": "corrected" },
  { poolId: "pool-id", verify: false },
);

// Or one cell at a time
await client.updateThingCell("thing-id", "2", "corrected");
await client.updateThingCell("thing-id", "Pronunciation", "kon-ni-chi-wa", {
  cellType: "attribute",
});

// Read a single row, every column, by thing ID
const { thing } = await client.getThing("thing-id");

// Remove a thing from a level
await client.deleteThingFromLevel("level-id", "thing-id");

// List every thing in a level, with the thing IDs deleteThingFromLevel needs
const levelThings = await client.getLevelThings("course-id", "level-id");

// Or just the thing IDs, with no extra request for the text
const thingIds = await client.getLevelThingIds("course-id", "level-id");

// Search pool. At least one non-empty column value is required -- Memrise has
// no "return everything" mode, use getLevelThings to enumerate instead.
const results = await client.searchPool("pool-id", {
  "1": "search term",
});

// Get pool information
const pool = await client.getPool("pool-id");
```

## API

### Constructor

```typescript
new MemriseClient(username: string, password: string, clientId?: string)
```

### Methods

**Account:**

- `getMe()` - The signed-in account: id, username, email, locale, Pro status and lifetime statistics

**Course Management:**

- `getAllMyCourses(limit?)` - Every course on your dashboard, following pagination
- `getMyCourses(limit?, offset?)` - One raw page of courses (the API caps `limit` at 9)
- `getCourseById(courseId)` - Get course by ID
- `getCourseBySlug(slug)` - Get course by slug
- `getCourseLevels(courseId)` - Get levels for a course
- `getCourseLevelsIncludingEmpty(courseId, slug?)` - Get levels including empty draft levels from the edit view
- `getCourseColumns(courseId)` - Get column configuration for a course

**Reading Items:**

- `getCourseItems(courseId, limit?)` - Every item in a course, each tagged with its thingId and the levelIds it belongs to
- `getLevelItems(courseId, levelNumber, limit?)` - Get items from a level by its Memrise number (1-based)
- `getLevelByNumber(courseId, levelNumber)` - Resolve a level by its Memrise number
- `getLearnable(learnableId)` - Get a single learnable item
- `getLearnables(learnableIds)` - Fetch many learnables in one batched request
- `getLevel(courseId, levelId)` - Look up a single level
- `getLevelThingIds(courseId, levelId)` - Thing IDs attached to a level, in level order
- `getLevelThings(courseId, levelId)` - Things in a level, each with its thing ID and the learnable text
- `getLevelColumnPair(courseId, levelId)` - Which columns a level tests
- `getLearnableIdInLevel(courseId, levelId, thingId)` - Learnable ID for a thing in a level, or null

**Adding Items:**

- `addThingToCourse(courseId, columns, levelNumber?)` - Add item to course (default: level 1)
- `addThingToLevel(levelId, columns)` - Add item to specific level
- `bulkAddToCourse(courseId, rows, levelNumber?, delimiter?)` - Bulk add items to a course (default: level 1)
- `bulkAddToLevel(levelId, rows, delimiter?)` - Bulk add items to a specific level
- `bulkAddToPool(poolId, rows, delimiter?)` - Bulk add items to a pool (not attached to a level)
- `addLevelToCourse(courseId, poolId?, kind?)` - Add a new level to a course
- `setLevelTitle(levelId, newTitle)` - Rename a level
- `deleteLevel(levelId)` - Delete a level
- `deleteThingFromLevel(levelId, thingId)` - Remove a thing from a level

**Editing Items:**

- `getThing(thingId)` - Read one pool row, every column and attribute
- `updateThing(thingId, columns, options?)` - Overwrite several cells of one thing, then read the row back to confirm. Options: `cellType` (`"column"` by default, or `"attribute"`), `poolId` (skips the lookup that resolves cell names), `verify` (`false` drops the read-back, saving a request)
- `updateThingCell(thingId, cell, newValue, options?)` - Overwrite one cell in a single request. Options: `cellType`, `poolId`

**Pool Operations:**

- `searchPool(poolId, columns, excludeThingIds?, originalOnly?)` - Search pool. Requires at least one non-empty column value; an empty filter throws (the endpoint answers 500)
- `getPool(poolId)` - Get pool information
- `getPoolIdForLevelId(levelId)` - Pool behind a level, without needing the course ID
- `resolveColumnKeys(poolId, row)` - Translate column names to numeric keys

## Column names

Memrise stores columns under numeric keys, but you can use their labels:

```typescript
await client.bulkAddToLevel(levelId, [
  { Word: "หมา (maa)", Definition: "dog" },
  { Word: "แมว (maew)", Definition: "cat" },
]);
```

Names are matched case-insensitively and resolved against the pool, which is
looked up once and cached. Numeric keys still work and skip the lookup
entirely, so nothing gets slower:

```typescript
await client.bulkAddToLevel(levelId, [{ "1": "หมา (maa)", "2": "dog" }]);
```

A name that does not exist fails with the list of ones that do:

```
Pool 7778482 has no column named "Wrod". Available columns: word, definition, audio.
```

## Level numbers

Level numbers are the 1-based numbers Memrise shows in the editor, and they are
matched against each level's own `index`:

```typescript
await client.getLevelItems(courseId, 3);
await client.getLevelByNumber(courseId, 3);
```

This matters because the levels endpoint **omits empty levels** while the
survivors keep their real numbers. Counting positions in the returned array
drifts by however many empty levels precede it. Asking for a number that is
empty or missing is an error naming the numbers that do exist, rather than
silently returning the wrong level.

## Thing IDs and learnable IDs

Memrise exposes two identifiers for what looks like the same item:

- **thing** — the row in the pool database. `deleteThingFromLevel`,
  `searchPool` and the `addThing*` responses all speak thing IDs.
- **learnable** — a thing *plus* the pair of columns being tested. Levels and
  the course-facing APIs report learnable IDs.

A learnable ID packs both together: the thing ID sits in the high bits and the
low 16 bits hold the column pair, so `0x...0102` means "column 1 prompts
column 2". `thingIdFromLearnableId(learnableId)` recovers the thing ID without
another request, which is how `getLevelThingIds` works. The reverse direction
is not derivable, since it needs the column pair.

This packing is an undocumented implementation detail, so treat it as a fast
path rather than a guarantee: it is safe to use for lookups and membership
checks, where a wrong answer surfaces as "not found", but never derive an ID
for a destructive call that was not confirmed against the API first.

The SDK keeps these apart for you rather than making you remember which is
which:

- **Types that carry both.** `getLevelThings()` returns `{ thingId,
  learnableId, … }`, so you never unpack an ID by hand.
- **The compiler catches mix-ups.** `ThingId` and `LearnableId` are branded
  types. They erase to plain numbers at runtime, but passing one where the
  other belongs is a compile error. Use `asThingId()` / `asLearnableId()` to
  brand a number from elsewhere.
- **So does the runtime.** Passing a learnable ID to `deleteThingFromLevel`
  throws immediately with the thing ID you probably meant, rather than failing
  somewhere downstream.

Only one direction is derivable without a request:

| Direction | Call |
| --- | --- |
| learnable → thing | `thingIdFromLearnableId(learnableId)` |
| learnable → columns tested | `columnPairFromLearnableId(learnableId)` |
| thing → learnable | `client.getLearnableIdInLevel(courseId, levelId, thingId)` |

See [docs/api.md](docs/api.md) for the evidence behind this, the full endpoint
reference, and the quirks worth knowing before adding new calls.

## License

MIT
