import { fileIconUrl } from "../lib/fileIcons";

export default function FileIcon({ path, size = 16 }: { path: string; size?: number }) {
  return <img className="file-type-icon" src={fileIconUrl(path)} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
