import { expect, test } from "bun:test";
import { formatBulkThingData, MemriseClient } from "./index";

test("MemriseClient instantiation", () => {
	const cookie = "csrftoken=testtoken; sessionid=123";
	const client = new MemriseClient(cookie);
	expect(client).toBeDefined();
});

test("MemriseClient extractCsrfToken", () => {
	const cookie = "csrftoken=testtoken; sessionid=123";
	const client = new MemriseClient(cookie);
	// @ts-ignore - accessing private property for testing
	expect(client.csrfToken).toBe("testtoken");
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

test("formatBulkThingData rejects values that contain the delimiter", () => {
	expect(() => formatBulkThingData([["foo,bar", "baz"]])).toThrow(
		"delimiter or a newline",
	);
	expect(() => formatBulkThingData([["foo\nbar", "baz"]])).toThrow(
		"delimiter or a newline",
	);
});
