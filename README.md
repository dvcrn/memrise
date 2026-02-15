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

// Add items to a specific level
await client.addThingToLevel("level-id", {
  "1": "word",
  "2": "definition",
});

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

- `getMyCourses(limit?, offset?)` - Get your courses
- `getCourseById(courseId)` - Get course by ID
- `getCourseBySlug(slug)` - Get course by slug
- `getCourseLevels(courseId)` - Get levels for a course
- `getCourseColumns(courseId)` - Get column configuration for a course
- `getCourseItems(courseId)` - Get all items in a course
- `addThingToCourse(courseId, columns, levelIndex?)` - Add item to course (default: first level)
- `addThingToLevel(levelId, columns)` - Add item to specific level
- `searchPool(poolId, columns, excludeThingIds?, originalOnly?)` - Search pool
- `getPool(poolId)` - Get pool information
- `getLearnable(learnableId)` - Get learnable item

## License

MIT
