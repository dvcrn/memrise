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

**Course Management:**

- `getMyCourses(limit?, offset?)` - Get your courses
- `getCourseById(courseId)` - Get course by ID
- `getCourseBySlug(slug)` - Get course by slug
- `getCourseLevels(courseId)` - Get levels for a course
- `getCourseLevelsIncludingEmpty(courseId, slug?)` - Get levels including empty draft levels from the edit view
- `getCourseColumns(courseId)` - Get column configuration for a course

**Reading Items:**

- `getCourseItems(courseId, limit?)` - Get items from a course (optionally limit results)
- `getLevelItems(courseId, levelIndex, limit?)` - Get items from a specific level (optionally limit results)
- `getLearnable(learnableId)` - Get a single learnable item
- `getLearnables(learnableIds)` - Fetch many learnables in one batched request
- `getLevel(courseId, levelId)` - Look up a single level
- `getLevelThingIds(courseId, levelId)` - Thing IDs attached to a level, in level order
- `getLevelThings(courseId, levelId)` - Things in a level, each with its thing ID and the learnable text

**Adding Items:**

- `addThingToCourse(courseId, columns, levelIndex?)` - Add item to course (default: first level)
- `addThingToLevel(levelId, columns)` - Add item to specific level
- `bulkAddToCourse(courseId, rows, levelIndex?, delimiter?)` - Bulk add items to a course (default: first level)
- `bulkAddToLevel(levelId, rows, delimiter?)` - Bulk add items to a specific level
- `bulkAddToPool(poolId, rows, delimiter?)` - Bulk add items to a pool (not attached to a level)
- `addLevelToCourse(courseId, poolId?, kind?)` - Add a new level to a course
- `setLevelTitle(levelId, newTitle)` - Rename a level
- `deleteLevel(levelId)` - Delete a level
- `deleteThingFromLevel(levelId, thingId)` - Remove a thing from a level

**Pool Operations:**

- `searchPool(poolId, columns, excludeThingIds?, originalOnly?)` - Search pool. Requires at least one non-empty column value; an empty filter throws (the endpoint answers 500)
- `getPool(poolId)` - Get pool information

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

See [docs/api.md](docs/api.md) for the evidence behind this, the full endpoint
reference, and the quirks worth knowing before adding new calls.

## License

MIT
