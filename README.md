# Memrise API Client

Unofficial Memrise Community Courses API client JavaScript

## Installation

```bash
npm install memrise
```

## Usage as agent skill

- Either add `dvcrn/skills` or `dvcrn/memrise` as skill repository which should discover the `memrise` skill
- You can also do a `npx skills add dvcrn/skills` or `npx skills add dvcrn/memrise`

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

// Add a new level to a course (auto-uses pool from first existing level)
await client.addLevelToCourse("123456");

// Add a new level to a course with explicit pool_id and kind
await client.addLevelToCourse("123456", "7772442", "things");

// Search pool
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

**Adding Items:**

- `addThingToCourse(courseId, columns, levelIndex?)` - Add item to course (default: first level)
- `addThingToLevel(levelId, columns)` - Add item to specific level
- `addLevelToCourse(courseId, poolId?, kind?)` - Add a new level to a course

**Pool Operations:**

- `searchPool(poolId, columns, excludeThingIds?, originalOnly?)` - Search pool
- `getPool(poolId)` - Get pool information

## License

MIT
