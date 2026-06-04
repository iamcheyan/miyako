export function getBaseName(path: string): string {
  return path.split("/").pop() || path;
}

export function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.substring(0, lastDot) : name;
}

export function getDisplayName(path: string): string {
  return stripExtension(getBaseName(path));
}

export function getParentDirName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}
