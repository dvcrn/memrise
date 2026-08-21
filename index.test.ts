import { expect, test } from "bun:test";
import {
	assertThingId,
	pickBulkDelimiter,
	asThingId,
	columnPairFromLearnableId,
	formatBulkThingData,
	learnableIdFromThingId,
	MemriseClient,
	thingIdFromLearnableId,
} from "./index";

test("MemriseClient constructs and defers authentication", () => {
	const client = new MemriseClient("user@example.com", "not-a-real-password");
	// Authentication starts in the constructor. Nothing here should await it,
	// so swallow the rejection these fake credentials will produce.
	// @ts-ignore - reaching for a private field to keep the test offline
	client.authReady?.catch(() => {});

	expect(client).toBeDefined();
	// @ts-ignore - private
	expect(client.csrfToken).toBeNull();
});

test("formatBulkThingData passes through a raw string", () => {
	expect(formatBulkThingData("foo,bar\nfoo2,bar2")).toBe("foo,bar\nfoo2,bar2");
});

test("formatBulkThingData joins array rows with commas", () => {
	expect(
		formatBulkThingData([
			["foo", "bar"],
			["foo2", "bar2"],
		]),
	).toBe("foo,bar\nfoo2,bar2");
});

test("formatBulkThingData maps column records by numeric key order", () => {
	expect(
		formatBulkThingData([
			{ "2": "bar", "1": "foo" },
			{ "1": "foo2", "2": "bar2" },
		]),
	).toBe("foo,bar\nfoo2,bar2");
});

test("formatBulkThingData fills missing column indexes", () => {
	expect(formatBulkThingData([{ "1": "foo", "3": "baz" }])).toBe("foo,,baz");
});

test("formatBulkThingData supports tab and semicolon delimiters", () => {
	expect(formatBulkThingData([["foo", "bar"]], "tab")).toBe("foo\tbar");
	expect(formatBulkThingData([["foo", "bar"]], "semicolon")).toBe("foo;bar");
});

test("formatBulkThingData avoids a delimiter that occurs in the values", () => {
	// A comma in a definition used to corrupt the row; tab is picked instead.
	expect(formatBulkThingData([["foo,bar", "baz"]])).toBe("foo,bar\tbaz");
	expect(pickBulkDelimiter([["foo,bar", "baz"]])).toBe("tab");
	expect(pickBulkDelimiter([["plain", "values"]])).toBe("comma");
	expect(pickBulkDelimiter([["a,b", "c\td"]])).toBe("semicolon");
});

test("formatBulkThingData still rejects a delimiter given explicitly", () => {
	expect(() => formatBulkThingData([["foo,bar", "baz"]], "comma")).toThrow(
		/delimiter or a newline/,
	);
});

test("pickBulkDelimiter refuses when every delimiter collides", () => {
	expect(() => pickBulkDelimiter([["a,b", "c\td", "e;f"]])).toThrow(
		/cannot be encoded unambiguously/,
	);
});

test("searchPool rejects an empty column filter instead of hitting the API", async () => {
	const client = new MemriseClient("csrftoken=testtoken; sessionid=123");
	expect(client.searchPool(1, {})).rejects.toThrow(
		/at least one non-empty column value/,
	);
	expect(client.searchPool(1, { "1": "" })).rejects.toThrow(
		/at least one non-empty column value/,
	);
});

// Recorded from live courses. A learnable ID packs the thing it was built from
// into the high bits and the column pair it tests into the low 16.
const LEARNABLE_TO_THING: Array<[number, number, number]> = [
	// [learnableId, thingId, columnPair]
	[33075772588290, 504696237, 0x0102],
	[33075772653826, 504696238, 0x0102],
	[33075772719362, 504696239, 0x0102],
	[31330446672130, 478064677, 0x0102],
	[32690739282178, 498821095, 0x0102],
];

test("thingIdFromLearnableId recovers the thing ID", () => {
	for (const [learnableId, thingId] of LEARNABLE_TO_THING) {
		expect(thingIdFromLearnableId(learnableId)).toBe(thingId);
	}
});

test("consecutive things step the learnable ID by one column-pair block", () => {
	expect(33075772653826 - 33075772588290).toBe(65536);
	expect(thingIdFromLearnableId(33075772653826)).toBe(
		thingIdFromLearnableId(33075772588290) + 1,
	);
});

test("the low bits are the column pair, not part of the thing ID", () => {
	for (const [learnableId, , pair] of LEARNABLE_TO_THING) {
		expect(learnableId % 65536).toBe(pair);
	}
	// Same thing, different column pairing -> different learnable, same thing ID.
	const thing = 504696237;
	expect(thingIdFromLearnableId(thing * 65536 + 0x0102)).toBe(thing);
	expect(thingIdFromLearnableId(thing * 65536 + 0x0302)).toBe(thing);
});

test("thing IDs stay inside the safe integer range", () => {
	for (const [learnableId] of LEARNABLE_TO_THING) {
		expect(Number.isSafeInteger(learnableId)).toBe(true);
	}
});

test("columnPairFromLearnableId reads the tested columns", () => {
	// Pool 7776382 feeds levels testing column 1 -> 2 and column 3 -> 2.
	expect(columnPairFromLearnableId(504696237 * 65536 + 0x0102)).toEqual({
		learningColumn: 1,
		definitionColumn: 2,
	});
	expect(columnPairFromLearnableId(504696237 * 65536 + 0x0302)).toEqual({
		learningColumn: 3,
		definitionColumn: 2,
	});
	expect(columnPairFromLearnableId(33075772588290)).toEqual({
		learningColumn: 1,
		definitionColumn: 2,
	});
});

test("learnableIdFromThingId round-trips against recorded IDs", () => {
	for (const [learnableId, thingId] of LEARNABLE_TO_THING) {
		const pair = columnPairFromLearnableId(learnableId);
		expect(learnableIdFromThingId(thingId, pair)).toBe(learnableId);
	}
});

test("the same thing under two pairings gives two learnable IDs", () => {
	const thingId = 504696237;
	const a = learnableIdFromThingId(thingId, {
		learningColumn: 1,
		definitionColumn: 2,
	});
	const b = learnableIdFromThingId(thingId, {
		learningColumn: 3,
		definitionColumn: 2,
	});
	expect(a).not.toBe(b);
	expect(thingIdFromLearnableId(a)).toBe(thingId);
	expect(thingIdFromLearnableId(b)).toBe(thingId);
});

test("assertThingId accepts a thing ID unchanged", () => {
	expect(assertThingId(504696237)).toBe(asThingId(504696237));
});

test("assertThingId rejects a learnable ID and names the right one", () => {
	expect(() => assertThingId(33075772588290)).toThrow(
		/needs a thingId but was given 33075772588290.*Did you mean 504696237/s,
	);
});

test("assertThingId names the calling method in the error", () => {
	expect(() => assertThingId(33075772588290, "deleteThingFromLevel")).toThrow(
		/^deleteThingFromLevel needs a thingId/,
	);
});

test("the thing/learnable magnitude gap is wide enough to tell them apart", () => {
	// Observed live: thing IDs peak around 2^29, learnable IDs start near 2^43.
	for (const [learnableId, thingId] of LEARNABLE_TO_THING) {
		expect(thingId).toBeLessThan(0xffffffff);
		expect(learnableId).toBeGreaterThan(0xffffffff);
	}
});
