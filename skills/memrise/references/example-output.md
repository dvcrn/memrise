# memcli Example Output

Captured on February 15, 2026 from `/Users/david/src/memcli` using:
`bun run ./dist/index.js ...`

## Root Help

Command:

```bash
bun run ./dist/index.js --help
```

Output:

```text
Usage: memcli [options] [command]

CLI for Memrise teaching

Options:
  -V, --version                                         output the version number
  --username <value>                                    Memrise username
  --password <value>                                    Memrise password
  --client-id <value>                                   Optional client id
  -o, --output <mode>                                   Output format (text|json) (default: "text")
  -h, --help                                            display help for command

Commands:
  courses|my-courses [options]                          List your teaching courses
  course-by-id|course-id <course-id>                    Get course by ID
  course-by-slug|course-slug <slug>                     Get course by slug
  levels|course-levels <course-id>                      Get levels for a course
  columns|course-columns <course-id>                    Get columns for a course
  words|items [options] <course-id>                     Get words/items in a course or specific level
  learnable <learnable-id>                              Get learnable item by ID
  get-pool <pool-id>                                    Get pool information
  search-pool [options] <pool-id>                       Search pool by column values
  add-thing-course|add-to-course [options] <course-id>  Add a thing to a course (first level by default)
  add-thing-level|add-to-level [options] <level-id>     Add a thing to a specific level
  help [command]                                        display help for command
```

## `courses` Help

Command:

```bash
bun run ./dist/index.js courses --help
```

Output:

```text
Usage: memcli courses|my-courses [options]

List your teaching courses

Options:
  --limit <number>   Limit for courses (default: 9)
  --offset <number>  Offset for courses (default: 0)
  -h, --help         display help for command
```

## `words` Help

Command:

```bash
bun run ./dist/index.js words --help
```

Output:

```text
Usage: memcli words|items [options] <course-id>

Get words/items in a course or specific level

Arguments:
  course-id         Course ID

Options:
  --level <index>   Level index (1-based)
  --limit <number>  Limit items
  -h, --help        display help for command
```

## `add-to-course` Help

Command:

```bash
bun run ./dist/index.js add-to-course --help
```

Output:

```text
Usage: memcli add-thing-course|add-to-course [options] <course-id>

Add a thing to a course (first level by default)

Arguments:
  course-id               Course ID

Options:
  --field <key=value>     Column pair, repeatable (default: [])
  --columns <json>        JSON map of column pairs
  --level-index <number>  Level index (default: 0)
  -h, --help              display help for command
```

## Missing Credentials Error

Command:

```bash
bun run ./dist/index.js courses
```

Output:

```text
Error: Missing credentials. Set MEMRISE_USERNAME and MEMRISE_PASSWORD env vars or pass --username/--password.
```

## Authenticated Examples (Environment Variables)

The following commands assume `MEMRISE_USERNAME` and `MEMRISE_PASSWORD` are set
in the shell environment.

### Courses JSON Summary

Command:

```bash
bun run ./dist/index.js courses --output json \
  | jq '{applied_filter,course_count:(.courses|length),first_course:(.courses[0]|{id,name,slug})}'
```

Output:

```json
{
  "applied_filter": "teaching",
  "course_count": 5,
  "first_course": {
    "id": "1268555",
    "name": "Daily Random Japanese",
    "slug": "daily-random-japanese"
  }
}
```

### Levels JSON Summary

Command:

```bash
bun run ./dist/index.js levels 6711617 --output json \
  | jq 'map({id,index,title,pool_id}) | .[:3]'
```

Output:

```json
[
  {
    "id": 16240224,
    "index": 1,
    "title": "01/12",
    "pool_id": 7772442
  },
  {
    "id": 16242332,
    "index": 2,
    "title": "01/13",
    "pool_id": 7772442
  },
  {
    "id": 16242559,
    "index": 3,
    "title": "01/15",
    "pool_id": 7772442
  }
]
```

### Words JSON Summary

Command:

```bash
bun run ./dist/index.js words 6711617 --limit 3 --output json \
  | jq 'map({id,learning_element,definition_element,item_type})'
```

Output:

```json
[
  {
    "id": 31156870906114,
    "learning_element": "mii",
    "definition_element": "to have",
    "item_type": "word"
  },
  {
    "id": 31156870447362,
    "learning_element": "kin",
    "definition_element": "eat, drink",
    "item_type": "word"
  },
  {
    "id": 31156933296386,
    "learning_element": "sawadee",
    "definition_element": "hello",
    "item_type": "word"
  }
]
```
