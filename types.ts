/**
 * Memrise has two ID namespaces that are easy to confuse. These brands are
 * compile-time only -- they erase to plain numbers at runtime -- but they stop
 * a learnable ID being passed where a thing ID belongs.
 *
 * IDs handed back by this SDK are already branded. To brand a number from
 * elsewhere, use `asThingId` / `asLearnableId`, which is deliberately an
 * explicit act.
 */
declare const THING_ID: unique symbol;
declare const LEARNABLE_ID: unique symbol;

/** A row in a pool. What the mutation endpoints operate on. */
export type ThingId = number & { readonly [THING_ID]: true };

/** A thing plus the column pair being tested. What levels report. */
export type LearnableId = number & { readonly [LEARNABLE_ID]: true };

export function asThingId(id: number): ThingId {
	return id as ThingId;
}

export function asLearnableId(id: number): LearnableId {
	return id as LearnableId;
}

export interface MemriseColumn {
	val: string;
	kind: string;
	accepted: string[];
	alts: string[];
	choices: string[];
	distractors: {
		typing: string[];
		tapping: string[];
		multiple_choice: string[];
		audio: string[];
		default: string[];
	};
	typing_corrects: Record<string, unknown>;
}

export interface MemriseThing {
	id: number;
	pool_id: number;
	columns: Record<string, MemriseColumn>;
	attributes: Record<string, unknown>;
}

export interface AddThingResponse {
	success: boolean;
	thing: MemriseThing;
	rendered_thing: string;
}

export type BulkWordDelimiter = "comma" | "tab" | "semicolon";

export type BulkThingRow = string[] | Record<string, string>;

export type BulkThingRows = string | BulkThingRow[];

export interface BulkAddResponse {
	success: boolean;
	things: MemriseThing[];
}

export interface AddLevelResponse {
	success: boolean;
	/** ID of the level just created, recovered from the redirect URL. */
	levelId?: number;
	redirect_url?: string;
	level?: CourseLevel;
	rendered_level?: string;
	[key: string]: unknown;
}

export interface SetLevelTitleResponse {
	success: boolean;
	[key: string]: unknown;
}

export interface DeleteLevelResponse {
	success: boolean;
	[key: string]: unknown;
}

export interface DeleteThingResponse {
	success: boolean;
	[key: string]: unknown;
}

export interface SearchPoolResultItem {
	id: number;
	columns: Record<string, { val: string }>;
}

export interface SearchPoolResponse {
	success: boolean;
	result: SearchPoolResultItem[];
}

/** A pair of pool columns: one prompts, the other answers. */
export interface ColumnPair {
	learningColumn: number;
	definitionColumn: number;
}

export interface LevelThing {
	/** Pool-authoring identity. This is what deleteThingFromLevel needs. */
	thingId: ThingId;
	/** Course-facing identity the thing ID was derived from. */
	learnableId: LearnableId;
	learningElement: string;
	definitionElement: string;
	itemType: string;
	difficulty: string;
}

export interface PoolColumnConfig {
	kind: string;
	label: string;
	typing_disabled: boolean;
	typing_strict: boolean;
	show_after_tests: boolean;
	always_show: boolean;
	keyboard: string;
	tapping_disabled: boolean;
	classes: string[];
}

export interface PoolAttributeConfig {
	kind: string;
	label: string;
	show_at_tests: boolean;
}

export interface Pool {
	id: number;
	name: string;
	columns: Record<string, PoolColumnConfig>;
	attributes: Record<string, PoolAttributeConfig>;
	can_curate: boolean;
	can_moderate: boolean;
}

export interface GetPoolResponse {
	pool: Pool;
}

export interface DashboardCategory {
	id: string;
	name: string;
	photo_url: string;
	slug: string;
}

export interface DashboardCourseProgress {
	id: number;
	name: string;
	size: number;
	due_review: number;
	learned: number;
	ignored: number;
	difficult: number;
	completed_this_session: boolean;
	percent_complete: number;
}

export interface DashboardCourse {
	id: string;
	name: string;
	slug: string;
	is_official: boolean;
	photo_url: string;
	progress: DashboardCourseProgress;
}

export interface GetDashboardCoursesResponse {
	applied_filter: string;
	applied_category: string | null;
	categories: DashboardCategory[];
	courses: DashboardCourse[];
	has_more_pages: boolean;
}

export interface CourseLevel {
	course_id: number;
	id: number;
	index: number;
	kind: number;
	learnable_ids?: number[];
	pool_id: number;
	title: string;
}

export interface Learnable {
	id: number;
	learning_element: string;
	definition_element: string;
	item_type: string;
	difficulty: string;
}

/**
 * A learnable as this SDK hands it out: the raw fields plus the thing ID it
 * was built from, so callers never have to unpack the ID themselves.
 */
export interface CourseItem {
	learnableId: LearnableId;
	thingId: ThingId;
	learningElement: string;
	definitionElement: string;
	itemType: string;
	difficulty: string;
}

export interface GetLearnableResponse {
	learnables: Record<string, Learnable>;
}

export interface EnsureCsrfResponse {
	csrf_token: string;
}

export interface AccessTokenPayload {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	[key: string]: unknown;
}

export interface AccessTokenUser {
	id: number;
	username: string;
	is_new: boolean;
}

export interface AccessTokenResponse {
	access_token: AccessTokenPayload;
	user: AccessTokenUser;
}

export interface AuthWebResponse {
	success?: boolean;
	[key: string]: unknown;
}
