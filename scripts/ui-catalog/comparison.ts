import type { Capture } from "./capture";

export interface Comparison {
	current?: Capture;
	previous?: Capture;
	changed: boolean;
}
