const semver =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parseReleaseVersion(releaseVersion: string): string {
	if (releaseVersion.match(semver)?.[0] !== releaseVersion) {
		throw new Error("WTS_RELEASE_VERSION must be a SemVer without a v prefix");
	}
	return releaseVersion;
}
