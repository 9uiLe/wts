export function parseGitVersion(
	text: string,
): { major: number; minor: number } | undefined {
	const match = /^git version (\d+)\.(\d+)/.exec(text);
	return match
		? { major: Number(match[1]), minor: Number(match[2]) }
		: undefined;
}
export function supportsUpdateRefs(text: string): boolean {
	const version = parseGitVersion(text);
	return (
		!!version &&
		(version.major > 2 || (version.major === 2 && version.minor >= 38))
	);
}
