import { isAbsolute, relative, sep } from "node:path";

export function isSameOrDescendant(path: string, parent: string): boolean {
	const suffix = relative(parent, path);
	return (
		suffix === "" ||
		(suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
	);
}
