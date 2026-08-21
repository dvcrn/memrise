import axios from "axios";
import { asLearnableId, asThingId } from "./types.js";

export { asLearnableId, asThingId } from "./types.js";
export type * from "./types.js";
import type {
	AccessTokenResponse,
	ColumnPair,
	CourseItem,
	LearnableId,
	ThingId,
	AddLevelResponse,
	AddThingResponse,
	AuthWebResponse,
	BulkAddResponse,
	BulkThingRow,
	BulkThingRows,
	BulkWordDelimiter,
	CourseLevel,
	DashboardCourse,
	DeleteLevelResponse,
	DeleteThingResponse,
	EnsureCsrfResponse,
	GetDashboardCoursesResponse,
	GetLearnableResponse,
	GetPoolResponse,
	Learnable,
	LevelThing,
	PoolColumnConfig,
	SearchPoolResponse,
	SetLevelTitleResponse,
} from "./types.js";

const DEFAULT_CLIENT_ID = "1e739f5e77704b57a703";

const BULK_DELIMITER_CHARS: Record<BulkWordDelimiter, string> = {
	comma: ",",
	tab: "\t",
	semicolon: ";",
};

function orderedValuesFromRecord(row: Record<string, string>): string[] {
	const numericKeys = Object.keys(row)
		.filter((key) => /^\d+$/.test(key))
		.map(Number)
		.sort((a, b) => a - b);

	if (numericKeys.length === 0) {
		return [];
	}

	const maxKey = numericKeys[numericKeys.length - 1];
	if (maxKey == null) {
		return [];
	}

	const values: string[] = [];
	for (let i = 1; i <= maxKey; i++) {
		values.push(row[String(i)] ?? "");
	}
	return values;
}

/**
 * Choose a delimiter that appears in none of the values.
 *
 * Bulk adds are serialised as delimiter-separated text, so a definition
 * containing the delimiter would silently misalign the columns. Commas are
 * common in definitions, tabs and semicolons much less so.
 */
export function pickBulkDelimiter(rows: BulkThingRow[]): BulkWordDelimiter {
	const values = rows.flatMap((row) =>
		Array.isArray(row) ? row : orderedValuesFromRecord(row),
	);

	for (const candidate of ["comma", "tab", "semicolon"] as const) {
		const sep = BULK_DELIMITER_CHARS[candidate];
		if (!values.some((value) => value.includes(sep))) return candidate;
	}

	throw new Error(
		"Every supported delimiter (comma, tab, semicolon) appears in the values being added, so the rows cannot be encoded unambiguously. Split the batch or remove the punctuation.",
	);
}

export function formatBulkThingData(
	rows: BulkThingRows,
	delimiter?: BulkWordDelimiter,
): string {
	if (typeof rows === "string") {
		return rows;
	}

	const chosen = delimiter ?? pickBulkDelimiter(rows);
	const sep = BULK_DELIMITER_CHARS[chosen];
	return rows
		.map((row) => {
			const values = Array.isArray(row) ? row : orderedValuesFromRecord(row);
			for (const value of values) {
				if (value.includes(sep) || /[\r\n]/.test(value)) {
					throw new Error(
						`Bulk row value contains the '${chosen}' delimiter or a newline: ${JSON.stringify(value)}`,
					);
				}
			}
			return values.join(sep);
		})
		.join("\n");
}

/**
 * Learnable IDs are derived from the thing they were built from: the thing ID
 * occupies the high bits and the low 16 bits identify the column pair the
 * learnable tests (0x0102 = column 1 prompts column 2, and so on). So a thing
 * ID can be recovered from a learnable ID without another request, while the
 * reverse needs to know the column pair.
 */
const LEARNABLE_THING_SHIFT = 65536;

/**
 * Number of learnable IDs per /v1.25/learnables/ request. 400 ids is still
 * accepted and 793 answers 414, so this leaves plenty of headroom.
 */
const LEARNABLE_BATCH_SIZE = 200;

/** /v1.25/dashboard/courses/ rejects a limit above this with a 400. */
const DASHBOARD_MAX_PAGE_SIZE = 9;

/**
 * Recover the thing ID a learnable was built from.
 *
 * Pure arithmetic, no request. The reverse needs the column pair, so see
 * {@link learnableIdFromThingId} and {@link MemriseClient.getLearnableIdInLevel}.
 */
export function thingIdFromLearnableId(learnableId: number): ThingId {
	return asThingId(Math.floor(learnableId / LEARNABLE_THING_SHIFT));
}

/**
 * Which pair of columns a learnable tests, e.g. column 1 prompting column 2.
 */
