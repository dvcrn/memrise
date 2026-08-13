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
