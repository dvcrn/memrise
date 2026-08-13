import { MemriseClient } from "./index";

const username = process.env.MEMRISE_USERNAME;
const password = process.env.MEMRISE_PASSWORD;

if (!username || !password) {
	console.error("MEMRISE_USERNAME and MEMRISE_PASSWORD must be set");
	process.exit(1);
}

const courseId = process.env.MEMRISE_TEST_COURSE_ID || "6717539";
const stamp = Date.now();

const poolRows = [
	[`bulk-pool-${stamp}-a`, "pool-def-a"],
	[`bulk-pool-${stamp}-b`, "pool-def-b"],
];
const levelRows = [
	[`bulk-level-${stamp}-a`, "level-def-a"],
	[`bulk-level-${stamp}-b`, "level-def-b"],
];

function columnVal(thing: {
	columns: Record<string, { val: string }>;
	id: number;
}): string {
	return `${thing.columns["1"]?.val ?? "?"} = ${thing.columns["2"]?.val ?? "?"} (thing ${thing.id})`;
}

console.log("Authenticating...");
const client = new MemriseClient(username, password);

try {
	const levelsBefore = await client.getCourseLevelsIncludingEmpty(courseId);
	const level = levelsBefore[0];
	if (!level) {
		throw new Error(`No levels found for course ${courseId}`);
	}

	const poolId = level.pool_id;
	const levelId = level.id;
	const learnableIdsBefore = new Set(level.learnable_ids ?? []);

	console.log(`Dummy course ${courseId}`);
	console.log(`  pool ${poolId}`);
	console.log(`  level ${levelId} "${level.title}"`);
	console.log(`  learnables in first level before: ${learnableIdsBefore.size}`);

	console.log("\n1. bulkAddToPool...");
	const poolResult = await client.bulkAddToPool(poolId, poolRows);
	console.log(
		`   success=${poolResult.success} created=${poolResult.things.length}`,
	);
	for (const thing of poolResult.things) {
		console.log(`   + ${columnVal(thing)}`);
	}

	console.log("\n2. bulkAddToLevel...");
	const levelResult = await client.bulkAddToLevel(levelId, levelRows);
	console.log(
		`   success=${levelResult.success} created=${levelResult.things.length}`,
	);
	for (const thing of levelResult.things) {
		console.log(`   + ${columnVal(thing)}`);
	}

	if (
		!poolResult.success ||
		poolResult.things.length !== poolRows.length ||
		!levelResult.success ||
		levelResult.things.length !== levelRows.length
	) {
		throw new Error("Bulk add did not return the expected things");
	}

	console.log("\n3. Searching pool for the pool-added words...");
	const missingFromPool: string[] = [];
	for (const [word, definition] of poolRows) {
		const search = await client.searchPool(poolId, { "1": word, "2": definition });
		const match = search.result.find((item) => item.columns["1"]?.val === word);
		if (match) {
			console.log(`   found in pool: ${word} = ${definition} (id ${match.id})`);
		} else {
			console.log(`   NOT found in pool: ${word} = ${definition}`);
			console.log(`   search payload: ${JSON.stringify(search)}`);
			missingFromPool.push(word);
		}
	}

	console.log("\n4. Re-reading first level for the level-added words...");
	const levelsAfter = await client.getCourseLevelsIncludingEmpty(courseId);
	const levelAfter = levelsAfter.find((item) => item.id === levelId);
	const learnableIdsAfter = levelAfter?.learnable_ids ?? [];
	const newLearnableIds = learnableIdsAfter.filter(
		(id) => !learnableIdsBefore.has(id),
	);
	console.log(
		`   learnables in first level after: ${learnableIdsAfter.length} (new: ${newLearnableIds.length})`,
	);

	const levelItems = await client.getLevelItems(courseId, 0);
	const missingFromLevel: string[] = [];
	for (const [word, definition] of levelRows) {
		const match = levelItems.find((item) => item.learning_element === word);
		if (match) {
			console.log(
				`   found in level: ${match.learning_element} = ${match.definition_element} (learnable ${match.id})`,
			);
		} else {
			console.log(`   NOT found in level items: ${word} = ${definition}`);
			missingFromLevel.push(word);
		}
	}

	const failed =
		missingFromPool.length > 0 ||
		missingFromLevel.length > 0 ||
		newLearnableIds.length < levelRows.length;

	if (failed) {
		console.error("\nBulk add verification failed.");
		process.exit(1);
	}

	console.log("\nBoth bulk methods added items and they are readable back.");
} catch (error) {
	const err = error as {
		message?: string;
		response?: { status?: number; data?: unknown };
	};
	console.error("Error:", err.message);
	if (err.response) {
		console.error("Response:", err.response.status, err.response.data);
	}
	process.exit(1);
}
