import type { ApiFolder } from "../toolTypes";
export function folderAncestors(folders: ApiFolder[], id: string): string[] {
  const result: string[] = [], seen = new Set([id]);
  let parent = folders.find((item) => item.id === id)?.parentId;
  while (parent && !seen.has(parent) && folders.some((item) => item.id === parent)) {
    result.push(parent); seen.add(parent); parent = folders.find((item) => item.id === parent)?.parentId;
  }
  return result;
}
export function canMoveFolder(folders: ApiFolder[], id: string, parentId: string) {
  return folders.some((item) => item.id === id) && id !== parentId && (!parentId || folders.some((item) => item.id === parentId)) && !folderAncestors(folders, parentId).includes(id);
}
export function orderedFolders(folders: ApiFolder[]): { folder: ApiFolder; depth: number }[] {
  const result: { folder: ApiFolder; depth: number }[] = [], seen = new Set<string>();
  const visit = (folder: ApiFolder, depth: number) => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id); result.push({ folder, depth });
    for (const child of folders.filter((item) => item.parentId === folder.id)) visit(child, depth + 1);
  };
  for (const folder of folders.filter((item) => !item.parentId || !folders.some((parent) => parent.id === item.parentId))) visit(folder, 0);
  for (const folder of folders) visit(folder, 0);
  return result;
}
