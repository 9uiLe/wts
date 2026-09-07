import { version as packageVersion } from "../package.json";

declare const WTS_BUILD_VERSION: string | undefined;

export const version =
	typeof WTS_BUILD_VERSION === "undefined" ? packageVersion : WTS_BUILD_VERSION;

export function parseReleaseVersion(releaseVersion: string): string {
	const semver =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
	if (releaseVersion.match(semver)?.[0] !== releaseVersion) {
		throw new Error("WTS_RELEASE_VERSION must be a SemVer without a v prefix");
	}
	return releaseVersion;
}