export function columnPairFromLearnableId(learnableId: number): ColumnPair {
	const pair = learnableId % LEARNABLE_THING_SHIFT;
	return {
		learningColumn: (pair >> 8) & 0xff,
		definitionColumn: pair & 0xff,
	};
}

/**
 * Build a learnable ID from a thing and the column pair being tested.
 *
 * The column pair belongs to the level, not the thing: one pool can feed
 * levels that test different pairings. Prefer
 * {@link MemriseClient.getLearnableIdInLevel}, which reads the pair from the
 * level and checks the thing is actually in it, over calling this directly.
 */
export function learnableIdFromThingId(
	thingId: number,
	pair: ColumnPair,
): LearnableId {
	return asLearnableId(
		thingId * LEARNABLE_THING_SHIFT +
			((pair.learningColumn & 0xff) << 8) +
			(pair.definitionColumn & 0xff),
	);
}

/**
 * Largest plausible thing ID. Thing IDs are pool row numbers (~2^29 today);
 * learnable IDs start around 2^43 because of the 16 bit shift, so anything
 * above this is a learnable ID that reached the wrong parameter.
 */
const MAX_PLAUSIBLE_THING_ID = 0xffffffff;

/**
 * Guard a value that must be a thing ID.
 *
 * This exists for the error message, not for correctness -- callers that
 * mutate a level still verify membership. It turns the most common mistake
 * into an answer instead of a confusing failure downstream.
 */
export function assertThingId(id: number, context = "This call"): ThingId {
	if (id > MAX_PLAUSIBLE_THING_ID) {
		throw new Error(
			`${context} needs a thingId but was given ${id}, which is a learnableId. Did you mean ${thingIdFromLearnableId(id)}? (learnableId = thing plus the column pair being tested; see docs/api.md)`,
		);
	}
	return asThingId(id);
}

export class MemriseClient {
	private client = axios.create({
		baseURL: "https://community-courses.memrise.com",
		headers: {
			origin: "https://community-courses.memrise.com",
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
			"x-requested-with": "XMLHttpRequest",
		},
	});
	private cookie: string;
	private csrfToken: string | null;
	private accessToken: string | null;
	private cookieJar: Map<string, string>;
	private authReady: Promise<void>;
	private poolIdByLevel = new Map<string, number>();
	private columnKeysByPool = new Map<string, Map<string, string>>();

	constructor(
		username: string,
		password: string,
		clientId: string = DEFAULT_CLIENT_ID,
	) {
		this.cookie = "";
		this.csrfToken = null;
		this.accessToken = null;
		this.cookieJar = new Map();

		this.authReady = this.authenticateWithCredentials(
			username,
			password,
			clientId,
		);
	}

	private async authenticateWithCredentials(
		username: string,
		password: string,
		clientId: string,
	): Promise<void> {
		const csrf = await this.getCsrfToken();
		if (csrf) {
			this.csrfToken = csrf;
			this.client.defaults.headers.common["x-csrftoken"] = csrf;
		}

		const access = await this.getAccessToken(username, password, clientId);
		this.accessToken = access.access_token.access_token;
		// Don't set authorization header globally - v1.25 endpoints use session cookies only
		// this.client.defaults.headers.common['authorization'] = `Bearer ${this.accessToken}`;

		await this.authenticateWeb(this.accessToken);
	}

	private mergeSetCookieCookies(setCookieValues: string[]): void {
		if (setCookieValues.length === 0) return;

		for (const item of setCookieValues) {
			const firstPair = item.split(";")[0];
			if (!firstPair) continue;
			const [name, ...rest] = firstPair.split("=");
			if (!name || rest.length === 0) continue;
			this.cookieJar.set(name, rest.join("="));
		}

		this.cookie = [...this.cookieJar.entries()]
			.map(([name, value]) => `${name}=${value}`)
			.join("; ");
		this.client.defaults.headers.common["cookie"] = this.cookie;
	}

	private extractFromCookie(cookieHeader: string, name: string): string | null {
		const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
		return match?.[1] ?? null;
	}

	private async ensureAuthenticated(): Promise<void> {
		await this.authReady;
	}

	private parseEditorLevelMetadata(
		editHtml: string,
	): Array<{ id: number; pool_id: number; index: number; title: string }> {
		const levels: Array<{
			id: number;
			pool_id: number;
			index: number;
			title: string;
		}> = [];
		const seen = new Set<number>();

		const startTagRegex =
			/<div id="l_(\d+)"\s+class="level[^"]*"\s+data-level-id="(\d+)"\s+data-pool-id="(\d+)">/g;

