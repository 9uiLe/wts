import { version as packageVersion } from "../package.json";

declare const WTS_BUILD_VERSION: string | undefined;

export const version =
	typeof WTS_BUILD_VERSION === "undefined" ? packageVersion : WTS_BUILD_VERSION;