		for (const match of editHtml.matchAll(startTagRegex)) {
			const fromIdAttr = Number(match[2]);
			const fromStartTag = Number(match[1]);
			const poolId = Number(match[3]);
			const id = Number.isFinite(fromIdAttr) ? fromIdAttr : fromStartTag;

			if (!Number.isFinite(id) || !Number.isFinite(poolId) || seen.has(id)) {
				continue;
			}

			const startIndex = match.index ?? 0;
			const snippet = editHtml.slice(startIndex, startIndex + 3500);
			const indexMatch = snippet.match(
				/<div class="level-handle">(\d+)<\/div>/,
			);
			const titleMatch = snippet.match(
				/<h3 class="level-name"[^>]*>\s*([\s\S]*?)\s*<\/h3>/,
			);

			const parsedIndex = Number(indexMatch?.[1]);
			const index = Number.isFinite(parsedIndex)
				? parsedIndex
				: levels.length + 1;
			const titleRaw = (titleMatch?.[1] ?? "").replace(/<[^>]*>/g, "").trim();
			const title = titleRaw || `Level ${index}`;

			levels.push({
				id,
				pool_id: poolId,
				index,
				title,
			});
			seen.add(id);
		}

		return levels;
	}

	async getCsrfToken(): Promise<string | null> {
		const response = await axios.get<EnsureCsrfResponse>(
			"https://community-courses.memrise.com/v1.25/web/ensure_csrf",
			{
				headers: {
					accept: "*/*",
					"sec-fetch-site": "same-origin",
					cookie: this.cookie,
					"sec-fetch-dest": "empty",
					"accept-language": "en-US,en;q=0.9",
					"sec-fetch-mode": "cors",
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15",
					"accept-encoding": "gzip, deflate, br, zstd",
					referer:
						"https://community-courses.memrise.com/signin?next=%2Fdashboard",
					priority: "u=3, i",
				},
			},
		);

		const setCookie = response.headers?.["set-cookie"];
		const setCookieValues = Array.isArray(setCookie)
			? setCookie
			: typeof setCookie === "string"
				? [setCookie]
				: [];

		this.mergeSetCookieCookies(setCookieValues);
		const tokenFromPayload =
			typeof response.data?.csrf_token === "string"
				? response.data.csrf_token
				: null;
		const tokenFromCookie = this.extractFromCookie(this.cookie, "csrftoken");

		return tokenFromPayload ?? tokenFromCookie;
	}

	async getAccessToken(
		username: string,
		password: string,
		clientId: string = DEFAULT_CLIENT_ID,
	): Promise<AccessTokenResponse> {
		const response = await axios.post<AccessTokenResponse>(
			"https://community-courses.memrise.com/v1.25/auth/access_token/",
			{
				username,
				password,
				grant_type: "password",
				client_id: clientId,
			},
			{
				headers: {
					referer:
						"https://community-courses.memrise.com/signin?next=%2Fdashboard",
					cookie: this.cookie,
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15",
					origin: "https://community-courses.memrise.com",
					"sec-fetch-dest": "empty",
					"sec-fetch-site": "same-origin",
					"accept-language": "en-US,en;q=0.9",
					accept: "*/*",
					"content-type": "application/json",
					"accept-encoding": "gzip, deflate, br, zstd",
					"sec-fetch-mode": "cors",
					"x-client-type": "web",
					"x-correlation-id": "df0e2b0d-c4de-4cb8-b976-7f807fbbc77c",
					"x-timezone": "Asia/Phnom_Penh",
					"x-device-type": "desktop",
					"x-os": "mac_os",
					...(this.csrfToken ? { "x-csrftoken": this.csrfToken } : {}),
					...(this.accessToken
						? { authorization: `Bearer ${this.accessToken}` }
						: {}),
					"x-os-version": "10.15.7",
					"x-browser": "Safari",
					"x-browser-version": "26.3",
				},
			},
		);

		const setCookie = response.headers?.["set-cookie"];
		const setCookieValues = Array.isArray(setCookie)
			? setCookie
			: typeof setCookie === "string"
				? [setCookie]
				: [];

		this.mergeSetCookieCookies(setCookieValues);

		return response.data;
	}

	async authenticateWeb(token: string): Promise<AuthWebResponse> {
		const response = await axios.get<AuthWebResponse>(
			"https://community-courses.memrise.com/v1.25/auth/web/",
			{
				params: {
					invalidate_token_after: true,
					token,
				},
				headers: {
					accept: "*/*",
					"sec-fetch-site": "same-origin",
					"sec-fetch-mode": "cors",
					"accept-language": "en-US,en;q=0.9",
					"user-agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15",
					referer:
						"https://community-courses.memrise.com/signin?next=%2Fdashboard",
					"accept-encoding": "gzip, deflate, br, zstd",
					cookie: this.cookie,
					"sec-fetch-dest": "empty",
					"x-device-type": "desktop",
					"x-correlation-id": crypto.randomUUID(),
					"x-os": "mac_os",
					"x-timezone": "Asia/Phnom_Penh",
					priority: "u=3, i",
					"x-browser": "Safari",
					"x-browser-version": "26.3",
					"x-client-type": "web",
					"x-os-version": "10.15.7",
				},
			},
		);

		const setCookie = response.headers?.["set-cookie"];
		const setCookieValues = Array.isArray(setCookie)
			? setCookie
			: typeof setCookie === "string"
				? [setCookie]
				: [];

		this.mergeSetCookieCookies(setCookieValues);

		// Update CSRF token from the updated cookies
		const updatedCsrfToken = this.extractFromCookie(this.cookie, "csrftoken");
		if (updatedCsrfToken) {
			this.csrfToken = updatedCsrfToken;
			this.client.defaults.headers.common["x-csrftoken"] = updatedCsrfToken;
		}

		return response.data;
	}

	async addThingToLevel(
		levelId: string | number,
		columns: Record<string, string>,
	): Promise<AddThingResponse> {
		await this.ensureAuthenticated();

		const resolved = await this.resolveColumnsForLevel(levelId, columns);

		const data = new URLSearchParams();
		data.append("columns", JSON.stringify(resolved));
		data.append("level_id", String(levelId));

		const response = await this.client.post<AddThingResponse>(
			"/ajax/level/thing/add/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async addLevelToCourse(
		courseId: string | number,
		poolId?: string | number,
		kind: string = "things",
	): Promise<AddLevelResponse> {
		await this.ensureAuthenticated();

		let resolvedPoolId = poolId;
		if (resolvedPoolId == null) {
			const levels = await this.getCourseLevels(courseId);
			const firstLevel = levels[0];
			if (!firstLevel) {
				throw new Error(
					`No levels found for course ${courseId}. Provide poolId explicitly.`,
				);
			}
			resolvedPoolId = firstLevel.pool_id;
		}

		const data = new URLSearchParams();
		data.append("course_id", String(courseId));
		data.append("kind", kind);
		data.append("pool_id", String(resolvedPoolId));

		const response = await this.client.post<AddLevelResponse>(
			"/ajax/level/add/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		// The endpoint reports the new level only as an anchor on the redirect
		// URL, e.g. "/course/1/slug/edit/#l_16402418".
		const levelId = Number(
			/#l_(\d+)/.exec(response.data?.redirect_url ?? "")?.[1],
		);

		if (Number.isFinite(levelId)) {
			// A new level is empty, so the levels endpoint will not report it
			// yet. Remember its pool so column names still resolve.
			this.poolIdByLevel.set(String(levelId), Number(resolvedPoolId));
			return { ...response.data, levelId };
		}

		return response.data;
	}

	async setLevelTitle(
		levelId: string | number,
		newTitle: string,
	): Promise<SetLevelTitleResponse> {
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("level_id", String(levelId));
		data.append("new_val", newTitle);

		const response = await this.client.post<SetLevelTitleResponse>(
			"/ajax/level/set_title/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async deleteLevel(levelId: string | number): Promise<DeleteLevelResponse> {
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("level_id", String(levelId));

		const response = await this.client.post<DeleteLevelResponse>(
			"/ajax/level/delete/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async deleteThingFromLevel(
		levelId: string | number,
		thingId: string | number,
	): Promise<DeleteThingResponse> {
		assertThingId(Number(thingId), "deleteThingFromLevel");
		await this.ensureAuthenticated();

		const data = new URLSearchParams();
		data.append("level_id", String(levelId));
		data.append("thing_id", String(thingId));

		const response = await this.client.post<DeleteThingResponse>(
			"/ajax/level/thing_remove/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	/**
	 * Add one item to a course, addressed by the level number Memrise shows.
	 */
	async addThingToCourse(
		courseId: string | number,
		columns: Record<string, string>,
		levelNumber: number = 1,
	): Promise<AddThingResponse> {
		const level = await this.getLevelByNumber(courseId, levelNumber);
		return this.addThingToLevel(level.id, columns);
	}

	async bulkAddToPool(
		poolId: string | number,
		rows: BulkThingRows,
		delimiter?: BulkWordDelimiter,
	): Promise<BulkAddResponse> {
		await this.ensureAuthenticated();

		const resolvedRows = await this.resolveRowsForPool(poolId, rows);
		const chosenDelimiter =
			delimiter ??
			(typeof resolvedRows === "string"
				? "comma"
				: pickBulkDelimiter(resolvedRows));
		const payload = formatBulkThingData(resolvedRows, chosenDelimiter);
		if (payload.trim() === "") {
			throw new Error("No rows provided for bulk add");
		}

		const data = new URLSearchParams();
		data.append("word_delimiter", chosenDelimiter);
		data.append("data", payload);
		data.append("pool_id", String(poolId));

		const response = await this.client.post<BulkAddResponse>(
			"/ajax/pool/add_things_in_bulk/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	async bulkAddToLevel(
		levelId: string | number,
		rows: BulkThingRows,
		delimiter?: BulkWordDelimiter,
	): Promise<BulkAddResponse> {
		await this.ensureAuthenticated();

		const resolvedRows = await this.resolveRowsForLevel(levelId, rows);
		const chosenDelimiter =
			delimiter ??
			(typeof resolvedRows === "string"
				? "comma"
				: pickBulkDelimiter(resolvedRows));
		const payload = formatBulkThingData(resolvedRows, chosenDelimiter);
		if (payload.trim() === "") {
			throw new Error("No rows provided for bulk add");
		}

		const data = new URLSearchParams();
		data.append("word_delimiter", chosenDelimiter);
		data.append("data", payload);
		data.append("level_id", String(levelId));

		const response = await this.client.post<BulkAddResponse>(
			"/ajax/level/add_things_in_bulk/",
			data,
			{
				headers: {
					"content-type": "application/x-www-form-urlencoded; charset=UTF-8",
				},
			},
		);

		return response.data;
	}

	/**
	 * Bulk add to a course, addressed by the level number Memrise shows.
	 */
	async bulkAddToCourse(
		courseId: string | number,
		rows: BulkThingRows,
		levelNumber: number = 1,
		delimiter?: BulkWordDelimiter,
	): Promise<BulkAddResponse> {
		const level = await this.getLevelByNumber(courseId, levelNumber);
		return this.bulkAddToLevel(level.id, rows, delimiter);
	}

	async searchPool(
		poolId: string | number,
		columns: Record<string, string>,
		excludeThingIds: string[] = [],
		originalOnly: boolean = false,
	): Promise<SearchPoolResponse> {
		const resolvedColumns = await this.resolveColumnKeys(poolId, columns);
		const terms = Object.values(resolvedColumns).filter(
			(value) => typeof value === "string" && value.length > 0,
		);
		if (terms.length === 0) {
			throw new Error(
				"searchPool requires at least one non-empty column value. Memrise's /ajax/pool/search/ endpoint has no 'return everything' mode and responds with HTTP 500 for an empty filter. Use getLevelThings(levelId) to enumerate a level's things instead.",
			);
		}

		await this.ensureAuthenticated();

		const params = {
			pool_id: poolId,
			original_only: originalOnly,
			columns: JSON.stringify(resolvedColumns),
			exclude_thing_ids: JSON.stringify(excludeThingIds),
			_: Date.now(),
		};

		const response = await this.client.get<SearchPoolResponse>(
			"/ajax/pool/search/",
			{
				params,
			},
		);

		return response.data;
	}

	async getPool(poolId: string | number): Promise<GetPoolResponse> {
		await this.ensureAuthenticated();

		const params = {
			pool_id: poolId,
			_: Date.now(),
		};

		const response = await this.client.get<GetPoolResponse>("/ajax/pool/get/", {
			params,
		});

		return response.data;
	}

	async getMyCourses(
		limit: number = 9,
		offset: number = 0,
	): Promise<GetDashboardCoursesResponse> {
		await this.ensureAuthenticated();

		const params = {
			filter: "teaching",
			limit,
			offset,
		};

		const response = await this.client.get<GetDashboardCoursesResponse>(
			"/v1.25/dashboard/courses/",
			{
				params,
			},
		);

		return response.data;
	}

	/**
	 * Every course on your dashboard, following pagination.
	 *
	 * getMyCourses exposes the API's own page size, which silently truncates
	 * at nine. This walks the pages so callers see the whole list.
	 */
	async getAllMyCourses(limit?: number): Promise<DashboardCourse[]> {
		const courses: DashboardCourse[] = [];
		// The dashboard endpoint answers 400 for a limit above 9.
		const pageSize = DASHBOARD_MAX_PAGE_SIZE;
		let offset = 0;

		while (true) {
			const page = await this.getMyCourses(pageSize, offset);
			courses.push(...page.courses);
			if (limit && courses.length >= limit) return courses.slice(0, limit);
			if (!page.has_more_pages || page.courses.length === 0) break;
			offset += pageSize;
		}

		return courses;
	}

	async getCourseById(
		courseId: string | number,
	): Promise<DashboardCourse | null> {
		const courses = await this.getAllMyCourses();
		return courses.find((c) => String(c.id) === String(courseId)) ?? null;
	}

	async getCourseBySlug(slug: string): Promise<DashboardCourse | null> {
		const courses = await this.getAllMyCourses();
		return courses.find((c) => c.slug === slug) ?? null;
	}

	async getCourseLevels(
		courseId: string | number,
		slug?: string,
	): Promise<CourseLevel[]> {
		await this.ensureAuthenticated();

		const response = await this.client.get<{ levels: CourseLevel[] }>(
			`/v1.25/courses/${courseId}/levels/`,
		);

		for (const level of response.data.levels) {
			this.poolIdByLevel.set(String(level.id), level.pool_id);
		}

		return response.data.levels;
	}

	async getCourseLevelsIncludingEmpty(
		courseId: string | number,
		slug?: string,
	): Promise<CourseLevel[]> {
		await this.ensureAuthenticated();

		const apiLevels = await this.getCourseLevels(courseId, slug);
		const byId = new Map<string, CourseLevel>();

		for (const level of apiLevels) {
			byId.set(String(level.id), level);
		}

		let resolvedSlug = slug;
		if (!resolvedSlug) {
			const course = await this.getCourseById(courseId);
			if (!course) {
				throw new Error(`Course ${courseId} not found`);
			}
			resolvedSlug = course.slug;
		}

		const response = await this.client.get<string>(
			`/course/${courseId}/${resolvedSlug}/edit/`,
		);
		const editorLevels = this.parseEditorLevelMetadata(response.data);

		for (const editorLevel of editorLevels) {
			const existing = byId.get(String(editorLevel.id));
			if (existing) {
				continue;
			}

			byId.set(String(editorLevel.id), {
				course_id: Number(courseId),
				id: editorLevel.id,
				index: editorLevel.index,
				kind: 1,
				learnable_ids: [],
				pool_id: editorLevel.pool_id,
				title: editorLevel.title,
			});
		}

		return [...byId.values()].sort((a, b) => {
			if (a.index !== b.index) return a.index - b.index;
			return a.id - b.id;
		});
	}

	async getLearnable(learnableId: string | number): Promise<Learnable | null> {
		await this.ensureAuthenticated();

		try {
			const response = await this.client.get<GetLearnableResponse>(
				`/v1.25/learnables/${learnableId}/`,
			);
			return response.data.learnables[String(learnableId)] || null;
		} catch (error) {
			if (axios.isAxiosError(error) && error.response?.status === 404) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Every item in a course, each tagged with the level it sits in.
	 *
	 * The level mapping is free -- it comes from the same levels response used
	 * to collect the IDs -- and without it the result is a dead end, since
	 * removing an item needs the level it belongs to.
	 */
	async getCourseItems(
		courseId: string | number,
		limit?: number,
	): Promise<CourseItem[]> {
		const levels = await this.getCourseLevels(courseId);

		const levelsByLearnable = new Map<number, number[]>();
		for (const level of levels) {
			for (const learnableId of level.learnable_ids ?? []) {
				const existing = levelsByLearnable.get(learnableId);
				if (existing) existing.push(level.id);
				else levelsByLearnable.set(learnableId, [level.id]);
			}
		}

		const uniqueIds = [...levelsByLearnable.keys()];
		const idsToFetch = limit ? uniqueIds.slice(0, limit) : uniqueIds;
		const learnables = await this.getLearnables(idsToFetch);

		return learnables.map((learnable) => ({
			learnableId: asLearnableId(learnable.id),
			thingId: thingIdFromLearnableId(learnable.id),
			levelIds: levelsByLearnable.get(learnable.id) ?? [],
			learningElement: learnable.learning_element,
			definitionElement: learnable.definition_element,
			itemType: learnable.item_type,
			difficulty: learnable.difficulty,
		}));
	}

	/**
	 * Look up a level by the number Memrise shows in the editor.
	 *
	 * Levels carry their own 1-based `index`, and it is authoritative: the
	 * levels endpoint omits empty levels but the survivors keep their real
	 * numbers, so counting positions in the returned array drifts by however
	 * many empty levels precede it. Always match on `index`.
	 */
	async getLevelByNumber(
		courseId: string | number,
		levelNumber: number,
	): Promise<CourseLevel> {
		const levels = await this.getCourseLevels(courseId);
		const level = levels.find((l) => l.index === levelNumber);
		if (level) return level;

		const available = levels.map((l) => l.index).join(", ");
		throw new Error(
			`Course ${courseId} has no level numbered ${levelNumber}. Levels with content are numbered: ${available}. Numbers are 1-based and match the Memrise editor; gaps are empty levels, which the API does not return.`,
		);
	}

	/**
	 * Items in a level, addressed by the level number shown in Memrise.
	 */
	async getLevelItems(
		courseId: string | number,
		levelNumber: number = 1,
		limit?: number,
	): Promise<Learnable[]> {
		const level = await this.getLevelByNumber(courseId, levelNumber);
		const learnableIds = level.learnable_ids || [];
		const idsToFetch = limit ? learnableIds.slice(0, limit) : learnableIds;

		return this.getLearnables(idsToFetch);
	}

	async getLearnables(
		learnableIds: Array<string | number>,
	): Promise<Learnable[]> {
		if (learnableIds.length === 0) return [];

		await this.ensureAuthenticated();

		const learnables: Learnable[] = [];
		for (let i = 0; i < learnableIds.length; i += LEARNABLE_BATCH_SIZE) {
			const chunk = learnableIds.slice(i, i + LEARNABLE_BATCH_SIZE);
			const response = await this.client.get<GetLearnableResponse>(
				`/v1.25/learnables/${chunk.join(",")}/`,
			);

			for (const id of chunk) {
				const learnable = response.data.learnables?.[String(id)];
				if (learnable) learnables.push(learnable);
			}
		}

		return learnables;
	}

	/**
	 * Look up a single level on a course.
	 */
	async getLevel(
		courseId: string | number,
		levelId: string | number,
	): Promise<CourseLevel> {
		const levels = await this.getCourseLevels(courseId);
		const level = levels.find((l) => String(l.id) === String(levelId));
		if (!level) {
			throw new Error(
				`Level ${levelId} was not found on course ${courseId}. Note that the levels endpoint omits empty levels, so a level that exists but has no things will also land here — use getCourseLevelsIncludingEmpty to see those.`,
			);
		}
		return level;
	}

	/**
	 * List the thing IDs currently attached to a level, in level order.
	 *
	 * A level only reports learnable IDs, but a learnable ID embeds the thing
	 * it was built from, so no extra request is needed. See
	 * {@link thingIdFromLearnableId}.
	 */
	async getLevelThingIds(
		courseId: string | number,
		levelId: string | number,
	): Promise<ThingId[]> {
		const level = await this.getLevel(courseId, levelId);
		return (level.learnable_ids ?? []).map(thingIdFromLearnableId);
	}

	/**
	 * List the things attached to a level, with the thing ID needed for
	 * deletion alongside the learnable's text.
	 */
	async getLevelThings(
		courseId: string | number,
		levelId: string | number,
	): Promise<LevelThing[]> {
		const level = await this.getLevel(courseId, levelId);
		const learnableIds = level.learnable_ids ?? [];
		const learnables = await this.getLearnables(learnableIds);
		const byId = new Map(learnables.map((l) => [String(l.id), l]));

		return learnableIds.map((learnableId) => {
			const learnable = byId.get(String(learnableId));
			return {
				thingId: thingIdFromLearnableId(learnableId),
				learnableId: asLearnableId(learnableId),
				learningElement: learnable?.learning_element ?? "",
				definitionElement: learnable?.definition_element ?? "",
				itemType: learnable?.item_type ?? "",
				difficulty: learnable?.difficulty ?? "",
			};
		});
	}

	/**
	 * The pair of columns a level tests, read from its learnables.
	 *
	 * Uniform within a level, but a pool can host levels with different
	 * pairings, so this is a per-level question. Returns null if the level
	 * reports no learnables to read the pair from. Note that a wholly empty
	 * level is invisible to the levels endpoint and throws instead.
	 */
	async getLevelColumnPair(
		courseId: string | number,
		levelId: string | number,
	): Promise<ColumnPair | null> {
		const level = await this.getLevel(courseId, levelId);
		const first = (level.learnable_ids ?? [])[0];
		return first === undefined ? null : columnPairFromLearnableId(first);
	}

	/**
	 * Find the learnable ID for a thing as it appears in a given level.
	 *
	 * Returns null when the thing is not in the level, rather than handing back
	 * an ID that does not resolve.
	 */
	async getLearnableIdInLevel(
		courseId: string | number,
		levelId: string | number,
		thingId: string | number,
	): Promise<LearnableId | null> {
		const level = await this.getLevel(courseId, levelId);
		const wanted = String(thingId);
		const match = (level.learnable_ids ?? []).find(
			(learnableId) => String(thingIdFromLearnableId(learnableId)) === wanted,
		);
		return match === undefined ? null : asLearnableId(match);
	}

	/**
	 * The pool behind a level, without needing the course ID.
	 *
	 * The levels endpoint is course-scoped, so this consults a cache that every
	 * getCourseLevels call populates, and falls back to sweeping the courses on
	 * your dashboard. All JSON -- no page scraping.
	 *
	 * A level with no items is invisible to that endpoint. Levels created
	 * through addLevelToCourse are cached at creation, but for anything else,
	 * pass numeric column keys or use a course-scoped call.
	 */
	async getPoolIdForLevelId(levelId: string | number): Promise<number> {
		const key = String(levelId);
		const cached = this.poolIdByLevel.get(key);
		if (cached !== undefined) return cached;

		for (const course of (await this.getMyCourses(100, 0)).courses) {
			await this.getCourseLevels(course.id);
			const found = this.poolIdByLevel.get(key);
			if (found !== undefined) return found;
		}

		throw new Error(
			`Could not find level ${levelId} on any course on your dashboard, so its columns cannot be resolved by name. Empty levels are not listed by the API. Pass numeric column keys instead, or add via the course-scoped call.`,
		);
	}

	private async columnKeysFor(
		poolId: string | number,
	): Promise<Map<string, string>> {
		const key = String(poolId);
		const cached = this.columnKeysByPool.get(key);
		if (cached) return cached;

		const { pool } = await this.getPool(poolId);
		const byLabel = new Map<string, string>();
		for (const [columnKey, config] of Object.entries(pool.columns)) {
			byLabel.set(config.label.trim().toLowerCase(), columnKey);
		}

		this.columnKeysByPool.set(key, byLabel);
		return byLabel;
	}

	/**
	 * Translate a row keyed by column name into the numeric keys Memrise
	 * wants. Numeric keys pass through untouched, so callers that already
	 * speak the wire format keep working and pay no extra request.
	 *
	 * Names are matched case-insensitively against the pool's column labels.
	 */
	async resolveColumnKeys(
		poolId: string | number,
		row: Record<string, string>,
	): Promise<Record<string, string>> {
		if (!Object.keys(row).some((key) => !/^\d+$/.test(key))) {
			return { ...row };
		}

		const byLabel = await this.columnKeysFor(poolId);
		const resolved: Record<string, string> = {};
		for (const [key, value] of Object.entries(row)) {
			if (/^\d+$/.test(key)) {
				resolved[key] = value;
				continue;
			}
			const numeric = byLabel.get(key.trim().toLowerCase());
			if (!numeric) {
				throw new Error(
					`Pool ${poolId} has no column named "${key}". Available columns: ${[...byLabel.keys()].join(", ")}.`,
				);
			}
			resolved[numeric] = value;
		}
		return resolved;
	}

	/** Resolve named columns in a single row against the pool behind a level. */
	private async resolveColumnsForLevel(
		levelId: string | number,
		row: Record<string, string>,
	): Promise<Record<string, string>> {
		if (!Object.keys(row).some((key) => !/^\d+$/.test(key))) return { ...row };
		return this.resolveColumnKeys(
			await this.getPoolIdForLevelId(levelId),
			row,
		);
	}

	/** Resolve named columns in bulk rows against the pool behind a level. */
	private async resolveRowsForLevel(
		levelId: string | number,
		rows: BulkThingRows,
	): Promise<BulkThingRows> {
		if (typeof rows === "string") return rows;
		const needsLookup = rows.some(
			(row) =>
				!Array.isArray(row) &&
				Object.keys(row).some((key) => !/^\d+$/.test(key)),
		);
		if (!needsLookup) return rows;
		return this.resolveRowsForPool(await this.getPoolIdForLevelId(levelId), rows);
	}

	/** Resolve named columns in bulk rows against a pool. */
	private async resolveRowsForPool(
		poolId: string | number,
		rows: BulkThingRows,
	): Promise<BulkThingRows> {
		if (typeof rows === "string" || Array.isArray(rows) === false) return rows;

		const needsLookup = rows.some(
			(row) =>
				!Array.isArray(row) &&
				Object.keys(row).some((key) => !/^\d+$/.test(key)),
		);
		if (!needsLookup) return rows;

		const resolved: BulkThingRow[] = [];
		for (const row of rows) {
			resolved.push(
				Array.isArray(row) ? row : await this.resolveColumnKeys(poolId, row),
			);
		}
		return resolved;
	}

	async getCourseColumns(
		courseId: string | number,
	): Promise<Record<string, PoolColumnConfig>> {
		const levels = await this.getCourseLevels(courseId);

		if (levels.length === 0) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		const firstLevel = levels[0];
		if (!firstLevel) {
			throw new Error(`No levels found for course ${courseId}`);
		}

		const poolInfo = await this.getPool(firstLevel.pool_id);
		return poolInfo.pool.columns;
	}
}
